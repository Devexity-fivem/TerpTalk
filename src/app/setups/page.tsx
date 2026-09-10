import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { Settings, Plus, Users } from "lucide-react"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import EmptyState from "@/components/ui/empty-state"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Grow Setup Showcases",
  description: "Cannabis grow room and tent setups — lighting, tents, and equipment shared by TerpTalk growers.",
}

async function getSetups() {
  const setups = await prisma.growSetup.findMany({
    where: { deleted: false },
    take: 12,
    orderBy: { createdAt: "desc" },
    include: {
      author: { select: publicUserSelect },
      images: { take: 1, orderBy: { order: "asc" } },
      _count: {
        select: { comments: true },
      },
    },
  })

  return setups
}

export default async function SetupsPage() {
  const setups = await getSetups()

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Grow Setup Showcases</h1>
          <p className="text-muted-foreground">Show off your grow room and equipment. Get feedback and inspiration from the community.</p>
        </div>

        <div className="flex justify-between items-center mb-6">
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
              title="No setups shared yet"
              description="Be the first to show off your grow setup."
              action={{ label: "Share your setup", href: "/setups/new" }}
            />
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {setups.map((setup) => (
              <Link
                key={setup.id}
                href={`/setups/${setup.id}`}
                className="bg-card rounded-lg border border-border overflow-hidden hover:border-primary/50 transition-colors"
              >
                {setup.images.length > 0 ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={setup.images[0].url} alt={setup.title} className="aspect-video w-full object-cover" />
                ) : (
                  <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                    <Settings className="w-16 h-16 text-primary/30" />
                  </div>
                )}
                <div className="p-4">
                  <h3 className="font-semibold mb-1">{setup.title}</h3>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{setup.description}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {setup.author.profile?.username || setup.author.name}
                      <RoleBadge role={setup.author.role} />
                    </span>
                    <span>{setup._count.comments} comments</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}