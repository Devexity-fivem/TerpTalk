// TerpBot command handlers — server-only module. Every data query a public
// bot command can run lives here so handlers stay reviewable and never touch
// prisma directly. All reads are public-class data per the permission
// contract in terpbot.ts: deleted:false, activeAuthor(), published guides,
// publicUserSelect — never DirectMessage, Report, SecurityEvent, Block,
// credentials, or staff-only tables.
import { prisma } from "@/lib/prisma"
import { activeAuthor, blockExistsBetween, blockedUserIds, notBlockedAuthor, containsExternalLink, LIMITS, USERNAME_REGEX, rankableProfile, REPUTATION_ORDER } from "@/lib/security"
import { extractThreadRef, type ThreadRef } from "@/lib/terpbot-context"
import { postDeepLink } from "@/lib/notify"
import { getNextTier, getTierProgress, getRepStage, getStageProgress, getTrustStanding, getNextTrustStanding } from "@/lib/reputation-config"
import { getQuestProgress } from "@/lib/quests"
import { nextLockedCosmetic } from "@/lib/cosmetics"
import { getGrowStreak } from "@/lib/grow-streak"
import { BADGE_RULES, getUserStats, getTrustScore } from "@/lib/reputation"
import { BADGE_REGISTRY, getBadgeByName } from "@/lib/badge-registry"
import { currentWeekKey } from "@/lib/week"
import { escapeLike, getStrainGrowStats } from "@/lib/strain-stats"
import { tokenizeSearchText } from "@/lib/search-terms"
import { diaryDay, diaryWeek } from "@/lib/diary-weeks"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { diaryPath, strainPath, setupPath } from "@/lib/slugs"
import { getGrowJourney } from "@/lib/grow-journey"
import { notify } from "@/lib/notify"
import { getBotUserId } from "@/lib/terpbot"
import { buildHelpText } from "@/lib/chat-commands"
import { buildGrowContext } from "@/lib/terpbot-intel-context"
import { evaluateContext, renderIntelLines } from "@/lib/terpbot-intel"
import { TERPBOT_USERNAME, randomGrowTip, sanitizeEcho as sanitizeEchoStrict } from "@/lib/terpbot"

export interface BotCommandCtx {
  userId: string
  role: string | null
  displayName: string
  args: string[]
  rest: string
  // Optional context the dispatcher already has in hand — lets
  // context-aware commands resolve "this thread" without extra lookups.
  roomId?: string
  rawContent?: string        // the full triggering message/command text
  replyToContent?: string    // content of the message being replied to
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

// DB-sourced fields echoed inside a bot message (strain genetics/breeder,
// thread/guide titles). User-authored values can smuggle markdown links or
// line breaks into a trusted-bot message — strip the markup characters.
function sanitizeField(s: string, max = 80): string {
  return s
    .replace(/[\r\n]+/g, " ")
    .replace(/[[\]()*`<>\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
}
// Two-pass public thread search shared by /thread and /about: exact
// phrase on title/tags first (search tier-1), then tokenized title match
// (similar-threads pattern). Visibility gate is identical to /search:
// deleted:false + category.hidden:false.
async function searchThreadsForBot(q: string, take = 3) {
  const base = { deleted: false, category: { hidden: false }, author: activeAuthor() }
  const select = { title: true, slug: true, replyCount: true, acceptedAnswerId: true, category: { select: { name: true } } } as const
  let threads = await prisma.thread.findMany({
    where: { ...base, OR: [{ title: { contains: q, mode: "insensitive" } }, { tags: { some: { tag: { name: { contains: q, mode: "insensitive" } } } } }] },
    take,
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
    select,
  })
  if (threads.length < take) {
    const words = tokenizeSearchText(q)
    if (words.length) {
      const more = await prisma.thread.findMany({
        where: { ...base, OR: words.map((w) => ({ title: { contains: w, mode: "insensitive" } })) },
        take: take * 2,
        orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
        select,
      })
      const seen = new Set(threads.map((t) => t.slug))
      threads = [...threads, ...more.filter((t) => !seen.has(t.slug))].slice(0, take)
    }
  }
  return threads.map((t) => ({ ...t, hasAcceptedAnswer: !!t.acceptedAnswerId }))
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
    select: { id: true, profile: { select: { username: true, reputation: true, publicMilestoneOptOut: true } } },
  })
  if (!target?.profile?.username) return null
  // Members who opted out of public recognition resolve the same as an
  // unknown name — the bot must not re-publish suppressed signals.
  if (target.profile.publicMilestoneOptOut && target.id !== requesterId) return null
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

// ── Thread-context resolution ───────────────────────────────────────
// Priority: explicit link in the command args → raw triggering message →
// the replied-to message → recent room history (30 min window, preferring
// the requester's own link). The room scan is bounded at 50 messages on
// the existing [roomId, createdAt] index.
async function resolveThreadRef(ctx: BotCommandCtx): Promise<ThreadRef | null> {
  for (const text of [ctx.rest, ctx.rawContent, ctx.replyToContent]) {
    const ref = text ? extractThreadRef(text) : null
    if (ref) return ref
  }
  if (!ctx.roomId) return null
  const recent = await prisma.chatMessage.findMany({
    where: {
      roomId: ctx.roomId,
      deleted: false,
      // A blocked author's link should not surface through bot output.
      ...notBlockedAuthor(await blockedUserIds(ctx.userId).catch(() => [])),
      createdAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      content: { contains: "/forum/thread/" },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { content: true, authorId: true },
  })
  const mine = recent.find((m) => m.authorId === ctx.userId)
  const pick = mine ?? recent[0]
  return pick ? extractThreadRef(pick.content) : null
}

interface LoadedPost {
  id: string
  content: string
  author: { name: string | null; profile: { username: string | null } | null }
  _count?: { reactions: number }
}

interface ThreadContext {
  id: string
  slug: string
  title: string
  content: string
  replyCount: number
  locked: boolean
  category: { name: string }
  authorName: string
  answer: { id: string; content: string; authorName: string } | null
  topReplies: LoadedPost[]
  recentReplies: LoadedPost[]
}

// Load a bounded thread snapshot for bot summaries. The visibility gate is
// absolute: deleted threads and hidden categories return the SAME null as
// a nonexistent slug, so the bot is never an existence oracle.
async function loadThreadContext(ref: ThreadRef): Promise<ThreadContext | null> {
  const t = await prisma.thread.findFirst({
    where: { slug: { equals: ref.slug, mode: "insensitive" }, deleted: false, category: { hidden: false }, author: activeAuthor() },
    select: {
      id: true, slug: true, title: true, content: true, replyCount: true, locked: true,
      category: { select: { name: true } },
      author: { select: { name: true, profile: { select: { username: true } } } },
      acceptedAnswer: {
        select: {
          id: true, content: true, deleted: true,
          author: { select: { name: true, banned: true, suspendedUntil: true, profile: { select: { username: true } } } },
        },
      },
    },
  })
  if (!t) return null

  const postSelect = {
    id: true, content: true,
    author: { select: { name: true, profile: { select: { username: true } } } },
    _count: { select: { reactions: true } },
  } as const

  const [topReplies, recentReplies] = await Promise.all([
    prisma.post.findMany({
      where: { threadId: t.id, deleted: false, author: activeAuthor() },
      orderBy: { reactions: { _count: "desc" } },
      take: 3,
      select: postSelect,
    }),
    prisma.post.findMany({
      where: { threadId: t.id, deleted: false, author: activeAuthor() },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: postSelect,
    }),
  ])

  const answerAuthorActive =
    !!t.acceptedAnswer &&
    !t.acceptedAnswer.author.banned &&
    (!t.acceptedAnswer.author.suspendedUntil || t.acceptedAnswer.author.suspendedUntil < new Date())
  const answer =
    t.acceptedAnswer && !t.acceptedAnswer.deleted && answerAuthorActive
      ? {
          id: t.acceptedAnswer.id,
          content: t.acceptedAnswer.content,
          authorName: t.acceptedAnswer.author.profile?.username ?? t.acceptedAnswer.author.name ?? "member",
        }
      : null

  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    content: t.content,
    replyCount: t.replyCount,
    locked: t.locked,
    category: t.category,
    authorName: t.author.profile?.username ?? t.author.name ?? "member",
    answer,
    topReplies,
    recentReplies,
  }
}

// Quoted excerpts are always capped, mention-stripped, and link-stripped —
// the bot is trusted to post links, so it must never re-broadcast a URL a
// low-trust member couldn't post themselves.
function sanitizeExcerpt(text: string, max = 160): string {
  const clean = text
    .replace(/@/g, "")
    .replace(/(?:https?:\/\/|www\.)\S*/gi, "")
    .replace(/\b[a-z0-9-]+\.[a-z]{2,}\b/gi, "")
    .replace(/[[\]()`\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  return clean.length > max ? `${clean.slice(0, max).trimEnd()}…` : clean
}

const NO_THREAD_HINT =
  "🤖 Which thread? Paste its link (like /forum/thread/…) or reply to a message containing it, then ask again."

const THREAD_NOT_FOUND = "I couldn't pull up that thread — the link may be old or the thread may have been removed."

const RARITY_ORDER = ["common", "rare", "epic", "legendary"]

// GrowDiary.stage values → display labels.
const STAGE_LABELS: Record<string, string> = {
  GERMINATION: "Germination",
  SEEDLING: "Seedling",
  VEGETATIVE: "Vegetative",
  FLOWER: "Flower",
  HARVEST: "Harvest",
  DRYING: "Drying",
  CURING: "Curing",
  COMPLETED: "Completed",
}
const stageLabel = (s: string) => STAGE_LABELS[s] ?? s.charAt(0) + s.slice(1).toLowerCase()

// The grow commands all need the requester's most relevant diary: the
// recently-touched active one first, otherwise the latest harvest. The
// select carries the newest update so "last update / readings" is free.
const GROW_DIARY_SELECT = {
  id: true, slug: true, title: true, stage: true, growType: true, strain: true, strainId: true,
  startDate: true, harvested: true, harvestedAt: true, yieldAmount: true, yieldUnit: true,
  updatedAt: true,
  strainRef: { select: { name: true } },
  setup: { select: { title: true } },
  _count: { select: { updates: true } },
  updates: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    select: {
      title: true, stage: true, createdAt: true,
      temperature: true, humidity: true, vpd: true, ph: true, ec: true,
      _count: { select: { images: true } },
    },
  },
} as const

type GrowDiaryRow = {
  id: string
  slug: string | null
  title: string
  stage: string
  growType: string
  strain: string | null
  strainRef: { name: string } | null
  startDate: Date
  harvested: boolean
  harvestedAt: Date | null
  yieldAmount: number | null
  yieldUnit: string | null
  updatedAt: Date
  setup: { title: string } | null
  _count: { updates: number }
  updates: {
    title: string
    stage: string
    createdAt: Date
    temperature: number | null
    humidity: number | null
    vpd: number | null
    ph: number | null
    ec: number | null
    _count: { images: number }
  }[]
}

// publicOnly: room-posted command output only ever reflects PUBLIC diaries —
// a caller asking the bot about their own UNLISTED/PRIVATE grow in a public
// room must not get its title/stage/readings echoed to everyone. Private
// channels (e.g. /mydigest's notification) pass publicOnly: false.
async function primaryGrow(userId: string, { publicOnly = false } = {}): Promise<GrowDiaryRow | null> {
  const scope = publicOnly ? publicDiaryWhere : {}
  return (
    (await prisma.growDiary.findFirst({
      where: { authorId: userId, deleted: false, harvested: false, ...scope },
      orderBy: { updatedAt: "desc" },
      select: GROW_DIARY_SELECT,
    })) ??
    (await prisma.growDiary.findFirst({
      where: { authorId: userId, deleted: false, ...scope },
      orderBy: { harvestedAt: "desc" },
      select: GROW_DIARY_SELECT,
    }))
  )
}

// "2 days ago" style relative age — bounded grammar, deterministic.
function relAge(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return "today"
  if (days === 1) return "yesterday"
  if (days < 30) return `${days} days ago`
  return d.toISOString().slice(0, 10)
}

function envReadingsLine(u: GrowDiaryRow["updates"][number]): string | null {
  const parts: string[] = []
  if (u.temperature != null) parts.push(`${u.temperature}°`)
  if (u.humidity != null) parts.push(`${u.humidity}% RH`)
  if (u.vpd != null) parts.push(`VPD ${u.vpd}`)
  if (u.ph != null) parts.push(`pH ${u.ph}`)
  if (u.ec != null) parts.push(`EC ${u.ec}`)
  return parts.length ? parts.join(" · ") : null
}

async function handle(name: string, ctx: BotCommandCtx): Promise<BotCommandResult> {
  switch (name) {
    case "help":
      return ok(buildHelpText(ctx.role, ctx.args[0]))

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
        where: rankableProfile(),
        orderBy: REPUTATION_ORDER,
        take: 5,
        select: { username: true, reputation: true },
      })
      const lines = top.map((p, i) => `${i + 1}. @${p.username} — ${p.reputation} rep`)
      return ok(`🏆 Top growers:\n${lines.join("\n")}\nFull board: /leaderboard`)
    }

    case "rep": {
      const t = await memberFor(ctx, ctx.args[0])
      if (!t) return ok(`Couldn't find that member.`)
      const stage = getRepStage(t.reputation)
      const next = getNextTier(t.reputation)
      const nextText = next ? ` Next: ${next.name} at ${next.threshold.toLocaleString()} rep (${(next.threshold - t.reputation).toLocaleString()} to go).` : " Top tier reached!"
      const trust = await getTrustScore(t.userId)
      const standing = getTrustStanding(trust)
      const nextStanding = getNextTrustStanding(trust)
      const standingText = nextStanding
        ? ` Standing: ${standing.icon} ${standing.name} (${nextStanding.name} at ${nextStanding.min.toLocaleString()} trust).`
        : ` Standing: ${standing.icon} ${standing.name} — the highest.`
      return ok(`📈 @${t.username} — ${t.reputation.toLocaleString()} rep · Grow Level ${stage.level} (${stage.stageName}) · ${stage.tier.name} tier.${nextText}${standingText} /u/${t.username}`)
    }

    case "quests": {
      const quests = await getQuestProgress(ctx.userId)
      if (!quests.length) return ok(`⚡ No quests today — check back tomorrow. /progress`)
      const lines = quests.map((q) => {
        const state = q.paid ? "✓ paid" : q.done ? "✓ done" : `${q.progress}/${q.target}`
        return `${q.icon} ${q.title} — ${q.description} (${state}, +${q.reward} rep)`
      })
      const done = quests.filter((q) => q.done || q.paid).length
      const perfect = done === quests.length ? "\nAll done today — perfect-day bonus earned!" : ""
      return ok(`⚡ @${ctx.displayName}'s quests today (${done}/${quests.length}):\n${lines.join("\n")}${perfect}\n/progress`)
    }

    case "progress": {
      const t = await memberFor(ctx, ctx.args[0])
      if (!t) return ok(`Couldn't find that member.`)
      const stage = getRepStage(t.reputation)
      const stageProg = getStageProgress(t.reputation)
      const unlock = nextLockedCosmetic(t.reputation)
      const next = getNextTier(t.reputation)
      // One unified progression view — rep, tier, trust, streak and today's
      // quests composed from the same libs the /progress page uses.
      const [trust, quests, streak] = await Promise.all([
        getTrustScore(t.userId),
        t.userId === ctx.userId ? getQuestProgress(ctx.userId) : Promise.resolve([]),
        getGrowStreak(t.userId, { publicOnly: true }),
      ])
      const standing = getTrustStanding(trust)
      const lines = [
        `📈 @${t.username} — ${t.reputation.toLocaleString()} rep · Grow Level ${stage.level} (${stage.stageName}) · ${stage.tier.name} tier`,
        `Trust: ${standing.icon} ${standing.name}${streak.streak > 0 ? ` · Streak: 🔥 ${streak.streak} days` : ""}`,
        stageProg.remaining > 0
          ? `Stage: ${stageProg.remaining.toLocaleString()} rep to level ${stage.level + 1} (${stageProg.percent}% through)`
          : `Stage: ${stage.stageName} — highest level reached`,
      ]
      if (quests.length) {
        const questLines = quests.map((q) => {
          const state = q.paid || q.done ? "✓" : `${q.progress}/${q.target}`
          return `${state === "✓" ? "✓" : state} ${q.title}`
        })
        lines.push(`Today's quests: ${questLines.join(" · ")}`)
      }
      const nexts: string[] = []
      if (next) {
        const prog = getTierProgress(t.reputation)
        nexts.push(`+${(next.threshold - t.reputation).toLocaleString()} rep → ${next.name} (${prog.percent}%)`)
      }
      if (unlock) nexts.push(`${unlock.name} at ${unlock.unlockedAt.toLocaleString()} rep`)
      if (nexts.length) lines.push(`Next: ${nexts.join(" · ")}`)
      lines.push(`/progress`)
      return ok(lines.join("\n"))
    }

    case "rank": {
      const t = await memberFor(ctx, ctx.args[0])
      if (!t) return ok(`Couldn't find that member.`)
      const [above, total] = await Promise.all([
        prisma.profile.count({
          where: { reputation: { gt: t.reputation }, ...rankableProfile() },
        }),
        prisma.profile.count({ where: rankableProfile() }),
      ])
      return ok(`🏆 @${t.username} is #${above + 1} of ${total} members by reputation. Board: /leaderboard`)
    }

    case "streak": {
      const t = await memberFor(ctx, ctx.args[0])
      if (!t) return ok(`Couldn't find that member.`)
      // Room output is public either way — the streak always reflects
      // public diaries only, even when the caller asks about themselves.
      const s = await getGrowStreak(t.userId, { publicOnly: true })
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
      const mine = await prisma.userBadge.findFirst({ where: { userId: ctx.userId, badge: { name } }, select: { earnedAt: true } })
      // Hidden badges are undiscoverable — the bot answers as if they
      // don't exist unless the requester has already earned one.
      if (def?.hidden && !mine) return ok(`No badge called that — browse the list on your profile or /nextbadges.`)
      const holders = await prisma.userBadge.count({ where: { badge: { name } } })
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
      const unearned = BADGE_REGISTRY.filter((d) => !d.hidden && !earned.has(d.name) && BADGE_RULES[d.name] && !BADGE_RULES[d.name](stats))
      if (!unearned.length) return ok(`🏅 @${ctx.displayName} has earned every rule-based badge — impressive!`)
      unearned.sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity))
      const lines = unearned.slice(0, 5).map((d) => `• ${d.name} (${d.rarity}) — ${d.requirement}`)
      return ok(`🏅 Next badges for @${ctx.displayName}:\n${lines.join("\n")}`)
    }

    case "diary": {
      const t = await memberFor(ctx, ctx.args[0])
      if (!t) return ok(`Couldn't find that member.`)
      const diarySelect = {
        id: true, slug: true, title: true, stage: true, strain: true, startDate: true,
        harvested: true, yieldAmount: true, yieldUnit: true, _count: { select: { updates: true } },
      } as const
      // Only PUBLIC grows are fair game — the reply posts into a public
      // room, so even the owner's own UNLISTED/PRIVATE diaries stay out.
      const diaryScope = publicDiaryWhere
      const diary =
        (await prisma.growDiary.findFirst({
          where: { authorId: t.userId, deleted: false, harvested: false, ...diaryScope },
          orderBy: { updatedAt: "desc" },
          select: diarySelect,
        })) ??
        (await prisma.growDiary.findFirst({
          where: { authorId: t.userId, deleted: false, ...diaryScope },
          orderBy: { harvestedAt: "desc" },
          select: diarySelect,
        }))
      if (!diary) {
        return ok(
          t.userId === ctx.userId
            ? `You don't have a public grow diary — unlisted/private grows stay out of the room. Start a public one at /diaries/new`
            : `@${t.username} doesn't have a public grow diary.`
        )
      }
      const day = diaryDay(diary.startDate, new Date())
      const yieldText = diary.yieldAmount != null ? ` · harvested ${diary.yieldAmount}${diary.yieldUnit ?? "g"}` : ""
      return ok(
        `📔 @${t.username}'s diary "${sanitizeField(diary.title)}"${diary.strain ? ` (${sanitizeField(diary.strain)})` : ""}\n` +
          `Stage: ${diary.stage} · Day ${day} · ${diary._count.updates} update${diary._count.updates === 1 ? "" : "s"}${yieldText}\n` +
          diaryPath(diary)
      )
    }

    case "grow": {
      const diary = await primaryGrow(ctx.userId, { publicOnly: true })
      if (!diary) {
        return ok(`🌱 You don't have a grow diary yet — start one at /diaries/new and I'll track your grow here.`)
      }
      const day = diaryDay(diary.startDate, new Date())
      const week = diaryWeek(diary.startDate, new Date())
      const strainName = diary.strainRef?.name ?? diary.strain
      const latest = diary.updates[0]
      const [journey, streak] = await Promise.all([
        getGrowJourney(diary.id),
        getGrowStreak(ctx.userId, { publicOnly: true }),
      ])
      const lines = [`🌱 ${sanitizeField(diary.title)}${strainName ? ` — ${sanitizeField(strainName)}` : ""}`]
      if (diary.harvested) {
        const yieldText = diary.yieldAmount != null ? ` · ${diary.yieldAmount}${diary.yieldUnit ?? "g"}` : ""
        lines.push(`Status: harvested${diary.harvestedAt ? ` ${diary.harvestedAt.toISOString().slice(0, 10)}` : ""}${yieldText}`)
        lines.push(`No active grow right now — start a new diary at /diaries/new`)
        lines.push(diaryPath(diary))
        return ok(lines.join("\n"))
      }
      const head = [
        `Stage: ${stageLabel(diary.stage)}`,
        `Week ${week} · Day ${day}`,
        `${diary.growType.charAt(0)}${diary.growType.slice(1).toLowerCase()} grow`,
      ]
      lines.push(head.join(" · "))
      lines.push(`Started ${diary.startDate.toISOString().slice(0, 10)} · ${diary._count.updates} update${diary._count.updates === 1 ? "" : "s"}`)
      if (latest) {
        const env = envReadingsLine(latest)
        lines.push(`Last update: "${sanitizeField(latest.title, 50)}" — ${relAge(latest.createdAt)}${env ? `\nLast readings: ${env}` : ""}`)
      } else {
        lines.push(`No updates logged yet`)
      }
      if (streak.streak > 0) lines.push(`Update streak: 🔥 ${streak.streak} days`)
      if (diary.setup) lines.push(`Setup: ${sanitizeField(diary.setup.title, 40)}`)
      if (journey?.next) lines.push(`Next milestone: ${journey.next.icon} ${journey.next.name} — ${journey.next.summary}`)
      lines.push(`Open diary → ${diaryPath(diary)}`)
      return ok(lines.join("\n"))
    }

    case "grows": {
      const diaries = await prisma.growDiary.findMany({
        where: { authorId: ctx.userId, deleted: false, harvested: false, ...publicDiaryWhere },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { id: true, title: true, stage: true, strain: true, strainRef: { select: { name: true } }, startDate: true },
      })
      if (!diaries.length) {
        const harvested = await prisma.growDiary.count({ where: { authorId: ctx.userId, deleted: false, harvested: true, ...publicDiaryWhere } })
        return ok(
          harvested > 0
            ? `🌱 No active grows — you've harvested ${harvested} diar${harvested === 1 ? "y" : "ies"}. Start a new run at /diaries/new`
            : `🌱 No grow diaries yet — start your first at /diaries/new`
        )
      }
      const lines = diaries.map((d, i) => {
        const strainName = d.strainRef?.name ?? d.strain
        return `${i + 1}. ${sanitizeField(d.title, 40)}${strainName ? ` (${sanitizeField(strainName, 30)})` : ""} — ${stageLabel(d.stage)} W${diaryWeek(d.startDate, new Date())}`
      })
      return ok(`🌱 @${ctx.displayName}'s grows:\n${lines.join("\n")}\n/diaries`)
    }

    case "checkin": {
      const diaries = await prisma.growDiary.findMany({
        where: { authorId: ctx.userId, deleted: false, harvested: false, ...publicDiaryWhere },
        orderBy: { updatedAt: "desc" },
        take: 3,
        select: { id: true, slug: true, title: true, stage: true, updatedAt: true },
      })
      if (!diaries.length) {
        return ok(`🌱 No active grows to check in on — start a diary at /diaries/new`)
      }
      // Rule engine over real diary fields — recency, photos, env coverage.
      // Never diagnoses the plant; it only evaluates diary freshness.
      const weekAgo = new Date(Date.now() - 7 * 86400000)
      const blocks: string[] = []
      for (const [diaryIndex, d] of diaries.entries()) {
        const [latest, envThisWeek, meaningfulThisWeek] = await Promise.all([
          prisma.diaryUpdate.findFirst({
            where: { diaryId: d.id },
            orderBy: { createdAt: "desc" },
            select: {
              createdAt: true,
              temperature: true, humidity: true, vpd: true, ph: true, ec: true,
              _count: { select: { images: true } },
            },
          }),
          prisma.diaryUpdate.count({
            where: {
              diaryId: d.id,
              createdAt: { gte: weekAgo },
              OR: [
                { temperature: { not: null } },
                { humidity: { not: null } },
                { vpd: { not: null } },
                { ph: { not: null } },
                { ec: { not: null } },
              ],
            },
          }),
          prisma.diaryUpdate.count({ where: { diaryId: d.id, createdAt: { gte: weekAgo } } }),
        ])
        const checks: string[] = []
        if (!latest) {
          checks.push(`⚠ No updates logged yet`)
        } else {
          const age = Math.floor((Date.now() - latest.createdAt.getTime()) / 86400000)
          checks.push(age <= 3 ? `✓ Updated ${relAge(latest.createdAt)}` : `⚠ Last update ${relAge(latest.createdAt)}`)
          if (latest._count.images > 0) checks.push(`✓ Photo in latest update`)
          else checks.push(`⚠ No photo in latest update`)
          if (envThisWeek > 0) checks.push(`✓ Environment logged this week`)
          else checks.push(`⚠ No pH/EC/temp/RH recorded this week`)
        }
        const next =
          !latest || meaningfulThisWeek === 0
            ? `Next useful action: add this week's update → ${diaryPath(d)}`
            : latest._count.images === 0 || envThisWeek === 0
              ? `Next useful action: add photos or env readings to your next update → ${diaryPath(d)}`
              : `On track — keep the weekly cadence → ${diaryPath(d)}`
        // Intelligence slice (primary diary only — keeps the block inside
        // the chat message cap). Same PUBLIC scope as the diary list above:
        // this output posts to a room, so private diary data never enters.
        let intel: string[] = []
        if (diaryIndex === 0) {
          const gctx = await buildGrowContext(d.id, { ownerId: ctx.userId, scope: "public" })
          if (gctx) intel = renderIntelLines(gctx, evaluateContext(gctx))
        }
        blocks.push(
          `${sanitizeField(d.title, 40)} (${stageLabel(d.stage)}):\n${[...checks, ...intel, next].join("\n")}`
        )
      }
      return ok(`🌱 Grow check-in\n\n${blocks.join("\n\n")}`)
    }

    case "growhelp": {
      const diary = await primaryGrow(ctx.userId, { publicOnly: true })
      if (!diary || diary.harvested) {
        return ok(`🌱 No active grow to match discussions to — start a diary at /diaries/new`)
      }
      const strainName = diary.strainRef?.name ?? diary.strain
      const latest = diary.updates[0]
      const env = latest ? envReadingsLine(latest) : null
      const lines = [
        `🌱 Your ${sanitizeField(diary.title, 40)} is in ${stageLabel(diary.stage)} W${diaryWeek(diary.startDate, new Date())}${strainName ? ` (${sanitizeField(strainName, 30)})` : ""}.`,
      ]
      if (env) lines.push(`You recently logged: ${env}`)
      // Deterministic topic: stage + strain tokens searched against real
      // public thread titles. No plant diagnosis — just knowledge routing.
      const terms = [stageLabel(diary.stage).toLowerCase(), strainName?.toLowerCase()].filter(Boolean) as string[]
      const seen = new Set<string>()
      const threads: Awaited<ReturnType<typeof searchThreadsForBot>> = []
      for (const t of terms) {
        for (const hit of await searchThreadsForBot(escapeLike(t), 3)) {
          if (seen.has(hit.slug) || threads.length >= 3) continue
          seen.add(hit.slug)
          threads.push(hit)
        }
      }
      if (threads.length) {
        lines.push(`Related TerpTalk discussions:`)
        for (const t of threads) {
          lines.push(`• ${sanitizeField(t.title)} → /forum/thread/${t.slug} (${t.replyCount} replies)`)
        }
      } else {
        lines.push(`No related discussions yet — asking in /forum with your stage + readings usually gets answers.`)
      }
      lines.push(`Open diary → ${diaryPath(diary)}`)
      return ok(lines.join("\n"))
    }

    case "milestones": {
      const [profile, quests, streak, earnedRows, stats, diary] = await Promise.all([
        prisma.profile.findUnique({ where: { userId: ctx.userId }, select: { reputation: true } }),
        getQuestProgress(ctx.userId),
        getGrowStreak(ctx.userId, { publicOnly: true }),
        prisma.userBadge.findMany({ where: { userId: ctx.userId }, select: { badge: { select: { name: true } } } }),
        getUserStats(ctx.userId),
        primaryGrow(ctx.userId, { publicOnly: true }),
      ])
      const rep = profile?.reputation ?? 0
      const stage = getRepStage(rep)
      const nextTier = getNextTier(rep)
      const unlock = nextLockedCosmetic(rep)
      const earned = new Set(earnedRows.map((r) => r.badge.name))
      const nextBadge = BADGE_REGISTRY
        .filter((d) => !d.hidden && !earned.has(d.name) && BADGE_RULES[d.name] && !BADGE_RULES[d.name](stats))
        .sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity))[0]
      const journey = diary && !diary.harvested ? await getGrowJourney(diary.id) : null
      const questLeft = quests.filter((q) => !q.done && !q.paid)

      const lines = [`🎯 What's next for @${ctx.displayName}:`]
      if (nextTier) lines.push(`${nextTier.icon} ${nextTier.name} tier — ${(nextTier.threshold - rep).toLocaleString()} rep to go`)
      else lines.push(`${stage.tier.icon} ${stage.tier.name} — top tier reached`)
      if (journey?.next) lines.push(`${journey.next.icon} ${journey.next.name} (grow) — ${journey.next.summary}`)
      if (nextBadge) lines.push(`🏅 "${nextBadge.name}" badge — ${nextBadge.requirement}`)
      if (unlock) lines.push(`🎨 ${unlock.name} — unlocks at ${unlock.unlockedAt.toLocaleString()} rep`)
      if (questLeft.length) lines.push(`⚡ ${questLeft.length} quest${questLeft.length === 1 ? "" : "s"} left today (+${questLeft.reduce((n, q) => n + q.reward, 0)} rep)`)
      if (streak.streak > 0) lines.push(`🔥 ${streak.streak}-day update streak — keep it alive`)
      if (lines.length === 1) lines.push(`Post a reply or update your diary to start earning.`)
      lines.push(`/progress`)
      return ok(lines.join("\n"))
    }

    case "thread": {
      if (!ctx.rest) return err("Usage: /thread <search>")
      if (hasLink(ctx.rest)) return ok(`I can't look that up — keywords only, no links.`)
      const q = escapeLike(sanitizeEcho(ctx.rest))
      const threads = await searchThreadsForBot(q, 3)
      if (!threads.length) {
        return ok(`No threads matching that — try broader keywords or browse /forum`)
      }
      const lines = threads.map((t) => `- ${sanitizeField(t.title)} → /forum/thread/${t.slug} (${t.replyCount} replies)`)
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
      const stats = await getStrainGrowStats(strain.name, strain.id)
      const statsLine = stats.growCount > 0 ? `📊 ${stats.label}` : null
      return ok(
        [
          `🌿 ${sanitizeField(strain.name)}${strain.type ? ` (${sanitizeField(strain.type, 20)})` : ""}`,
          strain.genetics ? `Genetics: ${sanitizeField(strain.genetics)}` : null,
          strain.breeder ? `Breeder: ${sanitizeField(strain.breeder)}` : null,
          statsLine,
          `Details: ${strainPath(strain)}`,
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
      return ok(`📚 Guides matching "${sanitizeEcho(ctx.rest)}":\n${guides.map((g) => `- ${sanitizeField(g.title)} → /guides/${g.slug}`).join("\n")}`)
    }

    case "ask": {
      if (!ctx.rest) return err("Usage: /ask <question>")
      if (hasLink(ctx.rest)) return ok(`I can't look that up — keywords only, no links.`)
      const q = escapeLike(sanitizeEcho(ctx.rest))
      // Deterministic front door: exact-ish guide match → strain → threads
      // (answered threads first — accepted answers are the best knowledge).
      const [guides, strains, threads] = await Promise.all([
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
          select: { id: true, slug: true, name: true },
        }),
        searchThreadsForBot(q, 3),
      ])
      const answeredFirst = [...threads].sort(
        (a, b) => Number(b.hasAcceptedAnswer) - Number(a.hasAcceptedAnswer)
      ).slice(0, 2)
      const lines = [
        ...guides.map((g) => `📚 ${sanitizeField(g.title)} → /guides/${g.slug}`),
        ...strains.map((s) => `🌿 ${sanitizeField(s.name)} → ${strainPath(s)}`),
        ...answeredFirst.map(
          (t) => `💬 ${sanitizeField(t.title)}${t.hasAcceptedAnswer ? " ✅" : ""} → /forum/thread/${t.slug}`
        ),
      ]
      if (!lines.length) {
        return ok(
          `🤖 I couldn't find a strong match in TerpTalk.\n` +
            `Try:\n- /thread ${sanitizeField(ctx.rest, 40)}\n- /guide ${sanitizeField(ctx.rest, 40)}\n- /strain <name>`
        )
      }
      return ok(`Here's what I found:\n${lines.join("\n")}\nFor anything else, try /help`)
    }

    case "related": {
      if (!ctx.rest) return err("Usage: /related <topic>")
      if (hasLink(ctx.rest)) return ok(`I can't look that up — keywords only, no links.`)
      const q = escapeLike(sanitizeEcho(ctx.rest))
      const [threads, guides, strain] = await Promise.all([
        searchThreadsForBot(q, 3),
        prisma.guide.findMany({
          where: {
            published: true,
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { excerpt: { contains: q, mode: "insensitive" } },
              { topic: { contains: q, mode: "insensitive" } },
            ],
          },
          take: 2,
          orderBy: { title: "asc" },
          select: { title: true, slug: true },
        }),
        prisma.strain.findFirst({
          where: { name: { contains: q, mode: "insensitive" } },
          orderBy: { name: "asc" },
          select: { id: true, slug: true, name: true },
        }),
      ])
      if (!threads.length && !guides.length && !strain) {
        return ok(`🤖 I couldn't find a strong match in TerpTalk for "${sanitizeField(ctx.rest, 40)}" — try broader keywords or /search`)
      }
      const lines = [`🔎 Related to "${sanitizeField(ctx.rest, 40)}":`]
      for (const t of threads) {
        lines.push(`💬 ${sanitizeField(t.title)}${t.hasAcceptedAnswer ? " ✅" : ""} → /forum/thread/${t.slug}`)
      }
      for (const g of guides) {
        lines.push(`📚 ${sanitizeField(g.title)} → /guides/${g.slug}`)
      }
      if (strain) lines.push(`🌿 ${sanitizeField(strain.name)} → ${strainPath(strain)}`)
      return ok(lines.join("\n"))
    }

    case "setup": {
      const raw = ctx.rest.trim()
      if (hasLink(raw)) return ok(`I can't look that up — setup names and equipment only, no links.`)

      // Public setup surface mirrors /setups: deleted excluded, active
      // authors only, and the viewer's blocked users filtered out.
      const SETUP_SELECT = {
        id: true,
        slug: true,
        title: true,
        authorId: true,
        space: true,
        tent: true,
        lighting: true,
        medium: true,
        equipment: true,
        strain: true,
        author: { select: { name: true, profile: { select: { username: true } } } },
      } as const

      const renderSetup = (s: {
        slug: string | null
        id: string
        title: string
        space: string | null
        tent: string | null
        lighting: string | null
        medium: string | null
        equipment: string | null
        strain: string | null
        author: { name: string | null; profile: { username: string | null } | null }
      }) => {
        // strict echo on stored user fields — strips URLs/domains/@ as well
        // as markup, so a spec field can't smuggle a link into bot output.
        const specs = [s.tent || s.space, s.lighting, s.medium, s.equipment]
          .filter((v): v is string => !!v)
          .map((v) => sanitizeEchoStrict(v, 30))
          .filter(Boolean)
          .slice(0, 3)
        const owner = s.author.profile?.username || s.author.name || "member"
        return `- ${sanitizeEchoStrict(s.title, 50)}${specs.length ? ` (${specs.join(" · ")})` : ""} by @${sanitizeEchoStrict(owner, 30)} → ${setupPath(s)}`
      }

      // "/setup @user" (and "my setup" → args ["me"]) — a member's setups.
      // resolveMember applies the banned/opted-out/mutual-block gates, so a
      // gated member resolves the same as an unknown name.
      const selfLookup = raw === "me"
      const ownerMatch = selfLookup ? null : raw.match(/^@([A-Za-z0-9_]{3,20})\b/)
      if (selfLookup || ownerMatch) {
        let targetId = ctx.userId
        let username: string | null = null
        if (ownerMatch) {
          const t = await resolveMember(`@${ownerMatch[1]}`, ctx.userId)
          if (!t) return ok(`Couldn't find that member — or they've opted out of bot lookups.`)
          if (t !== "self") {
            targetId = t.userId
            username = t.username
          }
        }
        const setups = await prisma.growSetup.findMany({
          where: { deleted: false, authorId: targetId },
          orderBy: { createdAt: "desc" },
          take: 3,
          select: SETUP_SELECT,
        })
        if (!setups.length) {
          return ok(
            username
              ? `@${username} hasn't shared a setup yet — browse /setups`
              : `You haven't shared a setup yet — post one at /setups/new`
          )
        }
        return ok(`🛠 ${username ? `@${username}'s` : "Your"} setup${setups.length > 1 ? "s" : ""}:\n${setups.map(renderSetup).join("\n")}`)
      }

      const blocked = new Set(await blockedUserIds(ctx.userId))
      const base = { deleted: false, author: activeAuthor() }

      if (!raw) {
        const setups = (await prisma.growSetup.findMany({
          where: base,
          orderBy: { createdAt: "desc" },
          take: 6, // fetch extra — blocked authors drop out below
          select: SETUP_SELECT,
        })).filter((s) => !blocked.has(s.authorId)).slice(0, 3)
        if (!setups.length) return ok(`No setups shared yet — be the first at /setups/new`)
        return ok(`🛠 Newest grow setups:\n${setups.map(renderSetup).join("\n")}\nBrowse all: /setups`)
      }

      const q = escapeLike(sanitizeEcho(raw))
      const needle = { contains: q, mode: "insensitive" as const }
      const setups = (await prisma.growSetup.findMany({
        where: {
          ...base,
          OR: [
            { title: needle },
            { space: needle },
            { tent: needle },
            { lighting: needle },
            { ventilation: needle },
            { fans: needle },
            { containers: needle },
            { medium: needle },
            { nutrients: needle },
            { controllers: needle },
            { equipment: needle },
            { strain: needle },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: SETUP_SELECT,
      })).filter((s) => !blocked.has(s.authorId)).slice(0, 3)
      if (!setups.length) {
        return ok(`No setups matching "${sanitizeEcho(raw)}" — browse /setups`)
      }
      return ok(`🛠 Setups matching "${sanitizeEcho(raw)}":\n${setups.map(renderSetup).join("\n")}\nBrowse all: /setups`)
    }

    case "online": {
      const since = new Date(Date.now() - 15 * 60 * 1000)
      // hideOnlineStatus members are excluded — their lastSeenAt still
      // updates (throttling) but they never appear in presence lists.
      const presenceWhere = {
        lastSeenAt: { gte: since },
        ...activeAuthor(),
        AND: [
          { profile: { isNot: { username: TERPBOT_USERNAME } } },
          { OR: [{ profile: { hideOnlineStatus: false } }, { profile: null }] },
        ],
      }
      const users = await prisma.user.findMany({
        where: presenceWhere,
        orderBy: { lastSeenAt: "desc" },
        take: 6,
        select: { profile: { select: { username: true } } },
      })
      const names = users.map((u) => u.profile?.username).filter(Boolean) as string[]
      const count = await prisma.user.count({ where: presenceWhere })
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

    case "hot": {
      const since = new Date(Date.now() - 7 * 86400000)
      const threads = await prisma.thread.findMany({
        where: { deleted: false, createdAt: { gte: since }, category: { hidden: false }, author: activeAuthor() },
        orderBy: [{ replyCount: "desc" }, { views: "desc" }],
        take: 5,
        select: { title: true, slug: true, replyCount: true, views: true },
      })
      if (!threads.length) return ok(`🔥 Quiet week so far — start a discussion at /forum`)
      const lines = threads.map(
        (t) => `• ${sanitizeField(t.title)} → /forum/thread/${t.slug} (${t.replyCount} replies · ${t.views} views)`
      )
      return ok(`🔥 Trending this week:\n${lines.join("\n")}`)
    }

    case "new": {
      const threads = await prisma.thread.findMany({
        where: { deleted: false, category: { hidden: false }, author: activeAuthor() },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { title: true, slug: true, createdAt: true, category: { select: { name: true } } },
      })
      if (!threads.length) return ok(`No public discussions yet — start one at /forum/new`)
      const lines = threads.map(
        (t) => `• ${sanitizeField(t.title)} (${t.category.name}) → /forum/thread/${t.slug}`
      )
      return ok(`🆕 Newest discussions:\n${lines.join("\n")}`)
    }

    case "unanswered": {
      // Threads still waiting for their first reply — bounded to the last
      // 30 days so this doesn't resurrect ancient abandoned posts.
      const threads = await prisma.thread.findMany({
        where: {
          deleted: false, locked: false, replyCount: 0,
          createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
          category: { hidden: false },
          author: activeAuthor(),
        },
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { title: true, slug: true, createdAt: true, category: { select: { name: true } } },
      })
      if (!threads.length) return ok(`✅ Every recent thread has replies — the community's on top of it.`)
      const lines = threads.map(
        (t) => `• ${sanitizeField(t.title)} (${t.category.name}, ${relAge(t.createdAt)}) → /forum/thread/${t.slug}`
      )
      return ok(`🙋 Still looking for a first reply:\n${lines.join("\n")}\nAnswering one earns rep — and a possible +30 accepted-answer bonus.`)
    }

    case "active": {
      const hourAgo = new Date(Date.now() - 60 * 60 * 1000)
      const [posts, updates, members, msgs] = await Promise.all([
        prisma.post.count({ where: { createdAt: { gte: hourAgo }, deleted: false, thread: { deleted: false, category: { hidden: false } } } }),
        prisma.diaryUpdate.count({ where: { createdAt: { gte: hourAgo }, diary: { deleted: false } } }),
        prisma.user.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }, ...activeAuthor() } }),
        prisma.chatMessage.count({ where: { createdAt: { gte: hourAgo }, deleted: false, room: { isPrivate: false } } }),
      ])
      if (!posts && !updates && !msgs) {
        return ok(`👀 Quiet hour — ${members} member${members === 1 ? "" : "s"} around. Start a thread or update your diary to get things going.`)
      }
      return ok(
        `📈 Last hour: ${posts} forum repl${posts === 1 ? "y" : "ies"} · ${updates} diary update${updates === 1 ? "" : "s"} · ${msgs} chat message${msgs === 1 ? "" : "s"} · ${members} online now`
      )
    }

    case "weekly": {
      const since = new Date(Date.now() - 7 * 86400000)
      const [members, threads, posts, updates, diaries, entries] = await Promise.all([
        prisma.user.count({ where: { createdAt: { gte: since }, banned: false } }),
        prisma.thread.count({ where: { createdAt: { gte: since }, deleted: false, category: { hidden: false } } }),
        prisma.post.count({ where: { createdAt: { gte: since }, deleted: false, thread: { deleted: false, category: { hidden: false } } } }),
        prisma.diaryUpdate.count({ where: { createdAt: { gte: since }, diary: { deleted: false } } }),
        prisma.growDiary.count({ where: { createdAt: { gte: since }, deleted: false } }),
        prisma.contestEntry.count({ where: { week: currentWeekKey(), user: activeAuthor() } }),
      ])
      const total = members + threads + posts + updates + diaries
      const summary = total > 0
        ? `This week: ${members} new member${members === 1 ? "" : "s"} · ${threads} thread${threads === 1 ? "" : "s"} · ${posts} repl${posts === 1 ? "y" : "ies"} · ${diaries} new diar${diaries === 1 ? "y" : "ies"} · ${updates} diary update${updates === 1 ? "" : "s"}`
        : `Quiet week so far — start a thread or update your diary to get things going.`
      return ok(`📅 ${summary}\nContest entries this week: ${entries} — /contest`)
    }

    case "mydigest": {
      // Personal digest — private by contract. Delivered as a BOT_ASSIST
      // notification (respects notifyOnBotAssist), never posted to the room.
      const [unreadNotifs, quests, streak, diary, followedUnread] = await Promise.all([
        prisma.notification.count({ where: { userId: ctx.userId, read: false } }),
        getQuestProgress(ctx.userId),
        getGrowStreak(ctx.userId),
        primaryGrow(ctx.userId),
        prisma.threadFollow.count({
          where: {
            userId: ctx.userId,
            thread: { deleted: false, category: { hidden: false } },
          },
        }),
      ])
      const parts: string[] = []
      const questLeft = quests.filter((q) => !q.done && !q.paid)
      if (unreadNotifs) parts.push(`${unreadNotifs} unread notification${unreadNotifs === 1 ? "" : "s"}`)
      if (questLeft.length) parts.push(`${questLeft.length} quest${questLeft.length === 1 ? "" : "s"} left today (+${questLeft.reduce((n, q) => n + q.reward, 0)} rep)`)
      if (streak.streak > 0) parts.push(`🔥 ${streak.streak}-day update streak`)
      if (diary && !diary.harvested) {
        const age = Math.floor((Date.now() - diary.updatedAt.getTime()) / 86400000)
        if (age >= 3) parts.push(`⚠ "${sanitizeField(diary.title, 40)}" hasn't been updated in ${age} days`)
        else parts.push(`"${sanitizeField(diary.title, 40)}" is current (${stageLabel(diary.stage)})`)
      }
      if (followedUnread) parts.push(`${followedUnread} followed thread${followedUnread === 1 ? "" : "s"}`)
      const content = parts.length
        ? parts.join("\n")
        : `All quiet — post a reply or update your diary to start earning rep.`
      const botId = await getBotUserId()
      const n = await notify({
        userId: ctx.userId,
        type: "BOT_ASSIST",
        title: "Your TerpTalk digest",
        content,
        link: "/",
        actorId: botId,
        groupKey: `bot-assist:mydigest:${ctx.userId}`,
      })
      if (!n) {
        return ok(`🤖 I put your digest together but couldn't deliver it — enable "TerpBot tips" in /settings/notifications, or check /progress for the same info.`)
      }
      return ok(`📬 Sent your personal digest to your notifications — it stays private to you.`)
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
          "6. Staff may remove content or restrict accounts that break the rules — use the Report button to flag issues.",
          "Full rules: /rules",
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

    // ── Thread-context commands ─────────────────────────────────────
    case "summarize": {
      const ref = await resolveThreadRef(ctx)
      if (!ref) return ok(NO_THREAD_HINT)
      const t = await loadThreadContext(ref)
      if (!t) return ok(THREAD_NOT_FOUND)
      const status = [
        t.answer ? "✅ answered" : `${t.replyCount} repl${t.replyCount === 1 ? "y" : "ies"}`,
        t.locked ? "locked" : null,
      ].filter(Boolean).join(" · ")
      const lines = [
        `📋 "${sanitizeField(t.title)}" — ${t.category.name} (${status})`,
        `${t.authorName} asked: ${sanitizeExcerpt(t.content, 140)}`,
      ]
      if (t.answer) {
        lines.push(`✅ Accepted answer (${t.answer.authorName}): ${sanitizeExcerpt(t.answer.content, 140)}`)
      } else {
        const seen = new Set<string>()
        for (const p of [...t.topReplies, ...t.recentReplies]) {
          if (seen.has(p.id)) continue
          seen.add(p.id)
          const who = p.author.profile?.username ?? p.author.name ?? "member"
          lines.push(`— ${who}: ${sanitizeExcerpt(p.content, 110)}`)
          if (lines.length >= 5) break
        }
        if (seen.size === 0) lines.push(`No replies yet — be the first to help out.`)
      }
      lines.push(`Read it all: /forum/thread/${t.slug}${ref.postId ? `?post=${ref.postId}` : ""}`)
      return ok(lines.join("\n"))
    }
    case "answered": {
      const ref = await resolveThreadRef(ctx)
      if (!ref) return ok(NO_THREAD_HINT)
      const t = await loadThreadContext(ref)
      if (!t) return ok(THREAD_NOT_FOUND)
      if (t.answer) {
        return ok(
          `✅ Yes — "${sanitizeField(t.title)}" has an accepted answer from ${t.answer.authorName}: "${sanitizeExcerpt(t.answer.content, 140)}" → ${postDeepLink(t.slug, t.answer.id)}`
        )
      }
      const latest = t.recentReplies[0]
      if (latest) {
        const who = latest.author.profile?.username ?? latest.author.name ?? "member"
        return ok(
          `Not yet — ${t.replyCount} repl${t.replyCount === 1 ? "y" : "ies"} on "${sanitizeField(t.title)}", none accepted. Latest from ${who}: "${sanitizeExcerpt(latest.content, 120)}" → /forum/thread/${t.slug}`
        )
      }
      return ok(`No replies yet on "${sanitizeField(t.title)}" — /forum/thread/${t.slug}`)
    }
    case "about": {
      const q = (ctx.rest || ctx.args.join(" ")).trim()
      if (!q) return err(`Usage: /about <topic>`)
      if (hasLink(q)) return err(`I can't look up links — drop the URL and tell me what you're after.`)
      const ref = await resolveThreadRef(ctx)
      if (ref) {
        const t = await loadThreadContext(ref)
        if (t) {
          const terms = tokenizeSearchText(q).slice(0, 6)
          const matches = terms.length
            ? await prisma.post.findMany({
                where: {
                  threadId: t.id,
                  deleted: false,
                  OR: terms.map((w) => ({ content: { contains: w, mode: "insensitive" as const } })),
                },
                orderBy: { createdAt: "asc" },
                take: 2,
                select: {
                  id: true, content: true,
                  author: { select: { name: true, profile: { select: { username: true } } } },
                },
              })
            : []
          if (matches.length) {
            const lines = matches.map((p) => {
              const who = p.author.profile?.username ?? p.author.name ?? "member"
              return `— ${who}: "${sanitizeExcerpt(p.content, 120)}"`
            })
            return ok(
              `In "${sanitizeField(t.title)}", here's what came up about "${sanitizeField(q)}":\n${lines.join("\n")}\n→ ${postDeepLink(t.slug, matches[0].id)}`
            )
          }
          return ok(
            `Nobody's mentioned "${sanitizeField(q)}" in "${sanitizeField(t.title)}" yet — worth asking there: /forum/thread/${t.slug}. Or search wider: /search?q=${encodeURIComponent(q)}`
          )
        }
      }
      // No thread in context — fall back to a compact threads+guides lookup.
      const [threads, guides] = await Promise.all([
        searchThreadsForBot(q, 2),
        prisma.guide.findMany({
          where: { published: true, title: { contains: q, mode: "insensitive" } },
          take: 2,
          select: { slug: true, title: true },
        }),
      ])
      if (!threads.length && !guides.length) {
        return ok(`Nothing obvious on "${sanitizeField(q)}" yet — try /thread ${sanitizeField(q)} or start a thread yourself.`)
      }
      const parts = threads.map(
        (x) => `💬 "${sanitizeField(x.title)}" (${x.replyCount} replies, ${x.category.name}) → /forum/thread/${x.slug}`
      )
      guides.forEach((g) => parts.push(`📖 "${sanitizeField(g.title)}" → /guides/${g.slug}`))
      return ok(parts.join("\n"))
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
