import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { FEED_KINDS, FEED_MODES, getFeedPage, resolveFeedScope } from "@/lib/feed"
import type { FeedKind, FeedMode } from "@/lib/feed"

// GET — canonical feed continuation for /feed "Load more".
//   ?mode=latest|following|for-you   (default latest)
//   &kinds=update,thread,harvest     (default all three)
//   &cursor=<f1.…>                   (keyset cursor from the previous page)
//   &limit=<1..30>                   (default FEED_PAGE_SIZE)
//
// Guests get the public `latest` stream only; personal modes return an
// empty page, matching the signed-out /feed tab behavior. The cursor is
// validated inside the feed module — malformed input falls back to
// page 1 rather than erroring or shifting the window.
export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rl = await rateLimit(`feed:${hashIp(ip)}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const sp = request.nextUrl.searchParams
  const modeParam = sp.get("mode") ?? "latest"
  if (!(FEED_MODES as readonly string[]).includes(modeParam)) {
    return NextResponse.json({ error: "Invalid mode" }, { status: 400 })
  }
  const mode = modeParam as FeedMode

  let kinds: FeedKind[] | undefined
  const kindsParam = sp.get("kinds")
  if (kindsParam) {
    kinds = kindsParam.split(",").filter((k): k is FeedKind => (FEED_KINDS as readonly string[]).includes(k))
    if (kinds.length === 0) {
      return NextResponse.json({ error: "Invalid kinds" }, { status: 400 })
    }
  }

  const limitParam = sp.get("limit")
  const limit = limitParam ? Number(limitParam) : undefined
  if (limitParam && (!Number.isInteger(limit) || (limit as number) < 1)) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 })
  }

  const session = await getServerSession(authOptions)
  const scope = await resolveFeedScope(session?.user?.id, mode)
  const page = await getFeedPage({ scope, kinds, cursor: sp.get("cursor"), limit })

  // Unread indicators ride along for signed-in members — same followed-
  // thread rule the feed page applies to its first render.
  const unreadThreadIds: string[] = []
  if (session?.user?.id) {
    const threadIds = page.items.filter((i) => i.kind === "thread").map((i) => i.id)
    if (threadIds.length) {
      const follows = await prisma.threadFollow.findMany({
        where: { userId: session.user.id, threadId: { in: threadIds } },
        select: { threadId: true, lastSeenAt: true, thread: { select: { lastActivityAt: true } } },
      })
      for (const f of follows) {
        if (f.thread.lastActivityAt > (f.lastSeenAt ?? new Date(0))) unreadThreadIds.push(f.threadId)
      }
    }
  }

  return NextResponse.json({
    items: page.items,
    nextCursor: page.nextCursor,
    coldStart: page.coldStart,
    unreadThreadIds,
  })
}
