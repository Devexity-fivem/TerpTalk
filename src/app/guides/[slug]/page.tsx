import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { BookOpen } from "lucide-react"
import ShareButtons from "@/components/share-buttons"
import { buildMetadata, snippet } from "@/lib/seo"
import { Breadcrumbs } from "@/components/breadcrumbs"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = await prisma.guide.findUnique({ where: { slug }, select: { title: true, excerpt: true, published: true, topic: true } })
  if (!guide || !guide.published) return buildMetadata({ title: "Guide not found", robots: { index: false } })
  return buildMetadata({
    title: `${guide.title} — Cannabis Grow Guide`,
    description: snippet(guide.excerpt),
    keywords: [guide.topic, "cannabis grow guide", "how to grow cannabis"],
    pathname: `/guides/${slug}`,
    og: { type: "article" },
  })
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = await prisma.guide.findUnique({
    where: { slug },
    include: { author: { select: { name: true, role: true, profile: { select: { username: true } } } } },
  })
  if (!guide || !guide.published) notFound()

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <Breadcrumbs items={[
          { label: "Grow Guides", href: "/guides" },
          { label: guide.title },
        ]} />
        <div className="bg-card rounded-xl border border-border p-6 md:p-8">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
            <BookOpen className="w-4 h-4 text-primary" />
            <span className="uppercase tracking-wide">{guide.topic}</span>
            <span>·</span>
            <span>by {guide.author.profile?.username || guide.author.name}</span>
            <span>·</span>
            <span>{new Date(guide.createdAt).toLocaleDateString()}</span>
          </div>
          <h1 className="text-3xl font-bold mb-6">{guide.title}</h1>
          <div className="prose prose-invert max-w-none text-foreground whitespace-pre-wrap leading-relaxed">
            {guide.content}
          </div>
          <div className="mt-8 pt-4 border-t border-border">
            <ShareButtons path={`/guides/${guide.slug}`} title={guide.title} />
          </div>
        </div>
      </div>
    </div>
  )
}
