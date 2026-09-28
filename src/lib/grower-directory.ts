import { MASTERIES, MASTERY_LEVELS, type Mastery } from "@/lib/progression-config"

// Grower-directory mastery filter (P4 §14): members who reached level
// M3+ in a path — "Showing growers with Helping Out M3+". M3 = 350 path
// XP, a real specialization signal, not a dabble threshold. Deterministic
// and explainable — no ranking, just a threshold on stored progress.
export const MASTERY_MIN_XP = MASTERY_LEVELS[2]

/** Parses the `?mastery=` query param — anything outside the five real
    paths is ignored, never trusted. */
export function masteryParam(raw: string | undefined | null): Mastery | null {
  const m = raw?.toUpperCase()
  return m && (MASTERIES as readonly string[]).includes(m) ? (m as Mastery) : null
}

/** Prisma `where` fragment restricting a member to M3+ in `m`. Applies
    on `User` (`author: { … }`) or nested under `user: { … }`. Indexed by
    MasteryProgress(userId, mastery). */
export function masteryQualified(m: Mastery) {
  return {
    masteryProgress: { some: { mastery: m, xp: { gte: MASTERY_MIN_XP } } },
  } as const
}
