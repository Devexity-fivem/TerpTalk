import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { Leaf, Calendar, TrendingUp, Users } from "lucide-react"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import EmptyState from "@/components/ui/empty-state"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Grow Diaries",
  description: "Follow real cannabis grow journals — seed to harvest updates, environment data, and results from TerpTalk growers.",
}

async function getDiaries() {
  const diaries = await prisma.growDiary.findMany({
    where: { deleted: false },
    take: 12,
    orderBy: [
      { featured: "desc" },
      { createdAt: "desc" },
    ],
    include: {
      author: { select: publicUserSelect },
      _count: {
        select: { updates: true, followers: true },
      },
    },
  })

  return diaries
}

export default async function DiariesPage() {
  const diaries = await getDiaries()

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Grow Diaries</h1>
          <p className="text-muted-foreground">Document and share your complete grow journey from seed to harvest</p>
        </div>

        {/* Featured Diaries */}
        {diaries.filter(d => d.featured).length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-primary" />
              Featured Diaries
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {diaries.filter(d => d.featured).map((diary) => (
                <Link
                  key={diary.id}
                  href={`/diaries/${diary.id}`}
                  className="bg-card rounded-lg border border-border overflow-hidden hover:border-primary/50 transition-colors"
                >
                  <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                    <Leaf className="w-16 h-16 text-primary/30" />
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-primary px-2 py-1 bg-primary/10 rounded">
                        {diary.growType}
                      </span>
                      <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                        {diary.stage}
                      </span>
                    </div>
                    <h3 className="font-semibold mb-1">{diary.title}</h3>
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{diary.description}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {diary.author.profile?.username || diary.author.name}
                        <RoleBadge role={diary.author.role} />
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {diary._count.updates} updates
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* All Diaries */}
        <div>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">All Diaries</h2>
            <Link
              href="/diaries/new"
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-colors text-sm"
            >
              Start New Diary
            </Link>
          </div>

          {diaries.length === 0 ? (
            <div className="bg-card rounded-xl border border-border">
              <EmptyState
                icon={Leaf}
                title="No grow diaries yet"
                description="Be the first to document your grow journey."
                action={{ label: "Start your first diary", href: "/diaries/new" }}
              />
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {diaries.map((diary) => (
                <Link
                  key={diary.id}
                  href={`/diaries/${diary.id}`}
                  className="bg-card rounded-lg border border-border overflow-hidden hover:border-primary/50 transition-colors"
                >
                  <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                    <Leaf className="w-16 h-16 text-primary/30" />
                  </div>
                  <div className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      {diary.featured && (
                        <span className="text-xs text-primary px-2 py-1 bg-primary/10 rounded">
                          Featured
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                        {diary.growType}
                      </span>
                      <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                        {diary.stage}
                      </span>
                    </div>
                    <h3 className="font-semibold mb-1">{diary.title}</h3>
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{diary.description}</p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {diary.author.profile?.username || diary.author.name}
                        <RoleBadge role={diary.author.role} />
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {diary._count.updates} updates
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}