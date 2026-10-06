// Answer-recruitment — the deterministic TerpBot loop that connects
// unanswered grow questions to members whose PUBLIC record shows they
// can probably help.
//
// MATCHING CONTRACT (explainable, same inputs → same candidates):
//   A member is a candidate for a question only when at least one of
//   these concrete public signals holds:
//     STRAIN_GROWN      — member has a PUBLIC, live grow diary for a
//                         strain tagged on the question (catalog link or
//                         exact free-text strain name)
//     SETUP_MATCH       — member's public grow/setup record carries the
//                         question's setup vocabulary (structured
//                         mediumType/lightType/growType enums or whole-
//                         word tokens in setup showcase fields)
//     TECHNIQUE_MATCH   — member's PUBLIC diaries log a technique the
//                         question is tagged with (fixed vocab)
//     TOPIC_PARTICIPANT — member has demonstrated participation in the
//                         question's category (≥3 live posts across ≥2
//                         distinct threads)
//   Ranking is score-ordered: STRAIN(30) > SETUP(20) = TECHNIQUE(20) >
//   PARTICIPANT(5), ties broken by userId — never a learned score.
//
// PRIVACY CONTRACT — public evidence only:
//   PRIVATE and UNLISTED diaries are never a match signal. GrowSetup has
//   no visibility tier (setups are public pages), so all live setup
//   fields are in-scope. Notification content names only the public
//   reason, never private data. Candidates blocked in either direction
//   from the asker are excluded; banned/suspended candidates and askers
//   are excluded via activeAuthor().
//
// ANTI-ABUSE:
//   - Claim key `assist:answer-match:<threadId>:<userId>` is once-ever
//     per (thread, member) pair — re-scans, edits, and reopened threads
//     can never re-send to the same member.
//   - The shared botAssist() 3/day cap + 7-day cross-kind cushion +
//     notifyOnBotAssist preference apply unchanged.
//   - Only questions ≥24h old with zero replies recruit — organic
//     answers always get the first day.
//   - Questions keep recruiting only while unanswered and ≤30 days old.
//   - Receiving an assist earns nothing — only real replies pay, via the
//     existing post XP path + the answer-the-call daily quest.
//
// Bounded: ≤25 threads per run (freshest unanswered first), ≤5
// candidates per thread, ≤30 sends per run. Member-home reuses the same
// scoring for the "could use your help" card — no second matching rule.
import { prisma } from "@/lib/prisma"
import { activeAuthor, blockedUserIds } from "@/lib/security"
import { botAssist, loadAssistPrelude } from "@/lib/terpbot-assist"
import { sanitizeEcho } from "@/lib/terpbot"
import { TECHNIQUE_LABELS } from "@/lib/grow-fields"

// The question-surface convention shared with /questions and ops-metrics:
// categories whose slug or name reads as a help surface. No separate
// Question model — these are ordinary forum threads.
export const QUESTION_CATEGORY_RE = /question|help|problem|doctor/i

const DAY = 86400000
/** Organic answers get the first day before recruitment starts. */
const MIN_QUESTION_AGE_MS = 24 * 60 * 60 * 1000
const MAX_QUESTION_AGE_MS = 30 * DAY
const THREAD_SCAN_CAP = 25
const HOME_SCAN_CAP = 15
const CANDIDATES_PER_THREAD = 5
const SEND_CAP = 30
const STRAIN_DIARY_CAP = 20
const TECH_DIARY_CAP = 20
const SETUP_ROW_CAP = 30
const PARTICIPANT_CAP = 30
const SETUP_TOKEN_CAP = 8

const STRAIN_SCORE = 30
const SETUP_SCORE = 20
const TECHNIQUE_SCORE = 20
const PARTICIPANT_SCORE = 5
const PARTICIPATION_MIN_POSTS = 3
const PARTICIPATION_MIN_THREADS = 2

export type AnswerMatchReason =
  | "STRAIN_GROWN"
  | "SETUP_MATCH"
  | "TECHNIQUE_MATCH"
  | "TOPIC_PARTICIPANT"

export interface AnswerCandidate {
  userId: string
  score: number
  reason: AnswerMatchReason
  /** Human-facing evidence label — a strain name, technique label,
   *  setup term, or category name. Public data only. */
  detail: string
}

export interface HelpWantedItem {
  slug: string
  title: string
  category: string
  reason: AnswerMatchReason
  detail: string
}

// ── Normalization ────────────────────────────────────────────────────

/** Lowercase, collapse non-alphanumerics to spaces — token form. */
const normTokens = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3)

/** Lowercase, strip non-alphanumerics — exact-equality form. */
const normKey = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "")

// Technique vocabulary — tag "scrog"/"ScrOG"/"main-lining" all resolve
// to the fixed enum via normalized keys and labels.
const TECHNIQUE_BY_NORM = new Map<string, string>()
for (const [key, label] of Object.entries(TECHNIQUE_LABELS)) {
  TECHNIQUE_BY_NORM.set(normKey(key), key)
  TECHNIQUE_BY_NORM.set(normKey(label), key)
}

// Structured setup vocabulary on diaries — enum value AND its label form
// both count as the same token ("living soil" ↔ LIVING_SOIL).
const MEDIUM_TYPES = ["SOIL", "COCO", "HYDRO", "DWC", "LIVING_SOIL", "OTHER"]
const LIGHT_TYPES = ["LED", "HPS", "CMH", "FLUORESCENT", "SUN", "OTHER"]
const GROW_TYPES = ["INDOOR", "OUTDOOR", "GREENHOUSE", "HYDROPONIC", "OTHER"]
const SETUP_ENUM_TOKENS = new Map<string, { medium?: string; light?: string; grow?: string }>()
for (const v of MEDIUM_TYPES) SETUP_ENUM_TOKENS.set(normKey(v), { medium: v })
for (const v of LIGHT_TYPES)
  SETUP_ENUM_TOKENS.set(normKey(v), { ...SETUP_ENUM_TOKENS.get(normKey(v)), light: v })
for (const v of GROW_TYPES)
  SETUP_ENUM_TOKENS.set(normKey(v), { ...SETUP_ENUM_TOKENS.get(normKey(v)), grow: v })
// Friendly spellings that members actually tag with.
SETUP_ENUM_TOKENS.set("lsoil", { medium: "LIVING_SOIL" })
SETUP_ENUM_TOKENS.set("livingsoil", { medium: "LIVING_SOIL" })
SETUP_ENUM_TOKENS.set("hydro", { medium: "HYDRO", grow: "HYDROPONIC" })
SETUP_ENUM_TOKENS.set("hydroponic", { medium: "HYDRO", grow: "HYDROPONIC" })
SETUP_ENUM_TOKENS.set("dwc", { medium: "DWC" })
SETUP_ENUM_TOKENS.set("flouro", { light: "FLUORESCENT" })

const SETUP_TEXT_FIELDS = [
  "space",
  "tent",
  "lighting",
  "ventilation",
  "fans",
  "containers",
  "medium",
  "equipment",
] as const

// ── Question extraction ──────────────────────────────────────────────

export interface QuestionSignals {
  /** normalized full tag names that resolve to catalog strains */
  strainTagNames: string[]
  strainIds: string[]
  /** technique enum keys the question is tagged with */
  techniqueKeys: string[]
  /** setup vocabulary tokens not consumed by strain/technique matching */
  setupTokens: string[]
  /** structured enum values implied by setup tokens */
  mediumTypes: string[]
  lightTypes: string[]
  growTypes: string[]
}

function tagNamesOf(thread: { tags: { tag: { name: string } }[] }): string[] {
  return [...new Set(thread.tags.map((t) => t.tag.name.trim().toLowerCase()).filter(Boolean))]
}

function buildSignals(
  tagNames: string[],
  strainByNorm: Map<string, { id: string; name: string }>
): QuestionSignals {
  const signals: QuestionSignals = {
    strainTagNames: [],
    strainIds: [],
    techniqueKeys: [],
    setupTokens: [],
    mediumTypes: [],
    lightTypes: [],
    growTypes: [],
  }
  if (!tagNames.length) return signals

  const strainNorms = new Set(strainByNorm.keys())
  signals.strainIds = tagNames
    .map((t) => strainByNorm.get(normKey(t))?.id)
    .filter((id): id is string => !!id)
  // A tag can name a strain that isn't in the catalog yet — the exact
  // full-tag name still matches diary free-text `strain`, so keep it.
  // Technique and setup-enum vocabulary ("scrog", "soil") is excluded so
  // a setup tag never becomes a phantom strain signal.
  signals.strainTagNames = tagNames.filter(
    (t) =>
      strainNorms.has(normKey(t)) ||
      (!TECHNIQUE_BY_NORM.has(normKey(t)) && !SETUP_ENUM_TOKENS.has(normKey(t)))
  )

  const consumed = new Set<string>()
  for (const t of tagNames) {
    const tech = TECHNIQUE_BY_NORM.get(normKey(t))
    if (tech) {
      signals.techniqueKeys.push(tech)
      consumed.add(t)
      continue
    }
    if (strainNorms.has(normKey(t))) {
      consumed.add(t)
      continue
    }
  }
  for (const t of tagNames) {
    if (consumed.has(t)) continue
    for (const w of normTokens(t)) {
      const enums = SETUP_ENUM_TOKENS.get(normKey(w))
      if (enums) {
        if (enums.medium) signals.mediumTypes.push(enums.medium)
        if (enums.light) signals.lightTypes.push(enums.light)
        if (enums.grow) signals.growTypes.push(enums.grow)
      }
      signals.setupTokens.push(w)
    }
  }
  signals.setupTokens = [...new Set(signals.setupTokens)].slice(0, SETUP_TOKEN_CAP)
  signals.mediumTypes = [...new Set(signals.mediumTypes)]
  signals.lightTypes = [...new Set(signals.lightTypes)]
  signals.growTypes = [...new Set(signals.growTypes)]
  return signals
}

/** One catalog-strain resolution for a batch of threads — the only DB
 *  read signal extraction needs. Same inputs → same signals. */
async function extractSignalsBatch(
  threads: { id: string; tags: { tag: { name: string } }[] }[]
): Promise<Map<string, QuestionSignals>> {
  const allTagNames = [...new Set(threads.flatMap(tagNamesOf))]
  const strainRows = allTagNames.length
    ? await prisma.strain.findMany({
        where: { name: { in: allTagNames, mode: "insensitive" } },
        select: { id: true, name: true },
      })
    : []
  const byNorm = new Map(strainRows.map((s) => [normKey(s.name), s]))
  const map = new Map<string, QuestionSignals>()
  for (const t of threads) map.set(t.id, buildSignals(tagNamesOf(t), byNorm))
  return map
}

/** Single-thread convenience wrapper over the batch resolver — used by
 *  the question-evidence rail so page code never re-implements the
 *  tag→strain/technique/setup extraction. */
export async function extractQuestionSignals(
  thread: { id: string; tags: { tag: { name: string } }[] }
): Promise<QuestionSignals> {
  return (await extractSignalsBatch([thread])).get(thread.id)!
}

// ── Shared eligibility predicates ────────────────────────────────────

/** Question categories — help-surface boards only. */
export async function questionCategoryIds(): Promise<{ id: string; name: string }[]> {
  const cats = await prisma.category.findMany({
    where: { hidden: false },
    select: { id: true, name: true, slug: true },
  })
  return cats.filter((c) => QUESTION_CATEGORY_RE.test(`${c.slug} ${c.name}`))
}

/** The authoritative unanswered-question predicate used by the scan AND
 *  the member-home card — one definition, no drift. */
function unansweredQuestionWhere(categoryIds: string[], now: number) {
  return {
    deleted: false,
    locked: false,
    replyCount: 0,
    acceptedAnswerId: null,
    categoryId: { in: categoryIds },
    author: activeAuthor(),
    createdAt: {
      lt: new Date(now - MIN_QUESTION_AGE_MS),
      gte: new Date(now - MAX_QUESTION_AGE_MS),
    },
  }
}

const QUESTION_SELECT = {
  id: true,
  slug: true,
  title: true,
  categoryId: true,
  authorId: true,
  createdAt: true,
  category: { select: { name: true } },
  tags: { select: { tag: { select: { name: true } } } },
} as const

// ── Scan-side candidate discovery ────────────────────────────────────

interface RawCandidate {
  userId: string
  score: number
  reason: AnswerMatchReason
  detail: string
}

async function candidatesForThread(
  thread: {
    id: string
    categoryId: string
    authorId: string
    category: { name: string }
    tags: { tag: { name: string } }[]
  },
  signals: QuestionSignals
): Promise<AnswerCandidate[]> {
  const raw = new Map<string, RawCandidate[]>()
  const add = (c: RawCandidate) => {
    const list = raw.get(c.userId) ?? []
    list.push(c)
    raw.set(c.userId, list)
  }

  const searches: Promise<void>[] = []

  // STRAIN_GROWN — public diaries carrying the tagged strain.
  if (signals.strainTagNames.length || signals.strainIds.length) {
    searches.push(
      prisma.growDiary
        .findMany({
          where: {
            visibility: "PUBLIC",
            deleted: false,
            author: activeAuthor(),
            authorId: { not: thread.authorId },
            OR: [
              ...(signals.strainIds.length ? [{ strainId: { in: signals.strainIds } }] : []),
              { strain: { in: signals.strainTagNames, mode: "insensitive" as const } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: STRAIN_DIARY_CAP,
          select: { authorId: true, strain: true, strainRef: { select: { name: true } } },
        })
        .then((rows) => {
          const tagNorms = new Set(signals.strainTagNames.map(normKey))
          for (const d of rows) {
            const name = d.strainRef?.name ?? d.strain ?? "this strain"
            // strainId hits are always valid; free-text hits must be a
            // real equality, not a substring coincidence.
            if (!d.strainRef && d.strain && !tagNorms.has(normKey(d.strain))) continue
            add({ userId: d.authorId, score: STRAIN_SCORE, reason: "STRAIN_GROWN", detail: name })
          }
        })
    )
  }

  // TECHNIQUE_MATCH — public diaries logging the tagged technique.
  if (signals.techniqueKeys.length) {
    searches.push(
      prisma.growDiary
        .findMany({
          where: {
            visibility: "PUBLIC",
            deleted: false,
            author: activeAuthor(),
            authorId: { not: thread.authorId },
            techniques: { hasSome: signals.techniqueKeys },
          },
          orderBy: { updatedAt: "desc" },
          take: TECH_DIARY_CAP,
          select: { authorId: true, techniques: true },
        })
        .then((rows) => {
          for (const d of rows) {
            const hit = d.techniques.find((t) => signals.techniqueKeys.includes(t))
            add({
              userId: d.authorId,
              score: TECHNIQUE_SCORE,
              reason: "TECHNIQUE_MATCH",
              detail: TECHNIQUE_LABELS[hit as keyof typeof TECHNIQUE_LABELS] ?? hit ?? "this technique",
            })
          }
        })
    )
  }

  // SETUP_MATCH — structured enum fields on public diaries plus the
  // public setup showcase's free-text fields (post-filtered to whole-
  // word matches so "led" never hits "cooled").
  const setupSearches: Promise<void>[] = []
  if (signals.mediumTypes.length || signals.lightTypes.length || signals.growTypes.length) {
    setupSearches.push(
      prisma.growDiary
        .findMany({
          where: {
            visibility: "PUBLIC",
            deleted: false,
            author: activeAuthor(),
            authorId: { not: thread.authorId },
            OR: [
              ...(signals.mediumTypes.length ? [{ mediumType: { in: signals.mediumTypes } }] : []),
              ...(signals.lightTypes.length ? [{ lightType: { in: signals.lightTypes } }] : []),
              ...(signals.growTypes.length ? [{ growType: { in: signals.growTypes } }] : []),
            ],
          },
          orderBy: { updatedAt: "desc" },
          take: SETUP_ROW_CAP,
          select: { authorId: true, mediumType: true, lightType: true, growType: true },
        })
        .then((rows) => {
          for (const d of rows) {
            const detail =
              (d.mediumType && signals.mediumTypes.includes(d.mediumType) && d.mediumType.toLowerCase()) ||
              (d.lightType && signals.lightTypes.includes(d.lightType) && `${d.lightType.toLowerCase()} lighting`) ||
              (d.growType && signals.growTypes.includes(d.growType) && d.growType.toLowerCase()) ||
              "setup"
            add({ userId: d.authorId, score: SETUP_SCORE, reason: "SETUP_MATCH", detail })
          }
        })
    )
  }
  if (signals.setupTokens.length) {
    setupSearches.push(
      prisma.growSetup
        .findMany({
          where: {
            deleted: false,
            author: activeAuthor(),
            authorId: { not: thread.authorId },
            OR: signals.setupTokens.map((tok) => ({
              OR: SETUP_TEXT_FIELDS.map((f) => ({ [f]: { contains: tok, mode: "insensitive" as const } })),
            })),
          },
          orderBy: { updatedAt: "desc" },
          take: SETUP_ROW_CAP,
          select: {
            authorId: true,
            space: true,
            tent: true,
            lighting: true,
            ventilation: true,
            fans: true,
            containers: true,
            medium: true,
            equipment: true,
          },
        })
        .then((rows) => {
          for (const s of rows) {
            const text = SETUP_TEXT_FIELDS.map((f) => s[f] ?? "").join(" ")
            const words = new Set(normTokens(text).map(normKey))
            const hit = signals.setupTokens.find((t) => words.has(normKey(t)))
            if (hit) add({ userId: s.authorId, score: SETUP_SCORE, reason: "SETUP_MATCH", detail: hit })
          }
        })
    )
  }
  if (setupSearches.length) searches.push(...setupSearches)

  // TOPIC_PARTICIPANT — demonstrated participation in this category.
  searches.push(
    prisma
      .$queryRaw<{ authorId: string; posts: bigint; threads: bigint }[]>`
        SELECT p."authorId", COUNT(*) AS posts, COUNT(DISTINCT p."threadId") AS threads
        FROM "Post" p
        JOIN "Thread" t ON t."id" = p."threadId"
        JOIN "User" u ON u."id" = p."authorId"
        WHERE t."categoryId" = ${thread.categoryId}
          AND t."deleted" = false AND p."deleted" = false
          AND p."authorId" <> ${thread.authorId}
          AND u."banned" = false
          AND (u."suspendedUntil" IS NULL OR u."suspendedUntil" < ${new Date()})
        GROUP BY p."authorId"
        HAVING COUNT(*) >= ${PARTICIPATION_MIN_POSTS}
           AND COUNT(DISTINCT p."threadId") >= ${PARTICIPATION_MIN_THREADS}
        ORDER BY posts DESC
        LIMIT ${PARTICIPANT_CAP}`
      .then((rows) => {
        for (const r of rows) {
          add({
            userId: r.authorId,
            score: PARTICIPANT_SCORE,
            reason: "TOPIC_PARTICIPANT",
            detail: thread.category.name,
          })
        }
      })
  )

  await Promise.all(searches)
  if (!raw.size) return []

  // Blocks in either direction remove the pair entirely.
  const candidateIds = [...raw.keys()]
  const blocks = candidateIds.length
    ? await prisma.block.findMany({
        where: {
          OR: [
            { blockerId: thread.authorId, blockedId: { in: candidateIds } },
            { blockedId: thread.authorId, blockerId: { in: candidateIds } },
          ],
        },
        select: { blockerId: true, blockedId: true },
      })
    : []
  const excluded = new Set(
    blocks.map((b) => (b.blockerId === thread.authorId ? b.blockedId : b.blockerId))
  )

  // Merge evidence, rank by total score, break ties deterministically.
  return candidateIds
    .filter((id) => id !== thread.authorId && !excluded.has(id))
    .map((userId) => {
      const hits = raw.get(userId)!
      const best = [...hits].sort((a, b) => b.score - a.score)[0]
      return {
        userId,
        score: hits.reduce((n, h) => n + h.score, 0),
        reason: best.reason,
        detail: best.detail,
      }
    })
    .sort((a, b) => b.score - a.score || a.userId.localeCompare(b.userId))
    .slice(0, CANDIDATES_PER_THREAD)
}

const REASON_COPY: Record<AnswerMatchReason, (detail: string) => string> = {
  STRAIN_GROWN: (d) => `you've publicly grown ${d}`,
  SETUP_MATCH: (d) => `your grow record matches their ${d} setup`,
  TECHNIQUE_MATCH: (d) => `you've logged ${d} on your grows`,
  TOPIC_PARTICIPANT: (d) => `you're active in ${d}`,
}

// ── Cron scan ────────────────────────────────────────────────────────

/**
 * Daily scan — unanswered question threads ≥24h old recruit up to 5
 * members each whose PUBLIC evidence matches. One once-ever invite per
 * (thread, member) pair; the shared cushion/cap/pref pipeline applies.
 */
export async function scanAnswerMatches(opts: {
  /** Test seam: restrict the scan to these thread ids. Omit in production. */
  threadIds?: string[]
  /** Test seam: restrict recipients to these user ids. Omit in production. */
  userIds?: string[]
} = {}): Promise<{ scanned: number; matched: number; sent: number }> {
  const now = Date.now()
  const cats = await questionCategoryIds()
  if (!cats.length) return { scanned: 0, matched: 0, sent: 0 }

  const threads = await prisma.thread.findMany({
    where: {
      ...unansweredQuestionWhere(cats.map((c) => c.id), now),
      ...(opts.threadIds ? { id: { in: opts.threadIds } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: opts.threadIds ? Math.max(THREAD_SCAN_CAP, opts.threadIds.length) : THREAD_SCAN_CAP,
    select: QUESTION_SELECT,
  })
  if (!threads.length) return { scanned: 0, matched: 0, sent: 0 }

  // Match every thread first so the assist prelude can batch-load all
  // recipient + claim-key state in three queries total.
  const signalsByThread = await extractSignalsBatch(threads)
  const matched: { thread: (typeof threads)[number]; candidates: AnswerCandidate[] }[] = []
  const allUserIds = new Set<string>()
  const allKeys: string[] = []
  for (const t of threads) {
    const candidates = (await candidatesForThread(t, signalsByThread.get(t.id)!)).filter(
      (c) => !opts.userIds || opts.userIds.includes(c.userId)
    )
    if (!candidates.length) continue
    matched.push({ thread: t, candidates })
    for (const c of candidates) {
      allUserIds.add(c.userId)
      allKeys.push(`assist:answer-match:${t.id}:${c.userId}`)
    }
  }
  if (!matched.length) return { scanned: threads.length, matched: 0, sent: 0 }

  const pre = await loadAssistPrelude([...allUserIds], allKeys)

  let sent = 0
  for (const { thread: t, candidates } of matched) {
    if (sent >= SEND_CAP) break
    for (const c of candidates) {
      if (sent >= SEND_CAP) break
      const r = await botAssist({
        key: `assist:answer-match:${t.id}:${c.userId}`,
        kind: "answer-match",
        userId: c.userId,
        pre,
        title: "A grower could use your experience",
        content: `"${sanitizeEcho(t.title, 60)}" still has no replies — ${REASON_COPY[c.reason](sanitizeEcho(c.detail, 40))}, so your take could help.`,
        link: `/forum/thread/${t.slug}`,
        metadata: {
          kind: "answer-match",
          threadId: t.id,
          reason: c.reason,
        },
      })
      if (r === "sent") sent++
    }
  }
  return {
    scanned: threads.length,
    matched: matched.reduce((n, m) => n + m.candidates.length, 0),
    sent,
  }
}

// ── Member-home "could use your help" ────────────────────────────────

interface UserEvidence {
  strainNames: Set<string>
  strainIds: Set<string>
  techniques: Set<string>
  setupTokens: Set<string>
  participation: Map<string, { posts: number; threads: number }>
}

async function loadUserEvidence(userId: string): Promise<UserEvidence> {
  const [diaries, setups, posts] = await Promise.all([
    prisma.growDiary.findMany({
      // Same public-evidence rule as the assist — private/unlisted grows
      // never become a match signal, even for the owner-facing card.
      where: { authorId: userId, deleted: false, visibility: "PUBLIC" },
      select: {
        strain: true,
        strainId: true,
        techniques: true,
        mediumType: true,
        lightType: true,
        growType: true,
        strainRef: { select: { name: true } },
      },
    }),
    prisma.growSetup.findMany({
      where: { authorId: userId, deleted: false },
      select: {
        space: true,
        tent: true,
        lighting: true,
        ventilation: true,
        fans: true,
        containers: true,
        medium: true,
        equipment: true,
      },
    }),
    prisma.$queryRaw<{ categoryId: string; posts: bigint; threads: bigint }[]>`
      SELECT t."categoryId", COUNT(*) AS posts, COUNT(DISTINCT p."threadId") AS threads
      FROM "Post" p
      JOIN "Thread" t ON t."id" = p."threadId"
      WHERE p."authorId" = ${userId} AND p."deleted" = false AND t."deleted" = false
      GROUP BY t."categoryId"`,
  ])

  const ev: UserEvidence = {
    strainNames: new Set(),
    strainIds: new Set(),
    techniques: new Set(),
    setupTokens: new Set(),
    participation: new Map(),
  }
  for (const d of diaries) {
    if (d.strainRef?.name) ev.strainNames.add(normKey(d.strainRef.name))
    if (d.strain) ev.strainNames.add(normKey(d.strain))
    if (d.strainId) ev.strainIds.add(d.strainId)
    for (const t of d.techniques) ev.techniques.add(t)
    for (const v of [d.mediumType, d.lightType, d.growType])
      if (v) {
        // Both forms: "LIVING_SOIL" matches question tokens "living"/"soil"
        // AND the enum-implied signal "livingsoil".
        ev.setupTokens.add(normKey(v))
        for (const w of normTokens(v)) ev.setupTokens.add(normKey(w))
      }
  }
  for (const s of setups) {
    const text = SETUP_TEXT_FIELDS.map((f) => s[f] ?? "").join(" ")
    for (const w of normTokens(text)) ev.setupTokens.add(normKey(w))
  }
  for (const p of posts) {
    ev.participation.set(p.categoryId, { posts: Number(p.posts), threads: Number(p.threads) })
  }
  return ev
}

function scoreThreadForUser(
  thread: { categoryId: string; category: { name: string }; tags: { tag: { name: string } }[] },
  signals: QuestionSignals,
  ev: UserEvidence
): AnswerCandidate | null {
  const hits: RawCandidate[] = []
  for (const t of signals.strainTagNames) {
    const n = normKey(t)
    if (ev.strainNames.has(n)) {
      const name = thread.tags.find((tt) => normKey(tt.tag.name) === n)?.tag.name ?? "this strain"
      hits.push({ userId: "", score: STRAIN_SCORE, reason: "STRAIN_GROWN", detail: name })
      break
    }
  }
  if (!hits.some((h) => h.reason === "STRAIN_GROWN") && signals.strainIds.some((id) => ev.strainIds.has(id))) {
    hits.push({ userId: "", score: STRAIN_SCORE, reason: "STRAIN_GROWN", detail: "this strain" })
  }
  const tech = signals.techniqueKeys.find((k) => ev.techniques.has(k))
  if (tech)
    hits.push({
      userId: "",
      score: TECHNIQUE_SCORE,
      reason: "TECHNIQUE_MATCH",
      detail: TECHNIQUE_LABELS[tech as keyof typeof TECHNIQUE_LABELS] ?? tech,
    })
  const setupHit =
    [...ev.setupTokens].find((tok) => signals.setupTokens.map(normKey).includes(tok)) ||
    signals.mediumTypes.find((m) => ev.setupTokens.has(normKey(m))) ||
    signals.lightTypes.find((l) => ev.setupTokens.has(normKey(l))) ||
    signals.growTypes.find((g) => ev.setupTokens.has(normKey(g)))
  if (setupHit) hits.push({ userId: "", score: SETUP_SCORE, reason: "SETUP_MATCH", detail: setupHit.toLowerCase() })
  const part = ev.participation.get(thread.categoryId)
  if (part && part.posts >= PARTICIPATION_MIN_POSTS && part.threads >= PARTICIPATION_MIN_THREADS)
    hits.push({ userId: "", score: PARTICIPANT_SCORE, reason: "TOPIC_PARTICIPANT", detail: thread.category.name })

  if (!hits.length) return null
  const best = [...hits].sort((a, b) => b.score - a.score)[0]
  return {
    userId: "",
    score: hits.reduce((n, h) => n + h.score, 0),
    reason: best.reason,
    detail: best.detail,
  }
}

/**
 * Unanswered questions this member's public evidence could help with —
 * the member-home "could use your help" card. Same predicate and scoring
 * as the cron scan, scoped to one viewer. Returns the top items plus the
 * total match count for the "N more" line.
 */
export async function helpWantedForUser(
  userId: string,
  opts: { /** Test seam: restrict to these thread ids. */ threadIds?: string[] } = {}
): Promise<{ total: number; items: HelpWantedItem[] }> {
  const now = Date.now()
  const [cats, blocked, viewer] = await Promise.all([
    questionCategoryIds(),
    blockedUserIds(userId),
    // Same eligibility gate as the scan's activeAuthor() — a banned or
    // suspended member can't reply, so the card never signals for them.
    prisma.user.findUnique({
      where: { id: userId },
      select: { banned: true, suspendedUntil: true },
    }),
  ])
  if (!cats.length) return { total: 0, items: [] }
  if (!viewer || viewer.banned || (viewer.suspendedUntil && viewer.suspendedUntil.getTime() > now))
    return { total: 0, items: [] }

  const threads = await prisma.thread.findMany({
    where: {
      ...unansweredQuestionWhere(cats.map((c) => c.id), now),
      authorId: { not: userId, ...(blocked.length ? { notIn: blocked } : {}) },
      ...(opts.threadIds ? { id: { in: opts.threadIds } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(HOME_SCAN_CAP, opts.threadIds?.length ?? 0),
    select: QUESTION_SELECT,
  })
  if (!threads.length) return { total: 0, items: [] }

  const [ev, signalsByThread] = await Promise.all([loadUserEvidence(userId), extractSignalsBatch(threads)])
  const scored: { thread: (typeof threads)[number]; match: AnswerCandidate }[] = []
  for (const t of threads) {
    const match = scoreThreadForUser(t, signalsByThread.get(t.id)!, ev)
    if (match) scored.push({ thread: t, match })
  }
  scored.sort((a, b) => b.match.score - a.match.score || a.thread.id.localeCompare(b.thread.id))

  return {
    total: scored.length,
    items: scored.slice(0, 3).map(({ thread: t, match }) => ({
      slug: t.slug,
      title: t.title,
      category: t.category.name,
      reason: match.reason,
      detail: match.detail,
    })),
  }
}

/** One-line reason for the member-home card — mirrors REASON_COPY. */
export function helpWantedReasonText(item: HelpWantedItem): string {
  return REASON_COPY[item.reason](item.detail)
}
