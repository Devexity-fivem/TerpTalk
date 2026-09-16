import { prisma } from "@/lib/prisma"
import { publicUserSelect, activeAuthor } from "@/lib/security"
import { unstable_cache } from "next/cache"
import { Leaf, Calendar, TrendingUp, Users, BarChart3 } from "lucide-react"
import { getCommunityGrowStats, type Distribution } from "@/lib/community-stats"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import TierChip from "@/components/tier-chip"
import EmptyState from "@/components/ui/empty-state"

export const revalidate = 300

export const metadata = {
  title: "Grow Diaries",
  description: "Follow real cannabis grow journals — seed to harvest updates, environment data, and results from TerpTalk growers.",
}

const getDiaries = unstable_cache(
  async () => {
    const diaries = await prisma.growDiary.findMany({
      where: { deleted: false, author: activeAuthor() },
      take: 12,
      orderBy: [
        { featured: "desc" },
        { createdAt: "desc" },
      ],
      include: {
        author: { select: publicUserSelect },
        // Latest update's first photo becomes the card cover.
        updates: {
          take: 1,
          orderBy: { createdAt: "desc" },
          include: { images: { take: 1, orderBy: { order: "asc" } } },
        },
        _count: {
          select: { updates: true, followers: true },
        },
      },
    })

    return diaries
  },
  ["diaries-list"],
  { revalidate: 300, tags: ["diaries"] }
)

/** One distribution as an accessible text line — "Label N (pct%) · …". */
function DistLine({ label, dist }: { label: string; dist: Distribution }) {
  if (dist.suppressed || dist.rows.length === 0) return null
  return (
    <div>
      <span className="text-muted-foreground">{label}: </span>
      {dist.rows.map((r, i) => (
        <span key={r.value}>
          {i > 0 && <span className="text-muted-foreground"> · </span>}
          {r.label} {r.count} <span className="text-muted-foreground">({r.pct}%)</span>
        </span>
      ))}
      <span className="text-muted-foreground"> — {dist.n} grow{dist.n === 1 ? "" : "s"}</span>
    </div>
  )
}

export default async function DiariesPage() {
  const [diaries, stats] = await Promise.all([getDiaries(), getCommunityGrowStats()])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Grow Diaries</h1>
          <p className="text-sm text-muted-foreground">Document and share your complete grow journey from seed to harvest</p>
        </div>

        {/* Community grow data — aggregate-only stats, descriptive wording */}
        <div className="bg-card rounded-xl border border-border p-5 mb-6">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h2 className="font-semibold">Community grow data</h2>
            {stats.label && (
              <span className={`text-xs px-2 py-0.5 rounded ml-auto ${stats.tier === "early" ? "bg-amber-500/10 text-amber-500" : "bg-secondary text-muted-foreground"}`}>
                {stats.label}
              </span>
            )}
          </div>
          {stats.tier === "none" ? (
            <p className="text-sm text-muted-foreground">
              Not enough community data yet — stats appear as members log grow diaries.
            </p>
          ) : (
            <div className="space-y-4 text-sm">
              {/* Commonly used methods — counts + shares, no rankings */}
              <div className="space-y-1.5">
                <DistLine label="Grow types" dist={stats.methods.growTypes} />
                <DistLine label="Mediums" dist={stats.methods.mediums} />
                <DistLine label="Lights" dist={stats.methods.lights} />
                <DistLine label="Techniques" dist={stats.methods.techniques} />
              </div>

              {/* Harvest summary */}
              <div className="pt-3 border-t border-border">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                  <span>{stats.harvestedCount} harvested grow{stats.harvestedCount === 1 ? "" : "s"}</span>
                  {stats.harvest.medianYieldOz.value != null && (
                    <span>
                      median reported yield {stats.harvest.medianYieldOz.value} oz ({stats.harvest.medianYieldOz.n} harvests)
                    </span>
                  )}
                  {stats.harvest.medianTotalDays.value != null && (
                    <span>
                      median seed→harvest {stats.harvest.medianTotalDays.value}d ({stats.harvest.medianTotalDays.n} grows)
                    </span>
                  )}
                  {!stats.harvest.difficulty.suppressed && (
                    <span>
                      difficulty: {stats.harvest.difficulty.easy} easy · {stats.harvest.difficulty.normal} normal · {stats.harvest.difficulty.hard} hard
                    </span>
                  )}
                </div>
                {!stats.harvest.yieldBuckets.suppressed && stats.harvest.yieldBuckets.rows.length > 0 && (
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    reported yields: {stats.harvest.yieldBuckets.rows.map((r) => `${r.label} ×${r.count}`).join(" · ")}
                  </div>
                )}
                {!stats.harvest.ratings.suppressed && stats.harvest.ratings.rows.length > 0 && (
                  <div className="mt-1.5 text-xs text-muted-foreground">
                    member ratings:{" "}
                    {[...stats.harvest.ratings.rows]
                      .sort((a, b) => Number(a.value) - Number(b.value))
                      .map((r) => `${r.value}/10 ×${r.count}`)
                      .join(" · ")}{" "}
                    ({stats.harvest.ratings.n} harvests)
                  </div>
                )}
                {stats.harvestedCount > 0 &&
                  stats.harvest.medianYieldOz.suppressed &&
                  stats.harvest.medianTotalDays.suppressed && (
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      More harvested grows are needed before yield and timing stats are shown.
                    </p>
                  )}
              </div>
            </div>
          )}
        </div>

        {/* Featured Diaries */}
        {diaries.filter(d => d.featured).length > 0 && (
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Featured Diaries
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {diaries.filter(d => d.featured).map((diary) => (
                <Link
                  key={diary.id}
                  href={`/diaries/${diary.id}`}
                  className="bg-card rounded-lg border border-border overflow-hidden hover:border-primary/50 transition-colors"
                >
                  <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center overflow-hidden">
                    {diary.updates[0]?.images[0]?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={diary.updates[0].images[0].url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Leaf className="w-10 h-10 text-primary/30" />
                    )}
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
                        <TierChip reputation={diary.author.profile?.reputation ?? 0} publicMilestoneOptOut={diary.author.profile?.publicMilestoneOptOut} />
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
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-semibold">All Diaries</h2>
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
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {diaries.map((diary) => (
                <Link
                  key={diary.id}
                  href={`/diaries/${diary.id}`}
                  className="bg-card rounded-lg border border-border overflow-hidden hover:border-primary/50 transition-colors"
                >
                  <div className="aspect-video bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center overflow-hidden">
                    {diary.updates[0]?.images[0]?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={diary.updates[0].images[0].url}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Leaf className="w-10 h-10 text-primary/30" />
                    )}
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
                        <TierChip reputation={diary.author.profile?.reputation ?? 0} publicMilestoneOptOut={diary.author.profile?.publicMilestoneOptOut} />
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