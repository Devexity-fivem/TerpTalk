import { prisma } from "@/lib/prisma"
import { publicUserSelect, activeAuthor, blockedUserIds } from "@/lib/security"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unstable_cache } from "next/cache"
import { Settings, Plus, Users, ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import TierChip from "@/components/tier-chip"
import EmptyState from "@/components/ui/empty-state"

export const revalidate = 300

export const metadata = {
  title: "Grow Setup Showcases",
  description: "Cannabis grow room and tent setups — lighting, tents, and equipment shared by TerpTalk growers.",
}

const PAGE_SIZE = 24
const MAX_PAGE = 50

const getSetups = unstable_cache(
  async (page: number) => {
    const where = { deleted: false, author: activeAuthor() }
    const [setups, total] = await Promise.all([
      prisma.growSetup.findMany({
        where,
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        include: {
          author: { select: publicUserSelect },
          images: { take: 1, orderBy: { order: "asc" } },
          _count: {
            select: { comments: true },
          },
        },
      }),
      prisma.growSetup.count({ where }),
    ])

    return { setups, total }
  },
  ["setups-list"],
  { revalidate: 300, tags: ["setups"] }
)

export default async function SetupsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const sp = await searchParams
  const rawPage = Number.parseInt(sp?.page ?? "1", 10)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGE) : 1

  const [cached, session] = await Promise.all([getSetups(page), getServerSession(authOptions)])
  const { total } = cached
  // The cached list is global — hide setups by authors the viewer has
  // blocked or been blocked by (counts/pagination stay cache-based).
  const blockedIds = await blockedUserIds(session?.user?.id)
  const setups = blockedIds.length ? cached.setups.filter((s) => !blockedIds.includes(s.authorId)) : cached.setups
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageHref = (p: number) => (p <= 1 ? "/setups" : `/setups?page=${p}`)

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Grow Setup Showcases</h1>
          <p className="text-muted-foreground">Show off your grow room and equipment. Get feedback and inspiration from the community.</p>
        </div>

        <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
          <h2 className="text-xl font-semibold">All Setups</h2>
          <Link
            href="/setups/new"
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors text-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Share Your Setup
          </Link>
        </div>

        {setups.length === 0 ? (
          <div className="bg-card rounded-xl border border-border">
            <EmptyState
              icon={Settings}
              title={total === 0 ? "No setups shared yet" : "No setups on this page"}
              description={total === 0 ? "Be the first to show off your grow setup." : "This page is past the end of the setups list."}
              action={total === 0 ? { label: "Share your setup", href: "/setups/new" } : { label: "Back to page 1", href: "/setups" }}
            />
          </div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {setups.map((setup) => (
                <div
                  key={setup.id}
                  className="bg-card rounded-lg border border-border overflow-hidden hover:border-primary/50 transition-colors"
                >
                  <Link href={`/setups/${setup.id}`} className="block">
                    {setup.images.length > 0 ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={setup.images[0].url} alt={setup.title} loading="lazy" decoding="async" className="aspect-video w-full object-cover" />
                    ) : (
                      <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                        <Settings className="w-16 h-16 text-primary/30" />
                      </div>
                    )}
                  </Link>
                  <div className="p-4">
                    <Link href={`/setups/${setup.id}`} className="hover:text-primary transition-colors">
                      <h3 className="font-semibold mb-1">{setup.title}</h3>
                    </Link>
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{setup.description}</p>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1 min-w-0">
                        <Users className="w-3 h-3 shrink-0" />
                        <Link
                          href={`/u/${setup.author.profile?.username || setup.author.name}`}
                          className="truncate hover:text-foreground hover:underline"
                        >
                          {setup.author.profile?.username || setup.author.name}
                        </Link>
                        <RoleBadge role={setup.author.role} />
                        <TierChip reputation={setup.author.profile?.reputation ?? 0} publicMilestoneOptOut={setup.author.profile?.publicMilestoneOptOut} />
                      </span>
                      <span className="shrink-0">{setup._count.comments} comments</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 mt-6">
                {page > 1 ? (
                  <Link
                    href={pageHref(page - 1)}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-card border border-border text-sm font-medium hover:border-primary/40 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-sm text-muted-foreground">
                  Page {page} of {totalPages}
                </span>
                {page < totalPages ? (
                  <Link
                    href={pageHref(page + 1)}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-lg bg-card border border-border text-sm font-medium hover:border-primary/40 transition-colors"
                  >
                    Next <ChevronRight className="w-4 h-4" />
                  </Link>
                ) : (
                  <span />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
