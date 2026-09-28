// Progression V2 — isomorphic config. No Prisma imports here: client
// components may import this file safely. Server-side award/gate logic
// lives in progression.ts.
//
// Locked economy: docs/progression-v2-design.md (rev 3, DESIGN LOCKED).

// ─── Mastery paths ───────────────────────────────────────────────────
export const MASTERIES = [
  "CULTIVATION",
  "RECORDS",
  "KNOWLEDGE",
  "EXPERIMENTATION",
  "COMMUNITY",
] as const
export type Mastery = (typeof MASTERIES)[number]

export const MASTERY_META: Record<Mastery, { name: string; icon: string }> = {
  CULTIVATION: { name: "Growing", icon: "🌱" },
  RECORDS: { name: "Journaling", icon: "📓" },
  KNOWLEDGE: { name: "Helping Out", icon: "💡" },
  EXPERIMENTATION: { name: "Experiments", icon: "🔬" },
  COMMUNITY: { name: "Community", icon: "🤝" },
}

// Per-path XP thresholds → mastery level M1..M10.
export const MASTERY_LEVELS = [50, 150, 350, 750, 1500, 3000, 6000, 10000, 16000, 24000] as const

export function masteryLevelFromXp(xp: number): number {
  let lvl = 0
  for (const t of MASTERY_LEVELS) if (xp >= t) lvl++
  return lvl
}

// ─── Ranks (locked thresholds — do not change without a design rev) ───
export interface Rank {
  name: string
  threshold: number
  era: "propagation" | "vegetative" | "transition" | "bloom" | "post-harvest" | "mastery"
}

export const REP_RANKS: Rank[] = [
  { name: "Seed", threshold: 0, era: "propagation" },
  { name: "Germinated", threshold: 60, era: "propagation" },
  { name: "Seedling", threshold: 180, era: "propagation" },
  { name: "Rooted", threshold: 420, era: "propagation" },
  { name: "Vegged", threshold: 900, era: "vegetative" },
  { name: "Trained", threshold: 1600, era: "vegetative" },
  { name: "Preflower", threshold: 2600, era: "transition" },
  { name: "Flowering", threshold: 4000, era: "bloom" },
  { name: "Ripening", threshold: 5800, era: "bloom" },
  { name: "Harvested", threshold: 7500, era: "post-harvest" },
  { name: "Cured", threshold: 12000, era: "post-harvest" },
  { name: "Cultivator", threshold: 17000, era: "mastery" },
  { name: "Master Cultivator", threshold: 23000, era: "mastery" },
]

export function rankFromXp(xp: number): Rank {
  let r = REP_RANKS[0]
  for (const rank of REP_RANKS) {
    if (xp >= rank.threshold) r = rank
    else break
  }
  return r
}

export function nextRank(xp: number): Rank | null {
  for (const rank of REP_RANKS) if (xp < rank.threshold) return rank
  return null
}

export function rankProgress(xp: number): { rank: Rank; next: Rank | null; pct: number } {
  const rank = rankFromXp(xp)
  const next = nextRank(xp)
  const pct = next ? Math.min(1, (xp - rank.threshold) / (next.threshold - rank.threshold)) : 1
  return { rank, next, pct }
}

// Sub-level checkpoints inside each rank gap → "Grow Level" rungs.
// [threshold, name] — emitted as once-ever MILESTONE markers when crossed.
export const REP_SUBLEVELS: Record<string, [number, string][]> = {
  Seed: [[20, "Germinating"], [40, "Cracked"]],
  Germinated: [[90, "Cotyledon"], [135, "First Node"], [160, "Established"]],
  Seedling: [[240, "Rootbound"], [300, "Anchored"], [370, "Taking Hold"]],
  Rooted: [[540, "Stretching"], [660, "Stacking"], [780, "Training"]],
  Vegged: [[1100, "Topped"], [1350, "Canopied"]],
  Trained: [[1900, "Shaped"], [2250, "Scrogged"]],
  Preflower: [[2950, "Preflowering"], [3300, "Pistils"], [3650, "Bud Sites"]],
  Flowering: [[4400, "Budding"], [4850, "Stacking Frost"], [5350, "Swelling"]],
  Ripening: [[6200, "Foxtailing"], [6800, "Flushing"]],
  Harvested: [[8200, "Chopping"], [9100, "Drying"], [10500, "Bucking"]],
  Cured: [[13700, "Jar Cure"], [15500, "Burping"]],
  Cultivator: [[19000, "Pheno Selection"], [21000, "Mother Keeper"]],
  "Master Cultivator": [],
}

// All rungs (rank thresholds + sub-levels) sorted — crossedRung detection.
export const PROGRESSION_RUNGS: { xp: number; label: string; rank: string }[] = REP_RANKS.flatMap(
  (r) => [
    { xp: r.threshold, label: r.name, rank: r.name },
    ...(REP_SUBLEVELS[r.name] ?? []).map(([xp, label]) => ({ xp, label, rank: r.name })),
  ]
).sort((a, b) => a.xp - b.xp)

export function crossedRungs(oldXp: number, newXp: number) {
  return PROGRESSION_RUNGS.filter((r) => r.xp > oldXp && r.xp <= newXp)
}

// ─── Rank diversity floors (Balanced Growth) ─────────────────────────
// Rank promotion requires XP AND breadth: [mastery level, distinct paths].
export const DIVERSITY_FLOORS: Record<string, { level: number; paths: number }> = {
  Flowering: { level: 2, paths: 2 },
  Ripening: { level: 3, paths: 2 },
  Harvested: { level: 3, paths: 3 },
  Cultivator: { level: 4, paths: 3 },
  "Master Cultivator": { level: 4, paths: 3 }, // + 1 path ≥ M6 handled separately
}

// Master Cultivator additionally requires one path at M6.
export const MASTER_EXTRA_FLOOR = { rank: "Master Cultivator", level: 6, paths: 1 }

// ─── XP economy (locked §6) ──────────────────────────────────────────
export interface XpSpec {
  xp: number
  standing?: number
  mastery?: Mastery | null
  dailyCap?: number
  weeklyCap?: number
  peerGated?: boolean // exempt from mastery soft caps — human-limited already
  /**
   * Locked-design event whose awarding feature is intentionally deferred
   * (see DEFERRED_XP_EVENTS). `awardProgression` refuses deferred types —
   * they stay in the table as the design contract but can never pay.
   */
  deferred?: true
  label: string
}

export const XP_TABLE: Record<string, XpSpec> = {
  // Cultivation
  DIARY_CREATED: { xp: 15, mastery: "CULTIVATION", dailyCap: 3, label: "Started a grow diary" },
  UPDATE_DAY: { xp: 5, mastery: "CULTIVATION", dailyCap: 5, label: "Logged a grow update" },
  UPDATE_RICH: { xp: 3, mastery: "CULTIVATION", label: "Detailed grow update" },
  UPDATE_EXCEPTIONAL: { xp: 6, mastery: "CULTIVATION", label: "Exceptional grow update" },
  STAGE_ESTABLISHED: { xp: 15, mastery: "CULTIVATION", label: "Grow reached established" },
  STAGE_VEGGING: { xp: 25, mastery: "CULTIVATION", label: "Grow is vegging" },
  STAGE_FLOWERING: { xp: 40, mastery: "CULTIVATION", label: "Grow is flowering" },
  HARVEST_LOGGED: { xp: 50, mastery: "CULTIVATION", label: "Harvest logged" },
  GROW_COMPLETE: { xp: 50, mastery: "CULTIVATION", label: "Grow completed" },
  SEASON_FINISHER: { xp: 25, mastery: "CULTIVATION", label: "Finished a full-season grow" },

  // Records
  STRUCTURED_CATEGORY: { xp: 2, mastery: "RECORDS", label: "Logged your readings (temps, pH, feeds)" },
  METRIC_FIRST: { xp: 5, mastery: "RECORDS", label: "Logged a new kind of reading" },
  SETUP_SHOWCASE: { xp: 10, mastery: "RECORDS", dailyCap: 2, label: "Shared your grow setup" },
  STRAIN_PHOTO: { xp: 4, mastery: "RECORDS", dailyCap: 5, label: "Strain photo added" },
  COVERAGE_MILESTONE: { xp: 25, mastery: "RECORDS", label: "Kept a thorough diary" },
  HARVEST_REPORT: { xp: 30, mastery: "RECORDS", label: "Wrote up a full harvest" },

  // Knowledge
  SUBSTANTIVE_ANSWER: { xp: 4, mastery: "KNOWLEDGE", dailyCap: 5, label: "Gave a helpful answer" },
  ACCEPTED_ANSWER: { xp: 30, standing: 10, mastery: "KNOWLEDGE", dailyCap: 2, peerGated: true, label: "Answer accepted" },
  OP_CURATION: { xp: 5, mastery: "KNOWLEDGE", label: "Marked the answer that fixed it" },
  NEWCOMER_ACCEPT_BONUS: { xp: 10, standing: 2, mastery: "KNOWLEDGE", peerGated: true, label: "Helped a new grower" },
  // Guides are staff-authored today — member authoring + the review queue
  // are Phase IV. Deferred: no callsite may award until that ships.
  GUIDE_PUBLISHED: { xp: 50, standing: 10, mastery: "KNOWLEDGE", peerGated: true, deferred: true, label: "Guide published" },
  GUIDE_IMPROVEMENT: { xp: 15, mastery: "KNOWLEDGE", peerGated: true, deferred: true, label: "Guide improved" },
  STRAIN_SOURCED: { xp: 10, mastery: "KNOWLEDGE", dailyCap: 5, label: "Added a strain with a source" },
  PROBLEM_RESOLVED: { xp: 20, mastery: "KNOWLEDGE", label: "Fixed a problem and wrote it up" },

  // Experimentation
  EXPERIMENT_CREATED: { xp: 5, mastery: "EXPERIMENTATION", weeklyCap: 2, label: "Experiment started" },
  HYPOTHESIS_DOC: { xp: 5, mastery: "EXPERIMENTATION", label: "Wrote down what you expected" },
  EXPERIMENT_COMPLETED: { xp: 25, mastery: "EXPERIMENTATION", label: "Experiment completed" },
  FAILURE_DOCUMENTED: { xp: 8, mastery: "EXPERIMENTATION", weeklyCap: 2, label: "Wrote up something that didn't work" },
  FOLLOWUPS_3: { xp: 10, mastery: "EXPERIMENTATION", label: "Checked back in on an experiment" },
  // Replication needs an explicit `replicates` link between experiments —
  // that entity is Phase III comparisons scope. Deferred until it exists.
  REPLICATION: { xp: 20, mastery: "EXPERIMENTATION", deferred: true, label: "Repeated another grower's experiment" },

  // Community
  THREAD_STARTED: { xp: 8, mastery: "COMMUNITY", dailyCap: 3, label: "Started a discussion" },
  REPLY: { xp: 2, mastery: "COMMUNITY", dailyCap: 10, label: "Replied to a discussion" },
  NEWCOMER_REPLY: { xp: 3, mastery: "COMMUNITY", label: "Helped a new member" },
  CONTEST_ENTRY: { xp: 5, mastery: "COMMUNITY", label: "Contest entry" },
  CONTEST_WEEKLY_WIN: { xp: 50, standing: 10, mastery: "COMMUNITY", peerGated: true, label: "Won the weekly contest" },
  CONTEST_MONTHLY_WIN: { xp: 150, standing: 20, mastery: "COMMUNITY", peerGated: true, label: "Won the monthly contest" },
  REFERRAL: { xp: 25, standing: 15, mastery: "COMMUNITY", weeklyCap: 3, peerGated: true, label: "Qualified referral" },
  // Mentoring routing is Phase IV (needs the achievement engine) — no
  // member-accessible mentor workflow exists yet. Deferred.
  MENTOR_SESSION: { xp: 5, mastery: "COMMUNITY", deferred: true, label: "Mentored a grower" },
  WEEKLY_AWARD: { xp: 50, mastery: "COMMUNITY", peerGated: true, label: "Grower of the Week" },
  STAFF_ADJUSTMENT: { xp: 0, mastery: null, label: "Staff adjustment" }, // amount passed directly

  // System/sub-engine payouts — amounts passed via opts.xp.
  DAILY_LOGIN: { xp: 0, mastery: null, label: "Daily check-in" }, // 0 XP permanently (D6) — streak signal only
  STREAK_MILESTONE: { xp: 0, mastery: null, label: "Check-in streak milestone" }, // marker row — utility rewards only
  QUEST_DAILY: { xp: 0, mastery: null, label: "Daily quest" },
  CHALLENGE_WEEKLY: { xp: 0, mastery: "COMMUNITY", label: "Weekly challenge" },
  ARC_STEP: { xp: 0, mastery: null, label: "Journey step" },
  ONBOARDING_COMPLETE: { xp: 15, mastery: "CULTIVATION", label: "Completed onboarding" },
}

// Referral qualification — a referee pays out only once they prove
// legitimate: this much XP earned on the V2 ledger plus this much age.
export const REFERRAL_MIN_XP = 25
export const REFERRAL_MIN_AGE_HOURS = 24

/**
 * Locked-design events whose awarding feature is intentionally deferred —
 * member guide authoring (Phase IV), mentoring routing (Phase IV), and
 * experiment replication links (Phase III). `awardProgression` refuses
 * these types, and member-facing earn lists must never advertise them.
 * Preserved in XP_TABLE because the design locks their economy; removal
 * would falsify the roadmap, not just the code.
 */
export const DEFERRED_XP_EVENTS = new Set(
  Object.entries(XP_TABLE).filter(([, s]) => s.deferred).map(([t]) => t)
)

// Member-driven XP types — the weekly-board allowlist. Excludes system
// payouts (quests, challenges, journeys, contests, referrals, weekly
// award, milestones, staff) so a machine award can never compound into
// the following week's ranking.
export const MEMBER_DRIVEN_XP_TYPES = new Set([
  "THREAD_STARTED", "REPLY", "SUBSTANTIVE_ANSWER", "NEWCOMER_REPLY", "OP_CURATION",
  "ACCEPTED_ANSWER", "NEWCOMER_ACCEPT_BONUS",
  "DIARY_CREATED", "UPDATE_DAY", "UPDATE_RICH", "UPDATE_EXCEPTIONAL",
  "STAGE_ESTABLISHED", "STAGE_VEGGING", "STAGE_FLOWERING",
  "HARVEST_LOGGED", "GROW_COMPLETE", "SEASON_FINISHER",
  "STRUCTURED_CATEGORY", "METRIC_FIRST", "SETUP_SHOWCASE",
  "STRAIN_PHOTO", "STRAIN_SOURCED", "COVERAGE_MILESTONE", "HARVEST_REPORT",
  "GUIDE_PUBLISHED", "GUIDE_IMPROVEMENT", "PROBLEM_RESOLVED",
  "EXPERIMENT_CREATED", "HYPOTHESIS_DOC", "EXPERIMENT_COMPLETED",
  "FAILURE_DOCUMENTED", "FOLLOWUPS_3", "REPLICATION",
])

// REVERSAL/REINSTATE are included so the weekly sum is *net* — clawed-back
// XP stops counting; a reinstated award counts again.
export const WEEKLY_BOARD_XP_TYPES: string[] = [...MEMBER_DRIVEN_XP_TYPES, "REVERSAL", "REINSTATE"]

// Zero-XP types kept as marker/system rows.
export const SYSTEM_EVENT_TYPES = new Set([
  "MILESTONE", // sub-level/rank-up marker (0 xp)
  "REVERSAL",
  "REINSTATE",
  "LEGACY_STANDING",
  "STANDING_RECOVERY",
  "UNLOCK_FREEZE",
  "STANDING_ONLY", // standing-only positive events (e.g. REPORT_UPHELD)
])

// Events whose standing component is judge/staff-driven or negative —
// tracked separately from XP_TABLE entries' positive peer standing.
export const STANDING_SOURCES = new Set([
  "ACCEPTED_ANSWER", "NEWCOMER_ACCEPT_BONUS", "CONTEST_WEEKLY_WIN",
  "CONTEST_MONTHLY_WIN", "REFERRAL", "GUIDE_PUBLISHED", "REPORT_UPHELD",
  "STAFF_GRANT", "LEGACY_STANDING", "STANDING_RECOVERY",
])

// ─── Standing config (locked §9) ─────────────────────────────────────
export const STANDING_WEEKLY_CAP = 40 // member-driven standing income ceiling
export const STANDING_PER_SOURCE_WEEK_CAP = 20 // contest/referral/report each
export const STANDING_PER_GRANTOR_LIFETIME = 30 // one grantor can't carry you
export const STANDING_GRANTOR_REPEAT_FACTOR = 0.5 // subsequent grants within 90d
export const STANDING_GRANTOR_WINDOW_DAYS = 90
export const STANDING_RECIPROCAL_WINDOW_DAYS = 90 // grantor got standing from you → 0
export const STANDING_GRANTOR_MIN_AGE_HOURS = 24 // grantor-age floor (legacy accept gate carried forward)
export const STANDING_CLUSTER_SHARE = 0.6 // ≥60% from one cluster → discount
export const STANDING_REPORT_UPHELD = 5
export const STANDING_REPORT_AGAINST = -20
export const STANDING_ABUSE_FLAG = -50
export const STANDING_MASS_REVERSAL = -15
export const STANDING_RECOVERY_AMOUNT = 25 // after 90 flag-free days, once per flag
export const STANDING_RECOVERY_DAYS = 90

// Standing-gated permission thresholds.
export const STANDINGS = [
  { min: 0, name: "New Face" },
  { min: 25, name: "Known" },
  { min: 100, name: "Trusted" },
  { min: 300, name: "Respected" },
  { min: 800, name: "Pillar" },
  { min: 1500, name: "Elder" },
] as const

export function standingName(standing: number): string {
  let s: string = STANDINGS[0].name
  for (const st of STANDINGS) {
    if (standing >= st.min) s = st.name
    else break
  }
  return s
}

// Presentation metadata for the standing ladder — public trust chips.
export const STANDING_DISPLAY: Record<string, { icon: string; color: string; bg: string }> = {
  "New Face": { icon: "🌰", color: "text-stone-500", bg: "bg-stone-500/10" },
  Known: { icon: "🌱", color: "text-success", bg: "bg-green-500/10" },
  Trusted: { icon: "🌿", color: "text-success", bg: "bg-emerald-500/10" },
  Respected: { icon: "🪴", color: "text-cyan-500", bg: "bg-cyan-500/10" },
  Pillar: { icon: "🏛️", color: "text-purple-500", bg: "bg-purple-500/10" },
  Elder: { icon: "🌟", color: "text-warning", bg: "bg-amber-500/10" },
}

export function standingDisplay(standing: number): { name: string; icon: string; color: string; bg: string } {
  const name = standingName(standing)
  return { name, ...STANDING_DISPLAY[name] }
}

export const STANDING_LINKS = 25 // post external links (Known + 24h age)
export const STANDING_POLL_VOTE = 25
export const STANDING_POLL_CREATE = 100
export const STANDING_VERIFIED = 300 // Progression Verified (Respected + 30d + no flags)
export const STANDING_VERIFIED_FLOOR = 100 // demote buffer — drops below Trusted → demote
export const STANDING_SLOWMODE_EXEMPT = 800
export const VERIFIED_MIN_AGE_DAYS_V2 = 30

// ─── Quality + duplicate detection (locked §6.7) ─────────────────────
export const QUALITY_BANDS = {
  RICH_MIN_CHARS: 150, // ≥150 chars AND ≥1 structured category → band 2
  RICH_MIN_CATEGORIES: 3, // OR ≥3 structured categories
  EXCEPTIONAL_MIN_CHARS: 250, // ≥250 chars AND ≥2 categories (≥1 numeric) AND photo
  EXCEPTIONAL_MIN_CATEGORIES: 2,
  SUBSTANTIVE_MIN_CHARS: 200, // substantive-answer threshold
}
export const DUP_WITHHOLD_PCT = 95 // ≥95% → award withheld
export const DUP_REDUCE_PCT = 85 // 85–94% → bonuses withheld, base only if new structured data

// ─── Soft caps (locked §6.8) ─────────────────────────────────────────
export const MASTERY_WEEKLY_FULL = 250 // full rate
export const MASTERY_WEEKLY_MID = 500 // 50% 250–500, 25% beyond
export const MASTERY_WEEKLY_MID_FACTOR = 0.5
export const MASTERY_WEEKLY_TAIL_FACTOR = 0.25

// ─── Unlock registry (locked §8 + plan Phase 6) ──────────────────────
export type UnlockLayer = "A" | "B" | "C"
export interface UnlockSpec {
  id: string
  name: string
  category: "functional" | "convenience" | "capacity" | "analytics" | "terpbot" | "leadership" | "showcase" | "deals" | "prestige"
  layer: UnlockLayer
  rank?: string // rank NAME (compared against REP_RANKS threshold)
  mastery?: { path: Mastery; level: number }
  standing?: number // min standing score
  achievement?: string // achievement key that grants it (alt route)
  streak?: number // check-in streak days that grant it (alt route — streak:<days>:<userId> marker)
  anyOf?: boolean // rank OR mastery is sufficient (alternate specialist routes)
  flag?: string // feature-flag Setting key
  /**
   * "future" = locked roadmap entry whose feature is intentionally deferred
   * (a later phase). Never enforced, never grantable — `hasUnlock` returns
   * false and `nextRankUnlock`/unlock roadmaps skip or label it. A registry
   * row may only ship *live* with its enforcement callsite or a documented
   * free-tier semantic; rows kept for roadmap visibility carry this flag.
   */
  status?: "future"
  blurb: string // what it unlocks + how to use it (UX copy)
}

export const UNLOCKS: UnlockSpec[] = [
  // Early — Layer A
  // (streak-dashboard, saved-searches-3, comparison-basic removed in
  // Phase I — the features are free for everyone, so the "unlock"
  // promised less than reality. The ladder keeps what genuinely changes.)
  { id: "comparison-slot-2", name: "Compare 2 grows at once", category: "capacity", layer: "A", rank: "Seedling", status: "future", blurb: "Keep two side-by-side comparisons open." },
  { id: "grow-templates", name: "Quick-log templates", category: "functional", layer: "A", rank: "Rooted", status: "future", blurb: "Update forms prefilled for your soil or hydro setup, so logging takes seconds." },
  { id: "quest-slot-4", name: "4th daily quest", category: "functional", layer: "A", rank: "Rooted", blurb: "One more quest on your board each day." },
  { id: "saved-views", name: "Saved filters", category: "convenience", layer: "A", rank: "Rooted", status: "future", blurb: "Pin the diary and feed filters you keep coming back to." },
  { id: "members-deals", name: "Members' deals", category: "deals", layer: "A", rank: "Rooted", blurb: "Partner discounts and codes set aside for growers who've put down roots." },

  // Mid — A + B
  { id: "env-analytics", name: "Advanced environment charts", category: "analytics", layer: "B", rank: "Vegged", mastery: { path: "RECORDS", level: 2 }, blurb: "On your own grows: night temps, CO₂, PPFD and the rest — plus day/night splits and 30/90-day trends beyond the basic chart." },
  { id: "comparison-env", name: "Compare your tent conditions", category: "analytics", layer: "B", rank: "Vegged", mastery: { path: "RECORDS", level: 2 }, status: "future", blurb: "Lay your temperature and humidity over what other growers are running." },
  { id: "harvest-analytics", name: "Harvest trends", category: "analytics", layer: "A", rank: "Vegged", blurb: "How your yields and ratings have changed from harvest to harvest." },
  // (grows-6 removed — no active-grow cap is manufactured just to gate it.)
  { id: "export-tools", name: "Per-grow CSV export", category: "functional", layer: "A", rank: "Trained", blurb: "Download a grow's full update log as a spreadsheet-ready CSV. (The whole-account JSON export stays free for everyone.)" },
  // (advanced-filters removed — every existing filter stays free; no
  //  gate was manufactured on basic search.)
  { id: "saved-searches-10", name: "Save 10 searches", category: "capacity", layer: "A", rank: "Trained", blurb: "A full shelf of saved searches — up from the 3 everyone gets." },
  { id: "custom-reminders", name: "Grow reminders", category: "functional", layer: "A", rank: "Trained", status: "future", blurb: "Set your own reminders to water, feed, or check on a grow." },
  { id: "terpbot-watch-basic", name: "TerpBot keeps an eye out", category: "terpbot", layer: "A", rank: "Preflower", status: "future", blurb: "Set up to 3 alerts — e.g. 'tell me if my tent gets too humid'." },
  { id: "longitudinal-analysis", name: "Whole-grow review", category: "terpbot", layer: "B", rank: "Flowering", mastery: { path: "RECORDS", level: 2 }, status: "future", blurb: "TerpBot looks back over a full grow and points out what changed and when." },
  { id: "comparison-multi", name: "Compare whole grows", category: "analytics", layer: "B", rank: "Flowering", mastery: { path: "RECORDS", level: 2 }, status: "future", blurb: "Put entire grows side by side — yours against yours, or against the community." },
  { id: "images-6", name: "6 photos per post", category: "capacity", layer: "A", rank: "Flowering", status: "future", blurb: "More room to show what you're seeing." },

  // Late — B + C
  { id: "guide-authoring", name: "Write grow guides", category: "leadership", layer: "B", rank: "Ripening", mastery: { path: "KNOWLEDGE", level: 3 }, anyOf: true, status: "future", blurb: "Publish your own guides for the community (staff-reviewed)." },
  { id: "challenge-creation", name: "Run a challenge", category: "leadership", layer: "B", rank: "Ripening", mastery: { path: "COMMUNITY", level: 4 }, anyOf: true, status: "future", blurb: "Set a community challenge and see who joins in." },
  { id: "mentoring-tools", name: "Mentor new growers", category: "leadership", layer: "C", rank: "Ripening", mastery: { path: "KNOWLEDGE", level: 3 }, standing: STANDING_POLL_CREATE, anyOf: true, achievement: "greenlight", status: "future", blurb: "Unanswered beginner questions get routed to you, and you're listed as a mentor." },
  { id: "nutrient-schedules", name: "Feed-chart presets", category: "functional", layer: "B", mastery: { path: "RECORDS", level: 3 }, status: "future", blurb: "Pick your nutrient brand and its feeding schedule drops straight into your update form." },
  { id: "data-quality-insights", name: "What's missing from your log", category: "analytics", layer: "B", mastery: { path: "RECORDS", level: 2 }, achievement: "full-spectrum", status: "future", blurb: "A gentle checklist of readings your diary doesn't have yet." },
  { id: "experiment-templates", name: "Copy a proven test", category: "functional", layer: "B", mastery: { path: "EXPERIMENTATION", level: 2 }, status: "future", blurb: "Start a new experiment from one that already worked." },
  { id: "rate-1.5", name: "Post & chat more often", category: "capacity", layer: "A", rank: "Harvested", status: "future", blurb: "Looser limits on how often you can post and chat." },
  { id: "images-8", name: "8 photos per post", category: "capacity", layer: "A", rank: "Harvested", status: "future", blurb: "Even more room for photos." },
  { id: "pinned-harvest", name: "Pin a harvest to your profile", category: "showcase", layer: "A", rank: "Harvested", streak: 60, blurb: "Pick your proudest harvest and it sits at the top of your profile." },
  { id: "grower-cockpit", name: "Grower Cockpit", category: "functional", layer: "A", rank: "Harvested", status: "future", blurb: "Your grows, alerts, comparisons and quests all on one screen." },
  { id: "watch-advanced", name: "More TerpBot alerts", category: "terpbot", layer: "B", rank: "Harvested", mastery: { path: "RECORDS", level: 3 }, status: "future", blurb: "Up to 10 alerts, including ones that watch over several days." },
  { id: "watch-compound", name: "Combined alerts", category: "terpbot", layer: "B", mastery: { path: "RECORDS", level: 4 }, status: "future", blurb: "Alerts that watch two things at once — say, humidity during late flower." },
  { id: "experiment-analysis", name: "What your experiments taught you", category: "terpbot", layer: "B", rank: "Harvested", mastery: { path: "EXPERIMENTATION", level: 2 }, status: "future", blurb: "TerpBot sums up what worked across all your finished experiments." },
  { id: "historical-trends", name: "This grow vs your past grows", category: "analytics", layer: "B", rank: "Cured", mastery: { path: "RECORDS", level: 4 }, status: "future", blurb: "See how your current grow compares with your own earlier seasons." },
  { id: "dashboard-advanced", name: "Bigger cockpit, 15 alerts", category: "analytics", layer: "A", rank: "Cured", status: "future", blurb: "More cockpit panels and more TerpBot alerts." },
  { id: "rate-2", name: "Post & chat freely, 7 tags", category: "capacity", layer: "A", rank: "Cured", status: "future", blurb: "The loosest posting limits and more tags per thread." },
  { id: "grower-spotlight", name: "Grower Spotlight", category: "showcase", layer: "A", rank: "Cured", streak: 100, blurb: "Your active grow can be featured on the TerpTalk home page." },
  { id: "quest-slot-5", name: "5th daily quest", category: "functional", layer: "A", rank: "Cultivator", blurb: "A fifth quest on your board each day." },

  // Prestige — C
  { id: "grow-room", name: "The Grow Room", category: "leadership", layer: "C", rank: "Cultivator", standing: 100, blurb: "The trusted growers' chat room — takes rank and a good standing." },
  { id: "community-evidence", name: "What's working for other growers", category: "analytics", layer: "C", rank: "Cultivator", standing: 100, status: "future", blurb: "Patterns pulled from public diaries — no names, just what tends to work." },
  { id: "images-10", name: "10 photos per post", category: "capacity", layer: "A", rank: "Cultivator", status: "future", blurb: "The most room for photos." },
  { id: "top-shelf-deals", name: "Top-shelf deals", category: "deals", layer: "A", rank: "Cultivator", blurb: "The best partner offers, reserved for the most experienced growers." },
  { id: "the-vault", name: "The Vault", category: "leadership", layer: "C", rank: "Master Cultivator", standing: 300, blurb: "The top room. Few get in, on purpose." },
  { id: "research-aggregates", name: "Deeper community stats", category: "analytics", layer: "B", rank: "Master Cultivator", mastery: { path: "RECORDS", level: 4 }, status: "future", blurb: "More detailed community-wide numbers, still anonymous." },
  // Enforced today for partner deals (`canSeeDeal` on /deals + /go/*);
  // the "try new features" half has no feature-flag consumers yet — the
  // blurb only promises the part that works.
  { id: "early-access", name: "First look", category: "prestige", layer: "A", rank: "Master Cultivator", blurb: "See new partner deals before they go public." },
]

export const UNLOCK_BY_ID = new Map(UNLOCKS.map((u) => [u.id, u]))

// The first rank-gated unlock a member is still climbing toward — powers
// every "next unlock" surface (member-facing, so rank-only entries count;
// streak/achievement/mastery alternates are hidden routes). `future`
// roadmap entries are skipped — an unlock that's on the horizon but not
// built must never be presented as the next thing you earn.
export function nextRankUnlock(xp: number): { id: string; name: string; rank: string; xpNeeded: number } | null {
  const next = UNLOCKS.filter(
    (u) => u.rank && u.status !== "future" && xp < (REP_RANKS.find((r) => r.name === u.rank)?.threshold ?? Infinity)
  ).sort(
    (a, b) =>
      (REP_RANKS.find((r) => r.name === a.rank)!.threshold) - (REP_RANKS.find((r) => r.name === b.rank)!.threshold)
  )[0]
  if (!next || !next.rank) return null
  const threshold = REP_RANKS.find((r) => r.name === next.rank)!.threshold
  return { id: next.id, name: next.name, rank: next.rank, xpNeeded: threshold }
}

// ─── Build titles (locked §7.2) ──────────────────────────────────────
export function buildTitle(paths: Record<Mastery, number>): { title: string; dominant: Mastery | null } {
  const total = MASTERIES.reduce((s, m) => s + (paths[m] ?? 0), 0)
  if (total === 0) return { title: "New Grower", dominant: null }
  const sorted = MASTERIES.map((m) => ({ m, xp: paths[m] ?? 0 })).sort((a, b) => b.xp - a.xp)
  const [top, second, third] = sorted
  if (top.xp / total >= 0.7) {
    const solo: Record<Mastery, string> = {
      CULTIVATION: "Grower", RECORDS: "Journal Keeper", KNOWLEDGE: "Helper",
      EXPERIMENTATION: "Tinkerer", COMMUNITY: "Regular",
    }
    return { title: solo[top.m], dominant: top.m }
  }
  if (third && third.xp / total >= 0.2 && sorted.slice(0, 3).every((s) => s.xp / total >= 0.2))
    return { title: "All-Rounder", dominant: null }
  const pairKey = [top.m, second.m].sort().join("+")
  const hybrids: Record<string, string> = {
    "CULTIVATION+RECORDS": "Grower Who Keeps Notes",
    "CULTIVATION+KNOWLEDGE": "Grower Who Helps",
    "EXPERIMENTATION+RECORDS": "Careful Tinkerer",
    "COMMUNITY+KNOWLEDGE": "Helpful Regular",
    "CULTIVATION+COMMUNITY": "Friendly Grower",
    "EXPERIMENTATION+KNOWLEDGE": "Hands-On Helper",
    "CULTIVATION+EXPERIMENTATION": "Curious Grower",
    "COMMUNITY+RECORDS": "Regular Who Keeps Notes",
    "KNOWLEDGE+RECORDS": "Well-Read Journal Keeper",
    "COMMUNITY+EXPERIMENTATION": "Curious Regular",
  }
  return { title: hybrids[pairKey] ?? `Mostly ${MASTERY_META[top.m].name}`, dominant: top.m }
}

// ─── Public history surface ──────────────────────────────────────────
// Which event types are shown on a member's public progression history.
// Everything not listed is staff/owner-only (adjustments, check-in
// cadence, standing bookkeeping, abuse internals).
export const PUBLIC_XP_TYPES = new Set<string>([
  ...Object.keys(XP_TABLE).filter((t) => t !== "DAILY_LOGIN" && t !== "STAFF_ADJUSTMENT"),
  "MILESTONE",
  "REVERSAL",
  "REINSTATE",
])

// Public-safe label per type — raw `reason` strings can embed titles and
// usernames, so public surfaces always render these labels instead.
export function publicXpLabel(type: string): string {
  switch (type) {
    case "MILESTONE": return "Reached a grow level"
    case "REVERSAL": return "XP adjustment"
    case "REINSTATE": return "XP restored"
    default: return XP_TABLE[type]?.label ?? "Progression event"
  }
}

// ─── Rank presentation ───────────────────────────────────────────────
// Display metadata per rank — public surfaces (profile tier chip,
// leaderboard) render these. `benefit` names the headline unlock(s) so
// "what am I working toward" is always answerable.
export const RANK_DISPLAY: Record<string, { icon: string; color: string; bg: string; benefit: string; nameplate?: string }> = {
  Seed: { icon: "🌰", color: "text-stone-500", bg: "bg-stone-500/10", benefit: "Every grow starts somewhere — post, grow, and share to earn XP." },
  // Benefit strings name only what the rank actually delivers today.
  // Roadmap items the rank will eventually carry are phrased as future
  // (or omitted) — never as if they unlock now.
  Germinated: { icon: "🌱", color: "text-success", bg: "bg-lime-500/10", benefit: "Roots are down — check in daily to start your streak milestones." },
  Seedling: { icon: "🌿", color: "text-success", bg: "bg-green-500/10", benefit: "One rank closer — a 4th daily quest slot and members' deals open at Rooted.", nameplate: "tt-nameplate-leaf" },
  Rooted: { icon: "🪴", color: "text-success", bg: "bg-green-600/10", benefit: "A 4th daily quest slot and members' deals.", nameplate: "tt-nameplate-leaf" },
  Vegged: { icon: "🌲", color: "text-success", bg: "bg-emerald-500/10", benefit: "Advanced environment charts and harvest trends for your own grows.", nameplate: "tt-nameplate-leaf" },
  Trained: { icon: "✂️", color: "text-success", bg: "bg-emerald-600/10", benefit: "Save up to 10 searches and export any grow's full log as CSV.", nameplate: "tt-nameplate-leaf" },
  Preflower: { icon: "🌸", color: "text-fuchsia-500", bg: "bg-fuchsia-500/10", benefit: "TerpBot grow alerts are on the roadmap at this rank.", nameplate: "tt-nameplate-bloom" },
  Flowering: { icon: "🌺", color: "text-fuchsia-500", bg: "bg-fuchsia-600/10", benefit: "Whole-grow review and side-by-side comparisons are on the roadmap.", nameplate: "tt-nameplate-bloom" },
  Ripening: { icon: "🍯", color: "text-amber-500", bg: "bg-amber-500/10", benefit: "Guide writing and community challenges are on the roadmap at this rank.", nameplate: "tt-nameplate-bloom" },
  Harvested: { icon: "🌾", color: "text-warning", bg: "bg-amber-600/10", benefit: "Pin a harvest to the top of your profile — a 60-day streak counts too.", nameplate: "tt-nameplate-master" },
  Cured: { icon: "🏺", color: "text-cyan-500", bg: "bg-cyan-500/10", benefit: "Your active grow can be featured in the Grower Spotlight on the home page.", nameplate: "tt-nameplate-master" },
  Cultivator: { icon: "🏆", color: "text-purple-500", bg: "bg-purple-500/10", benefit: "A 5th daily quest, top-shelf deals, and the Grow Room at 100 standing.", nameplate: "tt-nameplate-grand" },
  "Master Cultivator": { icon: "👑", color: "text-warning", bg: "bg-amber-400/10", benefit: "The Vault at 300 standing and first look at new partner deals.", nameplate: "tt-nameplate-gold" },
}

export function rankDisplay(xp: number): Rank & { icon: string; color: string; bg: string; benefit: string; nameplate?: string } {
  const rank = rankFromXp(xp)
  return { ...rank, ...(RANK_DISPLAY[rank.name] ?? RANK_DISPLAY.Seed) }
}

// Shape-compatible with the legacy getTierProgress — progress toward the
// next rank as { current: rank threshold, next: next threshold, percent }.
export function xpRankProgress(xp: number): { current: number; next: number; percent: number } {
  const { rank, next, pct } = rankProgress(xp)
  if (!next) return { current: rank.threshold, next: rank.threshold, percent: 100 }
  return { current: rank.threshold, next: next.threshold, percent: Math.round(pct * 100) }
}

// Grow Level — 1-based position on the combined rung ladder (rank
// thresholds + named sub-levels), the frequent feedback layer inside
// each rank gap. Pure presentation, derived from XP.
export interface XpStage {
  level: number
  rank: Rank
  stageName: string
  stageIndex: number
  stageCount: number
  stageStart: number
  stageEnd: number
}

export function xpStage(xp: number): XpStage {
  const rank = rankFromXp(xp)
  const rungs = [
    { xp: rank.threshold, label: rank.name },
    ...(REP_SUBLEVELS[rank.name] ?? []).map(([r, label]) => ({ xp: r, label })),
  ]
  let stageIndex = 0
  for (let i = 0; i < rungs.length; i++) {
    if (xp >= rungs[i].xp) stageIndex = i
    else break
  }
  const stageStart = rungs[stageIndex].xp
  const stageEnd = rungs[stageIndex + 1]?.xp ?? nextRank(xp)?.threshold ?? stageStart
  const level = PROGRESSION_RUNGS.findIndex((r) => r.xp === stageStart) + 1
  return {
    level,
    rank,
    stageName: rungs[stageIndex].label,
    stageIndex,
    stageCount: rungs.length,
    stageStart,
    stageEnd,
  }
}

export function xpStageProgress(xp: number): { current: number; next: number; percent: number; remaining: number } {
  const stage = xpStage(xp)
  if (stage.stageEnd <= stage.stageStart) {
    return { current: xp, next: xp, percent: 100, remaining: 0 }
  }
  const range = stage.stageEnd - stage.stageStart
  const gained = xp - stage.stageStart
  return {
    current: gained,
    next: range,
    percent: Math.min(100, Math.max(0, Math.round((gained / range) * 100))),
    remaining: range - gained,
  }
}
