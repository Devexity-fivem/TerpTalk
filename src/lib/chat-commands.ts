// Chat command registry — the single source of truth for every slash command.
//
// Pure module: no Prisma, no next/server. Safe to import from client
// components (chat sidebar autocomplete) and from the @terpbot intent parser.
//
// Permission tiers map to the security helpers:
//   public    — any member
//   moderator — MODERATOR or ADMINISTRATOR (SUPPORT deliberately excluded:
//               support is read-only and these commands must not appear in
//               their help/autocomplete)
//   admin     — ADMINISTRATOR only
//
// surfaces: "slash" = /name in chat; "mention" = reachable through the
// @terpbot natural-language parser. Only public commands may expose a
// "mention" surface — the parser can never resolve to a staff command.

export type ChatCommandPermission = "public" | "moderator" | "admin"
export type ChatCommandSurface = "slash" | "mention"
export type ChatCommandCategory = "grow" | "community" | "knowledge" | "profile" | "utility" | "staff"

export interface ChatCommandMeta {
  name: string
  aliases?: string[]
  usage: string
  description: string
  permission: ChatCommandPermission
  surfaces: ChatCommandSurface[]
  // Staff commands and /me keep their bespoke route handlers — the registry
  // only drives dispatch for "public" bot-persona commands.
  handledBy: "bot" | "route"
  category: ChatCommandCategory
  example?: string
  // Context-aware commands resolve a thread from the message/link/reply
  // context at dispatch time (terpbot-context.ts).
  contextAware?: boolean
}

const P = "public" as const
const M = "moderator" as const
const A = "admin" as const
const BOTH: ChatCommandSurface[] = ["slash", "mention"]

export const CHAT_COMMANDS: ChatCommandMeta[] = [
  // ── Grow ─────────────────────────────────────────────────────────
  { name: "grow", usage: "/grow", description: "Your active grow — stage, week, streak, readings, next milestone", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow", example: "@terpbot my grow" },
  { name: "grows", aliases: ["diaries"], usage: "/grows", description: "Your active grow diaries", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow" },
  { name: "checkin", usage: "/checkin", description: "Is your grow diary up to date?", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow", example: "@terpbot what should I update?" },
  { name: "growhelp", usage: "/growhelp", description: "Community discussions relevant to your grow", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow" },
  { name: "diary", usage: "/diary [@user]", description: "Latest grow diary", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow" },
  { name: "streak", usage: "/streak [@user]", description: "Grow-update streak", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow" },
  { name: "milestones", usage: "/milestones", description: "What you're closest to unlocking next", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow", example: "@terpbot what am I close to?" },
  { name: "progress", usage: "/progress", description: "Your rep, tier, quests and streak in one view", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow", example: "@terpbot my progress" },
  { name: "quests", usage: "/quests", description: "Today's daily quests", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow" },
  { name: "diagnose", usage: "/diagnose <what you see or measured>", description: "Reason over your grow — report symptoms or readings", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow", example: "@terpbot my leaves are curling" },
  { name: "why", usage: "/why [topic]", description: "Explain the last thing TerpBot said about your grow", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow", example: "@terpbot why did you say that" },
  { name: "status", usage: "/status", description: "Where your grow is — stage, readings, changes, open concerns", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow", example: "@terpbot how is my grow doing" },
  { name: "changes", usage: "/changes", description: "What changed since your last check-in", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow", example: "@terpbot what changed" },
  { name: "check", usage: "/check", description: "The most useful thing to measure or check next", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow", example: "@terpbot what should I check" },
  { name: "measurements", usage: "/measurements", description: "What TerpBot actually has — known, derived, stale, missing", permission: P, surfaces: BOTH, handledBy: "bot", category: "grow", example: "@terpbot what do you know about my grow" },

  // ── Community ────────────────────────────────────────────────────
  { name: "stats", usage: "/stats", description: "Community stats", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },
  { name: "top", aliases: ["leaderboard"], usage: "/top", description: "Top growers by rep", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },
  { name: "rank", usage: "/rank [@user]", description: "Leaderboard position", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },
  { name: "online", usage: "/online", description: "Who's online right now", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },
  { name: "digest", usage: "/digest", description: "Last 24 hours of community activity", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },
  { name: "weekly", usage: "/weekly", description: "This week's community summary", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },
  { name: "contest", usage: "/contest", description: "This week's contest status", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },
  { name: "hot", usage: "/hot", description: "Trending discussions this week", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },
  { name: "new", usage: "/new", description: "Newest public discussions", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },
  { name: "unanswered", usage: "/unanswered", description: "Threads still waiting for a first reply", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },
  { name: "active", usage: "/active", description: "Community activity in the last hour", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },
  { name: "rules", usage: "/rules", description: "Community rules", permission: P, surfaces: BOTH, handledBy: "bot", category: "community" },

  // ── Knowledge ────────────────────────────────────────────────────
  { name: "thread", aliases: ["threads"], usage: "/thread <search>", description: "Find forum threads", permission: P, surfaces: BOTH, handledBy: "bot", category: "knowledge", example: "/thread fungus gnats" },
  { name: "guide", aliases: ["guides"], usage: "/guide <search>", description: "Find a grow guide", permission: P, surfaces: BOTH, handledBy: "bot", category: "knowledge", example: "/guide cloning" },
  { name: "strain", usage: "/strain <name>", description: "Look up a strain", permission: P, surfaces: BOTH, handledBy: "bot", category: "knowledge", example: "/strain blue dream" },
  { name: "ask", usage: "/ask <question>", description: "Search threads, guides and strains", permission: P, surfaces: BOTH, handledBy: "bot", category: "knowledge", example: "@terpbot what is VPD?" },
  { name: "related", usage: "/related <topic>", description: "Threads, guides and strains on a topic", permission: P, surfaces: BOTH, handledBy: "bot", category: "knowledge", example: "/related nutrient burn" },
  { name: "setup", aliases: ["setups"], usage: "/setup [search or @user]", description: "Find public grow setups — tents, lights, equipment", permission: P, surfaces: BOTH, handledBy: "bot", category: "knowledge", example: "@terpbot what lights does @pablo run" },
  { name: "summarize", aliases: ["tldr", "recap"], usage: "/summarize [thread link]", description: "Summarize a forum thread", permission: P, surfaces: BOTH, handledBy: "bot", category: "knowledge", contextAware: true, example: "@terpbot summarize this" },
  { name: "answered", aliases: ["solved"], usage: "/answered [thread link]", description: "Does a thread have an accepted answer?", permission: P, surfaces: BOTH, handledBy: "bot", category: "knowledge", contextAware: true },
  { name: "about", usage: "/about <topic>", description: "Look up a topic in context", permission: P, surfaces: BOTH, handledBy: "bot", category: "knowledge", contextAware: true },

  // ── Profile ──────────────────────────────────────────────────────
  { name: "rep", usage: "/rep [@user]", description: "Reputation and tier", permission: P, surfaces: BOTH, handledBy: "bot", category: "profile" },
  { name: "badge", usage: "/badge [name]", description: "Your badges, or badge info", permission: P, surfaces: BOTH, handledBy: "bot", category: "profile" },
  { name: "nextbadges", usage: "/nextbadges", description: "Badges you haven't earned yet", permission: P, surfaces: BOTH, handledBy: "bot", category: "profile" },
  { name: "mydigest", usage: "/mydigest", description: "Your personal digest — sent privately", permission: P, surfaces: BOTH, handledBy: "bot", category: "profile" },

  // ── Utility ──────────────────────────────────────────────────────
  { name: "help", usage: "/help", description: "Show TerpBot commands", permission: P, surfaces: BOTH, handledBy: "bot", category: "utility" },
  { name: "tip", usage: "/tip", description: "Random grow tip", permission: P, surfaces: BOTH, handledBy: "bot", category: "utility" },
  { name: "flip", usage: "/flip", description: "Flip a coin", permission: P, surfaces: BOTH, handledBy: "bot", category: "utility" },
  { name: "roll", usage: "/roll [sides]", description: "Roll a die (2-1000)", permission: P, surfaces: BOTH, handledBy: "bot", category: "utility" },

  // ── Member command handled by the route (posts as the user) ───────
  { name: "me", usage: "/me <action>", description: "Roleplay a third-person action", permission: P, surfaces: ["slash"], handledBy: "route", category: "utility" },

  // ── Staff commands (route-handled, never reachable via @terpbot) ──
  { name: "slowmode", usage: "/slowmode <0-300>", description: "Set seconds between messages", permission: M, surfaces: ["slash"], handledBy: "route", category: "staff" },
  { name: "lock", usage: "/lock", description: "Prevent non-staff posting", permission: M, surfaces: ["slash"], handledBy: "route", category: "staff" },
  { name: "unlock", usage: "/unlock", description: "Re-enable posting", permission: M, surfaces: ["slash"], handledBy: "route", category: "staff" },
  { name: "clear", usage: "/clear", description: "Soft-delete all messages", permission: M, surfaces: ["slash"], handledBy: "route", category: "staff" },
  { name: "announce", usage: "/announce <message>", description: "Post a system-style message", permission: M, surfaces: ["slash"], handledBy: "route", category: "staff" },
  { name: "warn", usage: "/warn <@user> <reason>", description: "Warn a user", permission: M, surfaces: ["slash"], handledBy: "route", category: "staff" },
  { name: "mute", usage: "/mute <@user> <days> <reason>", description: "Temporarily suspend a user", permission: A, surfaces: ["slash"], handledBy: "route", category: "staff" },
  { name: "ban", usage: "/ban <@user> <reason>", description: "Permanently ban a user", permission: A, surfaces: ["slash"], handledBy: "route", category: "staff" },
  { name: "unban", usage: "/unban <@user>", description: "Lift a permanent ban", permission: A, surfaces: ["slash"], handledBy: "route", category: "staff" },
]

const BY_NAME = new Map<string, ChatCommandMeta>(
  CHAT_COMMANDS.flatMap((c) => [c.name, ...(c.aliases ?? [])].map((n) => [n, c] as const))
)

export function getChatCommand(name: string): ChatCommandMeta | undefined {
  return BY_NAME.get(name.toLowerCase())
}

// Role helpers mirrored from @/lib/security (duplicated here so this module
// stays pure/client-safe — it must never import prisma transitively).
function isModeratorRole(role?: string | null) {
  return role === "MODERATOR" || role === "ADMINISTRATOR"
}
function isAdminRole(role?: string | null) {
  return role === "ADMINISTRATOR"
}

export function canUseCommand(cmd: ChatCommandMeta, role?: string | null): boolean {
  if (cmd.permission === "public") return true
  if (cmd.permission === "moderator") return isModeratorRole(role)
  return isAdminRole(role)
}

export function listCommandsForRole(role?: string | null): ChatCommandMeta[] {
  return CHAT_COMMANDS.filter((c) => canUseCommand(c, role))
}

// Commands the @terpbot intent parser may ever dispatch to.
export function isMentionCommand(name: string): boolean {
  const cmd = getChatCommand(name)
  return !!cmd && cmd.permission === "public" && cmd.surfaces.includes("mention")
}

// Closest registered command within edit distance 2 — powers "did you mean
// /diary?" for mistyped slash commands. Deterministic Damerau–Levenshtein;
// only canonical names (never aliases) are suggested so the hint always
// matches /help output.
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length
  if (Math.abs(m - n) > 2) return 3
  const d: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= n; j++) {
      const tmp = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return d[n]
}

export function suggestCommand(input: string, role?: string | null): ChatCommandMeta | null {
  const q = input.toLowerCase().replace(/[^a-z0-9]/g, "")
  if (!q || q.length < 2) return null
  let best: ChatCommandMeta | null = null
  let bestDist = 3
  for (const cmd of listCommandsForRole(role)) {
    const dist = Math.min(
      editDistance(q, cmd.name),
      ...(cmd.aliases ?? []).map((al) => editDistance(q, al))
    )
    if (dist < bestDist) {
      bestDist = dist
      best = cmd
    }
  }
  return bestDist <= 2 ? best : null
}

const CATEGORY_ORDER: { key: ChatCommandCategory; label: string }[] = [
  { key: "grow", label: "Grow" },
  { key: "community", label: "Community" },
  { key: "knowledge", label: "Knowledge" },
  { key: "profile", label: "Profile" },
  { key: "utility", label: "Utility" },
]

// Bot chat messages are capped at CHAT_MESSAGE_MAX (1000 chars), so /help
// ships as a compact categorized index — names only. `/help <name>` returns
// the full usage/description/example card for one command, and
// `/help <category>` returns a category's one-liners.
export function buildHelpText(role?: string | null, topic?: string | null): string {
  const cmds = listCommandsForRole(role)
  const q = (topic ?? "").trim().toLowerCase().replace(/^\//, "")

  if (q) {
    const cmd = BY_NAME.get(q)
    if (cmd && canUseCommand(cmd, role)) {
      const lines = [`${cmd.usage} - ${cmd.description}`]
      if (cmd.aliases?.length) lines.push(`Aliases: ${cmd.aliases.map((a) => `/${a}`).join(" ")}`)
      if (cmd.example) lines.push(`e.g. ${cmd.example}`)
      return lines.join("\n")
    }
    const cat = CATEGORY_ORDER.find(
      (c) => c.key === q || c.label.toLowerCase() === q || `${c.label.toLowerCase()} commands` === q
    )
    if (cat) {
      const group = cmds.filter(
        (c) => c.category === cat.key && c.permission === "public" && c.handledBy === "bot"
      )
      if (group.length) {
        return `${cat.label}:\n${group.map((c) => `${c.usage} - ${c.description}`).join("\n")}`
      }
    }
    if (q === "staff") {
      const staff = cmds.filter((c) => c.permission !== "public")
      if (staff.length) {
        return `Staff:\n${staff.map((c) => `${c.usage} - ${c.description}`).join("\n")}`
      }
    }
    // Unknown topic → fall through to the compact index.
  }

  const lines = ["🤖 TerpBot commands (or ask me: @terpbot <question>):"]
  for (const { key, label } of CATEGORY_ORDER) {
    const group = cmds.filter(
      (c) => c.category === key && c.permission === "public" && c.handledBy === "bot"
    )
    if (!group.length) continue
    lines.push(`${label}: ${group.map((c) => `/${c.name}`).join(" ")}`)
  }
  const me = cmds.find((c) => c.name === "me")
  if (me) lines.push(`${me.usage} - ${me.description}`)
  const staff = cmds.filter((c) => c.permission !== "public")
  if (staff.length) lines.push(`Staff: ${staff.map((c) => `/${c.name}`).join(" ")}`)
  lines.push(`/help <name> for details — e.g. /help grow`)
  return lines.join("\n")
}
