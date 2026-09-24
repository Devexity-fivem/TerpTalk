import { prisma } from "@/lib/prisma"
import { activeAuthor } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { unstable_cache } from "next/cache"
import { Search, Plus, Leaf, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react"
import Link from "next/link"
import EmptyState from "@/components/ui/empty-state"
import StrainCard from "@/components/strain-card"
import { strainTypeLabel } from "@/lib/strain-stats"
import {
  STRAIN_TYPES,
  STRAIN_EFFECTS,
  STRAIN_EFFECT_LABELS,
  STRAIN_FLAVORS,
  STRAIN_FLAVOR_LABELS,
  STRAIN_DIFFICULTIES,
  STRAIN_DIFFICULTY_LABELS,
  parseStrainDifficulty,
} from "@/lib/strain-fields"
import {
  strainWhere,
  THC_BANDS,
  FLOWER_BANDS,
  type StrainFilters,
} from "@/lib/strain-filters"

export const revalidate = 300

export const metadata = {
  title: "Strain Database",
  description: "Community-maintained cannabis strain database — genetics, breeders, effects, growing info, and grower photos.",
}

const PAGE_SIZE = 24
const MAX_PAGE = 50

const getStrains = unstable_cache(
  async (f: StrainFilters) => {
    const where = strainWhere(f)
    const [strains, total] = await Promise.all([
      prisma.strain.findMany({
        where,
        orderBy: { name: "asc" },
        skip: (f.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          photos: {
            where: { user: activeAuthor() },
            take: 1,
            orderBy: { createdAt: "desc" },
          },
          _count: {
            select: {
              photos: { where: { user: activeAuthor() } },
              // Community grow count — public, non-deleted diaries only so
              // a private grow never inflates the catalog signal.
              diaries: { where: { deleted: false, author: activeAuthor(), ...publicDiaryWhere } },
            },
          },
        },
      }),
      prisma.strain.count({ where }),
    ])

    return { strains, total }
  },
  ["strains-list"],
  { revalidate: 300, tags: ["strains"] }
)

// Distinct breeders for the filter dropdown — deduped case-insensitively
// server-side, canonical spelling from the first occurrence.
const getBreeders = unstable_cache(
  async () => {
    const rows = await prisma.strain.findMany({
      where: { breeder: { not: null } },
      select: { breeder: true },
      orderBy: { breeder: "asc" },
      take: 500,
    })
    const seen = new Map<string, string>()
    for (const r of rows) {
      const b = r.breeder!.trim()
      const key = b.toLowerCase()
      if (b && !seen.has(key)) seen.set(key, b)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  },
  ["strain-breeders"],
  { revalidate: 300, tags: ["strains"] }
)

function filterHref(f: StrainFilters, patch: Partial<StrainFilters>) {
  const next = { ...f, ...patch }
  const params = new URLSearchParams()
  if (next.q) params.set("q", next.q)
  if (next.type) params.set("type", next.type)
  if (next.effect) params.set("effect", next.effect)
  if (next.flavor) params.set("flavor", next.flavor)
  if (next.difficulty) params.set("difficulty", next.difficulty)
  if (next.thc) params.set("thc", next.thc)
  if (next.flower) params.set("flower", next.flower)
  if (next.breeder) params.set("breeder", next.breeder)
  if (next.page > 1) params.set("page", String(next.page))
  const qs = params.toString()
  return qs ? `/strains?${qs}` : "/strains"
}

const activeFilterCount = (f: StrainFilters) =>
  [f.type, f.effect, f.flavor, f.difficulty, f.thc, f.flower, f.breeder].filter(Boolean).length

function FilterControls({ f, breeders }: { f: StrainFilters; breeders: string[] }) {
  const select = "px-2.5 py-2 rounded-lg border border-border/70 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary min-h-9"
  return (
    <>
      <select name="type" defaultValue={f.type} className={select} aria-label="Filter by type">
        <option value="">All types</option>
        {STRAIN_TYPES.map((t) => (
          <option key={t} value={t}>{strainTypeLabel(t)}</option>
        ))}
      </select>
      <select name="effect" defaultValue={f.effect} className={select} aria-label="Filter by effect">
        <option value="">Any effect</option>
        {STRAIN_EFFECTS.map((e) => (
          <option key={e} value={e}>{STRAIN_EFFECT_LABELS[e]}</option>
        ))}
      </select>
      <select name="flavor" defaultValue={f.flavor} className={select} aria-label="Filter by flavor">
        <option value="">Any flavor</option>
        {STRAIN_FLAVORS.map((fl) => (
          <option key={fl} value={fl}>{STRAIN_FLAVOR_LABELS[fl]}</option>
        ))}
      </select>
      <select name="difficulty" defaultValue={f.difficulty ?? ""} className={select} aria-label="Filter by difficulty">
        <option value="">Any difficulty</option>
        {STRAIN_DIFFICULTIES.map((d) => (
          <option key={d} value={d}>{STRAIN_DIFFICULTY_LABELS[d]}</option>
        ))}
      </select>
      <select name="thc" defaultValue={f.thc} className={select} aria-label="Filter by THC range">
        <option value="">Any THC</option>
        {THC_BANDS.map((b) => (
          <option key={b.key} value={b.key}>{b.label}</option>
        ))}
      </select>
      <select name="flower" defaultValue={f.flower} className={select} aria-label="Filter by flowering time">
        <option value="">Any flowering</option>
        {FLOWER_BANDS.map((b) => (
          <option key={b.key} value={b.key}>{b.label}</option>
        ))}
      </select>
      {breeders.length > 0 && (
        <select name="breeder" defaultValue={f.breeder} className={select} aria-label="Filter by breeder">
          <option value="">Any breeder</option>
          {breeders.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      )}
    </>
  )
}

export default async function StrainsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const rawPage = Number.parseInt(sp?.page ?? "1", 10)
  const f: StrainFilters = {
    q: (sp?.q ?? "").trim().slice(0, 80),
    type: (sp?.type ?? "").toUpperCase(),
    effect: (sp?.effect ?? "").toUpperCase(),
    flavor: (sp?.flavor ?? "").toUpperCase(),
    difficulty: parseStrainDifficulty((sp?.difficulty ?? "").toUpperCase()),
    thc: (sp?.thc ?? "").toLowerCase(),
    flower: (sp?.flower ?? "").toLowerCase(),
    breeder: (sp?.breeder ?? "").trim().slice(0, 100),
    page: Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGE) : 1,
  }

  const [{ strains, total }, breeders] = await Promise.all([getStrains(f), getBreeders()])
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageHref = (p: number) => filterHref(f, { page: p })
  const nActive = activeFilterCount(f)
  const hasQuery = !!f.q || nActive > 0

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
        <form action="/strains" className="mb-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              name="q"
              defaultValue={f.q}
              placeholder="Search strains, genetics, breeders..."
              className="w-full pl-11 pr-4 py-3 rounded-full border border-border bg-card/80 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {/* Keep active facets when re-searching */}
            {f.type && <input type="hidden" name="type" value={f.type} />}
            {f.effect && <input type="hidden" name="effect" value={f.effect} />}
            {f.flavor && <input type="hidden" name="flavor" value={f.flavor} />}
            {f.difficulty && <input type="hidden" name="difficulty" value={f.difficulty} />}
            {f.thc && <input type="hidden" name="thc" value={f.thc} />}
            {f.flower && <input type="hidden" name="flower" value={f.flower} />}
            {f.breeder && <input type="hidden" name="breeder" value={f.breeder} />}
          </div>
        </form>

        {/* Facet filters — a GET form so every filtered view is a
            shareable, server-rendered URL. Collapsed to a disclosure on
            small screens; an always-visible rail on lg+. */}
        <details className="lg:hidden mb-6 rounded-2xl border border-border/70 bg-card/80 group" {...(nActive > 0 ? { open: true } : {})}>
          <summary className="px-4 py-3 text-sm font-medium cursor-pointer select-none list-none flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-primary" />
            Filters{nActive > 0 ? ` (${nActive} active)` : ""}
            <span aria-hidden="true" className="ml-auto text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <form action="/strains" method="get" className="px-4 pb-4 flex flex-wrap gap-2">
            {f.q && <input type="hidden" name="q" value={f.q} />}
            <FilterControls f={f} breeders={breeders} />
            <button type="submit" className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium min-h-9">
              Apply
            </button>
            {nActive > 0 && (
              <Link href={f.q ? `/strains?q=${encodeURIComponent(f.q)}` : "/strains"} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
                Clear
              </Link>
            )}
          </form>
        </details>
        <form action="/strains" method="get" className="hidden lg:flex mb-6 flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card/80 px-4 py-3">
          <SlidersHorizontal className="w-4 h-4 text-primary" aria-hidden="true" />
          {f.q && <input type="hidden" name="q" value={f.q} />}
          <FilterControls f={f} breeders={breeders} />
          <button type="submit" className="px-4 py-2 rounded-full bg-primary text-primary-foreground text-sm font-medium min-h-9">
            Apply
          </button>
          {nActive > 0 && (
            <Link href={f.q ? `/strains?q=${encodeURIComponent(f.q)}` : "/strains"} className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
              Clear
            </Link>
          )}
        </form>

        <div className="flex justify-between items-center mb-6 gap-3 flex-wrap">
          <h2 className="font-display text-xl font-semibold">
            {hasQuery ? `${total} result${total === 1 ? "" : "s"}` : "All Strains"}
          </h2>
          <div className="flex items-center gap-3">
            <Link href="/diaries/new" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
              Start a grow diary →
            </Link>
            <Link
            href="/strains/new"
              className="tt-cta rounded-full px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Add Strain
            </Link>
          </div>
        </div>

        {strains.length === 0 ? (
          <div className="bg-card/80 rounded-2xl border border-border/70">
            <EmptyState
              icon={Leaf}
              title={hasQuery ? "No strains match" : "No strains in the database yet"}
              description={hasQuery ? "Try different filters or a different name, genetics, or breeder." : "Help build the community strain database."}
              action={hasQuery ? { label: "Clear filters", href: "/strains" } : { label: "Add the first strain", href: "/strains/new" }}
            />
          </div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {strains.map((strain) => (
                <StrainCard key={strain.id} strain={strain} />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 mt-6">
                {f.page > 1 ? (
                  <Link
                    href={pageHref(f.page - 1)}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-full bg-card border border-border text-sm font-medium hover:border-primary/40 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" /> Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-sm text-muted-foreground">
                  Page {f.page} of {totalPages}
                </span>
                {f.page < totalPages ? (
                  <Link
                    href={pageHref(f.page + 1)}
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
