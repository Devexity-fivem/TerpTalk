import { unstable_cache } from "next/cache"
import { prisma } from "@/lib/prisma"
import { TERPBOT_USERNAME } from "@/lib/terpbot"

// ─── Suggested growers ─────────────────────────────────────────────
// Deterministic, inexpensive suggestions for cold-start onboarding.
// The candidate pool is bounded (top 100 by reputation among users with
// a completed-ish profile) and cached; per-viewer exclusions (self,
// already followed, blocks either way, TerpBot) are applied after.

export interface SuggestedUser {
  id: string
  username: string | null
  name: string | null
  image: string | null
  role: string
  bio: string | null
  reputation: number
  followers: number
}

async function fetchCandidatePool() {
    const now = new Date()
    return prisma.profile.findMany({
      where: {
        user: {
          banned: false,
          OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: now } }],
        },
        OR: [{ avatarUrl: { not: null } }, { bio: { not: null } }],
      },
      orderBy: { reputation: "desc" },
      take: 100,
      select: {
        username: true,
        bio: true,
        avatarUrl: true,
        reputation: true,
        user: {
          select: {
            id: true,
            name: true,
            image: true,
            role: true,
            lastSeenAt: true,
            // Note: `following` is the inverted relation name — its _count
            // is this user's follower count.
            _count: {
              select: { following: true, posts: true, threadCreator: true, diaryCreator: true },
            },
          },
        },
      },
    })
}

// Normalize to JSON-safe values — unstable_cache round-trips through
// JSON.stringify/parse, so Date objects would come back as strings.
function toJsonSafePool(pool: Awaited<ReturnType<typeof fetchCandidatePool>>) {
  return pool.map((p) => {
    const { lastSeenAt, ...user } = p.user
    return { ...p, user: { ...user, lastSeenAtMs: lastSeenAt?.getTime() ?? null } }
  })
}

const getCachedCandidatePool = unstable_cache(
  async () => toJsonSafePool(await fetchCandidatePool()),
  ["onboarding-suggested-users"],
  { revalidate: 300 }
)

export async function getSuggestedUsers(viewerId: string, limit = 10): Promise<SuggestedUser[]> {
  // unstable_cache only works inside a Next.js request context — fall back
  // to a direct query when called from scripts/tests.
  let pool: ReturnType<typeof toJsonSafePool>
  try {
    pool = await getCachedCandidatePool()
  } catch {
    pool = toJsonSafePool(await fetchCandidatePool())
  }

  const [follows, blocks, terpbot] = await Promise.all([
    prisma.follow.findMany({ where: { followerId: viewerId }, select: { followingId: true } }),
    prisma.block.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    }),
    prisma.profile.findUnique({ where: { username: TERPBOT_USERNAME }, select: { userId: true } }),
  ])

  const excluded = new Set<string>([viewerId])
  for (const f of follows) excluded.add(f.followingId)
  for (const b of blocks) {
    excluded.add(b.blockerId)
    excluded.add(b.blockedId)
  }
  if (terpbot) excluded.add(terpbot.userId)

  const now = Date.now()
  const scored = pool
    .filter((p) => !excluded.has(p.user.id))
    .map((p) => {
      const u = p.user
      const followers = u._count.following
      const diaries = u._count.diaryCreator
      const contributions = u._count.posts + u._count.threadCreator
      const daysSinceSeen = u.lastSeenAtMs != null ? (now - u.lastSeenAtMs) / 86_400_000 : 30
      const score =
        2 * Math.log(1 + p.reputation) +
        3 * Math.log(1 + followers) +
        2 * Math.log(1 + diaries) +
        Math.log(1 + contributions) +
        (u.role === "VERIFIED_MEMBER" ? 15 : 0) +
        (u.role === "MODERATOR" || u.role === "ADMINISTRATOR" ? 10 : 0) +
        (p.bio && p.avatarUrl ? 10 : 0) +
        10 * Math.max(0, 1 - daysSinceSeen / 14)
      return { p, score }
    })
    .sort((a, b) => b.score - a.score || b.p.reputation - a.p.reputation || a.p.user.id.localeCompare(b.p.user.id))

  return scored.slice(0, limit).map(({ p }) => ({
    id: p.user.id,
    username: p.username,
    name: p.user.name,
    image: p.avatarUrl ?? p.user.image,
    role: p.user.role,
    bio: p.bio,
    reputation: p.reputation,
    followers: p.user._count.following,
  }))
}

// ─── Interest grouping ─────────────────────────────────────────────
// Maps seeded category slugs to a small set of interest groups so the
// onboarding step stays scannable. Slugs not listed here fall under
// "More topics".

export const INTEREST_GROUPS: { label: string; slugs: string[] }[] = [
  { label: "Getting started", slugs: ["new-grower-questions"] },
  { label: "Grow environment", slugs: ["indoor-growing", "outdoor-growing", "greenhouse-growing"] },
  { label: "Medium & feeding", slugs: ["soil-living-soil", "hydroponics", "nutrients"] },
  {
    label: "Technique & lifecycle",
    slugs: [
      "seeds-starting-plants",
      "training-trellising",
      "flowering",
      "harvest-curing",
      "plant-problems",
      "advanced-growing",
      "genetics-breeding",
    ],
  },
  { label: "Gear", slugs: ["lighting", "ventilation", "diy-equipment"] },
  {
    label: "Community",
    slugs: ["smoke-reports", "general-cannabis-discussion", "cannabis-memes", "off-topic"],
  },
]
