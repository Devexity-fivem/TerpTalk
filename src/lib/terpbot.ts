// TerpBot — the community engine. Shared helpers so any route or background
// job can post to chat as the bot without duplicating the account lookup,
// message creation, and realtime broadcast.
//
// Permission boundary: the bot is a least-privileged MEMBER account with no
// password and no session capability. Its code runs in-process with direct
// Prisma access, so code review is the permission system — helpers here may
// only read public-class data (publicUserSelect, published guides, public
// content with deleted:false + activeAuthor filters) and may only write
// ChatMessage as the bot, Setting idempotency keys, and system notifications.
// Never read DirectMessage, Report, SecurityEvent, Block, credentials, or
// staff-only tables from a TerpBot path; never interpolate private data into
// a bot message; never hand the bot moderation, role, or reputation writes.
import { prisma } from "@/lib/prisma"
import { getPusher } from "@/lib/pusher"
import { publicUserSelect, LIMITS } from "@/lib/security"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import { recordBotEvent } from "@/lib/terpbot-events"

export { TERPBOT_USERNAME }
const BOT_ROLE = "MEMBER"

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
    select: { id: true, image: true, role: true, password: true, profile: { select: { id: true, bio: true, avatarUrl: true } } },
  })
  if (existing) {
    // Never adopt a credentialed account — if a human ever ends up holding
    // the "terpbot" username with a password, they could log in and speak as
    // the bot. Fail closed instead of claiming the identity.
    if (existing.password !== null) {
      throw new Error("[terpbot] refusing to adopt a credentialed account")
    }
    cachedBotId = existing.id
    // Pin the role — the bot must never be privileged. If anything elevated
    // the account out-of-band, demote it back to MEMBER on the next post.
    // This only ever touches the known bot row.
    if (existing.role !== BOT_ROLE) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { role: BOT_ROLE },
      }).catch(() => {})
    }
    // Self-heal: fill in the bot's profile the first time it posts.
    if (existing.profile && (!existing.profile.bio || !existing.profile.avatarUrl)) {
      await prisma.profile.update({
        where: { id: existing.profile.id },
        data: BOT_PROFILE,
      }).catch(() => {})
    }
    // Chat DTOs read User.image — keep it in sync with the profile avatar.
    if (!existing.image) {
      await prisma.user.update({
        where: { id: existing.id },
        data: { image: BOT_PROFILE.avatarUrl },
      }).catch(() => {})
    }
    return existing.id
  }
  const created = await prisma.user.create({
    data: {
      name: "TerpBot",
      role: BOT_ROLE,
      ageVerified: true,
      status: "ONLINE",
      image: BOT_PROFILE.avatarUrl,
      profile: { create: { username: TERPBOT_USERNAME, ...BOT_PROFILE } },
    },
    select: { id: true },
  })
  cachedBotId = created.id
  return created.id
}

// Post a message to a room as TerpBot and push it over Pusher when configured.
// Returns the chat DTO used by the sidebar, or null if posting failed.
// Bot activity never earns reputation — automated posts must not pollute
// leaderboards or member rankings.
// replyToId threads the bot's answer under the message that asked for it.
export async function postBotMessage(roomId: string, text: string, replyToId?: string) {
  try {
    // The bot speaks in public rooms only — never into private/staff rooms.
    const room = await prisma.chatRoom.findUnique({
      where: { id: roomId },
      select: { isPrivate: true },
    })
    if (!room || room.isPrivate) return null
    // Enforce the same content cap users get, and never let bot output
    // contain its own trigger — an "@terpbot" in a reply could ping itself
    // if a future path ever re-scanned bot output.
    const content = text
      .replace(/@terpbot\b/gi, "terpbot")
      .slice(0, LIMITS.CHAT_MESSAGE_MAX)
    const authorId = await getOrCreateBot()
    const message = await prisma.chatMessage.create({
      data: { roomId, authorId, content, ...(replyToId ? { replyToId } : {}) },
      include: {
        author: { select: publicUserSelect },
        replyTo: { include: { author: { select: publicUserSelect } } },
      },
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
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            content: message.replyTo.deleted ? "[deleted]" : message.replyTo.content,
            author: {
              id: message.replyTo.author.id,
              name: message.replyTo.author.name,
              username: message.replyTo.author.profile?.username ?? null,
              image: message.replyTo.author.image ?? null,
              role: message.replyTo.author.role ?? null,
            },
          }
        : null,
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
  const dto = await postToGeneral(
    `🌱 Welcome @${username} to TerpTalk! Say hi, show off your setup, or start a grow diary.`
  )
  if (dto) {
    await recordBotEvent({
      type: "ANNOUNCEMENT",
      key: `announce:welcome:${username.toLowerCase()}`,
      command: "welcome",
    }).catch(() => {})
  }
  return dto
}

// Announcement helpers all record an ANNOUNCEMENT BotEvent keyed by the
// logical post so /u/terpbot stats stay truthful (welcomes/digests were
// already counted; these kinds previously were not).
export async function announceBadges(username: string, badgeNames: string[]) {
  if (badgeNames.length === 0) return null
  const list = badgeNames.map((n) => `"${n}"`).join(", ")
  const dto = await postToGeneral(
    `🏅 @${username} earned ${badgeNames.length > 1 ? "new badges" : "a new badge"}: ${list}`
  )
  if (dto) {
    await recordBotEvent({
      type: "ANNOUNCEMENT",
      key: `announce:badges:${dto.id}`,
      command: "badges",
    }).catch(() => {})
  }
  return dto
}

export async function announceTierUp(username: string, tierName: string, reputation: number) {
  const dto = await postToGeneral(
    `⬆️ @${username} just reached the ${tierName} tier with ${reputation.toLocaleString()} rep. Keep growing!`
  )
  if (dto) {
    await recordBotEvent({
      type: "ANNOUNCEMENT",
      key: `announce:tierup:${dto.id}`,
      command: "tierup",
    }).catch(() => {})
  }
  return dto
}

export async function announceHarvest(username: string, diaryTitle: string, yieldText?: string) {
  const dto = await postToGeneral(
    `🌾 @${username} harvested "${diaryTitle}"${yieldText ? ` — pulled ${yieldText}` : ""}. Nice work!`
  )
  if (dto) {
    await recordBotEvent({
      type: "ANNOUNCEMENT",
      key: `announce:harvest:${dto.id}`,
      command: "harvest",
    }).catch(() => {})
  }
  return dto
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
