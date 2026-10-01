import { NextRequest, NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"
import { prisma } from "@/lib/prisma"
import { sessionCookieName } from "@/lib/auth"
import { unauthorized, forbidden, isSessionValid, getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { GROW_ROOM_XP, GROW_ROOM_SLUG, VAULT_ROOM_XP, VAULT_ROOM_SLUG, roomRequirementText, roomAccessDecision } from "@/lib/chat-access"
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
    // High-frequency read polling — sampled counting (see rate-limit.ts):
    // every request still enforces, only ~1/6 of requests write.
    const rl = await rateLimit(`chat-rooms:${hashIp(ip)}`, 60, 60 * 1000, false, 6)
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
        update: { requiredXp: GROW_ROOM_XP },
        create: {
          name: "The Grow Room",
          slug: GROW_ROOM_SLUG,
          description: `Members-only room for experienced growers — unlocks at Cultivator rank (${GROW_ROOM_XP.toLocaleString()} XP) + Trusted standing. Advanced technique talk, seasoned advice, early previews.`,
          isPrivate: false,
          requiredXp: GROW_ROOM_XP,
          order: 2,
        },
      })
      // The Vault — the head table, opens at Head Grower.
      await prisma.chatRoom.upsert({
        where: { slug: VAULT_ROOM_SLUG },
        update: { requiredXp: VAULT_ROOM_XP },
        create: {
          name: "The Vault",
          slug: VAULT_ROOM_SLUG,
          description: `The head table — unlocks at Master Cultivator rank (${VAULT_ROOM_XP.toLocaleString()} XP) + Respected standing. Genetics vault talk, cup-level technique, and the garden's oldest hands.`,
          isPrivate: false,
          requiredXp: VAULT_ROOM_XP,
          order: 3,
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
          isPrivate: true,
          requiredXp: true,
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
        select: { role: true, profile: { select: { xp: true, standing: true, unlockFrozen: true } } },
      }),
    ])

    // Gated rooms list as locked teasers (the reward advertises itself) but
    // only while the flag is on — and messages never flow to non-members.
    // Access itself is evaluated by the shared predicate in chat-access.
    const rooms = await withLatestActivity(
      allRooms
        .filter((r) => r.requiredXp == null || growRoomEnabled)
        .map((r) => ({
          ...r,
          unlockText: r.requiredXp != null ? roomRequirementText(r) : null,
          accessible: roomAccessDecision(user, r, growRoomEnabled).allowed,
        })),
      userId
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
