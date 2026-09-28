import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getPublicProfileData } from "@/lib/public-profile"
import { buildMetadata, snippet } from "@/lib/seo"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import ProfileClient from "./profile-client"

const getProfileForMetadata = unstable_cache(
  async (username: string) => {
    return prisma.profile.findFirst({
      // Usernames are unique case-insensitively — /u/GrowKing and /u/growking
      // must resolve to the same member.
      where: { username: { equals: username, mode: "insensitive" } },
      select: {
        username: true,
        bio: true,
        avatarUrl: true,

        user: { select: { image: true, banned: true, suspendedUntil: true } },
      },
    })
  },
  ["profile-metadata"],
  { revalidate: 300, tags: ["profiles"] }
)

// Banned/suspended members' profiles are not public surfaces — treat them
// like missing profiles (noindex + 404) so bios don't stay indexable.
function isInactiveUser(u: { banned: boolean; suspendedUntil: Date | null } | null): boolean {
  if (!u) return true
  if (u.banned) return true
  if (u.suspendedUntil && u.suspendedUntil.getTime() > Date.now()) return true
  return false
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const decoded = decodeURIComponent(username)

  const profile = await getProfileForMetadata(decoded)

  if (!profile || isInactiveUser(profile.user)) {
    return buildMetadata({ title: "Profile not found", robots: { index: false } })
  }

  const isBot = profile.username === TERPBOT_USERNAME
  const description = snippet(
    profile.bio ||
      (isBot
        ? `TerpBot is TerpTalk's built-in automated assistant — welcomes new members, answers questions in chat, and relays staff announcements. It's a bot, not a moderator.`
        : `View ${profile.username}'s grow diaries, setup showcases, and forum activity on TerpTalk — the 21+ community for cannabis growers.`),
    160
  )

  return buildMetadata({
    title: isBot ? `TerpBot — Community Assistant` : `${profile.username} — Cannabis Grower`,
    description,
    keywords: isBot
      ? [profile.username, "chatbot", "community assistant", "TerpTalk"]
      : [profile.username, "cannabis grower", "grow journal", "TerpTalk"],
    pathname: `/u/${profile.username}`,
    og: { image: profile.avatarUrl || profile.user?.image || undefined },
    twitter: { image: profile.avatarUrl || profile.user?.image || undefined },
  })
}

const getProfileId = unstable_cache(
  async (username: string) => {
    return prisma.profile.findFirst({
      where: { username: { equals: username, mode: "insensitive" } },
      select: { id: true, user: { select: { banned: true, suspendedUntil: true } } },
    })
  },
  ["profile-id"],
  { revalidate: 300, tags: ["profiles"] }
)

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const decoded = decodeURIComponent(username)

  const profile = await getProfileId(decoded)

  if (!profile || isInactiveUser(profile.user)) {
    notFound()
  }

  // Server-render the profile payload — same aggregation + privacy scoping as
  // GET /api/users/[username]. A block in either direction 404s (inside the
  // aggregation), matching the API contract.
  const session = await getServerSession(authOptions)
  const data = await getPublicProfileData(decoded, session?.user?.id)
  if (!data) {
    notFound()
  }

  // Serialize Dates → ISO strings so the prop matches the fetch contract
  // exactly (the client keeps its JSON-shape types either way).
  const initial = JSON.parse(JSON.stringify(data))

  return <ProfileClient initial={initial} />
}
