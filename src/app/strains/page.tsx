import { prisma } from "@/lib/prisma"
import { Leaf, Plus, Search } from "lucide-react"
import Link from "next/link"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Strain Database",
  description: "Community-maintained cannabis strain database — genetics, breeders, growing info, and grower photos.",
}

async function getStrains() {
  const strains = await prisma.strain.findMany({
    take: 24,
    orderBy: { name: "asc" },
    include: {
      photos: { take: 1, orderBy: { createdAt: "desc" } },
      _count: { select: { photos: true } },
    },
  })

  return strains
}

export default async function StrainsPage() {
  const strains = await getStrains()

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Strain Database</h1>
          <p className="text-muted-foreground">Community-maintained database of cannabis strains, genetics, and growing characteristics</p>
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search strains..."
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-semibold">All Strains</h2>
          <Link
            href="/strains/new"
            className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors text-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Strain
          </Link>
        </div>

        {strains.length === 0 ? (
          <div className="bg-card rounded-lg border border-border p-12 text-center">
            <Leaf className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold mb-2">No strains in database yet</h3>
            <p className="text-muted-foreground mb-4">Help build our community strain database!</p>
            <Link
              href="/strains/new"
              className="bg-primary text-primary-foreground px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors"
            >
              Add First Strain
            </Link>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {strains.map((strain) => (
              <Link
                key={strain.id}
                href={`/strains/${strain.id}`}
                className="bg-card rounded-lg border border-border p-4 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                    {strain.photos[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={strain.photos[0].imageUrl} alt={strain.name} className="w-full h-full object-cover" />
                    ) : (
                      <Leaf className="w-6 h-6 text-primary" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-semibold">{strain.name}</h3>
                    {strain.breeder && (
                      <p className="text-xs text-muted-foreground">{strain.breeder}</p>
                    )}
                    {strain._count.photos > 0 && (
                      <p className="text-xs text-primary">{strain._count.photos} photo{strain._count.photos !== 1 ? "s" : ""}</p>
                    )}
                  </div>
                </div>
                {strain.type && (
                  <div className="text-xs text-muted-foreground mb-2">
                    {strain.type}
                  </div>
                )}
                {strain.genetics && (
                  <div className="text-xs text-muted-foreground line-clamp-1">
                    {strain.genetics}
                  </div>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
