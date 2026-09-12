import { notFound } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isModerator } from "@/lib/security"
import EditGuideForm from "./edit-guide-form"

export default async function EditGuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await getServerSession(authOptions)

  const guide = await prisma.guide.findUnique({
    where: { slug },
    select: { id: true, slug: true, title: true, excerpt: true, content: true, topic: true, authorId: true, published: true },
  })

  // Unpublished guides are moderator/author-only — 404 for everyone else so
  // the edit form can't disclose content the public page hides.
  if (!guide || (!guide.published && !(guide.authorId === session?.user?.id || isModerator(session?.user?.role)))) {
    notFound()
  }

  // Mirrors PATCH /api/guides/[slug] — only author or moderator can edit.
  const canEdit = guide.authorId === session?.user?.id || isModerator(session?.user?.role)

  if (!canEdit) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Permission denied</h1>
          <p className="text-muted-foreground">Only the guide author or a moderator can edit this guide.</p>
        </div>
      </div>
    )
  }

  return <EditGuideForm guide={guide} slug={guide.slug} />
}
