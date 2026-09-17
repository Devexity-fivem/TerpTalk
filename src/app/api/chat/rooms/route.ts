import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { prisma } from "@/lib/prisma"
import { sessionCookieName } from "@/lib/auth"
import { unauthorized, forbidden, isSessionValid, getClientIp, hashIp, isStaff } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { GROW_ROOM_REP, GROW_ROOM_SLUG } from "@/lib/chat-access"
import { getChatActivity, countOnline, withLatestActivity } from "@/lib/chat-activity"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"

// Get chat rooms
export async function GET(request: NextRequest) {
  try {
    const token = await getToken({
      req: request,
      secret: process.env.NEXTAUTH_SECRET,
      cookieName: sessionCookieName,
    })
    const userId = token?.id as string | undefined
    if (!userId) return unauthorized()

    if (!(await isSessionValid(userId, token?.sessionVersion as number | undefined))) return forbidden()

    const ip = getClientIp(request)
    const rl = await rateLimit(`chat-rooms:${hashIp(ip)}`, 60, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    // Badge mode — the nav polls this once a minute per signed-in user, so
    // it skips room seeding and the full room list. Returns the minimum
    // activity metadata (latest timestamp per accessible room + site-wide
    // online count) the client needs for the unread dot — no content.
    if (new URL(request.url).searchParams.get("badge") === "1") {
      const activity = await getChatActivity(userId)
      return NextResponse.json(activity)
    }

    // Ensure a default public room exists so users always have somewhere to chat
    await prisma.chatRoom.upsert({
      where: { slug: "general" },
      update: {},
      create: {
        name: "General Chat",
        slug: "general",
        description: "Community live chat",
        isPrivate: false,
        order: 1,
      },
    })

    // The Grow Room is seeded lazily behind its rollout flag — when the
    // flag is off the room isn't created and nothing gated is listed.
    const growRoomEnabled = await getBooleanSetting(SITE_SETTINGS.GROW_ROOM_ENABLED, false)
    if (growRoomEnabled) {
      await prisma.chatRoom.upsert({
        where: { slug: GROW_ROOM_SLUG },
        update: { requiredRep: GROW_ROOM_REP },
        create: {
          name: "The Grow Room",
          slug: GROW_ROOM_SLUG,
          description: `Members-only room for experienced growers — unlocks at ${GROW_ROOM_REP.toLocaleString()} rep (Cultivator). Advanced technique talk, seasoned advice, early previews.`,
          isPrivate: false,
          requiredRep: GROW_ROOM_REP,
          order: 2,
        },
      })
    }

    const [allRooms, onlineCount, user] = await Promise.all([
      prisma.chatRoom.findMany({
        where: { isPrivate: false },
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          requiredRep: true,
          slowModeSeconds: true,
          locked: true,
          _count: {
            select: { messages: true },
          },
        },
      }),
      countOnline(),
      prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, profile: { select: { reputation: true } } },
      }),
    ])

    // Gated rooms list as locked teasers (the reward advertises itself) but
    // only while the flag is on — and messages never flow to non-members.
    const staff = isStaff(user?.role)
    const rep = user?.profile?.reputation ?? 0
    const rooms = await withLatestActivity(
      allRooms
        .filter((r) => r.requiredRep == null || growRoomEnabled)
        .map((r) => ({
          ...r,
          accessible: r.requiredRep == null || staff || rep >= r.requiredRep,
        }))
    )

    return NextResponse.json({ rooms, onlineCount })
  } catch (error) {
    console.error("Failed to fetch chat rooms:", error)
    return NextResponse.json(
      { error: "Failed to load chat rooms" },
      { status: 500 }
    )
  }
}
