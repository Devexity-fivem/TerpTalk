import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { buildMetadata, snippet } from "@/lib/seo"
import { TERPBOT_USERNAME } from "@/lib/terpbot-constants"
import ProfileClient from "./profile-client"

const getProfileForMetadata = unstable_cache(
  async (username: string) => {
    return prisma.profile.findUnique({
      where: { username },
      select: {
        username: true,
        bio: true,
        avatarUrl: true,
        reputation: true,
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
        ? `TerpBot is TerpTalk's built-in community assistant — welcomes new members, answers questions in chat, and keeps the garden tidy.`
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
    return prisma.profile.findUnique({
      where: { username },
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

  return <ProfileClient />
}
