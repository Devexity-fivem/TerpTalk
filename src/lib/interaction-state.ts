import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

// ─── Live interaction state + serialization for keyed reversals ─────
// Every supported interaction key maps to exactly one logical
// interaction. All state transitions for a key — add, remove, and
// outbox reconciliation — must serialize on a shared PostgreSQL
// transaction-scoped advisory lock so no two transactions can act on
// stale versions of the same key:
//
//   pg_advisory_xact_lock(hashtext('tt-int'), hashtext(<key>))
//
//   - transaction-scoped: the lock releases automatically on commit or
//     rollback, so a crashed process can never leak it.
//   - two-int4 form gives a 64-bit lock id; the 'tt-int' namespace
//     separates these from any other advisory locks. A hash collision
//     between two DIFFERENT keys only causes extra serialization —
//     correctness never depends on the hash being unique.
//   - bound parameters only; user-controlled key text is never
//     interpolated into SQL.
//
// keyedInteractionActive(key) resolves the deterministic award key back
// to its interaction and reports whether that interaction is live:
//   true  — interaction exists; any pending reversal for the key is stale
//   false — interaction is gone; the keyed grant should be reversed
//   null  — key type has no live-state resolver; callers keep the
//           legacy reverse-by-key behavior (diary updates, badges,
//           thread-accept swaps, etc. whose "active" semantics differ)
//
// Resolvers mirror the exact predicates the award/removal paths use:
// a repost/comment counts while ANY live row remains, matching the
// "last live engagement" reversal gating in the moments routes.

export async function lockInteractionKey(
  tx: Prisma.TransactionClient,
  key: string
): Promise<void> {
  // pg_advisory_xact_lock returns void, which Prisma's $queryRaw cannot
  // deserialize — wrap it in count(*) so only an int column is returned.
  // The lock itself is still acquired; the key is a bound parameter,
  // never interpolated.
  await tx.$queryRaw`
    SELECT count(*)::int AS locked
    FROM (SELECT pg_advisory_xact_lock(hashtext('tt-int'), hashtext(${key}))) AS _lock`
}

type Db = Prisma.TransactionClient | typeof prisma

export async function keyedInteractionActive(key: string, db: Db = prisma): Promise<boolean | null> {
  // follow:{followerId}:user:{userId}
  if (key.startsWith("follow:")) {
    const m = /^([a-z0-9]+):user:([a-z0-9]+)$/i.exec(key.slice("follow:".length))
    if (!m) return null
    const row = await db.follow.findUnique({
      where: { followerId_followingId: { followerId: m[1], followingId: m[2] } },
      select: { id: true },
    })
    return !!row
  }

  // react:{reactorId}:{moment|post|diary|update}:{targetId}
  if (key.startsWith("react:")) {
    const m = /^react:([a-z0-9]+):(moment|post|diary|update):([a-z0-9]+)$/i.exec(key)
    if (!m) return null
    const [, reactorId, kind, targetId] = m
    const field =
      kind === "moment" ? { momentId: targetId }
      : kind === "post" ? { postId: targetId }
      : kind === "diary" ? { diaryId: targetId }
      : { diaryUpdateId: targetId }
    const row = await db.reaction.findFirst({
      where: { userId: reactorId, ...field },
      select: { id: true },
    })
    if (!row) return false
    // Parent-content liveness: a reaction row can outlive its target
    // (soft-delete cascades don't remove it). The interaction is only
    // "active" while the target itself is still live — otherwise a
    // stale keyed reconcile could restore standing on deleted content.
    return targetContentLive(kind, targetId, db)
  }

  // repost:{userId}:moment:{momentId} — live while ≥1 non-deleted repost
  // (pure or quote) of the target exists, matching removal gating.
  const repost = /^repost:([a-z0-9]+):moment:([a-z0-9]+)$/i.exec(key)
  if (repost) {
    const n = await db.moment.count({
      where: { authorId: repost[1], repostOfId: repost[2], deleted: false },
    })
    if (n === 0) return false
    return momentLive(repost[2], db)
  }

  // comment:{userId}:moment:{momentId} — live while ≥1 non-deleted
  // comment by that author remains on the moment.
  const comment = /^comment:([a-z0-9]+):moment:([a-z0-9]+)$/i.exec(key)
  if (comment) {
    const n = await db.momentComment.count({
      where: { authorId: comment[1], momentId: comment[2], deleted: false },
    })
    if (n === 0) return false
    return momentLive(comment[2], db)
  }

  return null
}

// A moment counts as live content while it isn't soft-deleted. Mirrors
// the eligibility the award paths checked at creation; visibility
// changes are not lifecycle events (no reversal semantics exist for
// them), so only the deleted flag gates here.
async function momentLive(momentId: string, db: Db): Promise<boolean> {
  const m = await db.moment.findUnique({ where: { id: momentId }, select: { deleted: true } })
  return !!m && !m.deleted
}

// Parent liveness for each reaction target kind — same eligibility the
// reaction route enforced at write time, reduced to the lifecycle
// boundary (deletion). Returns false when the target is gone or deleted.
async function targetContentLive(kind: string, targetId: string, db: Db): Promise<boolean> {
  if (kind === "moment") return momentLive(targetId, db)
  if (kind === "post") {
    const p = await db.post.findUnique({
      where: { id: targetId },
      select: { deleted: true, thread: { select: { deleted: true, category: { select: { hidden: true } } } } },
    })
    return !!p && !p.deleted && !p.thread?.deleted && !p.thread?.category?.hidden
  }
  if (kind === "diary") {
    const d = await db.growDiary.findUnique({ where: { id: targetId }, select: { deleted: true } })
    return !!d && !d.deleted
  }
  // update → its grow's deletion state governs
  const u = await db.diaryUpdate.findUnique({
    where: { id: targetId },
    select: { diary: { select: { deleted: true } } },
  })
  return !!u && !u.diary.deleted
}

// ─── Award spec derivation ──────────────────────────────────────────
// The outbox reconciler needs to re-derive the award a live interaction
// is owed: recipient, type, actor, source, and meta — all from the key
// plus the live rows, inside the caller's transaction. Returns null for
// keys without a derivable spec (caller falls back to reinstate-only).
export interface KeyedAwardSpec {
  userId: string
  type: string
  reason: string
  actorId?: string
  sourceType?: string
  sourceId?: string
  meta?: Record<string, string>
}

export async function keyedAwardSpec(key: string, db: Db = prisma): Promise<KeyedAwardSpec | null> {
  if (key.startsWith("follow:")) {
    const m = /^follow:([a-z0-9]+):user:([a-z0-9]+)$/i.exec(key)
    if (!m) return null
    return {
      userId: m[2],
      type: "FOLLOWER_GAINED",
      reason: "A grower followed you",
      actorId: m[1],
      sourceType: "USER",
      sourceId: m[2],
    }
  }
  const react = /^react:([a-z0-9]+):(moment|post|diary|update):([a-z0-9]+)$/i.exec(key)
  if (react) {
    const [, reactorId, kind, targetId] = react
    const type =
      kind === "moment" ? "MOMENT_REACTION_RECEIVED"
      : kind === "post" ? "POST_REACTION_RECEIVED"
      : kind === "diary" ? "DIARY_REACTION_RECEIVED"
      : "UPDATE_REACTION_RECEIVED"
    const sourceType = kind === "update" ? "DIARY_UPDATE" : kind.toUpperCase()
    let recipient: string | null = null
    if (kind === "moment") {
      recipient = (await db.moment.findUnique({ where: { id: targetId }, select: { authorId: true } }))?.authorId ?? null
    } else if (kind === "post") {
      recipient = (await db.post.findUnique({ where: { id: targetId }, select: { authorId: true } }))?.authorId ?? null
    } else if (kind === "diary") {
      recipient = (await db.growDiary.findUnique({ where: { id: targetId }, select: { authorId: true } }))?.authorId ?? null
    } else {
      const upd = await db.diaryUpdate.findUnique({
        where: { id: targetId },
        select: { diary: { select: { authorId: true } } },
      })
      recipient = upd?.diary.authorId ?? null
    }
    if (!recipient) return null
    const reaction = await db.reaction.findFirst({
      where:
        kind === "moment" ? { userId: reactorId, momentId: targetId }
        : kind === "post" ? { userId: reactorId, postId: targetId }
        : kind === "diary" ? { userId: reactorId, diaryId: targetId }
        : { userId: reactorId, diaryUpdateId: targetId },
      select: { type: true },
    })
    return {
      userId: recipient,
      type,
      reason: "Someone reacted to your content",
      actorId: reactorId,
      sourceType,
      sourceId: targetId,
      meta: reaction?.type ? { reactionType: reaction.type } : undefined,
    }
  }
  const repost = /^repost:([a-z0-9]+):moment:([a-z0-9]+)$/i.exec(key)
  if (repost) {
    const recipient = (await db.moment.findUnique({
      where: { id: repost[2] },
      select: { authorId: true },
    }))?.authorId
    if (!recipient) return null
    return {
      userId: recipient,
      type: "REPOST_RECEIVED",
      reason: "Someone reposted your post",
      actorId: repost[1],
      sourceType: "MOMENT",
      sourceId: repost[2],
    }
  }
  const comment = /^comment:([a-z0-9]+):moment:([a-z0-9]+)$/i.exec(key)
  if (comment) {
    const recipient = (await db.moment.findUnique({
      where: { id: comment[2] },
      select: { authorId: true },
    }))?.authorId
    if (!recipient) return null
    return {
      userId: recipient,
      type: "COMMENT_RECEIVED",
      reason: "Someone commented on your content",
      actorId: comment[1],
      sourceType: "MOMENT",
      sourceId: comment[2],
    }
  }
  return null
}
