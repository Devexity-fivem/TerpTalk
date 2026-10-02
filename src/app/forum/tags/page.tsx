import { prisma } from "@/lib/prisma"
import Link from "next/link"
import PageHeader from "@/components/ui/page-header"

export const metadata = {
  title: "Tags",
  description: "Browse all discussion tags on TerpTalk.",
}

export const dynamic = "force-dynamic"

export default async function TagsPage() {
  const tags = await prisma.tag.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { threads: true } },
    },
  })

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <PageHeader
          context={<span className="tt-eyebrow">Topics</span>}
          title="Discussion Tags"
          description="Find threads by topic, strain, or growing method."
        />

        {tags.length === 0 ? (
          <p className="text-muted-foreground">No tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {tags.map((tag) => (
              <Link
                key={tag.id}
                href={`/forum/tags/${tag.slug}`}
                className="inline-flex items-center px-4 py-2 rounded-full bg-card/80 border border-border/70 hover:border-primary/60 hover:text-primary hover:shadow-md transition-all"
              >
                <span className="font-medium">#{tag.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">{tag._count.threads} threads</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
