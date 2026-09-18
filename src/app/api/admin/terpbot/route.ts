import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { getBotStats } from "@/lib/terpbot-events"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import { CHAT_COMMANDS } from "@/lib/chat-commands"

// Admin TerpBot dashboard — aggregate BotEvent stats plus a deterministic
// health model. Aggregate counts only; no user-level rows are returned.
// Health checks report pass/fail, never secret values.
export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const [stats, botRows, publicRooms, latestEvent] = await Promise.all([
    getBotStats(),
    prisma.user.findMany({
      where: { profile: { username: TERPBOT_USERNAME } },
      select: {
        id: true, role: true, password: true,
        profile: { select: { id: true, bio: true, avatarUrl: true } },
      },
    }),
    prisma.chatRoom.count({ where: { isPrivate: false } }),
    prisma.botEvent.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ])

  const bot = botRows[0]
  const publicCommands = CHAT_COMMANDS.filter(
    (c) => c.permission === "public" && c.handledBy === "bot"
  ).length
  const mentionCommands = CHAT_COMMANDS.filter(
    (c) => c.permission === "public" && c.surfaces.includes("mention")
  ).length

  const checks: { name: string; ok: boolean; detail: string }[] = [
    { name: "Bot identity exists", ok: !!bot, detail: bot ? `@${TERPBOT_USERNAME}` : "missing" },
    { name: "Single bot identity", ok: botRows.length <= 1, detail: `${botRows.length} account(s)` },
    { name: "Bot role is MEMBER", ok: !bot || bot.role === "MEMBER", detail: bot?.role ?? "n/a" },
    { name: "Bot has no password", ok: !bot || bot.password === null, detail: bot ? (bot.password === null ? "none" : "SET — investigate") : "n/a" },
    { name: "Bot profile exists", ok: !!bot?.profile, detail: bot?.profile ? "ok" : "missing" },
    { name: "Public chat rooms available", ok: publicRooms > 0, detail: `${publicRooms} room(s)` },
    {
      name: "Cron secret configured",
      // In production the cron refuses to run without it; locally the
      // dev-only UA path makes absence acceptable.
      ok: !!process.env.CRON_SECRET || process.env.NODE_ENV !== "production",
      detail: process.env.CRON_SECRET ? "set" : "not set",
    },
    { name: "Command registry loaded", ok: publicCommands > 0, detail: `${publicCommands} public / ${mentionCommands} mentionable` },
    { name: "BotEvent writes functioning", ok: !!latestEvent, detail: latestEvent ? `latest ${latestEvent.createdAt.toISOString().slice(0, 10)}` : "no events yet" },
  ]

  return NextResponse.json({
    stats,
    checks,
    registry: { public: publicCommands, mentionable: mentionCommands },
  })
}
