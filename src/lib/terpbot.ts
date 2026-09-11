// TerpBot — the community engine. Shared helpers so any route or background
// job can post to chat as the bot without duplicating the account lookup,
// message creation, and realtime broadcast.
import { prisma } from "@/lib/prisma"
import { getPusher } from "@/lib/pusher"
import { publicUserSelect } from "@/lib/security"

export const TERPBOT_USERNAME = "terpbot"

let cachedBotId: string | null = null

async function getOrCreateBot(): Promise<string> {
  if (cachedBotId) return cachedBotId
  const existing = await prisma.user.findFirst({
    where: { profile: { username: TERPBOT_USERNAME } },
    select: { id: true },
  })
  if (existing) {
    cachedBotId = existing.id
    return existing.id
  }
  const created = await prisma.user.create({
    data: {
      name: "TerpBot",
      ageVerified: true,
      status: "ONLINE",
      profile: { create: { username: TERPBOT_USERNAME } },
    },
    select: { id: true },
  })
  cachedBotId = created.id
  return created.id
}

// Post a message to a room as TerpBot and push it over Pusher when configured.
// Returns the chat DTO used by the sidebar, or null if posting failed.
export async function postBotMessage(roomId: string, text: string) {
  try {
    const authorId = await getOrCreateBot()
    const message = await prisma.chatMessage.create({
      data: { roomId, authorId, content: text },
      include: { author: { select: publicUserSelect } },
    })
    const dto = {
      id: message.id,
      content: message.content,
      createdAt: message.createdAt,
      author: {
        id: message.author.id,
        name: message.author.name,
        username: message.author.profile?.username ?? null,
        image: message.author.image ?? null,
        role: message.author.role ?? null,
      },
      replyTo: null,
    }
    getPusher()?.trigger(`private-chat-${roomId}`, "new-message", dto).catch(() => {})
    return dto
  } catch (error) {
    console.error("[terpbot] post failed:", error)
    return null
  }
}

// Post to the community "general" room (falls back to the first public room).
export async function postToGeneral(text: string) {
  try {
    const room =
      (await prisma.chatRoom.findFirst({ where: { slug: "general", isPrivate: false } })) ??
      (await prisma.chatRoom.findFirst({ where: { isPrivate: false }, orderBy: { createdAt: "asc" } }))
    if (!room) return null
    return postBotMessage(room.id, text)
  } catch (error) {
    console.error("[terpbot] general post failed:", error)
    return null
  }
}

// ── Community events ────────────────────────────────────────────────────

export async function announceNewMember(username: string) {
  return postToGeneral(
    `🌱 Welcome @${username} to TerpTalk! Say hi, show off your setup, or start a grow diary.`
  )
}

export async function announceBadges(username: string, badgeNames: string[]) {
  if (badgeNames.length === 0) return null
  const list = badgeNames.map((n) => `"${n}"`).join(", ")
  return postToGeneral(
    `🏅 @${username} earned ${badgeNames.length > 1 ? "new badges" : "a new badge"}: ${list}`
  )
}

export async function announceTierUp(username: string, tierName: string, reputation: number) {
  return postToGeneral(
    `⬆️ @${username} just reached the ${tierName} tier with ${reputation.toLocaleString()} rep. Keep growing!`
  )
}

export async function announceHarvest(username: string, diaryTitle: string, yieldText?: string) {
  return postToGeneral(
    `🌾 @${username} harvested "${diaryTitle}"${yieldText ? ` — pulled ${yieldText}` : ""}. Nice work!`
  )
}
