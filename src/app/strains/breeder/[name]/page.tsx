import { prisma } from "@/lib/prisma"
import { activeAuthor } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { unstable_cache } from "next/cache"
import { Leaf, Dna, Sprout } from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import EmptyState from "@/components/ui/empty-state"
import StrainCard from "@/components/strain-card"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { buildMetadata } from "@/lib/seo"
import { normalizeBreederName, breederKeyFromSlug, breederPath } from "@/lib/breeders"

export const revalidate = 300

// Canonical breeder display names — dedupe the free-text field
// case/punctuation-insensitively, first-seen spelling wins.
const getBreederDirectory = unstable_cache(
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
      const key = normalizeBreederName(b)
      if (b && !seen.has(key)) seen.set(key, b)
    }
    return [...seen.values()]
  },
  ["breeder-directory"],
  { revalidate: 300, tags: ["strains"] }
)

const getBreederStrains = unstable_cache(
  async (canonicalName: string) => {
    // equals-insensitive finds the exact canonical spelling; variants like
    // "Fast Buds" vs "FastBuds" differ by punctuation so also match the
    // normalized form against every breeder row for this name.
    const all = await prisma.strain.findMany({
      where: { breeder: { not: null } },
      select: { breeder: true },
      take: 500,
    })
    const key = normalizeBreederName(canonicalName)
    const variants = [...new Set(all.map((r) => r.breeder!.trim()).filter((b) => b && normalizeBreederName(b) === key))]
    const strains = await prisma.strain.findMany({
      where: { OR: variants.map((b) => ({ breeder: { equals: b, mode: "insensitive" as const } })) },
      orderBy: { name: "asc" },
      take: 100,
      include: {
        photos: {
          where: { user: activeAuthor() },
          take: 1,
          orderBy: { createdAt: "desc" },
        },
        _count: {
          select: {
            photos: { where: { user: activeAuthor() } },
            diaries: { where: { deleted: false, author: activeAuthor(), ...publicDiaryWhere } },
          },
        },
      },
    })
    const totals = strains.reduce(
      (acc, s) => ({ grows: acc.grows + s._count.diaries, photos: acc.photos + s._count.photos }),
      { grows: 0, photos: 0 }
    )
    const harvested = await prisma.growDiary.count({
      where: {
        deleted: false,
        harvested: true,
        author: activeAuthor(),
        ...publicDiaryWhere,
        strainId: { in: strains.map((s) => s.id) },
      },
    })
    return { strains, totals, harvested }
  },
  ["breeder-strains"],
  { revalidate: 300, tags: ["strains", "diaries"] }
)

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const directory = await getBreederDirectory()
  const key = breederKeyFromSlug(name)
  const canonical = directory.find((b) => normalizeBreederName(b) === key)
  if (!canonical) {
    return buildMetadata({ title: "Breeder not found", robots: { index: false } })
  }
  return buildMetadata({
    title: `${canonical} — Cannabis Breeder Strains & Community Grows`,
    description: `Strains by ${canonical} in the TerpTalk catalog, with community grow diaries and growing characteristics.`,
    pathname: breederPath(canonical),
  })
}

export default async function BreederPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  const directory = await getBreederDirectory()
  const key = breederKeyFromSlug(name)
  const canonical = directory.find((b) => normalizeBreederName(b) === key)
  if (!canonical) notFound()

  const { strains, totals, harvested } = await getBreederStrains(canonical)

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <Breadcrumbs items={[
          { label: "Strains", href: "/strains" },
          { label: "Breeders", href: "/strains" },
          { label: canonical },
        ]} />

        <div className="mb-8">
          <span className="tt-eyebrow">Breeder</span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold mt-1.5 mb-2 tracking-tight flex items-center gap-3">
            <Dna className="w-8 h-8 text-spectrum" /> {canonical}
          </h1>
          <p className="text-muted-foreground">
            {strains.length} strain{strains.length === 1 ? "" : "s"} in the community catalog
            {totals.grows > 0 && <> · {totals.grows} public grow{totals.grows === 1 ? "" : "s"}</>}
            {harvested > 0 && <> · {harvested} harvested</>}
          </p>
        </div>

        {strains.length === 0 ? (
          <div className="bg-card/80 rounded-2xl border border-border/70">
            <EmptyState
              icon={Leaf}
              title={`No catalog strains by ${canonical} yet`}
              description="Strains appear here when members add them to the database with this breeder listed."
              action={{ label: "Add a strain", href: "/strains/new" }}
            />
          </div>
        ) : (
          <>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {strains.map((strain) => (
                <StrainCard key={strain.id} strain={strain} />
              ))}
            </div>
            {totals.grows === 0 && (
              <p className="mt-6 text-sm text-muted-foreground flex items-center gap-2">
                <Sprout className="w-4 h-4" />
                Nobody has documented a public grow of a {canonical} strain yet —{" "}
                <Link href="/diaries/new" className="text-primary hover:underline">start the first diary</Link>.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
