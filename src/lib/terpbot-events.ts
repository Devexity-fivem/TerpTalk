// TerpBot telemetry + achievements — server-only module.
//
// Chat messages hard-delete after ~3 days (chat-cleanup.ts), so durable bot
// statistics need their own store: one BotEvent row per real action, keyed
// by a unique idempotency token. Events never contain message contents,
// IPs, or request bodies — only what the public stats and achievements
// need. userId is stored for distinct-counting but never surfaced except
// as an aggregate integer.
//
// Achievements use real Badge/UserBadge rows so the existing profile UI
// renders them for free, but they are deliberately absent from BADGE_RULES
// — checkBadges() can never award them to a human, and the bot never earns
// human badges (awardReputation is never invoked on bot paths; checkBadges
// additionally early-returns for the bot identity).
import { prisma } from "@/lib/prisma"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import { BOT_BADGE_REGISTRY } from "@/lib/badge-registry"

export type BotEventType =
  | "COMMAND_SLASH"      // /command answered successfully
  | "COMMAND_MENTION"    // @terpbot intent answered successfully
  | "MENTION_HELP"       // bare @terpbot ping → help hint
  | "MENTION_FALLBACK"   // mention we couldn't parse
  | "MENTION_REFUSAL"    // moderation-vocabulary refusal
  | "ANNOUNCEMENT"       // welcome/digest/contest posts (command = kind)
  | "DAY_ACTIVE"         // one row per UTC day the bot did anything

const COMMAND_TYPES: BotEventType[] = ["COMMAND_SLASH", "COMMAND_MENTION"]

// Internal links a bot response surfaced — how "threads/guides/strains/
// diaries referenced" is measured. Counted on the posted text, so only
// links that actually reached the room count.
export function countEntityLinks(messages: string[]): number {
  const re = /\/(forum\/thread|guides|strains|diaries)\//g
  return messages.reduce((n, m) => n + (m.match(re)?.length ?? 0), 0)
}

// Record one real bot action. `key` must be unique per logical event
// (e.g. `cmd:<botMessageId>`, `mention:<pingMessageId>`,
// `announce:welcome:<username>`) so retries collapse to a single row.
// Also stamps DAY_ACTIVE for the current UTC day. Never throws.
export async function recordBotEvent(e: {
  type: BotEventType
  key: string
  userId?: string | null
  command?: string
  entities?: number
}) {
  try {
    if (e.userId) {
      // The bot never counts itself as an assisted member.
      const bot = await prisma.profile.findUnique({
        where: { username: TERPBOT_USERNAME },
        select: { userId: true },
      })
      if (bot?.userId === e.userId) e = { ...e, userId: null }
    }
    await prisma.botEvent.create({
      data: {
        type: e.type,
        key: e.key,
        userId: e.userId ?? null,
        command: e.command ?? null,
        entities: e.entities ?? 0,
      },
    })
  } catch (err) {
    // P2002 = duplicate idempotency key — the event already counted.
    if ((err as { code?: string })?.code !== "P2002") {
      console.error("[terpbot] event write failed:", err)
    }
    return
  }
  const day = new Date().toISOString().slice(0, 10)
  await prisma.botEvent
    .create({ data: { type: "DAY_ACTIVE", key: `day:${day}` } })
    .catch(() => {})
  await checkBotBadges().catch((err) =>
    console.error("[terpbot] badge check failed:", err)
  )
}

export interface BotStats {
  commands: number        // answered commands (slash + mention)
  mentions: number        // answered via @terpbot
  membersAssisted: number // distinct requesters across answered commands
  entityLinks: number     // internal links surfaced
  welcomes: number        // new-member welcome announcements
  announcements: number   // all announcements
  daysActive: number      // distinct UTC days with any event
  fallbacks: number       // mentions the parser couldn't route
  refusals: number        // moderation-vocabulary refusals
  helps: number           // bare-ping help hints
  byCommand: Record<string, number>      // per-command answer counts
  byAnnouncement: Record<string, number> // per-kind announcement counts
}

export async function getBotStats(): Promise<BotStats> {
  const [
    commands, mentions, assisted, entities, welcomes, announcements,
    daysActive, fallbacks, refusals, helps, commandRows, announceRows,
  ] = await Promise.all([
      prisma.botEvent.count({ where: { type: { in: COMMAND_TYPES } } }),
      prisma.botEvent.count({ where: { type: "COMMAND_MENTION" } }),
      prisma.botEvent.findMany({
        where: { type: { in: COMMAND_TYPES }, userId: { not: null } },
        select: { userId: true },
        distinct: ["userId"],
      }),
      prisma.botEvent.aggregate({
        _sum: { entities: true },
        where: { type: { in: COMMAND_TYPES } },
      }),
      prisma.botEvent.count({ where: { type: "ANNOUNCEMENT", command: "welcome" } }),
      prisma.botEvent.count({ where: { type: "ANNOUNCEMENT" } }),
      prisma.botEvent.count({ where: { type: "DAY_ACTIVE" } }),
      prisma.botEvent.count({ where: { type: "MENTION_FALLBACK" } }),
      prisma.botEvent.count({ where: { type: "MENTION_REFUSAL" } }),
      prisma.botEvent.count({ where: { type: "MENTION_HELP" } }),
      prisma.botEvent.groupBy({
        by: ["command"],
        where: { type: { in: COMMAND_TYPES }, command: { not: null } },
        _count: { _all: true },
      }),
      prisma.botEvent.groupBy({
        by: ["command"],
        where: { type: "ANNOUNCEMENT", command: { not: null } },
        _count: { _all: true },
      }),
    ])
  return {
    commands,
    mentions,
    membersAssisted: assisted.length,
    entityLinks: entities._sum.entities ?? 0,
    welcomes,
    announcements,
    daysActive,
    fallbacks,
    refusals,
    helps,
    byCommand: Object.fromEntries(commandRows.map((r) => [r.command as string, r._count._all])),
    byAnnouncement: Object.fromEntries(announceRows.map((r) => [r.command as string, r._count._all])),
  }
}

// Achievement criteria — generated from BOT_BADGE_REGISTRY progress specs
// (same pattern as BADGE_RULES in reputation.ts), evaluated against real
// BotEvent aggregates only.
const BOT_BADGE_RULES: Record<string, (s: BotStats) => boolean> = Object.fromEntries(
  BOT_BADGE_REGISTRY.flatMap((d): [string, (s: BotStats) => boolean][] => {
    const spec = d.progress
    if (!spec) return []
    return [[d.name, (s: BotStats) => spec.stats.reduce((n, k) => n + Number(s[k as keyof BotStats] ?? 0), 0) >= spec.target]]
  })
)

// Grant one bot badge — direct UserBadge write, matching the manual-grant
// pattern used by contest-awards.ts. No notify() (bot notifications are
// dead letters) and no reputation side-effects.
async function awardBotBadge(userId: string, name: string): Promise<boolean> {
  const def = BOT_BADGE_REGISTRY.find((d) => d.name === name)
  if (!def) return false
  const badge = await prisma.badge.upsert({
    where: { name: def.name },
    create: {
      name: def.name,
      description: def.description,
      requirement: def.requirement,
      icon: def.icon,
      color: def.rarity,
    },
    update: {},
    select: { id: true },
  })
  try {
    await prisma.userBadge.create({ data: { userId, badgeId: badge.id } })
    return true
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return false // already earned
    throw err
  }
}

// Evaluate bot achievements after a recorded event. Steady state is one
// cheap query (earned badge names) with an early return once all are held.
export async function checkBotBadges() {
  const bot = await prisma.profile.findUnique({
    where: { username: TERPBOT_USERNAME },
    select: {
      userId: true,
      user: { select: { badges: { select: { badge: { select: { name: true } } } } } },
    },
  })
  if (!bot) return
  const earned = new Set(bot.user.badges.map((b) => b.badge.name))
  const pending = BOT_BADGE_REGISTRY.filter((d) => !earned.has(d.name))
  if (!pending.length) return

  const stats = await getBotStats()
  const newlyEarned: string[] = []
  for (const def of pending) {
    if (BOT_BADGE_RULES[def.name]?.(stats) && (await awardBotBadge(bot.userId, def.name))) {
      newlyEarned.push(def.name)
    }
  }
  if (!newlyEarned.length) return

  // Deliberate self-announcement — this is the point of the post, unlike
  // the incidental announceBadges path. Dynamic import avoids a module
  // cycle (terpbot.ts imports this module for recordBotEvent).
  const { postToGeneral } = await import("@/lib/terpbot")
  const list = newlyEarned.map((n) => `"${n}"`).join(", ")
  await postToGeneral(
    `🤖 Achievement unlocked: ${list}. ${newlyEarned.length === 1 ? "It" : "They"} now live${newlyEarned.length === 1 ? "s" : ""} on my profile — /u/terpbot`
  ).catch(() => null)
}
