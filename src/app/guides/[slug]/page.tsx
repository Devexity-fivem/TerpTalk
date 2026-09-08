import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { BookOpen } from "lucide-react"
import Link from "next/link"
import ShareButtons from "@/components/share-buttons"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = await prisma.guide.findUnique({ where: { slug }, select: { title: true, excerpt: true, published: true } })
  if (!guide || !guide.published) return { title: "Guide not found" }
  return { title: guide.title, description: guide.excerpt }
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
        <Link href="/guides" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">← All guides</Link>
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
