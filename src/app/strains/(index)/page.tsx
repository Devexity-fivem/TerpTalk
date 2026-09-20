import { prisma } from "@/lib/prisma"
import { activeAuthor } from "@/lib/security"
import { unstable_cache } from "next/cache"
import { escapeLike, strainTypeLabel } from "@/lib/strain-stats"
import { Leaf, Plus, Search, ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import EmptyState from "@/components/ui/empty-state"
import { strainPath } from "@/lib/slugs"

export const revalidate = 60 // public content, edge-cached

export const metadata = {
  title: "Strain Database",
  description: "Community-maintained cannabis strain database — genetics, breeders, growing info, and grower photos.",
}

const PAGE_SIZE = 24
const MAX_PAGE = 50

const getStrains = unstable_cache(
  async (q: string, page: number) => {
    const contains = q ? { contains: escapeLike(q), mode: "insensitive" as const } : undefined
    const where = contains ? { OR: [{ name: contains }, { genetics: contains }, { breeder: contains }] } : undefined
    const [strains, total] = await Promise.all([
      prisma.strain.findMany({
        where,
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        orderBy: { name: "asc" },
        include: {
          photos: {
            where: { user: activeAuthor() },
            take: 1,
            orderBy: { createdAt: "desc" },
          },
          _count: { select: { photos: { where: { user: activeAuthor() } } } },
        },
      }),
      prisma.strain.count({ where }),
    ])

    return { strains, total }
  },
  ["strains-list"],
  { revalidate: 300, tags: ["strains"] }
)

export default async function StrainsPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams
  const q = (sp?.q ?? "").trim().slice(0, 80)
  const rawPage = Number.parseInt(sp?.page ?? "1", 10)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGE) : 1

  const { strains, total } = await getStrains(q, page)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageHref = (p: number) => {
    const params = new URLSearchParams()
    if (q) params.set("q", q)
    if (p > 1) params.set("page", String(p))
    const qs = params.toString()
    return qs ? `/strains?${qs}` : "/strains"
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <span className="tt-eyebrow">Genetics vault</span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold mt-1.5 mb-2 tracking-tight">Strain Database</h1>
          <p className="text-muted-foreground">Community-maintained database of cannabis strains, genetics, and growing characteristics</p>
        </div>

        {/* Search */}
        <form action="/strains" className="mb-6">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search strains, genetics, breeders..."
              className="w-full pl-11 pr-4 py-3 rounded-full border border-border bg-card/80 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </form>

        <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
          <h2 className="font-display text-xl font-semibold">{q ? `Results for "${q}"` : "All Strains"}</h2>
          <Link
            href="/strains/new"
            className="tt-cta rounded-full px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Strain
          </Link>
        </div>

        {strains.length === 0 ? (
          <div className="bg-card/80 rounded-2xl border border-border/70">
            <EmptyState
              icon={Leaf}
              title={q ? `No strains match "${q}"` : total === 0 ? "No strains in the database yet" : "No strains on this page"}
              description={q ? "Try a different name, genetics, or breeder." : total === 0 ? "Help build the community strain database." : "This page is past the end of the results."}
              action={q ? { label: "Browse all strains", href: "/strains" } : total === 0 ? { label: "Add the first strain", href: "/strains/new" } : { label: "Back to page 1", href: "/strains" }}
            />
          </div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {strains.map((strain) => (
                <Link
                  key={strain.id}
                  href={strainPath(strain)}
                  className="group bg-card rounded-2xl border border-border/70 overflow-hidden tt-lift hover:border-primary/50"
                >
                  <div className="relative aspect-[16/9] bg-gradient-to-br from-primary/15 via-secondary to-spectrum/10 flex items-center justify-center overflow-hidden">
                    {strain.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={strain.photos[0].imageUrl} alt={strain.name} loading="lazy" decoding="async" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                    ) : (
                      <Leaf className="w-8 h-8 text-primary/30" />
                    )}
                    {strain.type && (
                      <span className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
                        {strainTypeLabel(strain.type)}
                      </span>
                    )}
                    {strain._count.photos > 0 && (
                      <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold text-white backdrop-blur-sm">
                        {strain._count.photos} photo{strain._count.photos !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    <h3 className="font-display font-semibold line-clamp-1 group-hover:text-primary transition-colors">{strain.name}</h3>
                    {strain.breeder && (
                      <p className="text-xs text-muted-foreground mt-0.5">by {strain.breeder}</p>
                    )}
                    {strain.genetics && (
                      <p className="text-xs text-muted-foreground line-clamp-1 mt-1.5 border-t border-border/50 pt-1.5">
                        {strain.genetics}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 mt-6">
                {page > 1 ? (
                  <Link
                    href={pageHref(page - 1)}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-card border border-border text-sm font-medium hover:border-primary/40 transition-colors"
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
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-card border border-border text-sm font-medium hover:border-primary/40 transition-colors"
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
