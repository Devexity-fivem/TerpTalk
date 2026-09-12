// Deterministic @terpbot intent parser — pure module, no Prisma, no next.
//
// Maps natural-language text after "@terpbot" to a public chat command.
// The parser can ONLY produce commands registered with the "mention"
// surface in chat-commands.ts (all permission:"public") — there is no code
// path from free text to a staff command. Moderation vocabulary is
// hard-blocked before any matcher runs.
import { isMentionCommand } from "@/lib/chat-commands"

export type TerpbotIntent =
  | { kind: "command"; name: string; args: string[] }
  | { kind: "refusal" }
  | { kind: "help" }
  | { kind: "fallback" }

// Moderation/staff vocabulary — any hit short-circuits to a refusal before
// intent matching, so "@terpbot ban nutrient burn" can't fuzzy-match `ask`.
const STAFF_WORDS = /\b(ban|unban|mute|kick|warn|warning|suspend|suspend|lock|unlock|slow\s?mode|clear|purge|delete|remove|announce|promote|demote|report|shadowban|moderate|mod\s|dm\b|message\s+@)/i

interface Matcher {
  name: string
  // Patterns are tested against the normalized remainder (lowercase, no
  // trailing punctuation). First match wins — order = specificity.
  patterns: RegExp[]
  // Optional arg extraction: returns args for the command.
  args?: (text: string, m: RegExpMatchArray) => string[]
}

const MATCHERS: Matcher[] = [
  {
    name: "rep",
    patterns: [
      /\b(my|our)\s+(rep|reputation|points|score|karma)\b/,
      /\b(what('s| is)|whats|check|show|how much)\b.*\b(rep|reputation|points)\b/,
      /\b(rep|reputation|karma|points)\s+(of|for)?\s*@\w+/,
      /@\w+\s*('s)?\s*(rep|reputation)\b/,
      /^(rep|reputation|karma|points|score)$/,
      /\bhow much rep\b/,
    ],
    args: (t) => {
      const m = t.match(/@([A-Za-z0-9_]{3,20})\b/)
      return m ? [`@${m[1]}`] : []
    },
  },
  {
    name: "progress",
    patterns: [
      /\bnext tier\b/,
      /\btier progress\b/,
      /\bhow (far|close).*(next tier|tier up|level up)\b/,
      /\bhow (far|close) (am i|till|until)\b/,
      /\bmy progress\b/,
    ],
  },
  {
    name: "rank",
    patterns: [
      /\b(my\s+)?rank(ing)?\b/,
      /\bleaderboard position\b/,
      /\bwhere (do i|am i) (rank|stand)\b/,
      /\brank of @\w+/,
    ],
    args: (t) => {
      const m = t.match(/@([A-Za-z0-9_]{3,20})\b/)
      return m ? [`@${m[1]}`] : []
    },
  },
  {
    name: "streak",
    patterns: [/\bstreak\b/, /\bdays? in a row\b/, /\bconsecutive (days?|updates?)\b/, /^streak$/],
    args: (t) => {
      const m = t.match(/@([A-Za-z0-9_]{3,20})\b/)
      return m ? [`@${m[1]}`] : []
    },
  },
  {
    name: "nextbadges",
    patterns: [
      /\bnext badge/,
      /\bbadges? (to|i can|left to|to earn|to get)\b/,
      /\bwhat badges? (can|should|do) i\b/,
      /\bbadges? (i|i'm|im) (missing|need|don't have)\b/,
    ],
  },
  {
    name: "badge",
    patterns: [
      /\bmy badges\b/,
      /\bshow (me )?my badges\b/,
      /\bwhat badges (do i have|have i earned)\b/,
      /\bbadges?\b/,
      /\b(what is|tell me about|info on) (the )?badge\b/,
    ],
    args: (t) => {
      // "/badge Helper" style: "badge helper" → arg "helper"
      const m = t.match(/\bbadge\s+(?:called\s+|named\s+)?["']?([a-z0-9][a-z0-9 ',&-]{1,40}?)["']?\s*$/)
      return m && m[1].trim() ? [m[1].trim()] : []
    },
  },
  {
    name: "diary",
    patterns: [
      /\bmy (diary|diaries|grow|journal|grow log)\b/,
      /\bshow (me )?my (diary|grow)\b/,
      /\bhow('?s| is) my (grow|diary|plant)\b/,
      /\bdiary of @\w+|@\w+('s)?\s+(diary|diaries|grow)\b/,
      /\b(diaries|diary) (about|on|for)\s+.+/,
      /^(diary|diaries|journal|grow log)$/,
    ],
    args: (t) => {
      const m = t.match(/@([A-Za-z0-9_]{3,20})\b/)
      return m ? [`@${m[1]}`] : []
    },
  },
  {
    name: "thread",
    patterns: [
      /\b(threads?|posts?|discussions?)\s+(about|on|for|of)\s+(.+)/,
      /\bfind (me )?(a |any |some )?(threads?|posts?|discussions?)\s+(about|on|for)\s+(.+)/,
      /\b(has|have) (anyone|anybody|people) (talked|posted|written|said)\s+about\s+(.+)/,
      /\bany (threads?|posts?|discussions?) (on|about|for)\s+(.+)/,
      /\bsearch (for\s+)?(threads?|posts?|the forum)\s+(about|on|for)\s+(.+)/,
    ],
    args: (t, m) => [m[m.length - 1]],
  },
  {
    name: "strain",
    patterns: [
      /\bstrain\s+(.+)/,
      /\b(info|information|details|tell me) (on|about) (the )?(.+)\s+strain\b/,
      /\bwhat (is|about) (the )?(.+)\s+strain\b/,
    ],
    args: (t, m) => {
      // Prefer the captured group; for "strain X" the group is the name.
      const g = m[m.length - 1]?.trim()
      if (g && g !== "strain") return [g]
      const s = t.match(/\bstrain\s+(.+)/)
      return s ? [s[1].trim()] : []
    },
  },
  {
    name: "guide",
    patterns: [
      /\bguides?\s+(for|about|on|to)\s+(.+)/,
      /\bfind (me )?(a |any )?guides?\s+(for|about|on)\s+(.+)/,
      /\bfind\s+(.+?)\s+guides?\b/,
      /\b([\w ]{2,40}?)\s+guides?\s*$/,
      /\bhow (do|to)( i)?\s+(.+)/,
      /\bguide me (on|through)\s+(.+)/,
    ],
    args: (t, m) => [m[m.length - 1]],
  },
  {
    name: "online",
    patterns: [
      /\bwho('?s| is| are) (online|here|around|active)\b/,
      /\b(anyone|anybody|people) (online|here|around|active)\b/,
      /\bhow many (members |people |users )?(are )?(online|here|active)\b/,
      /\bonline now\b/,
    ],
  },
  {
    name: "digest",
    patterns: [/\bdigest\b/, /\bwhat happened (yesterday|today|last 24)/, /\bdaily (recap|summary|digest)\b/, /\byesterday'?s (activity|recap|summary)\b/],
  },
  {
    name: "contest",
    patterns: [/\bcontest\b/, /\bwho won\b/, /\bphoto contest\b/, /\bbudshot\b/, /\bdiary of the month\b/],
  },
  {
    name: "stats",
    patterns: [/\b(site |community )?stats\b/, /\bhow many (members|users|threads|diaries|strains)\b/],
  },
  {
    name: "top",
    patterns: [
      /\bleaderboard\b/,
      /\btop (growers|members|users|posters)\b/,
      /\bwho has the most rep\b/,
      /\bwho('?s| is) (on )?top\b/,
    ],
  },
  {
    name: "rules",
    patterns: [/\brules?\b/, /\b(am i|are we) allowed\b/, /\bcommunity guidelines\b/],
  },
  {
    name: "tip",
    patterns: [/\b(grow )?tips?\b/, /\b(give me|any|some) advice\b/],
  },
  {
    name: "flip",
    patterns: [/\bflip\b/, /\bcoin flip\b/, /\bheads or tails\b/],
  },
  {
    name: "roll",
    patterns: [/\broll\b/, /\bdice\b/, /\bd(\d{1,4})\b/],
    args: (t) => {
      const m = t.match(/\bd(\d{1,4})\b/)
      return m ? [m[1]] : []
    },
  },
]

// Broad "find/search X" or question fallback → /ask with extracted query.
const ASK_PATTERNS = [
  /\bwhat (is|are|causes?)\s+(.+)/,
  /\b(find|search|look ?up|look for|show me)\s+(.+)/,
  /\b(tell me about|info on|information about)\s+(.+)/,
  /\bhelp (me )?(with|find)\s+(.+)/,
]

// Extract the text after the first @terpbot mention and normalize it.
// Apostrophes and @handles are kept — patterns like who('?s rely on them,
// and @user args are how "rep @pablo" targets a third party. Bounded to
// 200 chars so pasted dumps can't blow up the matchers.
export function extractTerpbotQuery(content: string): string {
  const m = content.match(/@terpbot\b/i)
  if (!m || m.index === undefined) return ""
  return content
    .slice(m.index + m[0].length)
    .toLowerCase()
    .replace(/[?!.,";:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
}

export function parseTerpbotIntent(content: string): TerpbotIntent {
  // No valid mention at all → nothing to answer (the route only calls this
  // when /@terpbot\b/ matched, but stay correct if reused elsewhere).
  if (!/@terpbot\b/i.test(content)) return { kind: "fallback" }
  const text = extractTerpbotQuery(content)
  if (!text) return { kind: "help" }

  // Hard block: staff vocabulary never reaches a matcher.
  if (STAFF_WORDS.test(text)) return { kind: "refusal" }

  for (const matcher of MATCHERS) {
    for (const pattern of matcher.patterns) {
      const m = text.match(pattern)
      if (m) {
        if (!isMentionCommand(matcher.name)) return { kind: "fallback" }
        const args = matcher.args ? matcher.args(text, m) : []
        return { kind: "command", name: matcher.name, args: args.filter((a) => typeof a === "string" && a.trim()) }
      }
    }
  }

  // Question/search fallback → ask with the extracted query.
  for (const pattern of ASK_PATTERNS) {
    const m = text.match(pattern)
    if (m && m[m.length - 1]?.trim().length >= 3) {
      return { kind: "command", name: "ask", args: [m[m.length - 1].trim()] }
    }
  }

  return { kind: "fallback" }
}

// Fixed response texts — refusal and fallback never echo user input.
export const TERPBOT_REFUSAL_TEXT =
  "🤖 I can't help with moderation — that's for the staff team. If someone's breaking the rules, use the Report button."

export const TERPBOT_FALLBACKS = [
  "🤖 Not sure what you're after — try \"my rep\", \"find threads about …\", \"who's online\", or /help for the full list.",
  "🤖 I didn't catch that. I can look up threads, guides, strains, your rep/streak/diary, or list commands with /help.",
  "🤖 Hmm, try asking differently — e.g. \"what's my streak\", \"guides about cloning\", or \"contest status\". /help lists everything.",
]

export function terpbotFallbackText(seed: string): string {
  // Deterministic rotation so identical misses don't repeat verbatim.
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return TERPBOT_FALLBACKS[Math.abs(h) % TERPBOT_FALLBACKS.length]
}
