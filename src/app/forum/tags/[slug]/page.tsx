import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import Link from "next/link"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function TagThreadsPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const tag = await prisma.tag.findUnique({
    where: { slug },
    include: {
      threads: {
        where: { thread: { deleted: false, category: { hidden: false } } },
        orderBy: { thread: { createdAt: "desc" } },
        take: 50,
        include: {
          thread: {
            include: {
              author: { select: publicUserSelect },
              category: true,
              _count: { select: { posts: true } },
            },
          },
        },
      },
    },
  })

  if (!tag) notFound()

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <Link href="/forum/tags" className="text-sm text-muted-foreground hover:text-foreground mb-2 block">
            ← All tags
          </Link>
          <h1 className="text-3xl font-bold mb-2">#{tag.name}</h1>
          <p className="text-muted-foreground">{tag.threads.length} thread{tag.threads.length === 1 ? "" : "s"}</p>
        </div>

        <div className="space-y-4">
          {tag.threads.map((tt) => {
            const t = tt.thread
            return (
              <Link
                key={t.id}
                href={`/forum/thread/${t.slug}`}
                className="block bg-card border border-border rounded-lg p-6 hover:border-primary transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-semibold mb-1">{t.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t.category.name} · by {t.author.profile?.username || t.author.name} · {t._count.posts} repl{t._count.posts === 1 ? "y" : "ies"}
                    </p>
                  </div>
                  <span className="text-sm text-muted-foreground shrink-0">{new Date(t.createdAt).toLocaleDateString()}</span>
                </div>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
