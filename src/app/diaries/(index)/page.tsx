import { prisma } from "@/lib/prisma"
import { publicUserSelect, activeAuthor } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { unstable_cache } from "next/cache"
import { Leaf, TrendingUp, Users, BarChart3, ChevronLeft, ChevronRight, Dna } from "lucide-react"
import { getCommunityGrowStats, type Distribution } from "@/lib/community-stats"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { blockedUserIds } from "@/lib/security"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import TierChip from "@/components/tier-chip"
import EmptyState from "@/components/ui/empty-state"
import StageProgress from "@/components/stage-progress"
import { STAGE_LABELS, diaryCompleteness, diaryWeek } from "@/lib/diary-weeks"
import { diaryPath } from "@/lib/slugs"

export const revalidate = 300

export const metadata = {
  title: "Grow Diaries",
  description: "Follow real cannabis grow journals — seed to harvest updates, environment data, and results from TerpTalk growers.",
}

const PAGE_SIZE = 24
const MAX_PAGE = 50

const getDiaries = unstable_cache(
  async (page: number) => {
    const where = { deleted: false, author: activeAuthor(), ...publicDiaryWhere }
    // The rail owns featured diaries — the grid excludes them so page 1
    // never shows the same diary twice, and counts stay consistent.
    const gridWhere = { ...where, featured: false }
    const [diaries, total, featured] = await Promise.all([
      prisma.growDiary.findMany({
        where: gridWhere,
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        orderBy: [
          { createdAt: "desc" },
          { id: "asc" },
        ],
        include: {
          author: { select: publicUserSelect },
          strainRef: { select: { name: true } },
          // Light update window — feeds the card cover (latest photo) and
          // the completeness badge. Only evidence fields load, never content.
          updates: {
            take: 40,
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              createdAt: true,
              stage: true,
              temperature: true,
              humidity: true,
              vpd: true,
              images: { take: 1, orderBy: { order: "asc" }, select: { id: true, url: true } },
            },
          },
          _count: {
            select: { updates: true, followers: true },
          },
        },
      }),
      prisma.growDiary.count({ where: gridWhere }),
      // Featured rail is page-1-only, fetched separately so pagination never
      // hides or duplicates featured entries.
      page === 1
        ? prisma.growDiary.findMany({
            where: { ...where, featured: true },
            take: 6,
            orderBy: { createdAt: "desc" },
            include: {
              author: { select: publicUserSelect },
              strainRef: { select: { name: true } },
              updates: {
                take: 40,
                orderBy: { createdAt: "desc" },
                select: {
                  id: true,
                  createdAt: true,
                  stage: true,
                  temperature: true,
                  humidity: true,
                  vpd: true,
                  images: { take: 1, orderBy: { order: "asc" }, select: { id: true, url: true } },
                },
              },
              _count: {
                select: { updates: true, followers: true },
              },
            },
          })
        : Promise.resolve([]),
    ])

    return { diaries, total, featured }
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

type DiaryCardData = Awaited<ReturnType<typeof getDiaries>>["diaries"][number]

// Lifecycle order lives in lib/diary-weeks; StageProgress renders the
// segmented track (current = violet, done = emerald).
function DiaryCard({ diary, showFeatured = false }: { diary: DiaryCardData; showFeatured?: boolean }) {
  const authorName = diary.author.profile?.username || diary.author.name
  // Card week derives from startDate — the same rule the diary page uses —
  // never from a member-typed annotation.
  const week = diaryWeek(diary.startDate, new Date())
  const strainName = diary.strainRef?.name || diary.strain
  // "Well documented" is the public face of the completeness metric — a
  // positive badge only (≥80%), never a score or a ranking signal.
  const wellDocumented = diaryCompleteness(diary, diary.updates).percent >= 80
  return (
    <div className="tt-spotlight group bg-card rounded-2xl border border-border/70 overflow-hidden tt-lift hover:border-primary/50">
      <Link href={diaryPath(diary)} className="block relative">
        <div className="aspect-[16/10] bg-gradient-to-br from-primary/15 via-secondary to-spectrum/10 flex items-center justify-center overflow-hidden">
          {diary.updates[0]?.images[0]?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={diary.updates[0].images[0].url}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            />
          ) : (
            <Leaf className="w-10 h-10 text-primary/30" />
          )}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/55 to-transparent" />
        </div>
        {/* Overlay chips — stage + week badge, grow type, featured */}
        <div className="absolute left-3 top-3 flex gap-1.5">
          <span className="rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
            {STAGE_LABELS[diary.stage] ?? diary.stage}{` · Wk ${week}`}
          </span>
          {wellDocumented && (
            <span className="rounded-full bg-success/85 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-black backdrop-blur-sm">
              Well documented
            </span>
          )}
          {(showFeatured || diary.featured) && (
            <span className="rounded-full bg-amber-500/85 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-black backdrop-blur-sm">
              Featured
            </span>
          )}
        </div>
        <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white backdrop-blur-sm">
          {diary.growType}
        </span>
      </Link>
      <div className="p-4">
        <Link href={diaryPath(diary)} className="hover:text-primary transition-colors">
          <h3 className="font-display font-semibold mb-1 line-clamp-1">{diary.title}</h3>
        </Link>
        {strainName && (
          <div className="mb-1.5 flex items-center gap-1.5 text-xs">
            <Dna className="h-3 w-3 shrink-0 text-spectrum" />
            <span className="truncate font-medium text-primary">{strainName}</span>
            {diary.harvested && diary.harvestRating != null && (
              <span className="ml-auto shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 font-semibold text-warning">
                ★ {diary.harvestRating}/10
              </span>
            )}
          </div>
        )}
        {diary.techniques.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {diary.techniques.slice(0, 4).map((t) => (
              <span key={t} className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t}
              </span>
            ))}
          </div>
        )}
        {/* Lifecycle progress — where this grow sits seed → cure */}
        <StageProgress
          stage={diary.stage}
          caption={`${diary._count.updates} update${diary._count.updates === 1 ? "" : "s"}`}
          className="mb-3"
        />
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground flex-wrap border-t border-border/50 pt-3">
          <span className="flex items-center gap-1 min-w-0">
            <Users className="w-3 h-3 shrink-0" />
            <Link href={`/u/${authorName}`} className="truncate hover:text-foreground hover:underline">
              {authorName}
            </Link>
            <RoleBadge role={diary.author.role} />
            <TierChip reputation={diary.author.profile?.reputation ?? 0} publicMilestoneOptOut={diary.author.profile?.publicMilestoneOptOut} />
          </span>
          {diary._count.followers > 0 && (
            <span className="flex items-center gap-1 shrink-0">
              {diary._count.followers} follower{diary._count.followers === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export default async function DiariesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const sp = await searchParams
  const rawPage = Number.parseInt(sp?.page ?? "1", 10)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGE) : 1

  const [cached, stats, session] = await Promise.all([
    getDiaries(page),
    getCommunityGrowStats(),
    getServerSession(authOptions),
  ])
  const { total } = cached
  // The cached list is global — hide diaries by authors the viewer has
  // blocked or been blocked by (counts/pagination stay cache-based).
  const blockedIds = await blockedUserIds(session?.user?.id)
  const notBlocked = (authorId: string) => !blockedIds.includes(authorId)
  const diaries = cached.diaries.filter((d) => notBlocked(d.authorId))
  const featured = cached.featured.filter((d) => notBlocked(d.authorId))
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const pageHref = (p: number) => (p <= 1 ? "/diaries" : `/diaries?page=${p}`)

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <span className="tt-eyebrow">Seed to harvest</span>
          <h1 className="font-display text-3xl font-bold mt-1.5 mb-1 tracking-tight">Grow Diaries</h1>
          <p className="text-sm text-muted-foreground">Document and share your complete grow journey from seed to harvest</p>
        </div>

        {/* Community grow data — aggregate-only stats, descriptive wording */}
        <div className="bg-card/80 rounded-2xl border border-border/70 p-5 mb-6 tt-edge-card">
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h2 className="font-display font-semibold">Community grow data</h2>
            {stats.label && (
              <span className={`text-xs px-2 py-0.5 rounded ml-auto ${stats.tier === "early" ? "bg-amber-500/10 text-warning" : "bg-secondary text-muted-foreground"}`}>
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

        {/* Featured Diaries — page 1 only */}
        {featured.length > 0 && (
          <div className="mb-6">
            <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-spectrum" />
              Featured Diaries
            </h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {featured.map((diary) => (
                <DiaryCard key={diary.id} diary={diary} showFeatured />
              ))}
            </div>
          </div>
        )}

        {/* All Diaries */}
        <div>
          <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
            <div>
              <span className="tt-eyebrow">The journal wall</span>
              <h2 className="font-display text-xl font-semibold mt-1">All Diaries</h2>
            </div>
            <Link
              href="/diaries/new"
              className="tt-cta rounded-full px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all"
            >
              Start New Diary
            </Link>
          </div>

          {diaries.length === 0 ? (
            <div className="bg-card/80 rounded-2xl border border-border/70">
              <EmptyState
                icon={Leaf}
                title={total === 0 ? "No grow diaries yet" : "No diaries on this page"}
                description={total === 0 ? "Be the first to document your grow journey." : "This page is past the end of the diary list."}
                action={total === 0 ? { label: "Start your first diary", href: "/diaries/new" } : { label: "Back to page 1", href: "/diaries" }}
              />
            </div>
          ) : (
            <>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                {diaries.map((diary) => (
                  <DiaryCard key={diary.id} diary={diary} />
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
    </div>
  )
}
