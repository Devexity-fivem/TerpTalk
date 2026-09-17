// Server-side chat activity summaries. Feeds the nav badge endpoint and the
// homepage teaser. Everything here reuses the canAccessRoom boundary —
// staff-private rooms are never listed, and rep-gated rooms only appear for
// members past the gate while the rollout flag is on.
import { prisma } from "@/lib/prisma"
import { isStaff } from "@/lib/security"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"

export interface ChatActivityRoom {
  id: string
  slug: string
  name: string
  requiredRep: number | null
  latestAt: string | null
}

// Rooms a user may see activity metadata for — the same visibility rule the
// full room list applies, without the room payload.
async function visibleRooms(userId: string) {
  const [user, growRoomEnabled] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, profile: { select: { reputation: true } } },
    }),
    getBooleanSetting(SITE_SETTINGS.GROW_ROOM_ENABLED, false),
  ])
  if (!user) return []
  const staff = isStaff(user.role)
  const rep = user.profile?.reputation ?? 0
  const rooms = await prisma.chatRoom.findMany({
    where: { isPrivate: false },
    orderBy: { order: "asc" },
    select: { id: true, slug: true, name: true, requiredRep: true },
  })
  return rooms.filter(
    (r) =>
      (r.requiredRep == null || growRoomEnabled) &&
      (r.requiredRep == null || staff || rep >= r.requiredRep)
  )
}

// One indexed groupBy over the visible rooms — no message content, just the
// newest createdAt per room.
async function latestActivityByRoom(roomIds: string[]) {
  if (roomIds.length === 0) return new Map<string, Date>()
  const grouped = await prisma.chatMessage.groupBy({
    by: ["roomId"],
    where: { roomId: { in: roomIds }, deleted: false },
    _max: { createdAt: true },
  })
  return new Map(grouped.map((g) => [g.roomId, g._max.createdAt!]))
}

// Site-wide presence — lastSeenAt within 15 min. Same definition the nav has
// always used; now explicitly labeled site-wide rather than per-room.
export async function countOnline(): Promise<number> {
  return prisma.user.count({
    where: {
      lastSeenAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
      OR: [{ profile: { hideOnlineStatus: false } }, { profile: null }],
      banned: false,
    },
  })
}

// Nav badge payload: per-accessible-room latest activity + online count.
export async function getChatActivity(userId: string) {
  const rooms = await visibleRooms(userId)
  const latest = await latestActivityByRoom(rooms.map((r) => r.id))
  const onlineCount = await countOnline()
  return {
    onlineCount,
    rooms: rooms.map(
      (r): ChatActivityRoom => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        requiredRep: r.requiredRep,
        latestAt: latest.get(r.id)?.toISOString() ?? null,
      })
    ),
  }
}

// Annotate a full room list with per-room latest activity — used by the
// /chat room picker for unread dots.
export async function withLatestActivity<T extends { id: string }>(rooms: T[]) {
  const latest = await latestActivityByRoom(rooms.map((r) => r.id))
  return rooms.map((r) => ({ ...r, latestAt: latest.get(r.id)?.toISOString() ?? null }))
}

export interface ChatTeaser {
  onlineCount: number
  roomName: string
  roomSlug: string
  latestAt: string | null
}

// Homepage teaser — public rooms only (no rep gate, never private), so it is
// safe to server-render for guests. Returns room metadata + activity time,
// never message content.
export async function getChatTeaser(): Promise<ChatTeaser | null> {
  const room =
    (await prisma.chatRoom.findFirst({
      where: { slug: "general", isPrivate: false, requiredRep: null },
      select: { id: true, name: true, slug: true },
    })) ??
    (await prisma.chatRoom.findFirst({
      where: { isPrivate: false, requiredRep: null },
      orderBy: { order: "asc" },
      select: { id: true, name: true, slug: true },
    }))
  if (!room) return null
  const [latest, onlineCount] = await Promise.all([
    prisma.chatMessage.findFirst({
      where: { roomId: room.id, deleted: false },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    countOnline(),
  ])
  return {
    onlineCount,
    roomName: room.name,
    roomSlug: room.slug,
    latestAt: latest?.createdAt.toISOString() ?? null,
  }
}
