import { prisma } from "@/lib/prisma"
import Link from "next/link"

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
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Discussion Tags</h1>
          <p className="text-muted-foreground">Find threads by topic, strain, or growing method.</p>
        </div>

        {tags.length === 0 ? (
          <p className="text-muted-foreground">No tags yet.</p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {tags.map((tag) => (
              <Link
                key={tag.id}
                href={`/forum/tags/${tag.slug}`}
                className="inline-flex items-center px-4 py-2 rounded-full bg-card border border-border hover:border-primary hover:text-primary transition-colors"
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
