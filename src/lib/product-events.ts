import { prisma } from "@/lib/prisma"
import { eventSource } from "@/lib/event-sources"
import { median } from "@/lib/diary-weeks"

// ─── Product-event telemetry ─────────────────────────────────────
// The canonical sink for social-loop signals durable state cannot
// answer (which surface a follow/interaction came from, whether
// followed content was reached). Same doctrine as PushEvent /
// lib/activation: append-only, best-effort, data-minimized — type, an
// allowlisted source token, an object reference (id only), a dedupe
// key, a timestamp. No content, no URLs, no IPs, no user agents.
//
// Semantics per type:
//   FIRST_FOLLOW              once per member, keyed ff:<uid>; first
//                             OBSERVED follow transition of ANY kind —
//                             objectType records User vs Diary. For
//                             the first GROWER follow specifically, the
//                             report derives it (earliest durable
//                             Follow + earliest FOLLOW_CREATED User
//                             event); a prior diary follow can consume
//                             this milestone, so it is not the grower
//                             metric.
//   FOLLOW_CREATED            one per successful follow transition
//   INTERACTION_POSTED        one per persisted contribution — forum
//                             reply, anchored update comment, Moment
//                             (post/story), Moment comment, or Moment
//                             reaction
//   FOLLOWED_CONTENT_VIEWED   member opened a grow or post they
//                             follow — client beacon, server
//                             re-verifies the Follow + object
//                             visibility; keyed
//                             fcv:<uid>:<objectId>:<UTC-day>
//   DIGEST_VIEWED             member opened /mydigest — client
//                             beacon; keyed dv:<uid>:<UTC-day>

export const PRODUCT_EVENT_TYPES = [
  "FIRST_FOLLOW",
  "FOLLOW_CREATED",
  "INTERACTION_POSTED",
  "FOLLOWED_CONTENT_VIEWED",
  "DIGEST_VIEWED",
] as const
export type ProductEventType = (typeof PRODUCT_EVENT_TYPES)[number]

/** UTC day key — same convention as the cron task keys. */
export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

type EventClient = Pick<typeof prisma, "productEvent">

/**
 * Write one product event. Best-effort by contract: `key` upserts give
 * exactly-once semantics for milestone/daily types and make retries and
 * double-mounts harmless; failures are logged, never thrown — analytics
 * must not break the business transaction it observes.
 */
export async function recordProductEvent(
  e: {
    type: ProductEventType
    userId: string | null
    source?: string | null
    objectType?: string | null
    objectId?: string | null
    key?: string | null
  },
  db: EventClient = prisma
): Promise<void> {
  try {
    const data = {
      type: e.type,
      userId: e.userId,
      source: e.source ? eventSource(e.source) : null,
      objectType: e.objectType ?? null,
      objectId: e.objectId ?? null,
    }
    if (e.key) {
      await db.productEvent.upsert({
        where: { key: e.key },
        create: { ...data, key: e.key },
        update: {},
      })
    } else {
      await db.productEvent.create({ data })
    }
  } catch (err) {
    console.error("product event write failed:", err instanceof Error ? err.message : err)
  }
}

// ─── Social-loop report ─────────────────────────────────────────
// Aggregates ProductEvent over a rolling window for the staff-only
// activation report. Every query is bounded: one groupBy pass for
// counts, distinct-capped viewer lookups, and capped event fetches for
// pair/timing math. Output is counts, percentages and medians — never
// member ids or content.

const REPORT_CAP = 5000
const DAY = 86400000

export interface SourceCount {
  source: string
  count: number
}

export interface SocialLoopReport {
  windowDays: number
  /** Successful follow transitions (member + diary) in the window. */
  follows: number
  followsBySource: SourceCount[]
  /** Members hitting FIRST_FOLLOW in the window — first follow of ANY
   *  kind (member or diary); the row's objectType records which. */
  firstFollowsAnyKind: number
  firstFollowAnyKindBySource: SourceCount[]
  /** Members whose FIRST GROWER (member) follow landed in the window.
   *  Derived from durable state (earliest Follow.createdAt) joined to
   *  the earliest FOLLOW_CREATED(objectType=User) event — never from
   *  the any-kind milestone, which a prior diary follow can consume. */
  firstGrowerFollows: number
  /** Source of each member's first grower follow. Members whose first
   *  grower follow predates instrumentation report "unknown" — we never
   *  borrow a later event's surface. */
  firstGrowerFollowBySource: SourceCount[]
  /** signup → first grower follow, median hours (measured cohort). */
  medianHoursSignupToFirstGrowerFollow: number | null
  /** Distinct members with ≥1 measured followed-grower encounter in the
   *  window. NOT page views: encounters dedupe per member·diary·UTC-day. */
  followedContentViewers: number
  /** Measured encounters (member·diary·day rows) by surface. */
  followedContentViewsBySource: SourceCount[]
  /** Distinct members with ≥1 measured /mydigest open (deduped daily). */
  digestViewers: number
  /** Persisted replies/anchored comments in the window. */
  interactions: number
  interactionsBySource: SourceCount[]
  /** Distinct members who interacted on content whose author they
   *  follow NOW — current Follow state, not at-interaction state. */
  followedInteractors: number
  /** Of members whose first grower follow landed in the window, the
   *  share who also interacted on followed-grower content in the same
   *  window. Association between recorded events — not a verified
   *  encounter→interaction conversion sequence. */
  growerFollowerInteractionRate: number | null
  /** First grower follow → first later interaction, median hours. */
  medianHoursFirstGrowerFollowToInteraction: number | null
  /** First measured encounter → first later interaction (any content),
   *  median hours. Sequence is verified per member; the interaction is
   *  not proven to be about the encountered grow. */
  medianHoursEncounterToInteraction: number | null
  truncated: boolean
  generatedAt: string
}

const src = (v: string | null) => v ?? "unknown"

function groupRows(
  groups: { type: string; source: string | null; _count: { _all: number } }[],
  type: ProductEventType
): SourceCount[] {
  return groups
    .filter((g) => g.type === type)
    .map((g) => ({ source: src(g.source), count: g._count._all }))
    .sort((a, b) => b.count - a.count)
}

export async function socialLoopReport(windowDays = 30): Promise<SocialLoopReport> {
  const since = new Date(Date.now() - windowDays * DAY)

  const [groups, fcvRows, dvRows, ffRows, ixRows, fcvTimeRows, durableFollowRows, fcUserRows] = await Promise.all([
    prisma.productEvent.groupBy({
      by: ["type", "source"],
      where: { createdAt: { gt: since } },
      _count: { _all: true },
    }),
    prisma.productEvent.findMany({
      where: { type: "FOLLOWED_CONTENT_VIEWED", createdAt: { gt: since }, userId: { not: null } },
      select: { userId: true },
      distinct: ["userId"],
      take: REPORT_CAP,
    }),
    prisma.productEvent.findMany({
      where: { type: "DIGEST_VIEWED", createdAt: { gt: since }, userId: { not: null } },
      select: { userId: true },
      distinct: ["userId"],
      take: REPORT_CAP,
    }),
    prisma.productEvent.findMany({
      where: { type: "FIRST_FOLLOW", createdAt: { gt: since } },
      select: { userId: true, createdAt: true },
      take: REPORT_CAP,
      orderBy: { createdAt: "asc" },
    }),
    prisma.productEvent.findMany({
      where: { type: "INTERACTION_POSTED", createdAt: { gt: since } },
      select: { userId: true, objectType: true, objectId: true, createdAt: true },
      take: REPORT_CAP,
      orderBy: { createdAt: "asc" },
    }),
    prisma.productEvent.findMany({
      where: { type: "FOLLOWED_CONTENT_VIEWED", createdAt: { gt: since } },
      select: { userId: true, createdAt: true },
      take: REPORT_CAP,
      orderBy: { createdAt: "asc" },
    }),
    // Earliest durable grower Follow per member — not window-filtered:
    // "first" is a lifetime property; the window filter applies to the
    // derived first-follow timestamp below.
    prisma.follow.findMany({
      select: { followerId: true, followingId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
      take: REPORT_CAP,
    }),
    // Earliest grower-follow event per member — the surface-attribution
    // source for first grower follows (objectType=User only).
    prisma.productEvent.findMany({
      where: { type: "FOLLOW_CREATED", objectType: "User" },
      select: { userId: true, source: true, objectId: true, createdAt: true },
      take: REPORT_CAP,
      orderBy: { createdAt: "asc" },
    }),
  ])

  // First GROWER follow per member: earliest durable Follow row joined
  // to the earliest FOLLOW_CREATED(objectType=User) event BY OBJECT —
  // the event and row describe the same transition when
  // event.objectId === earliest Follow.followingId. A member's earliest
  // event whose object doesn't match their earliest durable row is for
  // a later (or deleted) follow and must not lend its surface; durable
  // rows carry no surface, so those members report "unknown" rather
  // than being guessed. Members with only an event (follow since
  // removed) are attributed from it — it is their first observed one.
  const durableByUser = new Map<string, { followingId: string; createdAt: Date }>()
  for (const r of durableFollowRows) {
    if (!durableByUser.has(r.followerId)) durableByUser.set(r.followerId, r)
  }
  const firstGrowerAt = new Map<string, Date>()
  const growerSource = new Map<string, string>()
  for (const e of fcUserRows) {
    if (!e.userId || firstGrowerAt.has(e.userId)) continue
    const d = durableByUser.get(e.userId)
    if (!d) {
      firstGrowerAt.set(e.userId, e.createdAt)
      growerSource.set(e.userId, src(e.source))
    } else if (d.followingId === e.objectId) {
      firstGrowerAt.set(e.userId, d.createdAt)
      growerSource.set(e.userId, src(e.source))
    }
  }
  for (const [u, d] of durableByUser) {
    if (!firstGrowerAt.has(u)) firstGrowerAt.set(u, d.createdAt)
  }
  const growerFollowCohort = new Map<string, { at: Date; source: string }>()
  for (const [u, at] of firstGrowerAt) {
    if (at > since) growerFollowCohort.set(u, { at, source: growerSource.get(u) ?? "unknown" })
  }
  const growerSourceCounts = new Map<string, number>()
  for (const { source } of growerFollowCohort.values()) {
    growerSourceCounts.set(source, (growerSourceCounts.get(source) ?? 0) + 1)
  }
  const firstGrowerFollowBySource = [...growerSourceCounts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count)

  // signup → first grower follow: join the bounded cohort to User.
  const cohortIds = [...growerFollowCohort.keys()]
  const cohortUsers = cohortIds.length
    ? await prisma.user.findMany({ where: { id: { in: cohortIds } }, select: { id: true, createdAt: true } })
    : []
  const signupById = new Map(cohortUsers.map((u) => [u.id, u.createdAt]))
  const signupToFf = [...growerFollowCohort.entries()]
    .map(([uid, { at }]) => {
      const signup = signupById.get(uid)
      return signup ? (at.getTime() - signup.getTime()) / 3_600_000 : null
    })
    .filter((n): n is number => n !== null && n >= 0)

  // first grower follow → first interaction, first encounter → first
  // interaction: earliest qualifying INTERACTION_POSTED per member.
  const ixByUser = new Map<string, Date[]>()
  for (const r of ixRows) {
    if (!r.userId) continue
    const arr = ixByUser.get(r.userId) ?? []
    arr.push(r.createdAt)
    ixByUser.set(r.userId, arr)
  }
  const firstAfter = (u: string | null, after: Date) =>
    (u ? ixByUser.get(u) : undefined)?.find((d) => d > after) ?? null
  const ffToIx = [...growerFollowCohort.entries()]
    .map(([u, { at }]) => {
      const ix = firstAfter(u, at)
      return ix ? (ix.getTime() - at.getTime()) / 3_600_000 : null
    })
    .filter((n): n is number => n !== null)
  const firstFcvByUser = new Map<string, Date>()
  for (const r of fcvTimeRows) {
    if (r.userId && !firstFcvByUser.has(r.userId)) firstFcvByUser.set(r.userId, r.createdAt)
  }
  const encToIx = [...firstFcvByUser.entries()]
    .map(([u, d]) => {
      const ix = firstAfter(u, d)
      return ix ? (ix.getTime() - d.getTime()) / 3_600_000 : null
    })
    .filter((n): n is number => n !== null)

  // Followed-content interactors: resolve each event's content owner,
  // then check the Follow relation in one bounded pair query.
  const updIds = [...new Set(ixRows.filter((r) => r.objectType === "DiaryUpdate" && r.objectId).map((r) => r.objectId!))]
  const thrIds = [...new Set(ixRows.filter((r) => r.objectType === "Thread" && r.objectId).map((r) => r.objectId!))]
  const momIds = [...new Set(ixRows.filter((r) => r.objectType === "Moment" && r.objectId).map((r) => r.objectId!))]
  const [updOwners, thrOwners, momOwners] = await Promise.all([
    updIds.length
      ? prisma.diaryUpdate.findMany({ where: { id: { in: updIds } }, select: { id: true, diary: { select: { authorId: true } } } })
      : Promise.resolve([] as { id: string; diary: { authorId: string } }[]),
    thrIds.length
      ? prisma.thread.findMany({ where: { id: { in: thrIds } }, select: { id: true, authorId: true } })
      : Promise.resolve([] as { id: string; authorId: string }[]),
    momIds.length
      ? prisma.moment.findMany({ where: { id: { in: momIds } }, select: { id: true, authorId: true } })
      : Promise.resolve([] as { id: string; authorId: string }[]),
  ])
  const ownerOf = new Map<string, string>()
  for (const u of updOwners) ownerOf.set(`DiaryUpdate:${u.id}`, u.diary.authorId)
  for (const t of thrOwners) ownerOf.set(`Thread:${t.id}`, t.authorId)
  for (const m of momOwners) ownerOf.set(`Moment:${m.id}`, m.authorId)

  const pairs = new Map<string, { actor: string; owner: string }>()
  const actors = new Set<string>()
  const owners = new Set<string>()
  for (const r of ixRows) {
    if (!r.userId || !r.objectType || !r.objectId) continue
    const owner = ownerOf.get(`${r.objectType}:${r.objectId}`)
    if (!owner || owner === r.userId) continue // self-interaction isn't a follow loop
    pairs.set(`${r.userId}:${owner}`, { actor: r.userId, owner })
    actors.add(r.userId)
    owners.add(owner)
  }
  const followedPairs = pairs.size
    ? await prisma.follow.findMany({
        where: { followerId: { in: [...actors] }, followingId: { in: [...owners] } },
        select: { followerId: true, followingId: true },
        take: REPORT_CAP,
      })
    : []
  const followedSet = new Set(followedPairs.map((f) => `${f.followerId}:${f.followingId}`))
  const followedInteractorIds = new Set(
    [...pairs.keys()].filter((k) => followedSet.has(k)).map((k) => k.split(":")[0])
  )
  const followedInteractors = followedInteractorIds.size
  // Rate denominator = the same cohort: members whose first grower
  // follow landed in this window who also interacted on followed-grower
  // content in the window.
  const cohortInteractors = [...growerFollowCohort.keys()].filter((u) => followedInteractorIds.has(u)).length

  const follows = groups.filter((g) => g.type === "FOLLOW_CREATED").reduce((s, g) => s + g._count._all, 0)
  const interactions = groups.filter((g) => g.type === "INTERACTION_POSTED").reduce((s, g) => s + g._count._all, 0)

  return {
    windowDays,
    follows,
    followsBySource: groupRows(groups, "FOLLOW_CREATED"),
    firstFollowsAnyKind: ffRows.length,
    firstFollowAnyKindBySource: groupRows(groups, "FIRST_FOLLOW"),
    firstGrowerFollows: growerFollowCohort.size,
    firstGrowerFollowBySource,
    medianHoursSignupToFirstGrowerFollow: median(signupToFf),
    followedContentViewers: fcvRows.length,
    followedContentViewsBySource: groupRows(groups, "FOLLOWED_CONTENT_VIEWED"),
    digestViewers: dvRows.length,
    interactions,
    interactionsBySource: groupRows(groups, "INTERACTION_POSTED"),
    followedInteractors,
    growerFollowerInteractionRate: growerFollowCohort.size > 0
      ? Math.round((cohortInteractors / growerFollowCohort.size) * 1000) / 10
      : null,
    medianHoursFirstGrowerFollowToInteraction: median(ffToIx),
    medianHoursEncounterToInteraction: median(encToIx),
    truncated: ixRows.length >= REPORT_CAP || fcvTimeRows.length >= REPORT_CAP
      || ffRows.length >= REPORT_CAP || durableFollowRows.length >= REPORT_CAP
      || fcUserRows.length >= REPORT_CAP,
    generatedAt: new Date().toISOString(),
  }
}
