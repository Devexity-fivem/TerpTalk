import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isBanned, isModerator, forbidden, unauthorized, getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS } from "@/lib/reputation"
import { enqueueReversal, drainOne } from "@/lib/reputation-outbox"
import { ACCEPT_MIN_ACTOR_AGE_HOURS, ACCEPT_MIN_ACTOR_REP } from "@/lib/reputation-config"
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
      select: { id: true, role: true, banned: true, createdAt: true, profile: { select: { reputation: true } } },
    })
    if (!user) return unauthorized()

    const body = await request.json().catch(() => ({}))
    const { threadId, postId } = body

    if (typeof threadId !== "string" || (postId !== null && typeof postId !== "string")) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    if (await isBanned(user.id) || user.banned) {
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
      // Reversal intents ride inside the CAS transaction.
      const reversalIds: string[] = []
      const cleared = await prisma.$transaction(async (tx) => {
        const res = await tx.thread.updateMany({
          where: { id: threadId, acceptedAnswerId: thread.acceptedAnswerId },
          data: { acceptedAnswerId: null },
        })
        if (res.count === 1 && thread.acceptedAnswerId) {
          reversalIds.push(await enqueueReversal(tx, {
            kind: "KEY", eventKey: `accept:${thread.acceptedAnswerId}`,
            reason: "Answer unaccepted", requestedBy: user.id,
          }))
          // The OP's curation bonus must unwind too — otherwise unaccept
          // leaves a sticky +rep for an answer that no longer exists.
          reversalIds.push(await enqueueReversal(tx, {
            kind: "KEY", eventKey: `accept-op:${threadId}`,
            reason: "Answer unaccepted", requestedBy: user.id,
          }))
        }
        return res
      })
      if (cleared.count === 0) {
        return NextResponse.json({ error: "Accepted answer changed concurrently — retry" }, { status: 409 })
      }
      for (const rid of reversalIds) await drainOne(rid).catch(() => false)
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
    const swapped = await prisma.$transaction(async (tx) => {
      const res = await tx.thread.updateMany({
        where: { id: threadId, acceptedAnswerId: thread.acceptedAnswerId },
        data: { acceptedAnswerId: postId },
      })
      if (res.count === 1 && thread.acceptedAnswerId && thread.acceptedAnswerId !== postId) {
        swapReversalIds.push(await enqueueReversal(tx, {
          kind: "KEY", eventKey: `accept:${thread.acceptedAnswerId}`,
          reason: "Accepted answer changed", requestedBy: user.id,
        }))
      }
      return res
    })
    if (swapped.count === 0) {
      return NextResponse.json({ error: "Accepted answer changed concurrently — retry" }, { status: 409 })
    }
    for (const rid of swapReversalIds) await drainOne(rid).catch(() => false)

    // Award reputation for helpful answer — keyed per post so
    // unaccept/re-accept cycles can't farm it. The accept itself works for
    // anyone, but the payout is trust-gated: a brand-new or zero-rep
    // acceptor doesn't pay — a fresh sockpuppet can't farm +30s for a main.
    const acceptorTrusted =
      Date.now() - user.createdAt.getTime() >= ACCEPT_MIN_ACTOR_AGE_HOURS * 3600 * 1000 &&
      (user.profile?.reputation ?? 0) >= ACCEPT_MIN_ACTOR_REP
    if (thread.acceptedAnswerId !== postId && acceptorTrusted) {
      await awardReputation(
        post.authorId,
        "HELPFUL_ANSWER",
        REP_POINTS.HELPFUL_ANSWER,
        `Accepted answer in "${thread.title.slice(0, 50)}"`,
        { key: `accept:${postId}`, actorId: user.id, sourceType: "POST", sourceId: postId }
      ).catch(() => {})
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
      await awardReputation(
        thread.authorId,
        "ACCEPT_MARKED",
        REP_POINTS.ACCEPT_MARKED,
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
