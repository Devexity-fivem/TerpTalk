// TerpBot command handlers — server-only module. Every data query a public
// bot command can run lives here so handlers stay reviewable and never touch
// prisma directly. All reads are public-class data per the permission
// contract in terpbot.ts: deleted:false, activeAuthor(), published guides,
// publicUserSelect — never DirectMessage, Report, SecurityEvent, Block,
// credentials, or staff-only tables.
import { prisma } from "@/lib/prisma"
import { activeAuthor, blockExistsBetween, containsExternalLink, LIMITS, USERNAME_REGEX } from "@/lib/security"
import { getReputationTier, getNextTier, getTierProgress } from "@/lib/reputation-config"
import { getGrowStreak } from "@/lib/grow-streak"
import { BADGE_RULES, getUserStats } from "@/lib/reputation"
import { BADGE_REGISTRY, getBadgeByName } from "@/lib/badge-registry"
import { currentWeekKey } from "@/lib/week"
import { escapeLike, getStrainGrowStats } from "@/lib/strain-stats"
import { tokenizeSearchText } from "@/lib/search-terms"
import { diaryDay } from "@/lib/diary-weeks"
import { buildHelpText } from "@/lib/chat-commands"
import { TERPBOT_USERNAME, randomGrowTip } from "@/lib/terpbot"

export interface BotCommandCtx {
  userId: string
  role: string | null
  displayName: string
  args: string[]
  rest: string
}

export type BotCommandResult =
  | { ok: true; messages: string[] }
  | { ok: false; error: string; status?: number }

const ok = (...messages: string[]): BotCommandResult => ({ ok: true, messages })
const err = (error: string, status = 400): BotCommandResult => ({ ok: false, error, status })

// Never interpolate raw user input containing links into bot output — a
// link-blocked user could otherwise launder URLs through the trusted bot
// account. Queries are echoed back length-capped and link-free only.
function sanitizeEcho(q: string): string {
  return q.replace(/@/g, "").slice(0, 60).trim()
}
function hasLink(q: string): boolean {
  return containsExternalLink(q)
}

// Resolve an optional "@user" argument to a community member the requester is
// allowed to see. Returns the member, "self" when no arg was given, or null
// for invalid/banned/blocked/bot targets.
async function resolveMember(
  raw: string | undefined,
  requesterId: string
): Promise<{ userId: string; username: string; reputation: number } | "self" | null> {
  if (!raw) return "self"
  const username = raw.replace(/^@/, "")
  if (!username || username.length < LIMITS.USERNAME_MIN || username.length > LIMITS.USERNAME_MAX || !USERNAME_REGEX.test(username)) {
    return null
  }
  if (username.toLowerCase() === TERPBOT_USERNAME) return null
  const target = await prisma.user.findFirst({
    where: { profile: { username: { equals: username, mode: "insensitive" } }, ...activeAuthor() },
    select: { id: true, profile: { select: { username: true, reputation: true } } },
  })
  if (!target?.profile?.username) return null
  if (target.id !== requesterId && (await blockExistsBetween(requesterId, target.id))) return null
  return { userId: target.id, username: target.profile.username, reputation: target.profile.reputation }
}

async function memberFor(ctx: BotCommandCtx, raw?: string) {
  const t = await resolveMember(raw, ctx.userId)
  if (t === "self") {
    const me = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { id: true, profile: { select: { username: true, reputation: true } } },
    })
    if (!me?.profile?.username) return null
    return { userId: me.id, username: me.profile.username, reputation: me.profile.reputation }
  }
  return t
}

const RARITY_ORDER = ["common", "rare", "epic", "legendary"]

async function handle(name: string, ctx: BotCommandCtx): Promise<BotCommandResult> {
  switch (name) {
    case "help":
      return ok(buildHelpText(ctx.role))

    case "tip":
      return ok(`💡 Grow tip: ${randomGrowTip()}`)

    case "stats": {
      const [members, threads, posts, diaries, strains] = await Promise.all([
        prisma.user.count({ where: activeAuthor() }),
        prisma.thread.count({ where: { deleted: false, category: { hidden: false } } }),
        prisma.post.count({ where: { deleted: false, thread: { deleted: false } } }),
        prisma.growDiary.count({ where: { deleted: false, author: activeAuthor() } }),
        prisma.strain.count(),
      ])
      return ok(`📊 TerpTalk stats — ${members} members · ${threads} threads · ${posts} posts · ${diaries} grow diaries · ${strains} strains`)
    }

    case "top": {
      const top = await prisma.profile.findMany({
        where: { user: activeAuthor(), username: { not: TERPBOT_USERNAME } },
        orderBy: { reputation: "desc" },
        take: 5,
        select: { username: true, reputation: true },
      })
      const lines = top.map((p, i) => `${i + 1}. @${p.username} — ${p.reputation} rep`)
      return ok(`🏆 Top growers:\n${lines.join("\n")}\nFull board: /leaderboard`)
    }

    case "rep": {
      const t = await memberFor(ctx, ctx.args[0])
      if (!t) return ok(`Couldn't find that member.`)
      const tier = getReputationTier(t.reputation)
      const next = getNextTier(t.reputation)
      const nextText = next ? ` Next: ${next.name} at ${next.threshold} rep (${next.threshold - t.reputation} to go).` : " Top tier reached!"
      return ok(`📈 @${t.username} — ${t.reputation} rep · ${tier.name} tier.${nextText} /u/${t.username}`)
    }

    case "progress": {
      const t = await memberFor(ctx, ctx.args[0])
      if (!t) return ok(`Couldn't find that member.`)
      const tier = getReputationTier(t.reputation)
      const next = getNextTier(t.reputation)
      if (!next) return ok(`📈 @${t.username} — ${t.reputation} rep · ${tier.name}. That's the top tier!`)
      const prog = getTierProgress(t.reputation)
      return ok(
        `📈 @${t.username} — ${t.reputation} rep · ${tier.name} tier\n` +
          `Progress: ${prog.percent}% toward ${next.name} (${next.threshold} rep — ${next.threshold - t.reputation} to go)\n` +
          `${next.icon} ${next.name}: ${next.benefit}`
      )
    }

    case "rank": {
      const t = await memberFor(ctx, ctx.args[0])
      if (!t) return ok(`Couldn't find that member.`)
      const [above, total] = await Promise.all([
        prisma.profile.count({
          where: { reputation: { gt: t.reputation }, user: activeAuthor(), username: { not: TERPBOT_USERNAME } },
        }),
        prisma.profile.count({ where: { user: activeAuthor(), username: { not: TERPBOT_USERNAME } } }),
      ])
      return ok(`🏆 @${t.username} is #${above + 1} of ${total} members by reputation. Board: /leaderboard`)
    }

    case "streak": {
      const t = await memberFor(ctx, ctx.args[0])
      if (!t) return ok(`Couldn't find that member.`)
      const s = await getGrowStreak(t.userId)
      if (s.streak === 0) {
        return ok(`🔥 @${t.username} has no diary-update streak — post an update to start one. /diaries`)
      }
      return ok(
        `🔥 @${t.username} — ${s.streak}-day update streak · ${s.totalUpdates} total updates · ${s.harvestedDiaries} harvested diaries`
      )
    }

    case "badge": {
      if (!ctx.rest) {
        // No arg → list the requester's earned badges.
        const earned = await prisma.userBadge.findMany({
          where: { userId: ctx.userId },
          orderBy: { earnedAt: "desc" },
          include: { badge: { select: { name: true } } },
        })
        if (!earned.length) {
          return ok(`🏅 @${ctx.displayName} hasn't earned any badges yet — /nextbadges shows what's next.`)
        }
        const names = earned.slice(0, 10).map((b) => `"${b.badge.name}"`)
        const more = earned.length > 10 ? ` +${earned.length - 10} more` : ""
        return ok(`🏅 @${ctx.displayName} — ${earned.length} badge${earned.length === 1 ? "" : "s"}: ${names.join(", ")}${more}\n/u/${ctx.displayName}`)
      }
      if (hasLink(ctx.rest)) return ok(`I can't look that up — badge names only.`)
      const badge =
        (await prisma.badge.findFirst({
          where: { name: { equals: ctx.rest, mode: "insensitive" } },
          select: { name: true, description: true, requirement: true, color: true },
        })) ?? null
      const def = getBadgeByName(ctx.rest)
      if (!badge && !def) return ok(`No badge called that — browse the list on your profile or /nextbadges.`)
      const name = badge?.name ?? def!.name
      const [holders, mine] = await Promise.all([
        prisma.userBadge.count({ where: { badge: { name } } }),
        prisma.userBadge.findFirst({ where: { userId: ctx.userId, badge: { name } }, select: { earnedAt: true } }),
      ])
      const earned = mine ? ` Earned by you on ${mine.earnedAt.toISOString().slice(0, 10)}.` : ""
      return ok(
        `🏅 "${name}" (${badge?.color ?? def!.rarity}) — ${badge?.description ?? def!.description}\n` +
          `Requirement: ${badge?.requirement ?? def!.requirement} · ${holders} member${holders === 1 ? "" : "s"} have it.${earned}`
      )
    }

    case "nextbadges": {
      const [stats, earnedRows] = await Promise.all([
        getUserStats(ctx.userId),
        prisma.userBadge.findMany({ where: { userId: ctx.userId }, select: { badge: { select: { name: true } } } }),
      ])
      const earned = new Set(earnedRows.map((r) => r.badge.name))
      const unearned = BADGE_REGISTRY.filter((d) => !earned.has(d.name) && BADGE_RULES[d.name] && !BADGE_RULES[d.name](stats))
      if (!unearned.length) return ok(`🏅 @${ctx.displayName} has earned every rule-based badge — impressive!`)
      unearned.sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity))
      const lines = unearned.slice(0, 5).map((d) => `• ${d.name} (${d.rarity}) — ${d.requirement}`)
      return ok(`🏅 Next badges for @${ctx.displayName}:\n${lines.join("\n")}`)
    }

    case "diary": {
      const t = await memberFor(ctx, ctx.args[0])
      if (!t) return ok(`Couldn't find that member.`)
      const diarySelect = {
        id: true, title: true, stage: true, strain: true, startDate: true,
        harvested: true, yieldAmount: true, yieldUnit: true, _count: { select: { updates: true } },
      } as const
      const diary =
        (await prisma.growDiary.findFirst({
          where: { authorId: t.userId, deleted: false, harvested: false },
          orderBy: { updatedAt: "desc" },
          select: diarySelect,
        })) ??
        (await prisma.growDiary.findFirst({
          where: { authorId: t.userId, deleted: false },
          orderBy: { harvestedAt: "desc" },
          select: diarySelect,
        }))
      if (!diary) {
        return ok(
          t.userId === ctx.userId
            ? `You don't have a grow diary yet — start one at /diaries/new`
            : `@${t.username} doesn't have a public grow diary.`
        )
      }
      const day = diaryDay(diary.startDate, new Date())
      const yieldText = diary.yieldAmount != null ? ` · harvested ${diary.yieldAmount}${diary.yieldUnit ?? "g"}` : ""
      return ok(
        `📔 @${t.username}'s diary "${diary.title}"${diary.strain ? ` (${diary.strain})` : ""}\n` +
          `Stage: ${diary.stage} · Day ${day} · ${diary._count.updates} update${diary._count.updates === 1 ? "" : "s"}${yieldText}\n` +
          `/diaries/${diary.id}`
      )
    }

    case "thread": {
      if (!ctx.rest) return err("Usage: /thread <search>")
      if (hasLink(ctx.rest)) return ok(`I can't look that up — keywords only, no links.`)
      const q = escapeLike(sanitizeEcho(ctx.rest))
      const base = { deleted: false, category: { hidden: false } }
      // Pass A — exact phrase on title/tags (mirrors search tier-1).
      let threads = await prisma.thread.findMany({
        where: { ...base, OR: [{ title: { contains: q, mode: "insensitive" } }, { tags: { some: { tag: { name: { contains: q, mode: "insensitive" } } } } }] },
        take: 3,
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        select: { title: true, slug: true, replyCount: true, category: { select: { name: true } } },
      })
      // Pass B — tokenized title match (similar-threads pattern).
      if (threads.length < 3) {
        const words = tokenizeSearchText(ctx.rest)
        if (words.length) {
          const more = await prisma.thread.findMany({
            where: { ...base, OR: words.map((w) => ({ title: { contains: w, mode: "insensitive" } })) },
            take: 6,
            orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
            select: { title: true, slug: true, replyCount: true, category: { select: { name: true } } },
          })
          const seen = new Set(threads.map((t) => t.slug))
          threads = [...threads, ...more.filter((t) => !seen.has(t.slug))].slice(0, 3)
        }
      }
      if (!threads.length) {
        return ok(`No threads matching that — try broader keywords or browse /forum`)
      }
      const lines = threads.map((t) => `- ${t.title} → /forum/thread/${t.slug} (${t.replyCount} replies)`)
      return ok(`🔎 Threads about "${sanitizeEcho(ctx.rest)}":\n${lines.join("\n")}\nMore: /search?q=${encodeURIComponent(ctx.rest.slice(0, 60))}&type=threads`)
    }

    case "strain": {
      if (!ctx.rest) return err("Usage: /strain <name>")
      if (hasLink(ctx.rest)) return ok(`I can't look that up — strain names only, no links.`)
      const q = escapeLike(sanitizeEcho(ctx.rest))
      const strain = await prisma.strain.findFirst({
        where: { name: { contains: q, mode: "insensitive" } },
        orderBy: { name: "asc" },
      })
      if (!strain) return ok(`No strain matching that in the library — browse /strains or add it yourself!`)
      const stats = await getStrainGrowStats(strain.name)
      const statsLine = stats.growCount > 0 ? `📊 ${stats.label}` : null
      return ok(
        [
          `🌿 ${strain.name}${strain.type ? ` (${strain.type})` : ""}`,
          strain.genetics ? `Genetics: ${strain.genetics}` : null,
          strain.breeder ? `Breeder: ${strain.breeder}` : null,
          statsLine,
          `Details: /strains/${strain.id}`,
        ]
          .filter(Boolean)
          .join("\n")
      )
    }

    case "guide": {
      if (!ctx.rest) return err("Usage: /guide <search>")
      if (hasLink(ctx.rest)) return ok(`I can't look that up — keywords only, no links.`)
      const q = escapeLike(sanitizeEcho(ctx.rest))
      const guides = await prisma.guide.findMany({
        where: {
          published: true,
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { excerpt: { contains: q, mode: "insensitive" } },
            { topic: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 3,
        orderBy: { title: "asc" },
        select: { title: true, slug: true },
      })
      if (!guides.length) return ok(`No guides matching that — browse /guides`)
      return ok(`📚 Guides matching "${sanitizeEcho(ctx.rest)}":\n${guides.map((g) => `- ${g.title} → /guides/${g.slug}`).join("\n")}`)
    }

    case "ask": {
      if (!ctx.rest) return err("Usage: /ask <question>")
      if (hasLink(ctx.rest)) return ok(`I can't look that up — keywords only, no links.`)
      const q = escapeLike(sanitizeEcho(ctx.rest))
      const [guides, strains] = await Promise.all([
        prisma.guide.findMany({
          where: {
            published: true,
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { excerpt: { contains: q, mode: "insensitive" } },
              { content: { contains: q, mode: "insensitive" } },
            ],
          },
          take: 2,
          orderBy: { title: "asc" },
          select: { title: true, slug: true },
        }),
        prisma.strain.findMany({
          where: {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { growingInfo: { contains: q, mode: "insensitive" } },
            ],
          },
          take: 2,
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        }),
      ])
      const lines = [
        ...guides.map((g) => `📚 ${g.title} → /guides/${g.slug}`),
        ...strains.map((s) => `🌿 ${s.name} → /strains/${s.id}`),
      ]
      if (!lines.length) {
        return ok(`Couldn't find anything on that — try different keywords, browse /guides and /strains, or ask the community in Discussions!`)
      }
      return ok(`Here's what I found:\n${lines.join("\n")}\nFor anything else, try /help`)
    }

    case "online": {
      const since = new Date(Date.now() - 15 * 60 * 1000)
      const users = await prisma.user.findMany({
        where: { lastSeenAt: { gte: since }, banned: false, profile: { isNot: { username: TERPBOT_USERNAME } } },
        orderBy: { lastSeenAt: "desc" },
        take: 6,
        select: { profile: { select: { username: true } } },
      })
      const names = users.map((u) => u.profile?.username).filter(Boolean) as string[]
      const count = await prisma.user.count({
        where: { lastSeenAt: { gte: since }, banned: false, profile: { isNot: { username: TERPBOT_USERNAME } } },
      })
      if (!count) return ok(`👀 Nobody's been active in the last 15 minutes — quiet garden.`)
      const list = names.slice(0, 5).map((n) => `@${n}`).join(", ")
      return ok(`👀 ${count} member${count === 1 ? "" : "s"} active in the last 15 min: ${list}${count > names.length ? " …" : ""}`)
    }

    case "digest": {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
      const [members, threads, updates] = await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: since }, banned: false } }),
        prisma.thread.count({ where: { createdAt: { gte: since }, deleted: false, category: { hidden: false } } }),
        prisma.diaryUpdate.count({ where: { createdAt: { gte: since }, diary: { deleted: false } } }),
      ])
      const activity =
        members + threads + updates > 0
          ? `Last 24 hours: ${members} new member${members === 1 ? "" : "s"}, ${threads} new thread${threads === 1 ? "" : "s"}, ${updates} diary update${updates === 1 ? "" : "s"}.`
          : "Quiet last 24 hours — start a thread or update your diary to get things going."
      return ok(`📊 ${activity}`)
    }

    case "contest": {
      const week = currentWeekKey()
      const [entries, leader] = await Promise.all([
        prisma.contestEntry.count({ where: { week, user: activeAuthor() } }),
        prisma.contestEntry.findFirst({
          where: { week, user: activeAuthor() },
          orderBy: { votes: { _count: "desc" } },
          include: {
            user: { select: { name: true, profile: { select: { username: true } } } },
            _count: { select: { votes: true } },
          },
        }),
      ])
      const leaderText =
        leader && leader._count.votes > 0
          ? `Current leader: @${leader.user.profile?.username || leader.user.name} with ${leader._count.votes} vote${leader._count.votes === 1 ? "" : "s"}.`
          : "No leader yet — every entry needs votes!"
      return ok(
        `🏆 Photo contest (week ${week}): ${entries} entr${entries === 1 ? "y" : "ies"}. ${leaderText} Enter or vote at /contest`
      )
    }

    case "rules":
      return ok(
        [
          "📜 Community rules:",
          "1. 21+ only — no exceptions.",
          "2. Be respectful — no harassment, hate speech, or personal attacks.",
          "3. No buying, selling, or sourcing cannabis or anything else.",
          "4. No spam or unsolicited advertising.",
          "5. Don't dox anyone — pseudonyms stay pseudonymous.",
          "6. Staff decisions are final; report issues with /help moderation tools or the Report button.",
        ].join("\n")
      )

    case "flip": {
      const result = Math.random() < 0.5 ? "Heads" : "Tails"
      return ok(`🪙 @${ctx.displayName} flipped a coin — ${result}!`)
    }

    case "roll": {
      const sides = ctx.args[0] !== undefined ? parseInt(ctx.args[0], 10) : 6
      if (Number.isNaN(sides) || sides < 2 || sides > 1000) {
        return err("Usage: /roll [2-1000]")
      }
      const rolled = 1 + Math.floor(Math.random() * sides)
      return ok(`🎲 @${ctx.displayName} rolled a d${sides} — ${rolled}!`)
    }

    default:
      return err("Unknown command")
  }
}

// Dispatch a public, bot-handled command by canonical name. The caller must
// have already resolved metadata via getChatCommand() and confirmed
// permission + surface.
export async function runBotCommand(name: string, ctx: BotCommandCtx): Promise<BotCommandResult> {
  try {
    return await handle(name, ctx)
  } catch (e) {
    console.error(`[terpbot] command "${name}" failed:`, e)
    return err("Something went wrong running that command")
  }
}
