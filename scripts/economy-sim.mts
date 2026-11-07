#!/usr/bin/env tsx
/**
 * Rewards V4 economy simulation — deterministic member-profile model.
 *
 * Not a DB test: this projects the LIVE XP_TABLE + cap rules forward so
 * reward values can be evaluated before/without touching data. Weekly XP
 * is already expressed post-mastery-soft-cap (250 full / 250–500 half /
 * >500 quarter per track) — i.e. numbers below are sustainable rates,
 * not burst rates.
 *
 * Run: npx tsx scripts/economy-sim.mts
 */
import { REP_RANKS, STANDINGS } from "@/lib/progression-config"

type Track = "CULTIVATION" | "RECORDS" | "KNOWLEDGE" | "EXPERIMENTATION" | "COMMUNITY"

interface Profile {
  name: string
  blurb: string
  weeklyXp: Partial<Record<Track, number>> // post-soft-cap sustainable weekly XP
  weeklyStanding: number // member-driven standing/week (ceiling 40)
  notes?: string
}

// Assumptions (documented in progression-v4-rewards-design.md §8):
// - "week" = 7 active days; quests ~3/day selected, ~70% completion ≈ 100–160 XP/wk.
// - Update band ≈ 2 (text + some structure): UPDATE_DAY5+RICH3+~2 cats ≈ 12–15 XP/update.
// - Accepts are the dominant standing source; 40/wk is the hard member-driven ceiling.
// - Standing numbers already reflect grantor-floor/reciprocal discounts for typical use.
const PROFILES: Profile[] = [
  {
    name: "Explorer",
    blurb: "Reads everything, posts rarely, does ~2 quests/day.",
    weeklyXp: { COMMUNITY: 60, KNOWLEDGE: 20 },
    weeklyStanding: 2,
  },
  {
    name: "Casual grower",
    blurb: "One diary update most days, a reply here and there.",
    weeklyXp: { CULTIVATION: 110, KNOWLEDGE: 30, COMMUNITY: 120 },
    weeklyStanding: 5,
  },
  {
    name: "Dedicated grower",
    blurb: "Two updates/day in season, forum replies, one experiment.",
    weeklyXp: { CULTIVATION: 260, KNOWLEDGE: 60, COMMUNITY: 110, EXPERIMENTATION: 50, RECORDS: 30 },
    weeklyStanding: 8,
  },
  {
    name: "Helpful member",
    blurb: "Answers questions daily; rarely grows. No diary needed to progress.",
    weeklyXp: { KNOWLEDGE: 260, COMMUNITY: 90 },
    weeklyStanding: 38, // ~4 accepted answers/wk — just under the 40 ceiling
    notes: "Standing-capped: more accepts don't pay beyond 40/wk member-driven.",
  },
  {
    name: "Social contributor",
    blurb: "Active in moments/chat, reacts and comments on others.",
    weeklyXp: { COMMUNITY: 230 },
    weeklyStanding: 30,
    notes: "Single-track XP → diversity floors stall rank ~Preflower by design.",
  },
  {
    name: "Experienced grower",
    blurb: "Multiple diaries, experiments, answers, contests across all features.",
    weeklyXp: { CULTIVATION: 320, RECORDS: 90, KNOWLEDGE: 140, EXPERIMENTATION: 90, COMMUNITY: 140 },
    weeklyStanding: 22,
  },
  {
    name: "Occasional",
    blurb: "Weekly check-in, a quest or two, rare posts.",
    weeklyXp: { CULTIVATION: 40, COMMUNITY: 40 },
    weeklyStanding: 2,
  },
  {
    name: "Abuse-prone",
    blurb: "Maxes every cap, farms reactions/follows with sockpuppets.",
    weeklyXp: { COMMUNITY: 170, KNOWLEDGE: 60, RECORDS: 50, CULTIVATION: 60 },
    weeklyStanding: 15, // theoretical ceiling 40; ring discounts + per-grantor 30 lifetime cut real take
    notes: "Velocity flag at 300 repeatable-XP/24h trips within ~2 days of grinding.",
  },
]

const wks = (xp: number, threshold: number) => (xp <= 0 ? Infinity : threshold / xp)
const fmt = (w: number) => (w === Infinity ? "—" : w > 520 ? ">10y" : `${Math.ceil(w)}w`)

console.log("Rewards V4 — projected progression (post-cap sustainable rates)\n")
console.log(
  "profile".padEnd(22) +
    "XP/wk".padStart(7) +
    "St/wk".padStart(7) +
    REP_RANKS.filter((r) => r.threshold > 0)
      .map((r) => r.name.slice(0, 4).padStart(5))
      .join("") +
    "  Trusted Respected".padStart(18)
)

for (const p of PROFILES) {
  const total = Object.values(p.weeklyXp).reduce((a, b) => a + (b ?? 0), 0)
  const rankTimes = REP_RANKS.filter((r) => r.threshold > 0).map((r) => fmt(wks(total, r.threshold)))
  const trusted = STANDINGS.find((s) => s.name === "Trusted")!
  const respected = STANDINGS.find((s) => s.name === "Respected")!
  console.log(
    p.name.padEnd(22) +
      String(total).padStart(7) +
      String(p.weeklyStanding).padStart(7) +
      rankTimes.join("") +
      `  ${fmt(wks(p.weeklyStanding, trusted.min))} ${fmt(wks(p.weeklyStanding, respected.min))}`.padStart(18) +
      (p.notes ? `   # ${p.notes}` : "")
  )
}

console.log("\nRank thresholds:", REP_RANKS.map((r) => `${r.name}=${r.threshold}`).join(", "))
console.log("Standing tiers:", STANDINGS.map((s) => `${s.name}>=${s.min}`).join(", "))
console.log("\nReading: weeks-to-threshold assumes the profile sustains listed weekly XP.")
console.log("Social contributor stalls at diversity floors — XP is single-track COMMUNITY.")
console.log("Helpful member hits the 40/wk member-driven standing ceiling by design.")
