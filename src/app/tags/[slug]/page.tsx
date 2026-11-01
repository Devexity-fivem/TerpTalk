import { prisma } from "@/lib/prisma"
import { getSession } from "@/lib/session"
import { buildMetadata } from "@/lib/seo"
import { blockedUserIds } from "@/lib/security"
import { decodeFeedCursor, encodeFeedCursor } from "@/lib/feed"
import { momentVisibleWhere, momentCardSelect, toMomentDTO, hashtagPath } from "@/lib/moments"
import { notFound } from "next/navigation"
import { Hash, MessageSquare } from "@/lib/icons"
import PageHeader from "@/components/ui/page-header"
import MomentCard from "@/components/moment-card"
import Link from "next/link"

export const dynamic = "force-dynamic"

const PAGE = 20

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const tag = await prisma.tag.findUnique({ where: { slug }, select: { name: true } })
  if (!tag) return buildMetadata({ title: "Tag not found", robots: { index: false, follow: false } })
  return buildMetadata({
    title: `#${tag.name}`,
    description: `Posts and conversations tagged #${tag.name} on TerpTalk.`,
    pathname: hashtagPath(slug),
  })
}

export default async function HashtagPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ cursor?: string }>
}) {
  const { slug } = await params
  const { cursor } = await searchParams
  const tag = await prisma.tag.findUnique({ where: { slug }, select: { id: true, name: true } })
  if (!tag) notFound()

  const session = await getSession()
  const viewerId = session?.user?.id ?? null
  const blockedIds = await blockedUserIds(viewerId)
  const cur = decodeFeedCursor(cursor)

  const rows = await prisma.moment.findMany({
    where: {
      AND: [
        momentVisibleWhere({ viewerId, blockedIds, kind: "POST" }),
        { tags: { some: { tagId: tag.id } } },
        ...(cur ? [{ OR: [{ createdAt: { lt: new Date(cur.ts) } }, { createdAt: new Date(cur.ts), id: { lt: cur.id } }] }] : []),
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE + 1,
    select: momentCardSelect(viewerId),
  })

  const items = rows.slice(0, PAGE).map((r) => toMomentDTO(r, viewerId, blockedIds))
  const last = items[items.length - 1]
  const nextCursor = rows.length > PAGE && last ? encodeFeedCursor(new Date(last.createdAt), last.id) : null

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <PageHeader
          context={
            <Link href="/feed" className="text-sm text-muted-foreground hover:text-foreground">
              ← Feed
            </Link>
          }
          title={<><span className="text-spectrum">#</span>{tag.name}</>}
          description="Posts tagged by the community"
        />

        <div className="tt-spotlight tt-spotlight bg-card/80 rounded-2xl border border-border/70 divide-y divide-border/60">
          {items.map((m) => (
            <MomentCard key={m.id} moment={m} />
          ))}
          {items.length === 0 && (
            <div className="p-12 text-center">
              <Hash className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="font-display text-lg font-semibold mb-2">No posts yet</h3>
              <p className="text-sm text-muted-foreground">Be the first to post with #{tag.name}.</p>
            </div>
          )}
        </div>

        {nextCursor && (
          <div className="mt-4 text-center">
            <Link href={`${hashtagPath(slug)}?cursor=${nextCursor}`} className="text-sm text-primary hover:underline">
              Load more
            </Link>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-muted-foreground">
          <Link href={`/forum/tags/${slug}`} className="inline-flex items-center gap-1 hover:text-foreground">
            <MessageSquare className="w-3.5 h-3.5" /> Forum discussions tagged #{tag.name}
          </Link>
        </p>
      </div>
    </div>
  )
}
