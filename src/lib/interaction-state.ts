import { prisma } from "@/lib/prisma"

// ─── Live interaction state for keyed progression reversals ─────────
// KEY reversal intents are enqueued inside the same transaction as the
// interaction delete, but the drain runs post-commit and may be delayed,
// retried, or crash. The only authoritative answer to "should this
// keyed grant still be active?" is the CURRENT interaction row — never
// a timestamp on a marker written by a possibly-stale award request.
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

export async function keyedInteractionActive(key: string): Promise<boolean | null> {
  // follow:{followerId}:user:{userId}
  if (key.startsWith("follow:")) {
    const m = /^([a-z0-9]+):user:([a-z0-9]+)$/i.exec(key.slice("follow:".length))
    if (!m) return null
    const row = await prisma.follow.findUnique({
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
    const row = await prisma.reaction.findFirst({
      where: { userId: reactorId, ...field },
      select: { id: true },
    })
    return !!row
  }

  // repost:{userId}:moment:{momentId} — live while ≥1 non-deleted repost
  // (pure or quote) of the target exists, matching removal gating.
  const repost = /^repost:([a-z0-9]+):moment:([a-z0-9]+)$/i.exec(key)
  if (repost) {
    const n = await prisma.moment.count({
      where: { authorId: repost[1], repostOfId: repost[2], deleted: false },
    })
    return n > 0
  }

  // comment:{userId}:moment:{momentId} — live while ≥1 non-deleted
  // comment by that author remains on the moment.
  const comment = /^comment:([a-z0-9]+):moment:([a-z0-9]+)$/i.exec(key)
  if (comment) {
    const n = await prisma.momentComment.count({
      where: { authorId: comment[1], momentId: comment[2], deleted: false },
    })
    return n > 0
  }

  return null
}
