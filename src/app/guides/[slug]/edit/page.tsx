import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isModerator, getTrustLevel } from "@/lib/security"
import EditGuideForm from "./edit-guide-form"

export default async function EditGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await getServerSession(authOptions)

  const guide = await prisma.guide.findUnique({
    where: { slug },
    select: { id: true, slug: true, title: true, excerpt: true, content: true, topic: true, authorId: true },
  })

  if (!guide) notFound()

  let canEdit = guide.authorId === session?.user?.id || isModerator(session?.user?.role)
  if (!canEdit && session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { createdAt: true, banned: true, role: true, profile: { select: { reputation: true } } },
    })
    if (user && !user.banned) {
      const level = getTrustLevel(user.createdAt, user.profile?.reputation ?? 0)
      canEdit = ["Established", "Veteran", "Expert"].includes(level) || isModerator(user.role)
    }
  }

  if (!canEdit) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Permission denied</h1>
          <p className="text-muted-foreground">You need Established trust or moderator status to edit guides.</p>
        </div>
      </div>
    )
  }

  return <EditGuideForm guide={guide} slug={guide.slug} />
}
