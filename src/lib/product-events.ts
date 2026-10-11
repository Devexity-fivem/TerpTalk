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
//   FIRST_FOLLOW              once per member, keyed ff:<uid>; the
//                             member's first Follow OR DiaryFollow
//   FOLLOW_CREATED            one per successful follow transition
//   INTERACTION_POSTED        one per persisted Post (reply or
//                             anchored update comment)
//   FOLLOWED_CONTENT_VIEWED   member opened a grow they follow —
//                             client beacon, server re-verifies the
//                             Follow + diary visibility; keyed
//                             fcv:<uid>:<diaryId>:<UTC-day>
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
  /** Successful follow transitions (user + diary) in the window. */
  follows: number
  followsBySource: SourceCount[]
  /** Members whose FIRST_FOLLOW landed in the window. */
  firstFollows: number
  firstFollowBySource: SourceCount[]
  /** signup → FIRST_FOLLOW, median hours (event cohort). */
  medianHoursSignupToFirstFollow: number | null
  /** Members who opened a grow they follow, per UTC day. */
  followedContentViewers: number
  followedContentViewsBySource: SourceCount[]
  /** Members who opened /mydigest at least once in the window. */
  digestViewers: number
  /** Persisted replies/anchored comments in the window. */
  interactions: number
  interactionsBySource: SourceCount[]
  /** Distinct interactors whose target author they follow. */
  followedInteractors: number
  /** followedInteractors / members with FIRST_FOLLOW in the window. */
  interactionRate: number | null
  /** FIRST_FOLLOW → first INTERACTION_POSTED, median hours. */
  medianHoursFirstFollowToInteraction: number | null
  /** First FOLLOWED_CONTENT_VIEWED → first interaction, median hours. */
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

  const [groups, fcvRows, dvRows, ffRows, ixRows, fcvTimeRows] = await Promise.all([
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
  ])

  // signup → first follow: join the bounded FIRST_FOLLOW cohort to User.
  const ffUserIds = [...new Set(ffRows.map((r) => r.userId).filter((u): u is string => !!u))]
  const ffUsers = ffUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: ffUserIds } }, select: { id: true, createdAt: true } })
    : []
  const signupById = new Map(ffUsers.map((u) => [u.id, u.createdAt]))
  const signupToFf = ffRows
    .map((r) => (r.userId && signupById.get(r.userId)
      ? (r.createdAt.getTime() - signupById.get(r.userId)!.getTime()) / 3_600_000
      : null))
    .filter((n): n is number => n !== null && n >= 0)

  // first follow → first interaction, first encounter → first
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
  const ffToIx = ffRows
    .map((r) => firstAfter(r.userId, r.createdAt))
    .map((d, i) => (d ? (d.getTime() - ffRows[i].createdAt.getTime()) / 3_600_000 : null))
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
  const [updOwners, thrOwners] = await Promise.all([
    updIds.length
      ? prisma.diaryUpdate.findMany({ where: { id: { in: updIds } }, select: { id: true, diary: { select: { authorId: true } } } })
      : Promise.resolve([] as { id: string; diary: { authorId: string } }[]),
    thrIds.length
      ? prisma.thread.findMany({ where: { id: { in: thrIds } }, select: { id: true, authorId: true } })
      : Promise.resolve([] as { id: string; authorId: string }[]),
  ])
  const ownerOf = new Map<string, string>()
  for (const u of updOwners) ownerOf.set(`DiaryUpdate:${u.id}`, u.diary.authorId)
  for (const t of thrOwners) ownerOf.set(`Thread:${t.id}`, t.authorId)

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
  const followedInteractors = new Set(
    [...pairs.keys()].filter((k) => followedSet.has(k)).map((k) => k.split(":")[0])
  ).size

  const follows = groups.filter((g) => g.type === "FOLLOW_CREATED").reduce((s, g) => s + g._count._all, 0)
  const interactions = groups.filter((g) => g.type === "INTERACTION_POSTED").reduce((s, g) => s + g._count._all, 0)

  return {
    windowDays,
    follows,
    followsBySource: groupRows(groups, "FOLLOW_CREATED"),
    firstFollows: ffRows.length,
    firstFollowBySource: groupRows(groups, "FIRST_FOLLOW"),
    medianHoursSignupToFirstFollow: median(signupToFf),
    followedContentViewers: fcvRows.length,
    followedContentViewsBySource: groupRows(groups, "FOLLOWED_CONTENT_VIEWED"),
    digestViewers: dvRows.length,
    interactions,
    interactionsBySource: groupRows(groups, "INTERACTION_POSTED"),
    followedInteractors,
    interactionRate: ffRows.length > 0 ? Math.round((followedInteractors / ffRows.length) * 1000) / 10 : null,
    medianHoursFirstFollowToInteraction: median(ffToIx),
    medianHoursEncounterToInteraction: median(encToIx),
    truncated: ixRows.length >= REPORT_CAP || fcvTimeRows.length >= REPORT_CAP || ffRows.length >= REPORT_CAP,
    generatedAt: new Date().toISOString(),
  }
}
