import { prisma } from "@/lib/prisma"
import { publicUserSelect, activeAuthor, blockedUserIds } from "@/lib/security"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { buildMetadata } from "@/lib/seo"
import TierChip from "@/components/tier-chip"
import Link from "next/link"
import { notFound } from "next/navigation"

export const dynamic = "force-dynamic"

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const tag = await prisma.tag.findUnique({ where: { slug }, select: { name: true } })
  if (!tag) return buildMetadata({ title: "Tag not found", robots: { index: false, follow: false } })
  return buildMetadata({
    title: `#${tag.name}`,
    description: `Forum discussions tagged #${tag.name} on TerpTalk.`,
    pathname: `/forum/tags/${slug}`,
  })
}

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
        where: { thread: { deleted: false, category: { hidden: false }, author: activeAuthor() } },
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

  // Post-filter by blocked authors — the tag list is shared content.
  const session = await getServerSession(authOptions)
  const blockedIds = await blockedUserIds(session?.user?.id)
  if (blockedIds.length) {
    tag.threads = tag.threads.filter((tt) => !blockedIds.includes(tt.thread.authorId))
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <Link href="/forum/tags" className="text-sm text-muted-foreground hover:text-foreground mb-2 block">
            ← All tags
          </Link>
          <h1 className="font-display text-3xl font-bold mb-2 tracking-tight"><span className="text-spectrum">#</span>{tag.name}</h1>
          <p className="text-muted-foreground">{tag.threads.length} thread{tag.threads.length === 1 ? "" : "s"}</p>
        </div>

        <div className="space-y-4">
          {tag.threads.map((tt) => {
            const t = tt.thread
            return (
              <Link
                key={t.id}
                href={`/forum/thread/${t.slug}`}
                className="tt-edge-card block bg-card/80 border border-border/70 rounded-2xl p-5 hover:border-primary/50 transition-all"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-semibold mb-1">{t.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      {t.category.name} · by {t.author.profile?.username || t.author.name} <TierChip reputation={t.author.profile?.reputation ?? 0} publicMilestoneOptOut={t.author.profile?.publicMilestoneOptOut} /> · {t._count.posts} repl{t._count.posts === 1 ? "y" : "ies"}
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
