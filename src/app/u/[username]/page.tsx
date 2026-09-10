import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import { buildMetadata, snippet } from "@/lib/seo"
import ProfileClient from "./profile-client"

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const decoded = decodeURIComponent(username)

  const profile = await prisma.profile.findUnique({
    where: { username: decoded },
    select: {
      username: true,
      bio: true,
      avatarUrl: true,
      reputation: true,
      user: { select: { image: true } },
    },
  })

  if (!profile) {
    return buildMetadata({ title: "Profile not found", robots: { index: false } })
  }

  const description = snippet(
    profile.bio ||
      `View ${profile.username}'s grow diaries, setup showcases, and forum activity on TerpTalk — the 21+ community for cannabis growers.`,
    160
  )

  return buildMetadata({
    title: `${profile.username} — Cannabis Grower`,
    description,
    keywords: [profile.username, "cannabis grower", "grow journal", "TerpTalk"],
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

  const profile = await prisma.profile.findUnique({
    where: { username: decoded },
    select: { id: true },
  })

  if (!profile) {
    notFound()
  }

  return <ProfileClient />
}
