import { prisma } from "@/lib/prisma"
import { buildMetadata, snippet } from "@/lib/seo"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { JsonLd } from "@/components/json-ld"

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const profile = await prisma.profile.findUnique({
    where: { username },
    select: {
      username: true,
      bio: true,
      user: { select: { banned: true, createdAt: true } },
    },
  })

  if (!profile || profile.user.banned) {
    return buildMetadata({ title: "Profile not found", robots: { index: false } })
  }

  return buildMetadata({
    title: `@${profile.username} — TerpTalk Grower Profile`,
    description: snippet(profile.bio || `View ${profile.username}'s grow diaries, setup showcases, and forum posts on TerpTalk.`),
    keywords: [profile.username, "cannabis grower", "grow journal", "strain database"],
    pathname: `/u/${profile.username}`,
    og: { type: "website" },
  })
}

export default async function UserLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"

  const personSchema = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: username,
    url: `${baseUrl}/u/${username}`,
    identifier: username,
    additionalName: username,
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Growers", href: "/leaderboard" }, { label: username }]} />
      <JsonLd data={personSchema} />
      {children}
    </>
  )
}
