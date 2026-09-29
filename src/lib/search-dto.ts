import { buildTitle, type Mastery } from "@/lib/progression-config"

/** Row shape the search users query selects (profile + mastery progress).
    The stored mastery column is a String — values outside the five real
    paths contribute no title signal. */
export interface SearchProfileRow {
  username: string | null
  userId: string
  avatarUrl: string | null
  xp: number
  publicMilestoneOptOut: boolean
  bio: string | null
  user: { masteryProgress: { mastery: string; xp: number }[] }
}

/**
 * SearchProfileDTO (P4 §15) — compact grower identity for search results:
 * avatar, username, rank inputs, one-line identity (buildTitle needs ≥50
 * total path XP; opted-out members get null because their status display
 * is hidden by choice). `userId` rides along only so the route's
 * viewer-scoped block strip can filter — it is removed before the payload
 * leaves the server.
 */
export function toSearchProfileDTO(u: SearchProfileRow) {
  const pathXp = Object.fromEntries(u.user.masteryProgress.map((m) => [m.mastery, m.xp])) as Record<Mastery, number>
  const totalPathXp = Object.values(pathXp).reduce((s, n) => s + n, 0)
  return {
    username: u.username,
    userId: u.userId,
    avatarUrl: u.avatarUrl,
    // Opted-out members hide public status — null the raw XP so the hidden
    // value never reaches the client; the flag stays for chip suppression.
    xp: u.publicMilestoneOptOut ? null : u.xp,
    publicMilestoneOptOut: u.publicMilestoneOptOut,
    bio: u.bio,
    buildTitle: u.publicMilestoneOptOut || totalPathXp < 50 ? null : buildTitle(pathXp).title,
  }
}
