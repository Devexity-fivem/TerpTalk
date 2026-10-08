// Suggested Growers — the canonical deterministic grower recommender.
// Consumed by the Discover "growers" tab and member home. One module,
// one scoring model, no per-surface forks.
//
// Model: for a signed-in member, the viewer's own PUBLIC grow signals
// (strains, medium, lighting, techniques, grow type, stages) plus their
// public follow graph are matched in SQL against other members' public
// grows; results are scored with additive weights where every point maps
// to a visible, explainable reason. Guests get the same cards ranked on
// public evidence only. No embeddings, no randomness, no graph
// materialization.
//
// Privacy: candidate data is public-discovery scope only (PUBLIC
// diaries, not deleted, active author, no block in either direction,
// already-followed excluded). The viewer's PRIVATE/UNLISTED diaries are
// never evidence — matching only uses what the member made discoverable,
// and their declared favoriteStrain (their own setting, shown only to
// them). UNLISTED diaries never participate for anyone.
import { prisma } from "@/lib/prisma"
import { activeAuthor, blockedUserIds } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import type { Prisma } from "@prisma/client"

// Bounded pools → in-memory scoring → top RESULT_LIMIT. Diary candidates
// are pre-filtered in SQL to grows sharing at least one viewer signal;
// the generic pool is bounded the same way the Discover growers tab is.
const DIARY_CANDIDATE_CAP = 150
const GENERIC_POOL_CAP = 40
const VIEWER_DIARY_CAP = 50
const VIEWER_FOLLOW_CAP = 500
const RESULT_LIMIT = 6
const RECENT_UPDATE_DAYS = 30
// Below this a personalized suggestion is too weak to surface — shared
// context must beat generic popularity. Generic (guest/fill) items are
// ranked on public evidence without a floor; the floor only applies to
// the relevance-scored set so the section never disappears entirely.
export const MIN_PERSONALIZED_SCORE = 30

// Weights follow informational value, mirroring grow-matches: shared
// genetics >> shared substrate/light >> techniques >> contribution and
// graph signals. Follower counts and reaction counts are never inputs —
// they are popularity, not relevance.
const W = {
  STRAIN: 40,
  MEDIUM: 20,
  LIGHTING: 15,
  TECHNIQUE: 8,
  TECHNIQUE_CAP: 24,
  GROW_TYPE: 10,
  STAGE: 5,
  SHARED_FOLLOW: 20,
  SHARED_FOLLOW_CAP: 30,
  ACCEPTED_ANSWER: 5,
  ACCEPTED_ANSWER_CAP: 25,
  RECENT_ACTIVITY: 10,
  HARVEST: 8,
  HARVEST_CAP: 16,
  CREATOR: 8,
  PUBLIC_GROW: 2,
  PUBLIC_GROW_CAP: 10,
}

export type GrowerReasonKind =
  | "STRAIN"
  | "MEDIUM"
  | "LIGHTING"
  | "TECHNIQUE"
  | "GROW_TYPE"
  | "STAGE"
  | "SHARED_FOLLOW"
  | "ACCEPTED_ANSWERS"
  | "RECENT_ACTIVITY"
  | "HARVEST"
  | "CREATOR"
  | "PUBLIC_GROWS"

export interface GrowerReason {
  kind: GrowerReasonKind
  label: string
}

export interface SuggestedGrower {
  userId: string
  username: string | null
  name: string | null
  image: string | null
  role: string
  /** null when the member opted out of public milestones. */
  xp: number | null
  publicMilestoneOptOut: boolean
  bio: string | null
  href: string
  /** Public aggregate counts — honest, query-backed card context. */
  publicGrows: number
  harvests: number
  acceptedAnswers: number
  reasons: GrowerReason[]
}

interface ViewerSignals {
  strainIds: string[]
  strainNames: string[] // normalized lowercase
  mediums: string[]
  lights: string[]
  growTypes: string[]
  techniques: string[]
  stages: string[] // stages of the viewer's live (non-harvested) grows
  favoriteStrain: string | null // normalized; viewer's own declared pref
  followingIds: string[]
  blockedIds: string[]
}

// A page context (strain profile, question thread) can act as a second
// signal set: candidates are generated from viewer signals ∪ context
// signals, and each evidence dimension is scored once — the viewer's
// phrasing wins when both match. Context never bypasses eligibility,
// blocks, or the public-only diary scope.
export interface GrowerContext {
  strainIds?: string[]
  strainNames?: string[] // raw names; normalized internally
  mediums?: string[]
  lights?: string[]
  growTypes?: string[]
  techniques?: string[]
}

interface ContextSignals {
  strainIds: string[]
  strainNames: string[] // normalized lowercase
  mediums: string[]
  lights: string[]
  growTypes: string[]
  techniques: string[]
}

// A context match below this bar ("indoor grower", one technique) is too
// weak to headline a contextual surface; strain/medium-level evidence and
// combined signals clear it. Only applies under `contextOnly`.
export const MIN_CONTEXT_SCORE = 20
const CONTEXT_DIARY_CAP = 100

const toContextSignals = (c: GrowerContext): ContextSignals => ({
  strainIds: [...new Set(c.strainIds ?? [])],
  strainNames: [...new Set((c.strainNames ?? []).map((s) => norm(s)).filter((s): s is string => !!s))],
  mediums: [...new Set(c.mediums ?? [])],
  lights: [...new Set(c.lights ?? [])],
  growTypes: [...new Set(c.growTypes ?? [])],
  techniques: [...new Set(c.techniques ?? [])],
})

const ctxEmpty = (c: ContextSignals) =>
  !c.strainIds.length && !c.strainNames.length && !c.mediums.length &&
  !c.lights.length && !c.growTypes.length && !c.techniques.length

type CandidateUser = {
  id: string
  name: string | null
  image: string | null
  role: string
  lastSeenAt: Date | null
  profile: {
    username: string | null
    bio: string | null
    avatarUrl: string | null
    xp: number
    publicMilestoneOptOut: boolean
    hideOnlineStatus: boolean
  } | null
  badges: { badge: { name: string } }[]
}

const USER_SELECT = {
  id: true,
  name: true,
  image: true,
  role: true,
  lastSeenAt: true,
  profile: {
    select: {
      username: true,
      bio: true,
      avatarUrl: true,
      xp: true,
      publicMilestoneOptOut: true,
      hideOnlineStatus: true,
    },
  },
  badges: { select: { badge: { select: { name: true } } } },
} satisfies Prisma.UserSelect

const norm = (s: string | null | undefined) => (s ? s.trim().toLowerCase() : null)

// A suggested grower needs an eligible public identity AND at least one
// real public contribution — same gate as the Discover growers tab.
const eligibleUserWhere = (excludedIds: string[]): Prisma.UserWhereInput => ({
  banned: false,
  id: excludedIds.length ? { notIn: excludedIds } : undefined,
  AND: [
    // activeAuthor() carries an OR — never spread it beside our own OR,
    // it would be silently overwritten.
    { OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: new Date() } }] },
    { profile: { isNot: { username: TERPBOT_USERNAME } } },
    // Online-status opt-outs never appear on member-listing surfaces
    // (homepage "who's online" + growers tab precedent).
    { OR: [{ profile: { hideOnlineStatus: false } }, { profile: null }] },
  ],
  OR: [
    { posts: { some: { deleted: false } } },
    { threadCreator: { some: { deleted: false } } },
    { diaryCreator: { some: { deleted: false, ...publicDiaryWhere } } },
  ],
})

async function loadViewerSignals(viewerId: string): Promise<ViewerSignals> {
  const [diaries, profile, follows, blockedIds] = await Promise.all([
    prisma.growDiary.findMany({
      where: { authorId: viewerId, deleted: false, ...publicDiaryWhere },
      orderBy: { updatedAt: "desc" },
      take: VIEWER_DIARY_CAP,
      select: {
        strainId: true, strain: true, mediumType: true, lightType: true,
        growType: true, techniques: true, stage: true, harvested: true,
        strainRef: { select: { name: true } },
      },
    }),
    prisma.profile.findUnique({ where: { userId: viewerId }, select: { favoriteStrain: true } }),
    prisma.follow.findMany({
      where: { followerId: viewerId },
      take: VIEWER_FOLLOW_CAP,
      select: { followingId: true },
    }),
    blockedUserIds(viewerId),
  ])

  const set = <T>(vals: (T | null | undefined)[]) => [...new Set(vals.filter((v): v is T => v != null))]
  return {
    strainIds: set(diaries.map((d) => d.strainId)),
    strainNames: set(diaries.map((d) => norm(d.strainRef?.name ?? d.strain))),
    mediums: set(diaries.map((d) => d.mediumType)),
    lights: set(diaries.map((d) => d.lightType)),
    growTypes: set(diaries.map((d) => d.growType)),
    techniques: set(diaries.flatMap((d) => d.techniques)),
    stages: set(diaries.filter((d) => !d.harvested).map((d) => d.stage)),
    favoriteStrain: norm(profile?.favoriteStrain),
    followingIds: follows.map((f) => f.followingId),
    blockedIds,
  }
}

interface DiaryMatch {
  score: number
  reasons: GrowerReason[]
  lastActive: Date
}

const STAGE_LABELS: Record<string, string> = {
  GERMINATION: "germinating", SEEDLING: "seedling", VEGETATIVE: "in veg", FLOWER: "in flower",
  HARVEST: "at harvest", DRYING: "drying", CURING: "curing", COMPLETED: "completed",
}
const MEDIUM_LABELS: Record<string, string> = {
  SOIL: "soil", COCO: "coco", HYDRO: "hydro", DWC: "DWC", LIVING_SOIL: "living soil", OTHER: "other",
}
const LIGHT_LABELS: Record<string, string> = {
  LED: "LED", HPS: "HPS", CMH: "CMH", FLUORESCENT: "fluorescent", SUN: "sun-grown", OTHER: "other",
}
const GROW_TYPE_LABELS: Record<string, string> = {
  INDOOR: "indoor", OUTDOOR: "outdoor", GREENHOUSE: "greenhouse", HYDROPONIC: "hydroponic", OTHER: "other",
}
const label = (map: Record<string, string>, v: string) => map[v] ?? v.toLowerCase()

// Score one candidate diary against the viewer's signal sets and — when
// a page context is attached — the context's signal sets. Every point of
// score produces a reason — explanations can never disagree with the
// ranking. Each evidence dimension is scored once: the viewer's phrasing
// wins when both match ("You both grow X" beats "Grows X"), and
// `ctxScore` tracks context-attributable points for `contextOnly`
// surfaces so a card can never headline "growers growing this strain"
// without real context evidence.
function scoreDiaryMatch(
  sig: ViewerSignals | null,
  ctx: ContextSignals | null,
  cand: { strainId: string | null; strain: string | null; strainRefName: string | null; mediumType: string | null; lightType: string | null; growType: string; techniques: string[]; stage: string; updatedAt: Date }
): DiaryMatch & { ctxHit: boolean; ctxScore: number } {
  let score = 0
  let ctxScore = 0
  const reasons: GrowerReason[] = []
  const candStrainName = cand.strainRefName ?? cand.strain
  const candStrain = norm(candStrainName)

  const viewerStrainHit =
    !!sig &&
    ((cand.strainId && sig.strainIds.includes(cand.strainId)) ||
      (candStrain && sig.strainNames.includes(candStrain)) ||
      (candStrain && sig.favoriteStrain === candStrain))
  const ctxStrainHit =
    !!ctx &&
    ((cand.strainId && ctx.strainIds.includes(cand.strainId)) ||
      (candStrain && ctx.strainNames.includes(candStrain)))
  if ((viewerStrainHit || ctxStrainHit) && candStrainName) {
    score += W.STRAIN
    if (ctxStrainHit) ctxScore += W.STRAIN
    reasons.push({
      kind: "STRAIN",
      label: viewerStrainHit ? `You both grow ${candStrainName.trim()}` : `Grows ${candStrainName.trim()}`,
    })
  }
  if (cand.mediumType) {
    const vHit = !!sig && sig.mediums.includes(cand.mediumType)
    const cHit = !!ctx && ctx.mediums.includes(cand.mediumType)
    if (vHit || cHit) {
      score += W.MEDIUM
      if (cHit) ctxScore += W.MEDIUM
      reasons.push({
        kind: "MEDIUM",
        label: vHit
          ? `Same medium — ${label(MEDIUM_LABELS, cand.mediumType)}`
          : `Grows in ${label(MEDIUM_LABELS, cand.mediumType)}`,
      })
    }
  }
  if (cand.lightType) {
    const vHit = !!sig && sig.lights.includes(cand.lightType)
    const cHit = !!ctx && ctx.lights.includes(cand.lightType)
    if (vHit || cHit) {
      score += W.LIGHTING
      if (cHit) ctxScore += W.LIGHTING
      reasons.push({
        kind: "LIGHTING",
        label: vHit
          ? `Same lighting — ${label(LIGHT_LABELS, cand.lightType)}`
          : `Runs ${label(LIGHT_LABELS, cand.lightType)}`,
      })
    }
  }
  const sharedTech = sig ? cand.techniques.filter((t) => sig.techniques.includes(t)) : []
  const ctxTech = ctx ? cand.techniques.filter((t) => ctx.techniques.includes(t) && !sharedTech.includes(t)) : []
  if (sharedTech.length || ctxTech.length) {
    score += Math.min((sharedTech.length + ctxTech.length) * W.TECHNIQUE, W.TECHNIQUE_CAP)
    ctxScore += Math.min(ctxTech.length * W.TECHNIQUE, W.TECHNIQUE_CAP)
    if (sharedTech.length)
      reasons.push({ kind: "TECHNIQUE", label: `Shared techniques: ${sharedTech.slice(0, 3).join(", ")}` })
    if (ctxTech.length)
      reasons.push({ kind: "TECHNIQUE", label: `Uses ${ctxTech.slice(0, 3).join(", ")}` })
  }
  {
    const vHit = !!sig && sig.growTypes.includes(cand.growType)
    const cHit = !!ctx && ctx.growTypes.includes(cand.growType)
    if (vHit || cHit) {
      score += W.GROW_TYPE
      if (cHit) ctxScore += W.GROW_TYPE
      reasons.push({
        kind: "GROW_TYPE",
        label: vHit ? `Both ${label(GROW_TYPE_LABELS, cand.growType)} growers` : `${label(GROW_TYPE_LABELS, cand.growType)} grower`,
      })
    }
  }
  if (sig && sig.stages.includes(cand.stage)) {
    score += W.STAGE
    reasons.push({ kind: "STAGE", label: `Same stage — ${label(STAGE_LABELS, cand.stage)}` })
  }
  return { score, reasons, lastActive: cand.updatedAt, ctxHit: ctxScore > 0, ctxScore }
}

interface CandidateAgg {
  user: CandidateUser
  growScore: number
  growReasons: GrowerReason[]
  lastActive: Date | null
  /** Any public diary of this candidate carried a context signal. */
  ctxMatched: boolean
  /** Best single-diary context score — the `contextOnly` floor input. */
  ctxScore: number
  sharedFollows: string[] // usernames of growers the viewer and candidate both follow
  acceptedAnswers: number
  recentUpdates: number
  harvests: number
  publicGrows: number
}

function finalize(agg: CandidateAgg): { g: SuggestedGrower; score: number; lastActive: number; ctxMatched: boolean; ctxScore: number } {
  let score = agg.growScore
  // Grow-overlap reasons lead (most relevant), but the card caps at 3 —
  // reserve a slot so trust/contribution evidence never gets truncated
  // off a strong match's card.
  const reasons = agg.growReasons.slice(0, 2)
  const social: GrowerReason[] = []

  if (agg.sharedFollows.length) {
    score += Math.min(W.SHARED_FOLLOW + 5 * (agg.sharedFollows.length - 1), W.SHARED_FOLLOW_CAP)
    social.push({
      kind: "SHARED_FOLLOW",
      label: `You both follow ${agg.sharedFollows.slice(0, 2).map((u) => `@${u}`).join(" and ")}`,
    })
  }
  if (agg.acceptedAnswers > 0) {
    score += Math.min(agg.acceptedAnswers * W.ACCEPTED_ANSWER, W.ACCEPTED_ANSWER_CAP)
    social.push({ kind: "ACCEPTED_ANSWERS", label: `${agg.acceptedAnswers} accepted answer${agg.acceptedAnswers === 1 ? "" : "s"}` })
  }
  if (agg.recentUpdates > 0) {
    score += W.RECENT_ACTIVITY
    social.push({ kind: "RECENT_ACTIVITY", label: `Active — ${agg.recentUpdates} update${agg.recentUpdates === 1 ? "" : "s"} this month` })
  }
  if (agg.harvests > 0) {
    score += Math.min(agg.harvests * W.HARVEST, W.HARVEST_CAP)
    social.push({ kind: "HARVEST", label: `Documented ${agg.harvests} harvest${agg.harvests === 1 ? "" : "s"}` })
  }
  if (agg.publicGrows > 0) {
    score += Math.min(agg.publicGrows * W.PUBLIC_GROW, W.PUBLIC_GROW_CAP)
    social.push({ kind: "PUBLIC_GROWS", label: `${agg.publicGrows} public grow${agg.publicGrows === 1 ? "" : "s"}` })
  }
  const isCreator = agg.user.badges.some((b) => b.badge.name === "Verified YouTuber")
  if (isCreator) {
    score += W.CREATOR
    social.push({ kind: "CREATOR", label: "Verified creator" })
  }
  reasons.push(...social)

  const u = agg.user
  const p = u.profile
  return {
    score,
    lastActive: agg.lastActive?.getTime() ?? 0,
    ctxMatched: agg.ctxMatched,
    ctxScore: agg.ctxScore,
    g: {
      userId: u.id,
      username: p?.username ?? null,
      name: u.name,
      image: p?.avatarUrl ?? u.image,
      role: u.role,
      xp: p?.publicMilestoneOptOut ? null : (p?.xp ?? 0),
      publicMilestoneOptOut: p?.publicMilestoneOptOut ?? false,
      bio: p?.bio ?? null,
      href: `/u/${p?.username ?? u.id}`,
      publicGrows: agg.publicGrows,
      harvests: agg.harvests,
      acceptedAnswers: agg.acceptedAnswers,
      reasons: reasons.slice(0, 3),
    },
  }
}

/**
 * The canonical suggested-grower query. `viewerId` null → guest: public
 * evidence only, no personalization. Members get signal-matched
 * suggestions first, then public-evidence fillers so the section stays
 * useful for members with no public grows yet.
 *
 * `opts.context` attaches a page context (strain, question signals) as a
 * second evidence set — it generates its own bounded candidate pool and
 * produces context-phrased reasons ("Grows X", "Uses LST"), never
 * bypassing eligibility, blocks, or the public-only scope. With
 * `contextOnly: true` the result is restricted to candidates with real
 * context evidence (ctxScore ≥ MIN_CONTEXT_SCORE) — contextual surfaces
 * never headline a grower who lacks evidence for the subject.
 *
 * Ordering is deterministic: score → most recent public grow activity →
 * user id. Same inputs, same ranking.
 */
export async function getSuggestedGrowers(
  viewerId: string | null,
  opts: { limit?: number; context?: GrowerContext; contextOnly?: boolean } = {}
): Promise<SuggestedGrower[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? RESULT_LIMIT), 24)
  const now = Date.now()
  const recentSince = new Date(now - RECENT_UPDATE_DAYS * 86_400_000)

  const sig = viewerId ? await loadViewerSignals(viewerId) : null
  const ctxSig = opts.context ? toContextSignals(opts.context) : null
  const hasCtx = !!ctxSig && !ctxEmpty(ctxSig)
  // Candidates the viewer can never be shown: self, already followed,
  // blocked either direction.
  const excluded = sig ? [viewerId!, ...sig.followingIds, ...sig.blockedIds] : []


  const aggs = new Map<string, CandidateAgg>()

  const mergeDiary = (d: {
    authorId: string
    strainId: string | null
    strain: string | null
    mediumType: string | null
    lightType: string | null
    growType: string
    techniques: string[]
    stage: string
    updatedAt: Date
    strainRef: { name: string } | null
    author: CandidateUser
  }) => {
    if (d.author.profile?.hideOnlineStatus || d.author.profile?.username === TERPBOT_USERNAME) return
    const m = scoreDiaryMatch(sig, ctxSig, {
      strainId: d.strainId, strain: d.strain, strainRefName: d.strainRef?.name ?? null,
      mediumType: d.mediumType, lightType: d.lightType, growType: d.growType,
      techniques: d.techniques, stage: d.stage, updatedAt: d.updatedAt,
    })
    const prev = aggs.get(d.authorId)
    if (!prev || m.score > prev.growScore) {
      aggs.set(d.authorId, {
        user: d.author, growScore: m.score, growReasons: m.reasons, lastActive: m.lastActive,
        ctxMatched: (prev?.ctxMatched ?? false) || m.ctxHit,
        ctxScore: Math.max(prev?.ctxScore ?? 0, m.ctxScore),
        sharedFollows: prev?.sharedFollows ?? [], acceptedAnswers: 0, recentUpdates: 0,
        harvests: 0, publicGrows: 0,
      })
    } else {
      prev.ctxMatched ||= m.ctxHit
      prev.ctxScore = Math.max(prev.ctxScore, m.ctxScore)
      if (m.lastActive > (prev.lastActive ?? new Date(0))) prev.lastActive = m.lastActive
    }
  }

  const DIARY_SELECT = {
    authorId: true, strainId: true, strain: true, mediumType: true,
    lightType: true, growType: true, techniques: true, stage: true,
    updatedAt: true,
    strainRef: { select: { name: true } },
    author: { select: USER_SELECT },
  } satisfies Prisma.GrowDiarySelect

  // ── Source 1a: public diaries sharing at least one viewer signal ──
  // Guests have no signals — this source only runs for members.
  if (sig) {
    const or: Prisma.GrowDiaryWhereInput[] = []
    if (sig.strainIds.length) or.push({ strainId: { in: sig.strainIds } })
    for (const s of [...sig.strainNames, ...(sig.favoriteStrain ? [sig.favoriteStrain] : [])].slice(0, 12)) {
      or.push({ strainRef: { is: { name: { equals: s, mode: "insensitive" } } } })
      or.push({ strain: { equals: s, mode: "insensitive" } })
    }
    if (sig.mediums.length) or.push({ mediumType: { in: sig.mediums } })
    if (sig.lights.length) or.push({ lightType: { in: sig.lights } })
    if (sig.growTypes.length) or.push({ growType: { in: sig.growTypes } })
    if (sig.techniques.length) or.push({ techniques: { hasSome: sig.techniques } })

    if (or.length) {
      const diaries = await prisma.growDiary.findMany({
        where: {
          deleted: false,
          ...publicDiaryWhere,
          author: activeAuthor(),
          authorId: { notIn: excluded },
          OR: or,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        take: DIARY_CANDIDATE_CAP,
        select: DIARY_SELECT,
      })
      for (const d of diaries) mergeDiary(d)
    }
  }

  // ── Source 1b: public diaries matching the page context ──
  // A separate bounded pool so popular viewer-signal diaries can never
  // starve context matches out of the shared cap. Runs for guests too —
  // context evidence is already public-only.
  if (hasCtx && ctxSig) {
    const or: Prisma.GrowDiaryWhereInput[] = []
    if (ctxSig.strainIds.length) or.push({ strainId: { in: ctxSig.strainIds } })
    for (const s of ctxSig.strainNames.slice(0, 12)) {
      or.push({ strainRef: { is: { name: { equals: s, mode: "insensitive" } } } })
      or.push({ strain: { equals: s, mode: "insensitive" } })
    }
    if (ctxSig.mediums.length) or.push({ mediumType: { in: ctxSig.mediums } })
    if (ctxSig.lights.length) or.push({ lightType: { in: ctxSig.lights } })
    if (ctxSig.growTypes.length) or.push({ growType: { in: ctxSig.growTypes } })
    if (ctxSig.techniques.length) or.push({ techniques: { hasSome: ctxSig.techniques } })

    const diaries = await prisma.growDiary.findMany({
      where: {
        deleted: false,
        ...publicDiaryWhere,
        author: activeAuthor(),
        authorId: { notIn: excluded },
        OR: or,
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: CONTEXT_DIARY_CAP,
      select: DIARY_SELECT,
    })
    for (const d of diaries) mergeDiary(d)
  }

  // ── Source 2: graph proximity — growers the viewer's followees follow ──
  // Member-only signal; the named followee is already in the viewer's own
  // follow list, so the reason never exposes an invisible relationship.
  if (sig && sig.followingIds.length) {
    const pairs = await prisma.follow.findMany({
      where: {
        followingId: { in: sig.followingIds },
        followerId: { notIn: excluded },
      },
      take: 400,
      select: { followerId: true, followingId: true },
    })
    for (const p of pairs) {
      const agg = aggs.get(p.followerId)
      if (!agg) {
        // Graph-only candidates join the pool lazily — they still must
        // pass the eligibility gate before they can surface.
        continue
      }
      agg.sharedFollows.push(p.followingId)
    }
    // Graph proximity also seeds candidates who shared no grow signal:
    // fetch the top followed ids, gate them, merge below.
    const counts = new Map<string, string[]>()
    for (const p of pairs) {
      const list = counts.get(p.followerId) ?? []
      list.push(p.followingId)
      counts.set(p.followerId, list)
    }
    const graphIds = [...counts.keys()].filter((id) => !aggs.has(id)).slice(0, 60)
    if (graphIds.length) {
      const users = await prisma.user.findMany({
        // AND, not a spread — eligibleUserWhere carries its own `id` key
        // (`undefined` when empty), which would silently overwrite the
        // `in: graphIds` bound and turn this into an unscoped user scan.
        where: { AND: [{ id: { in: graphIds } }, eligibleUserWhere(excluded)] },
        select: USER_SELECT,
      })
      for (const u of users) {
        const shared = counts.get(u.id)!
        aggs.set(u.id, {
          user: u, growScore: 0, growReasons: [], lastActive: null,
          ctxMatched: false, ctxScore: 0,
          sharedFollows: shared, acceptedAnswers: 0, recentUpdates: 0, harvests: 0, publicGrows: 0,
        })
      }
    }
    // Resolve usernames for the shared followees used in reasons.
    const followeeIds = [...new Set(pairs.map((p) => p.followingId))]
    const followees = followeeIds.length
      ? await prisma.profile.findMany({ where: { userId: { in: followeeIds } }, select: { userId: true, username: true } })
      : []
    const nameOf = new Map(followees.map((f) => [f.userId, f.username]))
    for (const agg of aggs.values()) {
      agg.sharedFollows = [...new Set(agg.sharedFollows)]
        .map((id) => nameOf.get(id))
        .filter((u): u is string => !!u)
    }
  }

  // ── Source 3: generic eligible pool — guest pool + member filler ──
  const generic = await prisma.user.findMany({
    where: eligibleUserWhere(excluded),
    orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
    take: GENERIC_POOL_CAP,
    select: USER_SELECT,
  })
  for (const u of generic) {
    if (!aggs.has(u.id)) {
      aggs.set(u.id, {
        user: u, growScore: 0, growReasons: [], lastActive: null,
        ctxMatched: false, ctxScore: 0,
        sharedFollows: [], acceptedAnswers: 0, recentUpdates: 0, harvests: 0, publicGrows: 0,
      })
    }
  }

  const candIds = [...aggs.keys()]
  if (!candIds.length) return []

  // ── One aggregate query per public signal — no N+1 ──
  const [grows, harvests, answers, updates] = await Promise.all([
    prisma.growDiary.groupBy({
      by: "authorId",
      where: { authorId: { in: candIds }, deleted: false, ...publicDiaryWhere },
      _count: true,
      _max: { updatedAt: true },
    }),
    prisma.growDiary.groupBy({
      by: "authorId",
      where: { authorId: { in: candIds }, deleted: false, ...publicDiaryWhere, harvested: true, harvestedAt: { not: null } },
      _count: true,
    }),
    prisma.post.groupBy({
      by: "authorId",
      where: { authorId: { in: candIds }, deleted: false, acceptedAnswerFor: { is: { deleted: false } } },
      _count: true,
    }),
    prisma.diaryUpdate.groupBy({
      by: "authorId",
      where: { authorId: { in: candIds }, createdAt: { gte: recentSince }, diary: { deleted: false, ...publicDiaryWhere } },
      _count: true,
    }),
  ])
  const byAuthor = <T extends { authorId: string }>(rows: T[]) => new Map(rows.map((r) => [r.authorId, r]))
  const growBy = byAuthor(grows)
  const harvBy = byAuthor(harvests)
  const ansBy = byAuthor(answers)
  const updBy = byAuthor(updates)

  for (const [id, agg] of aggs) {
    agg.publicGrows = growBy.get(id)?._count ?? 0
    agg.lastActive = agg.lastActive ?? growBy.get(id)?._max?.updatedAt ?? null
    agg.harvests = harvBy.get(id)?._count ?? 0
    agg.acceptedAnswers = ansBy.get(id)?._count ?? 0
    agg.recentUpdates = updBy.get(id)?._count ?? 0
  }

  const scored = [...aggs.values()].map(finalize)
  const order = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    b.score - a.score || b.lastActive - a.lastActive || a.g.userId.localeCompare(b.g.userId)

  // Personalized results must clear the relevance floor; the remaining
  // slots fill from public evidence so the section never renders empty
  // for a member with no public grows yet. Guests get the whole pool
  // ranked on public evidence — no floor, honest reasons only.
  const hasEvidence = (s: (typeof scored)[number]) => s.score > 0 && s.g.reasons.length > 0
  // Contextual surfaces only headline growers with real context evidence;
  // personalization and generic fillers never stand in for it. An empty
  // context means there is no honest contextual answer — return none.
  if (opts.contextOnly) {
    if (!hasCtx) return []
    return scored
      .filter((s) => s.ctxMatched && s.ctxScore >= MIN_CONTEXT_SCORE && hasEvidence(s))
      .sort(order)
      .slice(0, limit)
      .map((s) => s.g)
  }
  if (!sig) {
    return scored.filter(hasEvidence).sort(order).slice(0, limit).map((s) => s.g)
  }
  const relevant = scored.filter((s) => s.score >= MIN_PERSONALIZED_SCORE && hasEvidence(s)).sort(order)
  const fillers = scored.filter((s) => s.score < MIN_PERSONALIZED_SCORE && hasEvidence(s)).sort(order)
  return [...relevant, ...fillers].slice(0, limit).map((s) => s.g)
}
