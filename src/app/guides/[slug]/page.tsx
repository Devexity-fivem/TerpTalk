import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { BookOpen, Pencil } from "lucide-react"
import Link from "next/link"
import ShareButtons from "@/components/share-buttons"
import { buildMetadata, snippet } from "@/lib/seo"
import { JsonLd } from "@/components/json-ld"
import { Breadcrumbs } from "@/components/breadcrumbs"
import TierChip from "@/components/tier-chip"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isModerator } from "@/lib/security"

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
  const [guide, session] = await Promise.all([
    prisma.guide.findUnique({
      where: { slug },
      include: { author: { select: { name: true, role: true, profile: { select: { username: true, reputation: true, publicMilestoneOptOut: true } } } } },
    }),
    getServerSession(authOptions),
  ])
  if (!guide || !guide.published) notFound()

  // Edit permission is author-or-moderator — mirrors PATCH /api/guides/[slug].
  // Check the DB role so a stale JWT can't show an Edit link that will 403.
  let canEdit = guide.authorId === session?.user?.id || isModerator(session?.user?.role)
  if (!canEdit && session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { banned: true, role: true },
    })
    canEdit = !!user && !user.banned && isModerator(user.role)
  }

  const guideBase = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"
  const guideUrl = `${guideBase}/guides/${guide.slug}`
  const guideSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: snippet(guide.excerpt || guide.content || guide.title),
    articleSection: guide.topic,
    author: {
      "@type": "Person",
      name: guide.author.profile?.username || guide.author.name || "TerpTalk",
    },
    datePublished: guide.createdAt.toISOString(),
    dateModified: guide.updatedAt.toISOString(),
    url: guideUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": guideUrl },
    publisher: { "@type": "Organization", name: "TerpTalk", url: guideBase },
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <JsonLd data={guideSchema} />
        <Breadcrumbs items={[
          { label: "Grow Guides", href: "/guides" },
          { label: guide.title },
        ]} />
        <div className="bg-card rounded-xl border border-border p-6 md:p-8">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
            <BookOpen className="w-4 h-4 text-primary" />
            <span className="uppercase tracking-wide">{guide.topic}</span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">by {guide.author.profile?.username || guide.author.name} <TierChip reputation={guide.author.profile?.reputation ?? 0} publicMilestoneOptOut={guide.author.profile?.publicMilestoneOptOut} /></span>
            <span>·</span>
            <span>{new Date(guide.createdAt).toLocaleDateString()}</span>
            {canEdit && (
              <>
                <span>·</span>
                <Link href={`/guides/${guide.slug}/edit`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Pencil className="w-3 h-3" /> Edit
                </Link>
              </>
            )}
          </div>
          <h1 className="text-3xl font-bold mb-6">{guide.title}</h1>
          <div className="max-w-none text-foreground whitespace-pre-wrap break-words leading-relaxed">
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
