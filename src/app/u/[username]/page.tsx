import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { getSession } from "@/lib/session"
import { getPublicProfileData } from "@/lib/public-profile"
import { buildMetadata, snippet } from "@/lib/seo"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import { JsonLd } from "@/components/json-ld"
import ProfileClient from "./profile-client"

// One cached row feeds both generateMetadata and the page's existence/
// inactivity gate — two renders of the same profile no longer cost two
// identical lookups.
const getProfileLite = unstable_cache(
  async (username: string) => {
    return prisma.profile.findFirst({
      // Usernames are unique case-insensitively — /u/GrowKing and /u/growking
      // must resolve to the same member.
      where: { username: { equals: username, mode: "insensitive" } },
      select: {
        id: true,
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

  const profile = await getProfileLite(decoded)

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

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const decoded = decodeURIComponent(username)

  const profile = await getProfileLite(decoded)

  if (!profile || isInactiveUser(profile.user)) {
    notFound()
  }

  // Server-render the profile payload — same aggregation + privacy scoping as
  // GET /api/users/[username]. A block in either direction 404s (inside the
  // aggregation), matching the API contract.
  const session = await getSession()
  const data = await getPublicProfileData(decoded, session?.user?.id)
  if (!data) {
    notFound()
  }

  // Serialize Dates → ISO strings so the prop matches the fetch contract
  // exactly (the client keeps its JSON-shape types either way).
  const initial = JSON.parse(JSON.stringify(data))

  // ProfilePage JSON-LD — public identity fields only (username, bio, avatar,
  // join date). Never stats, standing, or anything visibility-scoped; a row
  // that reached this render already passed the same rules a crawler sees.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"
  const p = data.profile
  const jsonLd = p.isBot
    ? null
    : {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        mainEntity: {
          "@type": "Person",
          alternateName: p.username,
          ...(p.bio ? { description: snippet(p.bio, 200) } : {}),
          ...(p.image ? { image: p.image } : {}),
          ...(p.joinDate ? { memberSince: new Date(p.joinDate).toISOString().slice(0, 10) } : {}),
          url: `${baseUrl}/u/${encodeURIComponent(p.username)}`,
        },
      }

  return (
    <>
      {jsonLd && <JsonLd data={jsonLd} />}
      <ProfileClient initial={initial} />
    </>
  )
}
