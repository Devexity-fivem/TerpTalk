import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isBannedRow, isModerator, forbidden, unauthorized, getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardProgression } from "@/lib/progression"
import { enqueueReversals, drainMany } from "@/lib/reputation-outbox"
import { enqueueXpReversals, drainXpMany } from "@/lib/progression-outbox"
import { ACCEPT_MIN_ACTOR_AGE_HOURS } from "@/lib/reputation-config"
import { checkMaintenance } from "@/lib/maintenance"
import { notify, postDeepLink } from "@/lib/notify"
import { revalidateTag } from "next/cache"
import { after } from "next/server"
import { notifyOpAcceptedAnswer } from "@/lib/terpbot-assist"

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, role: true, banned: true, suspendedUntil: true, createdAt: true, profile: { select: { xp: true } } },
    })
    if (!user) return unauthorized()

    const body = await request.json().catch(() => ({}))
    const { threadId, postId } = body

    if (typeof threadId !== "string" || (postId !== null && typeof postId !== "string")) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    if (isBannedRow(user)) {
      return forbidden("Your account is suspended")
    }

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    // Rate limit: 30 accept actions per hour per user
    const rl = await rateLimit(`accept-answer:${user.id}`, 30, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "forum/threads/accept" },
      })
      return NextResponse.json({ error: "Too many actions. Please try again later." }, { status: 429 })
    }

    const thread = await prisma.thread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        slug: true,
        authorId: true,
        acceptedAnswerId: true,
        title: true,
        locked: true,
        deleted: true,
        wizardResultId: true,
        category: { select: { hidden: true } },
      },
    })
    if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 })

    if (thread.deleted || thread.locked || (thread.category?.hidden && !isModerator(user.role))) {
      return NextResponse.json({ error: "Thread is locked" }, { status: 403 })
    }

    // Only thread author or moderator can set accepted answer
    const canSet = thread.authorId === user.id || isModerator(user.role)
    if (!canSet) return forbidden()

    if (postId === null) {
      // Compare-and-set: bail if a concurrent request changed the pointer.
      // Reversal intents ride inside the CAS transaction — both ledgers.
      const reversalIds: string[] = []
      const xpReversalIds: string[] = []
      const cleared = await prisma.$transaction(async (tx) => {
        const res = await tx.thread.updateMany({
          where: { id: threadId, acceptedAnswerId: thread.acceptedAnswerId },
          data: { acceptedAnswerId: null },
        })
        if (res.count === 1 && thread.acceptedAnswerId) {
          const keys = [`accept:${thread.acceptedAnswerId}`, `accept-newcomer:${thread.acceptedAnswerId}`, `accept-op:${threadId}`]
          reversalIds.push(...await enqueueReversals(tx, keys.map((eventKey) => ({
            kind: "KEY" as const, eventKey,
            reason: "Answer unaccepted", requestedBy: user.id,
          }))))
          xpReversalIds.push(...await enqueueXpReversals(tx, keys.map((eventKey) => ({
            kind: "KEY" as const, eventKey,
            reason: "Answer unaccepted", requestedBy: user.id,
          }))))
        }
        return res
      })
      if (cleared.count === 0) {
        return NextResponse.json({ error: "Accepted answer changed concurrently — retry" }, { status: 409 })
      }
      await drainMany(reversalIds)
      await drainXpMany(xpReversalIds)
      // Plant Doctor outcome stats track accepted answers.
      if (thread.wizardResultId) revalidateTag("analytics", { expire: 0 })
      return NextResponse.json({ success: true })
    }

    const post = await prisma.post.findFirst({
      where: { id: postId, threadId, deleted: false },
      select: { id: true, authorId: true, content: true },
    })
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 })

    // Nobody can mark their own post as the answer — this also blocks a
    // moderator accepting their own reply in someone else's thread.
    if (post.authorId === thread.authorId || post.authorId === user.id) {
      return NextResponse.json({ error: "You cannot mark your own post as the answer" }, { status: 400 })
    }

    // Compare-and-set on the current pointer — two parallel accepts must not
    // both pay out. Loser gets a 409 and retries against fresh state. The
    // old answer's reversal intent is written inside the CAS transaction.
    const swapReversalIds: string[] = []
    const swapXpReversalIds: string[] = []
    const swapped = await prisma.$transaction(async (tx) => {
      const res = await tx.thread.updateMany({
        where: { id: threadId, acceptedAnswerId: thread.acceptedAnswerId },
        data: { acceptedAnswerId: postId },
      })
      if (res.count === 1 && thread.acceptedAnswerId && thread.acceptedAnswerId !== postId) {
        const keys = [`accept:${thread.acceptedAnswerId}`, `accept-newcomer:${thread.acceptedAnswerId}`]
        swapReversalIds.push(...await enqueueReversals(tx, keys.map((eventKey) => ({
          kind: "KEY" as const, eventKey,
          reason: "Accepted answer changed", requestedBy: user.id,
        }))))
        swapXpReversalIds.push(...await enqueueXpReversals(tx, keys.map((eventKey) => ({
          kind: "KEY" as const, eventKey,
          reason: "Accepted answer changed", requestedBy: user.id,
        }))))
      }
      return res
    })
    if (swapped.count === 0) {
      return NextResponse.json({ error: "Accepted answer changed concurrently — retry" }, { status: 409 })
    }
    await drainMany(swapReversalIds)
    await drainXpMany(swapXpReversalIds)

    // Accepted-answer award — keyed per post so unaccept/re-accept cycles
    // can't farm it. The accept itself works for anyone, but the payout is
    // trust-gated: acceptor needs ≥24h age + ≥10 XP (the V2 mirror of the
    // legacy rep gate — a fresh sockpuppet can't farm +30s for a main).
    // The engine stacks the standing controls (grantor floor, reciprocal,
    // cluster, caps) on top.
    const acceptorTrusted =
      Date.now() - user.createdAt.getTime() >= ACCEPT_MIN_ACTOR_AGE_HOURS * 3600 * 1000 &&
      (user.profile?.xp ?? 0) >= 10
    if (thread.acceptedAnswerId !== postId && acceptorTrusted) {
      await awardProgression(
        post.authorId,
        "ACCEPTED_ANSWER",
        `Accepted answer in "${thread.title.slice(0, 50)}"`,
        { key: `accept:${postId}`, actorId: user.id, sourceType: "POST", sourceId: postId }
      ).catch(() => {})
      // Newcomer bonus: the OP is <30d old → the answerer helped a new grower.
      const threadAuthor = await prisma.user.findUnique({
        where: { id: thread.authorId }, select: { createdAt: true },
      })
      if (threadAuthor && Date.now() - threadAuthor.createdAt.getTime() < 30 * 86400000) {
        await awardProgression(
          post.authorId,
          "NEWCOMER_ACCEPT_BONUS",
          `Accepted answer for a new grower in "${thread.title.slice(0, 50)}"`,
          { key: `accept-newcomer:${postId}`, actorId: user.id, sourceType: "POST", sourceId: postId }
        ).catch(() => {})
      }
    }

    // Small peer-gated bonus for the OP who curates their own thread —
    // requires another member's answer to exist, so it can't be solo-farmed.
    // Keyed per thread so unmark/remark cycles can't repeat it. Moderators
    // marking answers don't trigger it — only the OP's own curation.
    if (
      thread.acceptedAnswerId !== postId &&
      user.id === thread.authorId &&
      post.authorId !== thread.authorId
    ) {
      await awardProgression(
        thread.authorId,
        "OP_CURATION",
        `Marked an accepted answer on "${thread.title.slice(0, 50)}"`,
        { key: `accept-op:${threadId}`, actorId: post.authorId, sourceType: "THREAD", sourceId: threadId }
      ).catch(() => {})
    }

    if (thread.acceptedAnswerId !== postId) {

      // Hidden categories never notify — title/link would leak staff-only content.
      if (!thread.category?.hidden) {
        await notify({
          userId: post.authorId,
          type: "ACCEPTED_ANSWER",
          title: "Your answer was accepted",
          content: `@${session.user.name || "Someone"} marked your reply in "${thread.title.slice(0, 60)}" as the accepted answer.`,
          link: postDeepLink(thread.slug, postId),
          actorId: session.user.id,
        })

        // The answerer is told above, but when a MODERATOR accepts (the OP
        // didn't do it themselves) the OP would otherwise never learn their
        // thread got a marked answer. TerpBot delivers that notice — claimed
        // once-ever per post so accept/unaccept cycles can't re-ping.
        if (thread.authorId !== user.id) {
          after(() =>
            notifyOpAcceptedAnswer({
              opUserId: thread.authorId,
              threadSlug: thread.slug,
              threadTitle: thread.title,
              postId,
            }).then(() => {})
          )
        }
      }
    }

    if (thread.wizardResultId) revalidateTag("analytics", { expire: 0 })
    return NextResponse.json({ success: true, post: { id: postId } })
  } catch (error: unknown) {
    console.error("Accept answer error:", error)
    if (error instanceof Response) return error
    return NextResponse.json({ error: "Failed to update accepted answer" }, { status: 500 })
  }
}
