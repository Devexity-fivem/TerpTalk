import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/session"
import { buildMetadata } from "@/lib/seo"
import { getAuthorStories } from "@/lib/moments"
import { notFound } from "next/navigation"
import StoryViewer from "@/components/story-viewer"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  return buildMetadata({
    title: `@${username} — story`,
    // Ephemeral, member-personalized surface — never indexed.
    robots: { index: false, follow: false },
  })
}

export default async function StoryPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const session = await getSession()

  const author = await prisma.profile.findUnique({
    where: { username },
    select: { userId: true, username: true },
  })
  if (!author) notFound()

  const stories = await getAuthorStories(author.userId, session?.user?.id ?? null)
  if (stories.length === 0) notFound()

  return <StoryViewer stories={JSON.parse(JSON.stringify(stories))} username={author.username ?? username} />
}
