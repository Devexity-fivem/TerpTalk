// Progression V2 — server-side engine. Port of the Reputation 2.0 spine
// (append-only keyed ledger, signed reversals, durable outbox, drift-checked
// cached balances) with the locked V2 economy on top:
//
//   - Dual currency: ProgressionEvent.xp (mastery path XP) and
//     ProgressionEvent.standing (judgment-gated trust) — one ledger,
//     two balances, both summed for Profile.xp / Profile.standing.
//   - Quality bands + simhash duplicate tiers evaluated inside the award.
//   - Per-mastery weekly soft caps (250 full → 50% → 25%) on self-driven
//     sources; peer-gated types exempt.
//   - Standing controls: weekly ceiling 40, per-source 20/week,
//     per-grantor diminishing + lifetime 30, reciprocal discount,
//     grantor floor. Likes/reactions write nothing — callsites removed.
//
// Locked spec: docs/progression-v2-design.md (rev 3).
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { PROFILE_SECTION_BASE_LIMIT, SHOWN_STATS_BASE } from "@/lib/profile-settings"
import {
  DUP_REDUCE_PCT,
  DUP_WITHHOLD_PCT,
  DIVERSITY_FLOORS,
  MASTER_EXTRA_FLOOR,
  MASTERIES,
  MASTERY_WEEKLY_FULL,
  MASTERY_WEEKLY_MID,
  MASTERY_WEEKLY_MID_FACTOR,
  MASTERY_WEEKLY_TAIL_FACTOR,
  QUALITY_BANDS,
  REP_RANKS,
  STANDING_CLUSTER_SHARE,
  STANDING_GRANTOR_MIN_AGE_HOURS,
  STANDING_GRANTOR_REPEAT_FACTOR,
  STANDING_GRANTOR_WINDOW_DAYS,
  STANDING_PER_GRANTOR_LIFETIME,
  STANDING_PER_SOURCE_WEEK_CAP,
  STANDING_POLL_CREATE,
  STANDING_POLL_VOTE,
  STANDING_RECIPROCAL_WINDOW_DAYS,
  STANDING_SLOWMODE_EXEMPT,
  STANDING_WEEKLY_CAP,
  STANDINGS,
  UNLOCKS,
  UNLOCK_BY_ID,
  XP_TABLE,
  crossedRungs,
  masteryLevelFromXp,
  rankFromXp,
  type Mastery,
  type UnlockSpec,
} from "@/lib/progression-config"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import { announceTierUp } from "@/lib/terpbot"
import { notify } from "@/lib/notify"
import { RANK_DISPLAY, xpStage, nextRankUnlock } from "@/lib/progression-config"
import { rateLimit } from "@/lib/rate-limit"

export {
  MASTERIES,
  MASTERY_META,
  MASTERY_LEVELS,
  REP_RANKS,
  REP_SUBLEVELS,
  PROGRESSION_RUNGS,
  DIVERSITY_FLOORS,
  XP_TABLE,
  UNLOCKS,
  UNLOCK_BY_ID,
  STANDINGS,
  QUALITY_BANDS,
  STANDING_WEEKLY_CAP,
  rankFromXp,
  nextRank,
  rankProgress,
  masteryLevelFromXp,
  crossedRungs,
  buildTitle,
  standingName,
  type Mastery,
  type Rank,
  type UnlockSpec,
} from "@/lib/progression-config"

// ─── Types ───────────────────────────────────────────────────────────

export interface ProgressionAwardOptions {
  key?: string // idempotency token — required for any re-triggerable award
  sourceType?: string // THREAD | POST | DIARY | DIARY_UPDATE | SETUP | STRAIN | STRAIN_PHOTO | CONTEST | EXPERIMENT | GUIDE
  sourceId?: string
  actorId?: string // grantor (acceptor, referrer, voter quorum, staff)
  xp?: number // explicit override (STAFF_ADJUSTMENT, band bonuses)
  standing?: number // explicit standing delta (negatives, staff)
  mastery?: Mastery | null
  meta?: Record<string, unknown> // audit detail — band, dup, standingSource
  force?: boolean // staff adjustments bypass inactive-recipient skip
  marker?: boolean // write a 0-value audit row even when nothing pays (§6.7)
}

export interface ProgressionAwardResult {
  awarded: boolean
  reinstated?: boolean
  xp?: number
  standing?: number
  oldXp?: number
  newXp?: number
  rungsCrossed?: { xp: number; label: string; rank: string }[]
  skippedReason?: "bot" | "no-user" | "suspended" | "self" | "duplicate" | "capped" | "locked" | "withheld" | "dup" | "deferred"
}

type SubjectUser = {
  role: string | null
  createdAt: Date
  banned: boolean
  suspendedUntil: Date | null
  profile: { xp: number; standing: number; username: string } | null
}

function isInactive(u: SubjectUser): boolean {
  return u.banned || (!!u.suspendedUntil && u.suspendedUntil.getTime() > Date.now())
}

// ISO week start (Mon 00:00 UTC) for weekly caps.
function isoWeekStart(d = new Date()): Date {
  const day = (d.getUTCDay() + 6) % 7
  const w = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  w.setUTCDate(w.getUTCDate() - day)
  return w
}

const PEER_GATED_TYPES = new Set(
  Object.entries(XP_TABLE).filter(([, s]) => s.peerGated).map(([t]) => t)
)
// Standing sources that fall under the per-source-type weekly cap.
const STANDING_CAPPED_TYPES = new Set([
  "CONTEST_WEEKLY_WIN", "CONTEST_MONTHLY_WIN", "REFERRAL", "REPORT_UPHELD",
])

// ─── Simhash (deterministic, prose-only) ─────────────────────────────
// 32-bit FNV-1a simhash — bitwise ops are already 32-bit in JS, so no
// BigInt required. ~3% granularity, comfortable under the 85/95 tiers.

function fnv1a32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function simhash32(text: string): number {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean)
  const bits = new Array<number>(32).fill(0)
  for (const w of words) {
    const h = fnv1a32(w)
    for (let i = 0; i < 32; i++) bits[i] += ((h >>> i) & 1) ? 1 : -1
  }
  let out = 0
  for (let i = 0; i < 32; i++) if (bits[i] > 0) out |= 1 << i
  return out >>> 0
}

function similarity(a: number, b: number): number {
  const xor = (a ^ b) >>> 0
  let d = 0
  for (let i = 0; i < 32; i++) if ((xor >>> i) & 1) d++
  return Math.round(((32 - d) / 32) * 100)
}

/**
 * Locked §6.7: simhash of prose vs the author's own 30-day content.
 * ≥95% → withhold · 85–94% → reduce (bonuses withheld; base pays only if
 * structured data changed) · <85% → clean.
 * `structuredChanged` — caller-supplied signal that metric values, photos,
 * or nutrient rows differ from the similar item.
 */
export async function checkDuplicateContent(
  authorId: string,
  prose: string,
  opts: { structuredChanged?: boolean; priorTexts?: string[]; excludeId?: string } = {}
): Promise<{ verdict: "clean" | "reduced" | "withheld"; similarity: number; matchedSourceId?: string }> {
  if (!prose || prose.trim().length < 40)
    return { verdict: "clean", similarity: 0 }

  // Caller may supply texts directly (tests); otherwise scan the author's
  // recent authored prose. excludeId keeps the row being judged from
  // self-matching at 100%.
  const priorTexts = opts.priorTexts ?? (await loadAuthorProse(authorId, opts.excludeId))
  if (priorTexts.length === 0) return { verdict: "clean", similarity: 0 }

  const h = simhash32(prose)
  let best = 0
  for (const t of priorTexts) best = Math.max(best, similarity(h, simhash32(t)))

  if (best >= DUP_WITHHOLD_PCT)
    return { verdict: "withheld", similarity: best }
  if (best >= DUP_REDUCE_PCT)
    return { verdict: opts.structuredChanged ? "clean" : "reduced", similarity: best }
  return { verdict: "clean", similarity: best }
}

/**
 * §6.4a uniqueness — simhash(title+change+expected) of an experiment vs
 * the author's prior experiments. Returns the best similarity percent.
 * Identical re-created "failures" score ≥95 and forfeit the bonus.
 */
export async function experimentSimilarity(
  authorId: string,
  excludeId: string,
  text: string
): Promise<number> {
  const priors = await prisma.growExperiment.findMany({
    where: { authorId, id: { not: excludeId } },
    select: { title: true, change: true, expected: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
  if (!priors.length || text.trim().length < 10) return 0
  const h = simhash32(text)
  let best = 0
  for (const p of priors) {
    best = Math.max(best, similarity(h, simhash32([p.title, p.change, p.expected ?? ""].join("\n"))))
  }
  return best
}

async function loadAuthorProse(authorId: string, excludeId?: string): Promise<string[]> {
  const since = new Date(Date.now() - 30 * 86400000)
  const excl = excludeId ? { id: { not: excludeId } } : {}
  const [posts, updates] = await Promise.all([
    prisma.post.findMany({
      where: { authorId, createdAt: { gte: since }, ...excl },
      select: { content: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.diaryUpdate.findMany({
      where: { authorId, createdAt: { gte: since }, ...excl },
      select: { content: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ])
  return [...posts.map((p) => p.content), ...updates.map((u) => u.content ?? "")]
}

// ─── Quality bands (locked §6.7) ─────────────────────────────────────

export interface QualitySignals {
  chars: number // prose length
  structuredCategories: number // distinct structured groups present
  hasNumericMetric: boolean
  hasPhoto: boolean
}

export function updateBand(s: QualitySignals): 0 | 1 | 2 | 3 {
  const meaningful = s.chars >= 10 || s.hasPhoto || s.structuredCategories > 0
  if (!meaningful) return 0
  const band3 =
    s.chars >= QUALITY_BANDS.EXCEPTIONAL_MIN_CHARS &&
    s.structuredCategories >= QUALITY_BANDS.EXCEPTIONAL_MIN_CATEGORIES &&
    s.hasNumericMetric &&
    s.hasPhoto
  if (band3) return 3
  const band2 =
    (s.chars >= QUALITY_BANDS.RICH_MIN_CHARS && s.structuredCategories >= 1) ||
    s.structuredCategories >= QUALITY_BANDS.RICH_MIN_CATEGORIES
  if (band2) return 2
  return 1
}

// ─── Standing controls (locked §9.3) ─────────────────────────────────
// Returns the standing amount actually payable after all caps/discounts.
// Everything is deterministic and auditable via meta fields.

async function evaluateStandingAward(
  tx: Prisma.TransactionClient,
  userId: string,
  type: string,
  rawStanding: number,
  actorId: string | undefined
): Promise<{ standing: number; meta: Record<string, unknown> }> {
  const meta: Record<string, unknown> = {}
  if (rawStanding <= 0) return { standing: rawStanding, meta } // negatives pass through

  const weekStart = isoWeekStart()
  const grantorWindow = new Date(Date.now() - STANDING_GRANTOR_WINDOW_DAYS * 86400000)
  const reciprocalWindow = new Date(Date.now() - STANDING_RECIPROCAL_WINDOW_DAYS * 86400000)

  // Grantor-age floor (§9.3 "age gates stay"): a grantor younger than the
  // legacy 24h accept gate pays 0 standing — XP still lands.
  if (actorId) {
    const grantorUser = await tx.user.findUnique({
      where: { id: actorId },
      select: { createdAt: true },
    })
    if (grantorUser && Date.now() - grantorUser.createdAt.getTime() < STANDING_GRANTOR_MIN_AGE_HOURS * 3600000) {
      meta.grantorAge = true
      return { standing: 0, meta }
    }
  }

  // Grantor floor: sub-Trusted grantors pay half.
  if (actorId) {
    const grantor = await tx.profile.findUnique({
      where: { userId: actorId },
      select: { standing: true },
    })
    if (grantor && grantor.standing < STANDINGS[2].min) {
      rawStanding = Math.floor(rawStanding / 2)
      meta.grantorFloor = true
    }
  }

  // Reciprocal discount: grantor received standing from the subject within
  // 90d → standing pays 0 (the XP still lands — trust never round-trips).
  if (actorId) {
    const reciprocal = await tx.progressionEvent.count({
      where: {
        userId: actorId,
        actorId: userId,
        standing: { gt: 0 },
        reversedAt: null,
        createdAt: { gte: reciprocalWindow },
      },
    })
    if (reciprocal > 0) {
      meta.reciprocal = true
      return { standing: 0, meta }
    }
  }

  // Per-grantor diminishing + lifetime cap.
  if (actorId) {
    const fromGrantor = await tx.progressionEvent.aggregate({
      where: { userId, actorId, standing: { gt: 0 }, reversedAt: null },
      _sum: { standing: true },
    })
    const lifetime = fromGrantor._sum.standing ?? 0
    if (lifetime >= STANDING_PER_GRANTOR_LIFETIME) {
      meta.grantorCapped = true
      return { standing: 0, meta }
    }
    const recent = await tx.progressionEvent.count({
      where: { userId, actorId, standing: { gt: 0 }, reversedAt: null, createdAt: { gte: grantorWindow } },
    })
    if (recent > 0) {
      rawStanding = Math.floor(rawStanding * STANDING_GRANTOR_REPEAT_FACTOR)
      meta.grantorRepeat = true
    }
    rawStanding = Math.min(rawStanding, STANDING_PER_GRANTOR_LIFETIME - lifetime)
  }

  // Cluster discount: one grantor carrying ≥60% of trailing-90d member-driven
  // standing → in-cluster awards pay 0. (Deterministic proxy for ring detection.)
  if (actorId) {
    const since = new Date(Date.now() - 90 * 86400000)
    const memberTypes = { notIn: ["STAFF_GRANT", "STAFF_ADJUSTMENT", "LEGACY_STANDING", "STANDING_RECOVERY", "REVERSAL", "REINSTATE"] }
    const total = await tx.progressionEvent.aggregate({
      where: { userId, standing: { gt: 0 }, reversedAt: null, createdAt: { gte: since }, type: memberTypes },
      _sum: { standing: true },
    })
    const fromGrantor = await tx.progressionEvent.aggregate({
      where: { userId, actorId, standing: { gt: 0 }, reversedAt: null, createdAt: { gte: since }, type: memberTypes },
      _sum: { standing: true },
    })
    const totalS = total._sum.standing ?? 0
    const grantorShare = (fromGrantor._sum.standing ?? 0) / Math.max(1, totalS)
    if (totalS > 0 && grantorShare >= STANDING_CLUSTER_SHARE) {
      meta.clusterDiscount = true
      meta.clusterShare = Math.round(grantorShare * 100) / 100
      // §9.3: in-cluster awards pay 0 AND flag the pair for review.
      const flagKey = `stcl:${userId}:${actorId}:${weekStart.toISOString().slice(0, 10)}`
      await tx.abuseFlag.upsert({
        where: { key: flagKey },
        create: {
          signal: "STANDING_CLUSTER",
          userId,
          counterpartyId: actorId,
          key: flagKey,
          evidence: { share: grantorShare, total90d: totalS, fromGrantor90d: fromGrantor._sum.standing ?? 0 },
        },
        update: {},
      }).catch(() => {}) // flag write must never break the award path
      return { standing: 0, meta }
    }
  }

  // Per-source-type weekly cap (contests, referrals, reports).
  if (STANDING_CAPPED_TYPES.has(type)) {
    const srcSum = await tx.progressionEvent.aggregate({
      where: { userId, type, standing: { gt: 0 }, reversedAt: null, createdAt: { gte: weekStart } },
      _sum: { standing: true },
    })
    const used = srcSum._sum.standing ?? 0
    rawStanding = Math.min(rawStanding, Math.max(0, STANDING_PER_SOURCE_WEEK_CAP - used))
    if (rawStanding === 0) {
      meta.sourceWeekCap = true
      return { standing: 0, meta }
    }
  }

  // Weekly ceiling on member-driven standing income (staff/system exempt).
  const weekSum = await tx.progressionEvent.aggregate({
    where: {
      userId,
      standing: { gt: 0 },
      reversedAt: null,
      createdAt: { gte: weekStart },
      type: { notIn: ["STAFF_GRANT", "STAFF_ADJUSTMENT", "LEGACY_STANDING", "STANDING_RECOVERY", "REVERSAL", "REINSTATE"] },
    },
    _sum: { standing: true },
  })
  const room = STANDING_WEEKLY_CAP - (weekSum._sum.standing ?? 0)
  if (room <= 0) {
    meta.weekCap = true
    return { standing: 0, meta }
  }
  rawStanding = Math.min(rawStanding, room)
  return { standing: rawStanding, meta }
}

// ─── The award engine ────────────────────────────────────────────────

export async function awardProgression(
  userId: string,
  type: string,
  reason: string,
  opts: ProgressionAwardOptions = {}
): Promise<ProgressionAwardResult> {
  try {
    const subject = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        createdAt: true,
        banned: true,
        suspendedUntil: true,
        profile: { select: { xp: true, standing: true, username: true } },
      },
    })
    if (!subject?.profile) return { awarded: false, skippedReason: "no-user" }
    if (subject.profile.username === TERPBOT_USERNAME) return { awarded: false, skippedReason: "bot" }
    if (!opts.force && isInactive(subject)) return { awarded: false, skippedReason: "suspended" }
    if (opts.actorId === userId && type !== "STAFF_ADJUSTMENT")
      return { awarded: false, skippedReason: "self" }

    // Keyed idempotency + reinstate (staff-final reversals refuse re-grant).
    if (opts.key) {
      const existing = await prisma.progressionEvent.findUnique({
        where: { key: opts.key },
        select: { id: true, userId: true, xp: true, standing: true, reversedAt: true, reversalFinal: true, mastery: true },
      })
      if (existing) {
        if (!existing.reversedAt) return { awarded: false, skippedReason: "duplicate" }
        if (existing.reversalFinal) return { awarded: false, skippedReason: "locked" }
        return await reinstateProgressionEvent(existing, subject)
      }
    }

    const spec = XP_TABLE[type]
    // Deferred locked-design events (member guides, mentoring,
    // replication) are not awardable until their feature ships.
    if (spec?.deferred) return { awarded: false, skippedReason: "deferred" }
    let xp = opts.xp ?? spec?.xp ?? 0
    let standing = opts.standing ?? spec?.standing ?? 0
    const mastery = opts.mastery !== undefined ? opts.mastery : (spec?.mastery ?? null)

    // Per-type caps + mastery soft cap — self-driven sources only.
    const dailyCap = spec?.dailyCap
    const weeklyCap = spec?.weeklyCap
    const capped = dailyCap !== undefined || weeklyCap !== undefined
    const needsSerialize = capped || (standing > 0 && !!actorNeeded(type, opts))

    const runTx = () =>
      prisma.$transaction(
        async (tx) => {
          const dayStart = new Date()
          dayStart.setUTCHours(0, 0, 0, 0)

          // Caps count paying rows only — 0/0 marker rows (withheld/reduced
          // audit records, check-in markers) must not consume cap slots.
          if (dailyCap !== undefined) {
            const today = await tx.progressionEvent.count({
              where: {
                userId, type, reversedAt: null, createdAt: { gte: dayStart },
                NOT: { xp: 0, standing: 0 },
              },
            })
            if (today >= dailyCap) return "capped" as const
          }
          if (weeklyCap !== undefined) {
            const wk = await tx.progressionEvent.count({
              where: {
                userId, type, reversedAt: null, createdAt: { gte: isoWeekStart() },
                NOT: { xp: 0, standing: 0 },
              },
            })
            if (wk >= weeklyCap) return "capped" as const
          }

          // Weekly per-mastery soft cap (peer-gated types exempt).
          if (mastery && xp > 0 && !PEER_GATED_TYPES.has(type)) {
            const weekXp = await tx.progressionEvent.aggregate({
              where: {
                userId,
                mastery,
                xp: { gt: 0 },
                reversedAt: null,
                type: { notIn: ["REVERSAL", "REINSTATE", "MILESTONE"] },
                createdAt: { gte: isoWeekStart() },
              },
              _sum: { xp: true },
            })
            const used = weekXp._sum.xp ?? 0
            xp = applySoftCap(xp, used)
            if (xp === 0 && standing === 0) return "capped" as const
          }

          // Standing controls.
          let meta = { ...(opts.meta ?? {}) }
          if (standing > 0 && type !== "STAFF_ADJUSTMENT" && type !== "LEGACY_STANDING" && type !== "STANDING_RECOVERY") {
            const evaluated = await evaluateStandingAward(tx, userId, type, standing, opts.actorId)
            standing = evaluated.standing
            meta = { ...meta, ...evaluated.meta }
          }

          // §6.7: withheld/reduced decisions stay auditable — marker calls
          // write the 0-value row instead of skipping the write entirely.
          if (xp === 0 && standing === 0 && !opts.marker) return "withheld" as const

          const oldXp = subject.profile!.xp
          const appliedXp = xp < 0 ? -Math.min(-xp, oldXp) : xp
          const appliedStanding =
            standing < 0 ? -Math.min(-standing, subject.profile!.standing) : standing

          await tx.progressionEvent.create({
            data: {
              userId,
              type,
              mastery,
              xp: appliedXp,
              standing: appliedStanding,
              reason,
              key: opts.key,
              sourceType: opts.sourceType,
              sourceId: opts.sourceId,
              actorId: opts.actorId,
              meta: Object.keys(meta).length ? (meta as Prisma.InputJsonValue) : undefined,
            },
          })
          await tx.profile.update({
            where: { userId },
            data: { xp: { increment: appliedXp }, standing: { increment: appliedStanding } },
          })
          if (appliedStanding < 0) {
            await tx.profile.updateMany({
              where: { userId, standing: { lt: 0 } },
              data: { standing: 0 },
            })
          }
          if (mastery && appliedXp !== 0) {
            await tx.masteryProgress.upsert({
              where: { userId_mastery: { userId, mastery } },
              create: { userId, mastery, xp: appliedXp },
              update: { xp: { increment: appliedXp } },
            })
            await tx.masteryProgress.updateMany({
              where: { userId, mastery, xp: { lt: 0 } },
              data: { xp: 0 },
            })
          }

          // Once-ever milestone markers for crossed rungs.
          const newXp = oldXp + appliedXp
          const newRungs: { xp: number; label: string; rank: string }[] = []
          if (appliedXp > 0) {
            const rungs = crossedRungs(oldXp, newXp)
            for (const r of rungs) {
              const mkey = `milestone:${userId}:${r.xp}`
              const seen = await tx.progressionEvent.findUnique({ where: { key: mkey }, select: { id: true } })
              if (!seen) {
                newRungs.push(r)
                await tx.progressionEvent.create({
                  data: {
                    userId,
                    type: "MILESTONE",
                    xp: 0,
                    reason: `Reached ${r.label}`,
                    key: mkey,
                    meta: { rung: r.xp, label: r.label, rank: r.rank },
                  },
                })
              }
            }
          }
          return { oldXp, newXp, newRungs }
        },
        needsSerialize ? { isolationLevel: "Serializable" } : undefined
      )

    let txResult: { oldXp: number; newXp: number; newRungs: { xp: number; label: string; rank: string }[] } | "capped" | "withheld"
    try {
      txResult = await runTx()
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
        txResult = await runTx()
      } else {
        throw error
      }
    }
    if (txResult === "capped") return { awarded: false, skippedReason: "capped" }
    if (txResult === "withheld") return { awarded: false, skippedReason: "withheld" }
    const rungsCrossed = xp > 0 ? crossedRungs(txResult.oldXp, txResult.newXp) : []

    // Member-facing milestone notifications — the celebration card reads
    // the kind/tier/unlocks metadata. Only rungs whose marker row was newly
    // written this award notify (a re-earn after reversal stays quiet).
    // Private: opt-out suppresses only the public chat announcement below.
    if (txResult.newRungs.length > 0) {
      const rankCrossed = txResult.newRungs.filter((r) => r.label === r.rank)
      const stageCrossed = txResult.newRungs.filter((r) => r.label !== r.rank)
      if (rankCrossed.length > 0) {
        const top = rankCrossed[rankCrossed.length - 1]
        const disp = RANK_DISPLAY[top.rank]
        // Unlock list = registry entries gated on a rank newly crossed in
        // (oldXp, newXp] — the celebration card renders name chips.
        const crossedNames = new Set(rankCrossed.map((r) => r.rank))
        const unlocks = UNLOCKS.filter((u) => u.rank && crossedNames.has(u.rank))
        const stage = xpStage(txResult.newXp)
        await notify({
          userId,
          type: "REPUTATION",
          title: `Rank up: ${top.rank}`,
          content: `You reached ${txResult.newXp.toLocaleString()} XP and became ${top.rank}. ${disp?.benefit ?? ""}`,
          link: "/reputation",
          metadata: {
            kind: "tier",
            level: stage.level,
            stageName: stage.stageName,
            xp: txResult.newXp,
            tier: disp ? { name: top.rank, icon: disp.icon, color: disp.color, bg: disp.bg } : undefined,
            unlocks: unlocks.map((u) => ({ kind: u.category, key: u.id, name: u.name })),
          },
        }).catch(() => null)
      }
      for (let i = 0; i < stageCrossed.length; i++) {
        const stage = xpStage(txResult.newXp)
        const nextUnlock = nextRankUnlock(txResult.newXp)
        await notify({
          userId,
          type: "REPUTATION",
          title: `Grow Level ${stage.level} — ${stage.stageName}`,
          content: nextUnlock
            ? `Your garden reached a new stage. Next unlock: ${nextUnlock.name} at ${nextUnlock.rank} rank.`
            : "Your garden reached a new stage.",
          link: "/reputation",
          metadata: {
            kind: "stage",
            level: stage.level,
            stageName: stage.stageName,
            xp: txResult.newXp,
            nextUnlock: nextUnlock
              ? { kind: "perk", key: nextUnlock.id, name: nextUnlock.name, unlockedAt: nextUnlock.xpNeeded }
              : null,
          },
        }).catch(() => null)
      }
    }

    // Rank-up announcement — a crossed rung whose label IS the rank name is
    // a rank threshold (sub-level rungs carry their own labels). Announce
    // the highest rank reached; opt-out members stay private. Uses
    // newRungs (markers newly written this award) — a reversal+re-earn
    // must not re-fire the public post. Post-tx and fire-and-forget so a
    // chat failure can never roll back an award.
    const rankUp = [...txResult.newRungs].reverse().find((r) => r.label === r.rank)
    if (rankUp && subject.profile.username) {
      void (async () => {
        const p = await prisma.profile.findUnique({
          where: { userId },
          select: { publicMilestoneOptOut: true },
        })
        if (!p?.publicMilestoneOptOut) {
          await announceTierUp(subject.profile!.username, rankUp.rank, txResult.newXp).catch(() => null)
        }
      })().catch(() => null)
    }

    return {
      awarded: true,
      xp,
      standing,
      oldXp: txResult.oldXp,
      newXp: txResult.newXp,
      rungsCrossed,
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { awarded: false, skippedReason: "duplicate" }
    }
    console.error("[progression] award failed:", { userId, type, key: opts.key }, error)
    throw error
  }
}

function actorNeeded(_type: string, opts: ProgressionAwardOptions): boolean {
  return !!opts.actorId
}

function applySoftCap(amount: number, weekUsed: number): number {
  // Full rate under 250, 50% for the 250–500 band, 25% beyond 500.
  const fullRoom = Math.max(0, MASTERY_WEEKLY_FULL - weekUsed)
  const midRoom = Math.max(0, MASTERY_WEEKLY_MID - Math.max(weekUsed, MASTERY_WEEKLY_FULL))
  let remaining = amount
  let out = 0
  const f = Math.min(remaining, fullRoom)
  out += f
  remaining -= f
  const m = Math.min(remaining, midRoom)
  out += Math.floor(m * MASTERY_WEEKLY_MID_FACTOR)
  remaining -= m
  if (remaining > 0) out += Math.floor(remaining * MASTERY_WEEKLY_TAIL_FACTOR)
  return out
}

// ─── Reinstate ───────────────────────────────────────────────────────

async function reinstateProgressionEvent(
  original: { id: string; userId: string; xp: number; standing: number; mastery: string | null },
  subject: SubjectUser
): Promise<ProgressionAwardResult> {
  const oldXp = subject.profile?.xp ?? 0
  let restoredXp = 0
  let restoredStanding = 0
  const result = await prisma.$transaction(async (tx) => {
    const { count } = await tx.progressionEvent.updateMany({
      where: { id: original.id, reversedAt: { not: null }, reversalFinal: false },
      data: { reversedAt: null },
    })
    if (count === 0) {
      const cur = await tx.progressionEvent.findUnique({
        where: { id: original.id },
        select: { reversalFinal: true, reversedAt: true },
      })
      return cur?.reversedAt && cur.reversalFinal ? "locked" : null
    }
    const descendants = await tx.progressionEvent.findMany({
      where: { reversalOfId: original.id },
      select: { xp: true, standing: true },
    })
    const restoreXp = -descendants.reduce((s, d) => s + d.xp, 0)
    const restoreSt = -descendants.reduce((s, d) => s + d.standing, 0)
    restoredXp = restoreXp
    restoredStanding = restoreSt
    await tx.progressionEvent.updateMany({
      where: { reversalOfId: original.id, type: "REVERSAL" },
      data: { reversedAt: new Date() },
    })
    if (restoreXp !== 0 || restoreSt !== 0) {
      const src = await tx.progressionEvent.findUnique({
        where: { id: original.id },
        select: { sourceType: true, sourceId: true },
      })
      await tx.progressionEvent.create({
        data: {
          userId: original.userId,
          type: "REINSTATE",
          mastery: original.mastery,
          xp: restoreXp,
          standing: restoreSt,
          reason: "Award reinstated",
          key: `rein:${original.id}:${descendants.length}`,
          reversalOfId: original.id,
          sourceType: src?.sourceType,
          sourceId: src?.sourceId,
        },
      })
      await tx.profile.update({
        where: { userId: original.userId },
        data: { xp: { increment: restoreXp }, standing: { increment: restoreSt } },
      })
      if (original.mastery && restoreXp !== 0) {
        await tx.masteryProgress.upsert({
          where: { userId_mastery: { userId: original.userId, mastery: original.mastery } },
          create: { userId: original.userId, mastery: original.mastery, xp: Math.max(0, restoreXp) },
          update: { xp: { increment: restoreXp } },
        })
      }
    }
    return { oldXp, newXp: oldXp + restoreXp }
  })
  if (result === "locked") return { awarded: false, skippedReason: "locked" }
  if (result === null) return { awarded: false, skippedReason: "duplicate" }
  return { awarded: true, reinstated: true, xp: restoredXp, standing: restoredStanding, oldXp, newXp: result.newXp }
}

// ─── Reversals ───────────────────────────────────────────────────────

export interface ProgressionReversalResult {
  reversed: boolean
  eventId?: string
  newXp?: number
}

export async function reverseProgressionEvent(
  eventId: string,
  reason: string,
  actorId?: string,
  opts: { final?: boolean } = {}
): Promise<ProgressionReversalResult> {
  const outcome = await prisma.$transaction(async (tx) => {
    const original = await tx.progressionEvent.findUnique({
      where: { id: eventId },
      select: { id: true, userId: true, xp: true, standing: true, reversedAt: true, reversalFinal: true, type: true, sourceType: true, sourceId: true, mastery: true },
    })
    if (!original || original.reversedAt) return null

    const { count } = await tx.progressionEvent.updateMany({
      where: { id: original.id, reversedAt: null },
      data: { reversedAt: new Date(), ...(opts.final ? { reversalFinal: true } : {}) },
    })
    if (count === 0) return null

    const seq = await tx.progressionEvent.count({ where: { reversalOfId: original.id } })
    const current = await tx.profile.findUnique({
      where: { userId: original.userId },
      select: { xp: true, standing: true },
    })
    const appliedXp = -Math.min(original.xp, current?.xp ?? 0)
    const appliedSt = original.standing > 0 ? -Math.min(original.standing, current?.standing ?? 0) : -original.standing
    await tx.progressionEvent.create({
      data: {
        userId: original.userId,
        type: "REVERSAL",
        mastery: original.mastery,
        xp: appliedXp,
        standing: appliedSt,
        reason,
        key: `rev:${original.id}:${seq}`,
        reversalOfId: original.id,
        sourceType: original.sourceType,
        sourceId: original.sourceId,
        actorId,
      },
    })
    const profile = await tx.profile.update({
      where: { userId: original.userId },
      data: { xp: { increment: appliedXp }, standing: { increment: appliedSt } },
      select: { xp: true, standing: true },
    })
    if (original.mastery && appliedXp !== 0) {
      await tx.masteryProgress.upsert({
        where: { userId_mastery: { userId: original.userId, mastery: original.mastery } },
        create: { userId: original.userId, mastery: original.mastery, xp: Math.max(0, appliedXp) },
        update: { xp: { increment: appliedXp } },
      })
      await tx.masteryProgress.updateMany({
        where: { userId: original.userId, mastery: original.mastery, xp: { lt: 0 } },
        data: { xp: 0 },
      })
    }
    await tx.profile.updateMany({
      where: { userId: original.userId, standing: { lt: 0 } },
      data: { standing: 0 },
    })
    return { newXp: Math.max(0, profile.xp), userId: original.userId }
  })

  if (outcome === null) return { reversed: false }
  return { reversed: true, eventId, newXp: outcome.newXp }
}

export async function reverseProgressionByKey(key: string, reason: string, actorId?: string): Promise<ProgressionReversalResult> {
  const original = await prisma.progressionEvent.findUnique({ where: { key }, select: { id: true } })
  if (!original) return { reversed: false }
  try {
    return await reverseProgressionEvent(original.id, reason, actorId)
  } catch (err) {
    console.error("[progression] keyed reversal failed:", key, err)
    throw err
  }
}

// Types whose actorId is the granting member — the only attribution an
// account-takedown sweep may claw back. Fail-closed like the legacy list.
const ACTOR_GRANTED_TYPES = new Set([
  "ACCEPTED_ANSWER",
  "NEWCOMER_ACCEPT_BONUS",
  "REFERRAL",
  "CONTEST_WEEKLY_WIN",
  "CONTEST_MONTHLY_WIN",
])

export async function reverseProgressionBySource(
  sourceType: string,
  sourceId: string,
  reason: string,
  actorId?: string
): Promise<number> {
  let events
  try {
    events = await prisma.progressionEvent.findMany({
      where: { sourceType, sourceId, reversedAt: null, reversalOfId: null, type: { not: "REVERSAL" } },
      select: { id: true },
    })
  } catch (error) {
    console.error("[progression] source reversal lookup failed:", sourceType, sourceId, error)
    throw error
  }
  let reversed = 0
  for (const e of events) {
    try {
      const r = await reverseProgressionEvent(e.id, reason, actorId)
      if (r.reversed) reversed++
    } catch (err) {
      console.error("[progression] reversal failed:", sourceType, sourceId, e.id, err)
    }
  }
  return reversed
}

export async function reverseProgressionByActor(
  actorId: string,
  reason: string,
  opts: { before?: Date; requestedBy?: string } = {}
): Promise<number> {
  let events
  try {
    events = await prisma.progressionEvent.findMany({
      where: {
        actorId,
        reversedAt: null,
        reversalOfId: null,
        type: { in: [...ACTOR_GRANTED_TYPES] },
        ...(opts.before ? { createdAt: { lte: opts.before } } : {}),
      },
      select: { id: true },
    })
  } catch (error) {
    console.error("[progression] actor reversal lookup failed:", actorId, error)
    throw error
  }
  let reversed = 0
  const BATCH = 25
  for (let i = 0; i < events.length; i += BATCH) {
    const results = await Promise.all(
      events.slice(i, i + BATCH).map((e) =>
        // The swept user owns the events, but the reversal rows should be
        // attributed to whoever requested the sweep (staff, deletion flow)
        // — default to the user only when nobody requested it.
        reverseProgressionEvent(e.id, reason, opts.requestedBy ?? actorId).catch((err) => {
          console.error("[progression] actor reversal failed:", actorId, e.id, err)
          return { reversed: false } as ProgressionReversalResult
        })
      )
    )
    reversed += results.filter((r) => r.reversed).length
  }
  return reversed
}

// ─── Read helpers + gates ────────────────────────────────────────────

export async function getMasteryMap(userId: string): Promise<Record<Mastery, number>> {
  const rows = await prisma.masteryProgress.findMany({ where: { userId } })
  const map = Object.fromEntries(MASTERIES.map((m) => [m, 0])) as Record<Mastery, number>
  for (const r of rows) map[r.mastery as Mastery] = r.xp
  return map
}

/** Effective rank = XP rank gated by diversity floors (banked promotion). */
export async function effectiveRank(userId: string): Promise<{
  rank: (typeof REP_RANKS)[number]
  xpRank: (typeof REP_RANKS)[number]
  blockedBy: { rank: string; missing: Mastery[] } | null
}> {
  const profile = await prisma.profile.findUnique({ where: { userId }, select: { xp: true } })
  const xp = profile?.xp ?? 0
  const xpRank = rankFromXp(xp)
  const masteries = await getMasteryMap(userId)
  const levels = Object.fromEntries(MASTERIES.map((m) => [m, masteryLevelFromXp(masteries[m])]))
  const xpIndex = REP_RANKS.indexOf(xpRank)
  let blockedBy: { rank: string; missing: Mastery[] } | null = null

  // Walk ranks top-down; find the highest rank whose floor is satisfied.
  for (let i = xpIndex; i >= 0; i--) {
    const rank = REP_RANKS[i]
    const floor = DIVERSITY_FLOORS[rank.name]
    if (!floor) return { rank, xpRank, blockedBy }
    let satisfied = false
    if (rank.name === MASTER_EXTRA_FLOOR.rank) {
      // Master Cultivator: 1 path ≥ M6 plus the standard floor.
      const m6 = MASTERIES.filter((m) => levels[m] >= MASTER_EXTRA_FLOOR.level)
      const m4 = MASTERIES.filter((m) => levels[m] >= floor.level)
      satisfied = m6.length >= MASTER_EXTRA_FLOOR.paths && m4.length >= floor.paths
    } else {
      satisfied = MASTERIES.filter((m) => levels[m] >= floor.level).length >= floor.paths
    }
    if (satisfied) return { rank, xpRank, blockedBy }
    // Floor unmet — record what's missing for the XP rank, keep walking down.
    if (i === xpIndex) {
      const need = floor.paths - MASTERIES.filter((m) => levels[m] >= floor.level).length
      blockedBy = {
        rank: rank.name,
        missing: MASTERIES.filter((m) => levels[m] < floor.level).slice(0, Math.max(1, need)),
      }
    }
  }
  // Seed has no floor — always reachable.
  return { rank: REP_RANKS[0], xpRank, blockedBy }
}

/** Server-side single choke point for every unlock gate. */
export async function hasUnlock(userId: string, unlockId: string): Promise<boolean> {
  const spec = UNLOCK_BY_ID.get(unlockId)
  if (!spec || spec.status === "future") return false
  return meetsUnlockSpec(userId, spec)
}

type UnlockProfile = { xp: number; standing: number; unlockFrozen: boolean }

function loadUnlockProfile(userId: string): Promise<UnlockProfile | null> {
  return prisma.profile.findUnique({
    where: { userId },
    select: { xp: true, standing: true, unlockFrozen: true },
  })
}

/**
 * Evaluates several unlock ids against ONE profile read — for callers that
 * check a ladder of related unlocks in the same call (profileSectionLimit,
 * questSlotsFor, ...). Results are identical to calling hasUnlock per id:
 * unknown/future ids are false, each live spec still issues its own
 * achievement/streak/mastery read where the spec requires it.
 */
export async function hasUnlocks(userId: string, unlockIds: string[]): Promise<boolean[]> {
  const specs = unlockIds.map((id) => UNLOCK_BY_ID.get(id))
  if (!specs.some((s) => s && s.status !== "future")) return unlockIds.map(() => false)
  const profile = await loadUnlockProfile(userId)
  return Promise.all(
    specs.map((spec) =>
      !spec || spec.status === "future"
        ? Promise.resolve(false)
        : meetsUnlockSpecLoaded(profile, userId, spec)
    )
  )
}

/**
 * Evaluates an unlock spec against a member. Exported so the grant paths
 * (achievement, streak, rank, mastery, standing) can be exercised with any
 * spec — including future/synthetic ones in tests — while `hasUnlock`
 * remains the only gate production routes call.
 */
export async function meetsUnlockSpec(userId: string, spec: UnlockSpec): Promise<boolean> {
  const profile = await loadUnlockProfile(userId)
  return meetsUnlockSpecLoaded(profile, userId, spec)
}

async function meetsUnlockSpecLoaded(profile: UnlockProfile | null, userId: string, spec: UnlockSpec): Promise<boolean> {
  if (!profile || profile.unlockFrozen) return false

  // Achievement route — reads UserAchievement, the unlock-capable
  // progression-achievement store (V2 grants + LEGACY archive). Cosmetic
  // community badges live in UserBadge and NEVER gate unlocks — the two
  // systems are intentionally separate (Badge/BADGE_REGISTRY stays the
  // live cosmetic engine; Achievement is the progression-linked framework).
  if (spec.achievement) {
    const ach = await prisma.userAchievement.findFirst({
      where: { userId, achievement: { key: spec.achievement } },
      select: { id: true },
    })
    if (ach && (!spec.standing || profile.standing >= spec.standing)) return true
  }

  // Streak route — a non-reversed streak:<days>:<userId> marker row grants
  // the unlock even below the rank gate (Garden Perks D-amendment).
  if (spec.streak) {
    const marker = await prisma.progressionEvent.findFirst({
      where: { userId, key: `streak:${spec.streak}:${userId}`, reversedAt: null },
      select: { id: true },
    })
    if (marker) return true
  }

  const rankOk = spec.rank ? profile.xp >= (REP_RANKS.find((r) => r.name === spec.rank)?.threshold ?? Infinity) : true
  let masteryOk = true
  if (spec.mastery) {
    const mp = await prisma.masteryProgress.findUnique({
      where: { userId_mastery: { userId, mastery: spec.mastery.path } },
      select: { xp: true },
    })
    masteryOk = masteryLevelFromXp(mp?.xp ?? 0) >= spec.mastery.level
  }
  const coreOk = spec.anyOf ? rankOk || masteryOk : rankOk && masteryOk
  const standingOk = spec.standing ? profile.standing >= spec.standing : true
  return coreOk && standingOk
}

/** Profile P2 — custom-section capacity: Seed 2 → Germinated 3 → Rooted 4 →
 *  Harvested 6 → Cured 8 (hard-capped by PROFILE_SECTION_HARD_MAX in the
 *  caller). */
export async function profileSectionLimit(userId: string): Promise<number> {
  const [r8, r6, r4, r3] = await hasUnlocks(userId, [
    "profile-sections-8", "profile-sections-6", "profile-sections-4", "profile-sections-3",
  ])
  if (r8) return 8
  if (r6) return 6
  if (r4) return 4
  if (r3) return 3
  return PROFILE_SECTION_BASE_LIMIT
}

/** Profile P2 — notable-stat slots: Seed 4 → Vegged 6 → Ripening 7 →
 *  Harvested 8. */
export async function statSlotLimit(userId: string): Promise<number> {
  const [r8, r7, r6] = await hasUnlocks(userId, [
    "stat-slots-8", "stat-slots-7", "stat-slots-6",
  ])
  if (r8) return 8
  if (r7) return 7
  if (r6) return 6
  return SHOWN_STATS_BASE
}

/** Saved-search capacity: Seed 3 → Seedling 6 → Trained 10.
 *  Consumed by /api/saved-searches; existing rows above the cap stay
 *  readable — only creation is gated. */
export async function savedSearchLimit(userId: string): Promise<number> {
  const [ten, six] = await hasUnlocks(userId, ["saved-searches-10", "saved-searches-6"])
  if (ten) return 10
  if (six) return 6
  return 3
}

// ─── Enforced perks (locked §8/§9.6) ─────────────────────────────────
// The V2 replacement for the legacy tier-perk table — one profile read
// computes every capacity/permission flag the route layer needs. All of
// these are Layer-A rank gates or standing gates, identical to what
// hasUnlock evaluates for the matching registry entries.
export interface ProgressionPerks {
  pollVoting: boolean // "poll-vote" — Known (25 standing)
  pollCreation: boolean // "poll-create" — Trusted (100 standing)
  rateLimitBoost: number // "rate-1.5" / "rate-2" — ×1.5 Harvested, ×2 Cured+
  slowmodeExempt: boolean // "slowmode-exempt" — Pillar (800 standing)
  imagesPerPost: number | undefined // "images-5"/"images-6"/"images-8"/"images-10" — Seedling/Flowering/Harvested/Cultivator
  maxThreadTags: number | undefined // "tags-7" — 7 at Ripening
  // "showcase-slots-4"/"showcase-slots-5"/"showcase-slots-6"/
  // "showcase-slots-8"/"showcase-slots-10"/"showcase-slots-12"/
  // "showcase-slots-14" — badge pin capacity, Trained→MC.
  showcaseSlots: number
  rank: string
  standing: number
}

// Pure form — for callers that already loaded xp/standing/unlockFrozen.
// This IS the enforcement for the graduated registry rows named above —
// the registry entries document the same thresholds; `hasUnlock` evaluates
// them identically for display/roadmap purposes.
export function progressionPerksFrom(xp: number, standing: number, frozen: boolean): ProgressionPerks {
  const at = (rankName: string) => !frozen && xp >= (REP_RANKS.find((r) => r.name === rankName)?.threshold ?? Infinity)
  return {
    pollVoting: !frozen && standing >= STANDING_POLL_VOTE,
    pollCreation: !frozen && standing >= STANDING_POLL_CREATE,
    rateLimitBoost: at("Cured") ? 2 : at("Harvested") ? 1.5 : 1,
    slowmodeExempt: !frozen && standing >= STANDING_SLOWMODE_EXEMPT,
    imagesPerPost: at("Cultivator") ? 10 : at("Harvested") ? 8 : at("Flowering") ? 6 : at("Seedling") ? 5 : undefined,
    maxThreadTags: at("Ripening") ? 7 : undefined,
    // Showcase ladder (3→14) — registry rows showcase-slots-4/5/6/8/10/12/14.
    showcaseSlots: at("Master Cultivator") ? 14 : at("Cultivator") ? 12 : at("Cured") ? 10
      : at("Harvested") ? 8 : at("Ripening") ? 6 : at("Preflower") ? 5 : at("Trained") ? 4 : 3,
    rank: rankFromXp(xp).name,
    standing,
  }
}

export async function getProgressionPerks(userId: string): Promise<ProgressionPerks> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { xp: true, standing: true, unlockFrozen: true },
  })
  return progressionPerksFrom(profile?.xp ?? 0, profile?.standing ?? 0, profile?.unlockFrozen ?? true)
}

// rateLimit() scaled by the caller's V2 rank — Harvested+ get a boost.
export async function progressionRateLimit(userId: string, key: string, baseLimit: number, windowMs: number) {
  const perks = await getProgressionPerks(userId)
  const limit = Math.floor(baseLimit * perks.rateLimitBoost)
  return rateLimit(key, limit, windowMs)
}

// ─── Reconciliation ──────────────────────────────────────────────────

// Balance/ledger drift check — used by tests and the daily cron. Every
// row's xp/standing counts (reversedAt is status metadata, the signed
// REVERSAL counter-row already nets the math), so this is a plain SUM.
export async function findProgressionDrift(): Promise<{ userId: string; xp: number; standing: number; ledgerXp: number; ledgerStanding: number }[]> {
  return prisma.$queryRaw<{ userId: string; xp: number; standing: number; ledgerXp: number; ledgerStanding: number }[]>`
    SELECT p."userId", p.xp, p.standing,
           COALESCE(s.xp_total, 0)::int AS "ledgerXp",
           COALESCE(s.st_total, 0)::int AS "ledgerStanding"
    FROM "Profile" p
    LEFT JOIN (
      SELECT "userId", SUM("xp") AS xp_total, SUM("standing") AS st_total
      FROM "ProgressionEvent"
      GROUP BY "userId"
    ) s ON s."userId" = p."userId"
    WHERE p.xp <> COALESCE(s.xp_total, 0) OR p.standing <> COALESCE(s.st_total, 0)`
}
