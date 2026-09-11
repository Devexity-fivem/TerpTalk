// TerpBot — the community engine. Shared helpers so any route or background
// job can post to chat as the bot without duplicating the account lookup,
// message creation, and realtime broadcast.
import { prisma } from "@/lib/prisma"
import { getPusher } from "@/lib/pusher"
import { publicUserSelect } from "@/lib/security"

export const TERPBOT_USERNAME = "terpbot"

let cachedBotId: string | null = null

const BOT_PROFILE = {
  bio: "🤖 TerpTalk's resident bot. I welcome new members, celebrate your milestones, post the daily digest, and keep chat tidy. Type /help in chat to see my commands.",
  location: "The Garden",
  growSpace: "Server rack",
  growExperience: "Eternal — I watch every grow",
  favoriteStrain: "Blue Dream (compiled)",
  avatarUrl: "/terpbot.svg",
}

async function getOrCreateBot(): Promise<string> {
  if (cachedBotId) return cachedBotId
  const existing = await prisma.user.findFirst({
    where: { profile: { username: TERPBOT_USERNAME } },
    select: { id: true, profile: { select: { id: true, bio: true, avatarUrl: true } } },
  })
  if (existing) {
    cachedBotId = existing.id
    // Self-heal: fill in the bot's profile the first time it posts.
    if (existing.profile && (!existing.profile.bio || !existing.profile.avatarUrl)) {
      await prisma.profile.update({
        where: { id: existing.profile.id },
        data: BOT_PROFILE,
      }).catch(() => {})
    }
    return existing.id
  }
  const created = await prisma.user.create({
    data: {
      name: "TerpBot",
      ageVerified: true,
      status: "ONLINE",
      profile: { create: { username: TERPBOT_USERNAME, ...BOT_PROFILE } },
    },
    select: { id: true },
  })
  cachedBotId = created.id
  return created.id
}

// Post a message to a room as TerpBot and push it over Pusher when configured.
// Returns the chat DTO used by the sidebar, or null if posting failed.
// awardRep lets the bot slowly earn reputation for its work — but must stay
// false for announcement posts so a rep check can never re-announce and loop.
export async function postBotMessage(
  roomId: string,
  text: string,
  { awardRep = false }: { awardRep?: boolean } = {}
) {
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
    if (awardRep) {
      // Lazy import: reputation.ts already imports this module.
      const { awardReputation } = await import("@/lib/reputation")
      await awardReputation(authorId, "BOT_MESSAGE", 1, "Community bot post")
    }
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

// Rotating grow tips — shared by the daily digest and the /tip command.
export const GROW_TIPS = [
  "Check runoff pH weekly — nutrient lockout usually shows up there first.",
  "LST beats topping for small tents: same yields, less recovery time.",
  "Water less, more often is a myth — water to ~10-20% runoff, then wait for the pot to feel light.",
  "A steady 75-80°F in flower keeps terps happy; big day/night swings stress the plant.",
  "Defoliate lightly at week 3 of flower — light penetration matters more than leaf count.",
  "Drying slow (60°F / 60% RH) preserves more terpenes than a warm, fast dry.",
  "Label every cut and seed — future you will forget which pheno was which.",
  "If leaves canoe up, your light or VPD is too hot before your nutrients are wrong.",
  "Silica early in veg = stronger branches for heavy flowers later.",
  "Don't harvest by calendar — check trichomes with a loupe: cloudy > amber for most growers.",
  "Airflow fixes more problems than nutrients do. Add a fan before you add a bottle.",
  "Take clone cuts before flipping to flower — it's nearly impossible after.",
  "Cure in jars with daily burps for week one; patience doubles the flavor.",
  "Calibrate your pH pen monthly — a drifting meter causes phantom deficiencies.",
]

export function randomGrowTip(): string {
  return GROW_TIPS[Math.floor(Math.random() * GROW_TIPS.length)]
}
