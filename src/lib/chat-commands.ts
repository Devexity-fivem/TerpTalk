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
}

const P = "public" as const
const M = "moderator" as const
const A = "admin" as const
const BOTH: ChatCommandSurface[] = ["slash", "mention"]

export const CHAT_COMMANDS: ChatCommandMeta[] = [
  // ── Info / lookups (bot answers) ──────────────────────────────────
  { name: "help", usage: "/help", description: "Show TerpBot commands", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "rep", usage: "/rep [@user]", description: "Reputation and tier", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "progress", usage: "/progress", description: "Progress to your next tier", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "rank", usage: "/rank [@user]", description: "Leaderboard position", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "streak", usage: "/streak [@user]", description: "Grow-update streak", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "badge", usage: "/badge [name]", description: "Your badges, or badge info", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "nextbadges", usage: "/nextbadges", description: "Badges you haven't earned yet", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "diary", usage: "/diary [@user]", description: "Latest grow diary", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "thread", aliases: ["threads"], usage: "/thread <search>", description: "Find forum threads", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "strain", usage: "/strain <name>", description: "Look up a strain", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "guide", aliases: ["guides"], usage: "/guide <search>", description: "Find a grow guide", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "ask", usage: "/ask <question>", description: "Search guides and strains", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "online", usage: "/online", description: "Who's online right now", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "digest", usage: "/digest", description: "Yesterday's community digest", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "contest", usage: "/contest", description: "This week's contest status", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "stats", usage: "/stats", description: "Community stats", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "top", aliases: ["leaderboard"], usage: "/top", description: "Top growers by rep", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "rules", usage: "/rules", description: "Community rules", permission: P, surfaces: BOTH, handledBy: "bot" },

  // ── Fun ───────────────────────────────────────────────────────────
  { name: "tip", usage: "/tip", description: "Random grow tip", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "flip", usage: "/flip", description: "Flip a coin", permission: P, surfaces: BOTH, handledBy: "bot" },
  { name: "roll", usage: "/roll [sides]", description: "Roll a die (2-1000)", permission: P, surfaces: BOTH, handledBy: "bot" },

  // ── Member command handled by the route (posts as the user) ───────
  { name: "me", usage: "/me <action>", description: "Roleplay a third-person action", permission: P, surfaces: ["slash"], handledBy: "route" },

  // ── Staff commands (route-handled, never reachable via @terpbot) ──
  { name: "slowmode", usage: "/slowmode <0-300>", description: "Set seconds between messages", permission: M, surfaces: ["slash"], handledBy: "route" },
  { name: "lock", usage: "/lock", description: "Prevent non-staff posting", permission: M, surfaces: ["slash"], handledBy: "route" },
  { name: "unlock", usage: "/unlock", description: "Re-enable posting", permission: M, surfaces: ["slash"], handledBy: "route" },
  { name: "clear", usage: "/clear", description: "Soft-delete all messages", permission: M, surfaces: ["slash"], handledBy: "route" },
  { name: "announce", usage: "/announce <message>", description: "Post a system-style message", permission: M, surfaces: ["slash"], handledBy: "route" },
  { name: "warn", usage: "/warn <@user> <reason>", description: "Warn a user", permission: M, surfaces: ["slash"], handledBy: "route" },
  { name: "mute", usage: "/mute <@user> <days> <reason>", description: "Temporarily suspend a user", permission: A, surfaces: ["slash"], handledBy: "route" },
  { name: "ban", usage: "/ban <@user> <reason>", description: "Permanently ban a user", permission: A, surfaces: ["slash"], handledBy: "route" },
  { name: "unban", usage: "/unban <@user>", description: "Lift a permanent ban", permission: A, surfaces: ["slash"], handledBy: "route" },
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

export function buildHelpText(role?: string | null): string {
  const cmds = listCommandsForRole(role)
  const info = cmds.filter((c) => c.permission === "public" && c.handledBy === "bot" && !["tip", "flip", "roll"].includes(c.name))
  const fun = cmds.filter((c) => ["tip", "flip", "roll"].includes(c.name))
  const staff = cmds.filter((c) => c.permission !== "public")
  const me = cmds.find((c) => c.name === "me")
  const lines = [
    "🤖 TerpBot commands (or ask me: @terpbot <question>):",
    ...info.map((c) => `${c.usage} - ${c.description}`),
    ...(me ? [`${me.usage} - ${me.description}`] : []),
    ...fun.map((c) => `${c.usage} - ${c.description}`),
  ]
  if (staff.length) {
    lines.push("Staff:", ...staff.map((c) => `${c.usage} - ${c.description}`))
  }
  return lines.join("\n")
}
