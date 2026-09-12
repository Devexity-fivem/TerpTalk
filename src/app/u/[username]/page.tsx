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
        user: { select: { image: true } },
      },
    })
  },
  ["profile-metadata"],
  { revalidate: 300, tags: ["profiles"] }
)

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const decoded = decodeURIComponent(username)

  const profile = await getProfileForMetadata(decoded)

  if (!profile) {
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
      select: { id: true },
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

  if (!profile) {
    notFound()
  }

  return <ProfileClient />
}
