import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { BookOpen, Plus } from "lucide-react"
import Link from "next/link"
import EmptyState from "@/components/ui/empty-state"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Grow Guides",
  description: "Staff-written guides for cannabis growers — from first germination to harvest and curing.",
}

const getGuides = unstable_cache(
  async () => {
    return prisma.guide.findMany({
      where: { published: true },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true, profile: { select: { username: true } } } } },
    })
  },
  ["guides-list"],
  { revalidate: 300, tags: ["guides"] }
)

export default async function GuidesPage() {
  const session = await getServerSession(authOptions)
  const isStaff = ["MODERATOR", "ADMINISTRATOR"].includes((session?.user as { role?: string })?.role || "")

  const guides = await getGuides()

  const topics = [...new Set(guides.map((g) => g.topic))]

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex justify-between items-start mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
              <BookOpen className="w-8 h-8 text-primary" /> Grow Guides
            </h1>
            <p className="text-muted-foreground">Staff-written knowledge — from seed to cure.</p>
          </div>
          {isStaff && (
            <Link href="/guides/new" className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm hover:bg-primary/90">
              <Plus className="w-4 h-4" /> New Guide
            </Link>
          )}
        </div>

        {guides.length === 0 ? (
          <div className="bg-card rounded-xl border border-border">
            <EmptyState
              icon={BookOpen}
              title="No guides yet"
              description="Staff guides are coming soon."
            />
          </div>
        ) : (
          topics.map((topic) => (
            <div key={topic} className="mb-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{topic}</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                {guides.filter((g) => g.topic === topic).map((g) => (
                  <Link key={g.id} href={`/guides/${g.slug}`} className="bg-card border border-border rounded-xl p-5 hover:border-primary/50 transition-colors">
                    <h3 className="font-semibold mb-1">{g.title}</h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">{g.excerpt}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      by {g.author.profile?.username || g.author.name} · {new Date(g.createdAt).toLocaleDateString()}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
