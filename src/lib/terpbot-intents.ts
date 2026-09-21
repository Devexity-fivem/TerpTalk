// Deterministic @terpbot intent parser — pure module, no Prisma, no next.
//
// Maps natural-language text after "@terpbot" to a public chat command.
// The parser can ONLY produce commands registered with the "mention"
// surface in chat-commands.ts (all permission:"public") — there is no code
// path from free text to a staff command. Moderation vocabulary is
// hard-blocked before any matcher runs.
import { isMentionCommand } from "@/lib/chat-commands"
import { parseGrowText } from "@/lib/terpbot-nl-parse"

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
  // ── Week-scoped recaps route to /weekly, not thread summarize —
  // "weekly recap" contains "recap" but means the community summary.
  {
    name: "weekly",
    patterns: [/\bweekly\b/, /\bthis week('s)? (summary|recap|activity|stats)\b/, /\bweek in review\b/, /\bhow('?s| was) (the )?week\b/],
  },
  // ── Thread-context intents first — "summarize this" etc. resolve
  // the thread from the message's link/reply context at dispatch time.
  {
    name: "summarize",
    patterns: [
      /\b(summar\w*|tl[\s;]?dr|recap)\b/,
      /\bwhat('?s| is) (this|the|that) (thread|post|discussion|topic)\b/,
      /\bwhat do (people|they|others|growers|folks) (say|recommend|suggest|think)\b/,
      /\bwhat happened (in|on|with) (this|the|that)\b/,
      /\b(gist|overview|breakdown|summary) of\b/,
      /\bexplain (this|the|that) (thread|post|discussion)\b/,
    ],
  },
  {
    name: "answered",
    patterns: [
      /\banyone (answer|reply|respond|help|solve|fix)\b/,
      /\b(any|an) (accepted )?(answer|answers|solution|fix)\b/,
      /\b(is|was|has|did|does) (this|it|that|the thread|the post)\s*(get|got|been|ever)?\s*(answered|solved|resolved|replied|answered)\b/,
      /\baccepted answer\b/,
      /\b(solved|resolved)\b/,
      /\bget an? answer\b/,
    ],
  },
  {
    name: "about",
    patterns: [
      /\bwhat about\s+(.+)/,
      /\bhow about\s+(.+)/,
      /\bany (thoughts?|advice|recommendations?|ideas?|tips) (on|about|for)\s+(.+)/,
    ],
    args: (t, m) => [m[m.length - 1]],
  },
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
      /\bhow (far|close).*(next tier|tier up|level up|next level|next stage)\b/,
      /\bhow (far|close) (am i|till|until)\b/,
      /\bmy progress\b/,
      /\b(my|what('s| is)) (grow )?level\b/,
      /\b(what|which) (grow )?(level|stage) (am i|are you|is)\b/,
      /\bwhat (do|will|can) i unlock\b/,
      /\bwhat('s| is) next (for me|to unlock)\b/,
      /\bnext (unlock|reward|level|stage)\b/,
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
    name: "quests",
    patterns: [
      /\b(daily )?quests?\b/,
      /\bwhat (should|can) i do (today|now)\b/,
      /\bwhat('s| is) (there|left) to do\b/,
      /\btoday('s|s) (goals?|tasks?|quests?)\b/,
      /^quests?$/,
    ],
  },
  {
    name: "nextbadges",
    patterns: [
      /\bnext badge/,
      /\bbadges? (to|i can|left to|to earn|to get)\b/,
      /\bwhat badges? (can|should|do) i\b/,
      /\bbadges? (i|i'm|im) (missing|need|don't have)\b/,
      /\bachievements? (am i |i'm |i am )?close (to|on)\b/,
      /\bwhat achievements? (am i|can i)\b/,
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
  // ── Setups — before grow/diary so "my grow setup" isn't captured by
  // "my grow". Requires setup vocabulary or an @user, so unrelated grow
  // questions keep falling through to guide/ask. "set up a tent" (two
  // words) never matches `setups?` — "how do i set up a tent" still → guide.
  {
    name: "setup",
    patterns: [
      // "what lights does @user run" / "what tent is @user using"
      /\b(what|which)\s+(lights?|lighting|tents?|setups?|gear|equipment|nutes?|nutrients?|medium)\s+(does|do|did|is)\s+@\w+\b/,
      /\b(what|which)\s+(lights?|lighting|tents?|setups?|gear|equipment)\b.{0,20}\b(does|do|did)\s+@\w+\s+(use|uses|using|run|runs|running|have|has|got|grow|grows|growing)\b/,
      // "@user's setup" / "show me @user's setup" / "@user's tent"
      /@\w+('s|s)?\s+(grow\s+)?(setups?|tents?|lights?|lighting|gear|equipment)\b/,
      /\bmy (grow )?setups?\b/,
      // "setups for/with/using/running X" / "find grow setups"
      /\bsetups?\s+(for|with|using|running)\s+(.+)/,
      /\b(find|show|list|search|browse)\s+(me\s+)?(a\s+|an\s+|any\s+|some\s+|all\s+)?(grow\s+)?setups?\b/,
      /^(grow )?(setup|setups)$/,
    ],
    args: (t) => {
      const u = t.match(/@([A-Za-z0-9_]{3,20})\b/)
      if (u) return [`@${u[1]}`]
      if (/\bmy\b/.test(t)) return ["me"]
      const q = t.match(/\bsetups?\s+(?:for|with|using|running)\s+(.+)/)
      if (q) {
        const cleaned = q[1].replace(/^(a|an|the|some|any)\s+/, "").trim()
        return cleaned ? [cleaned] : []
      }
      return []
    },
  },
  {
    name: "growhelp",
    patterns: [
      /\b(help|advice) (for|with|about|on) my (grow|diary|plant|girls?)\b/,
      /\bmy (grow|plant|diary) (needs? )?(help|advice)\b/,
      /\bgrow help\b/,
      /\bhelp (me )?(with|fix) my (grow|plant)\b/,
    ],
  },
  {
    name: "grow",
    patterns: [
      /\bmy grow\b/,
      /\bhow('?s| is) my (grow|plant)\b/,
      /\bgrow (status|summary|report)\b/,
      /\b(what|which) stage is my\b/,
      /^grow$/,
    ],
  },
  {
    name: "grows",
    patterns: [
      /\bmy (grows|diaries)\b/,
      /\b(all|list|show)( me)?( my)? (grows|diaries|plants)\b/,
      /\bhow many (grows|diaries|plants)\b/,
      /^(grows|diaries|plants)$/,
    ],
  },
  {
    name: "checkin",
    patterns: [
      /\bcheck ?in\b/,
      /\bwhat (should|do) i (need to )?update\b/,
      /\bis my (diary|grow) (up to date|current|stale|overdue)\b/,
      /\bdiary (check|freshness|status)\b/,
      /\boverdue (update|diary)\b/,
    ],
  },
  {
    name: "milestones",
    patterns: [
      /\bmilestones?\b/,
      /\bwhat am i close to\b/,
      /\bwhat('s| is) (my )?next (milestone|goal|unlock)\b/,
      /\bclose to (unlocking|earning|leveling)\b/,
      /\bwhat should i (work on|do) next\b/,
    ],
  },
  {
    name: "mydigest",
    patterns: [
      /\bmy digest\b/,
      /\bpersonal(ized)? (digest|summary|recap|briefing)\b/,
      /\bwhat did i miss\b/,
      /\bcatch me up\b/,
    ],
  },
  {
    name: "diary",
    patterns: [
      /\bmy (diary|journal|grow log)\b/,
      /\bshow (me )?my (diary|grow)\b/,
      /\bdiary of @\w+|@\w+('s)?\s+(diary|diaries|grow)\b/,
      /\b(diaries|diary) (about|on|for)\s+.+/,
      /^(diary|journal|grow log)$/,
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
    name: "hot",
    patterns: [
      /\b(hot|trending|popular|busiest)\b/,
      /\bwhat('s| is) (hot|trending|popular)\b/,
      /\bmost (discussed|replied|talked about)\b/,
    ],
  },
  {
    name: "new",
    patterns: [
      /\b(new|newest|latest|recent|fresh) (threads?|discussions?|posts?)\b/,
      /\bwhat('s| is) new (in|on) (the )?(forum|discussions?|community)\b/,
      /\blatest discussions?\b/,
    ],
  },
  {
    name: "unanswered",
    patterns: [
      /\bunanswered\b/,
      /\b(threads?|posts?|discussions?) (that |with )?(need|needs|without|no) (answers?|replies|help)\b/,
      /\bwho needs help\b/,
      /\bno replies\b/,
    ],
  },
  {
    name: "active",
    patterns: [
      /\bwhat('s| is) (going on|happening|up)\b/,
      /\bcommunity activity\b/,
      /\bany activity\b/,
      /\bhow (busy|active) (is|was)\b/,
    ],
  },
  {
    name: "related",
    patterns: [
      /\b(related|similar) (to |about |on )?(.+)/,
      /\bmore (on|about) (.+)/,
      /\banything else (on|about) (.+)/,
    ],
    args: (t, m) => [m[m.length - 1]],
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

  // Grow-report fallback → diagnose. The deterministic parser finds
  // symptoms/measurements in free text ("my leaves are curling",
  // "tent is 84f"); a bare number is a pending-ask answer the handler
  // resolves against the session.
  const parsed = parseGrowText(text)
  if (
    parsed.observations.length ||
    parsed.measurements.length ||
    /^\s*-?\d+(\.\d+)?\s*$/.test(text)
  ) {
    return { kind: "command", name: "diagnose", args: [text] }
  }
  const why = text.match(/^(why|how come|what makes you)\b\s*(.*)/)
  if (why && !why[2].trim()) {
    return { kind: "command", name: "why", args: [] }
  }
  if (why) {
    return { kind: "command", name: "why", args: [why[2].trim()] }
  }

  return { kind: "fallback" }
}

// Fixed response texts — refusal and fallback never echo user input.
export const TERPBOT_REFUSAL_TEXT =
  "🤖 I can't help with moderation — that's for the staff team. If someone's breaking the rules, use the Report button."

export const TERPBOT_FALLBACKS = [
  "🤖 Not sure what you're after. I can help with: your grow, rep, progress, diaries, strains, guides, threads, and community stats.\nTry: @terpbot my grow · @terpbot find threads about … · /help",
  "🤖 I didn't catch that. I know your grows, milestones, rep, streaks, threads, guides, strains and community activity.\nTry: @terpbot what am I close to? · @terpbot summarize this · /help",
  "🤖 Hmm, try asking differently — \"what's my streak\", \"guides about cloning\", \"check in on my grow\", or /help for the full list.",
]

export function terpbotFallbackText(seed: string): string {
  // Deterministic rotation so identical misses don't repeat verbatim.
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return TERPBOT_FALLBACKS[Math.abs(h) % TERPBOT_FALLBACKS.length]
}
