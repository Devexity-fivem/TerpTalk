import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { sessionCookieName } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, getClientIp, logSecurityEvent, isSessionValid, forbidden, blockExistsBetween, hashIp, enforceLinkTrust } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { notify } from "@/lib/notify"
import { TERPBOT_USERNAME } from "@/lib/terpbot"

function senderDto(user: { id?: string; name?: string | null; image?: string | null; profile?: { username?: string | null } | null }) {
  return {
    name: user.name ?? user.profile?.username ?? "Unknown",
    username: user.profile?.username ?? null,
    image: user.image ?? null,
  }
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/

// GET — list conversations, or ?with=<userId> for a thread (marks it read)
export async function GET(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
    const userId = token?.id as string | undefined
    if (!userId) return unauthorized()
    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden()

    const ip = getClientIp(request)
    const rl = await rateLimit(`messages-read:${userId}:${hashIp(ip)}`, 120, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { searchParams } = new URL(request.url)
    const withId = searchParams.get("with")

    // Lightweight unread-count mode — one indexed COUNT for the navbar
    // badge so chrome doesn't pull the whole conversation list per page.
    if (searchParams.get("unread") === "1") {
      const unread = await prisma.directMessage.count({
        where: { receiverId: userId, read: false, deleted: false },
      })
      return NextResponse.json({ unread })
    }

    const after = searchParams.get("after") // ISO timestamp for incremental polling
    const afterId = searchParams.get("afterId") // tie-break: (createdAt, id) cursor
    const before = searchParams.get("before") // ISO timestamp for paging older messages
    const beforeId = searchParams.get("beforeId")

    if (withId) {
      const threadWhere = {
        deleted: false,
        OR: [
          { senderId: userId, receiverId: withId },
          { senderId: withId, receiverId: userId },
        ],
      }
      const dto = (m: { id: string; content: string; createdAt: Date; senderId: string; sender: Parameters<typeof senderDto>[0] }) => ({
        id: m.id,
        content: m.content,
        createdAt: m.createdAt,
        senderId: m.senderId,
        sender: senderDto(m.sender),
      })

      // Incremental mode: only fetch messages after the (createdAt, id)
      // cursor — the poll then transfers near-empty payloads instead of the
      // whole thread. The id tie-break keeps a deterministic total order so
      // messages sharing a millisecond timestamp can never be skipped.
      if (after && ISO_RE.test(after)) {
        const afterDate = new Date(after)
        if (isNaN(afterDate.getTime())) {
          return NextResponse.json({ error: "Invalid after timestamp" }, { status: 400 })
        }
        const fresh = await prisma.directMessage.findMany({
          where: {
            ...threadWhere,
            AND: {
              OR: [
                { createdAt: { gt: afterDate } },
                ...(afterId ? [{ createdAt: afterDate, id: { gt: afterId } }] : []),
              ],
            },
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 51,
          include: { sender: { select: publicUserSelect } },
        })
        const hasMore = fresh.length > 50
        if (hasMore) fresh.pop()
        // Still mark incoming as read
        if (fresh.some((m) => m.senderId === withId && !m.read)) {
          await prisma.directMessage.updateMany({
            where: { senderId: withId, receiverId: userId, read: false, deleted: false },
            data: { read: true },
          })
        }
        return NextResponse.json({
          messages: fresh.map(dto),
          incremental: true,
          hasMore,
        })
      }

      // Page of older history: messages strictly before the (createdAt, id)
      // cursor, fetched newest-first then reversed for chronological display.
      if (before && ISO_RE.test(before)) {
        const beforeDate = new Date(before)
        if (isNaN(beforeDate.getTime())) {
          return NextResponse.json({ error: "Invalid before timestamp" }, { status: 400 })
        }
        const older = await prisma.directMessage.findMany({
          where: {
            ...threadWhere,
            AND: {
              OR: [
                { createdAt: { lt: beforeDate } },
                ...(beforeId ? [{ createdAt: beforeDate, id: { lt: beforeId } }] : []),
              ],
            },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 51,
          include: { sender: { select: publicUserSelect } },
        })
        const hasMore = older.length > 50
        if (hasMore) older.pop()
        older.reverse()
        return NextResponse.json({ messages: older.map(dto), hasMore })
      }

      // Initial load: the newest 100 messages, not the oldest — a long
      // thread must open at the tail. Fetched desc, reversed for display;
      // the extra row is the hasMore probe for "load older" paging.
      const newest = await prisma.directMessage.findMany({
        where: threadWhere,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 101,
        include: { sender: { select: publicUserSelect } },
      })
      const hasMore = newest.length > 100
      if (hasMore) newest.pop()
      newest.reverse()

      // Only write when there are actually unread messages from the other user.
      if (newest.some((m) => m.senderId === withId && !m.read)) {
        await prisma.directMessage.updateMany({
          where: { senderId: withId, receiverId: userId, read: false, deleted: false },
          data: { read: true },
        })
      }

      return NextResponse.json({
        messages: newest.map(dto),
        hasMore,
      })
    }

    // Conversation list: latest message per partner + unread count.
    // Aggregated in SQL rather than scanning a capped window in JS — the
    // inbox must find every conversation regardless of total message count.
    const latest = await prisma.$queryRaw<{ partnerId: string; content: string; createdAt: Date }[]>`
      SELECT DISTINCT ON (partner) partner AS "partnerId", content, "createdAt"
      FROM (
        SELECT CASE WHEN "senderId" = ${userId} THEN "receiverId" ELSE "senderId" END AS partner,
               content, "createdAt"
        FROM "DirectMessage"
        WHERE deleted = false AND ("senderId" = ${userId} OR "receiverId" = ${userId})
      ) m
      ORDER BY partner, "createdAt" DESC`

    const unreadRows = await prisma.$queryRaw<{ partnerId: string; n: bigint }[]>`
      SELECT "senderId" AS "partnerId", COUNT(*) AS n
      FROM "DirectMessage"
      WHERE "receiverId" = ${userId} AND read = false AND deleted = false
      GROUP BY "senderId"`
    const unreadBy = new Map(unreadRows.map((r) => [r.partnerId, Number(r.n)]))

    const partners = await prisma.user.findMany({
      where: { id: { in: latest.map((r) => r.partnerId) } },
      select: publicUserSelect,
    })
    const partnerBy = new Map(partners.map((p) => [p.id, p]))

    const convos = latest
      .map((row) => {
        const p = partnerBy.get(row.partnerId)
        if (!p) return null // partner account removed — its DMs cascade with it
        return {
          partner: {
            id: p.id,
            name: p.name ?? p.profile?.username ?? "Unknown",
            image: p.image ?? null,
            role: p.role ?? null,
            profile: { username: p.profile?.username ?? null },
          },
          lastMessage: row.content.slice(0, 80),
          lastAt: row.createdAt,
          unread: unreadBy.get(row.partnerId) ?? 0,
        }
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => b.lastAt.getTime() - a.lastAt.getTime())

    return NextResponse.json({ conversations: convos })
  } catch (error) {
    console.error("Messages fetch error:", error)
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 })
  }
}

// POST — send a DM: { to, content }
export async function POST(request: NextRequest) {
  try {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET, cookieName: sessionCookieName })
    const userId = token?.id as string | undefined
    if (!token || !userId) return unauthorized()

    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden()

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const { to, content } = await request.json().catch(() => ({}))
    if (typeof to !== "string" || typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }
    if (to === userId) {
      return NextResponse.json({ error: "Cannot message yourself" }, { status: 400 })
    }
    if (content.length > 2000) {
      return NextResponse.json({ error: "Message too long" }, { status: 400 })
    }

    const rl = await rateLimit(`dm:${userId}`, 60, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId, ip: getClientIp(request), metadata: { endpoint: "messages" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }
    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden("Your account is suspended")
    if (await blockExistsBetween(userId, to)) {
      return forbidden("You cannot message this user")
    }

    const linkBlock = await enforceLinkTrust(content, userId, request, "messages")
    if (linkBlock) return linkBlock

    const target = await prisma.user.findUnique({
      where: { id: to },
      select: { id: true, banned: true, profile: { select: { notifyOnMessage: true, username: true, dmPolicy: true } } },
    })
    if (!target || target.banned) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }
    // Recipient's DM policy — enforced server-side.
    const dmPolicy = target.profile?.dmPolicy ?? "EVERYONE"
    if (dmPolicy === "NONE") {
      return NextResponse.json({ error: "This member isn't accepting direct messages" }, { status: 403 })
    }
    if (dmPolicy === "FOLLOWING") {
      // "Members I follow" — a Follow row where the recipient follows the sender.
      const followed = await prisma.follow.findFirst({
        where: { followerId: to, followingId: userId },
        select: { id: true },
      })
      if (!followed) {
        return NextResponse.json({ error: "This member only accepts messages from members they follow" }, { status: 403 })
      }
    }
    // TerpBot can't be DM'd — it never reads them, so a DM is a dead letter
    // where members might dump personal info expecting a reply.
    if (target.profile?.username === TERPBOT_USERNAME) {
      return NextResponse.json({ error: "TerpBot can't receive direct messages — try @terpbot or /help in chat" }, { status: 400 })
    }

    const message = await prisma.directMessage.create({
      data: { senderId: userId, receiverId: to, content: content.trim() },
      include: { sender: { select: publicUserSelect } },
    })

    await notify({
      userId: to,
      type: "DIRECT_MESSAGE",
      title: "New message",
      content: `@${((token as { name?: string | null }).name) ?? "Someone"} sent you a message`,
      link: `/messages?with=${userId}`,
      actorId: userId,
      groupKey: `DM:${userId}:${to}`,
      dedupeMs: 10 * 60 * 1000,
    })

    return NextResponse.json({
      message: {
        id: message.id,
        content: message.content,
        createdAt: message.createdAt,
        senderId: message.senderId,
        sender: senderDto(message.sender),
      },
    }, { status: 201 })
  } catch (error) {
    console.error("DM error:", error)
    return NextResponse.json({ error: "Failed to send" }, { status: 500 })
  }
}
