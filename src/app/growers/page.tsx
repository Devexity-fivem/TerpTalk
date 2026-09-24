import { prisma } from "@/lib/prisma"
import { activeAuthor, blockedUserIds, rankableProfile } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unstable_cache } from "next/cache"
import Link from "next/link"
import { Sprout, Users, Leaf, ChevronLeft, ChevronRight } from "lucide-react"
import RoleBadge from "@/components/role-badge"
import TierChip from "@/components/tier-chip"
import Surface from "@/components/ui/surface"
import EmptyState from "@/components/ui/empty-state"
import { Avatar } from "@/components/ui/avatar"
import { STAGE_LABELS } from "@/lib/diary-weeks"
import { cn } from "@/lib/utils"

export const metadata = {
  title: "Growers",
  description:
    "Meet the TerpTalk growers — browse community members documenting real cannabis grows, from first seed to harvest.",
}

const PAGE_SIZE = 24
const MAX_PAGE = 50

const SORTS = [
  { key: "active", label: "Growing now" },
  { key: "new", label: "New members" },
  { key: "all", label: "All growers" },
] as const
type Sort = (typeof SORTS)[number]["key"]

// Card payload — public fields only. publicMilestoneOptOut members are
// excluded upstream by rankableProfile(), and hidden-online status is
// never read here.
const PROFILE_SELECT = {
  username: true,
  avatarUrl: true,
  reputation: true,
  bio: true,
  profileTitle: true,
  joinDate: true,
  user: {
    select: {
      id: true,
      name: true,
      role: true,
      _count: {
        select: {
          // Public diaries only — private/unlisted grows never inflate
          // the directory's grow counts.
          diaryCreator: { where: { deleted: false, ...publicDiaryWhere } },
          threadCreator: { where: { deleted: false } },
        },
      },
    },
  },
} as const

const LIVE_GROW_SELECT = {
  authorId: true,
  slug: true,
  id: true,
  title: true,
  stage: true,
  updatedAt: true,
  strain: true,
  strainRef: { select: { name: true } },
} as const

const getGrowers = unstable_cache(
  async (sort: Sort, page: number) => {
    if (sort === "active") {
      // Members with a live (unharvested) public grow, most recent diary
      // activity first. groupBy gives the ordering + the paging window.
      const grouped = await prisma.growDiary.groupBy({
        by: ["authorId"],
        where: { deleted: false, harvested: false, author: activeAuthor(), ...publicDiaryWhere },
        _max: { updatedAt: true },
        orderBy: { _max: { updatedAt: "desc" } },
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
      })
      const ids = grouped.map((g) => g.authorId)
      if (ids.length === 0) return { rows: [], total: 0 }

      const [profiles, liveGrows, totalGroups] = await Promise.all([
        prisma.profile.findMany({ where: { userId: { in: ids }, ...rankableProfile() }, select: PROFILE_SELECT }),
        // One latest live grow per member — distinct on authorId.
        prisma.growDiary.findMany({
          where: { authorId: { in: ids }, deleted: false, harvested: false, author: activeAuthor(), ...publicDiaryWhere },
          orderBy: { updatedAt: "desc" },
          distinct: ["authorId"],
          select: LIVE_GROW_SELECT,
        }),
        prisma.growDiary.groupBy({ by: ["authorId"], where: { deleted: false, harvested: false, author: activeAuthor(), ...publicDiaryWhere } }),
      ])
      const byUser = new Map(profiles.map((p) => [p.user.id, p]))
      const growByUser = new Map(liveGrows.map((g) => [g.authorId, g]))
      const rows = ids
        .map((id) => {
          const profile = byUser.get(id)
          return profile ? { profile, liveGrow: growByUser.get(id) ?? null } : null
        })
        .filter((r): r is NonNullable<typeof r> => !!r)
      return { rows, total: totalGroups.length }
    }

    // "new" and "all" — profile-ordered browsing with the same card shape.
    const [profiles, total] = await Promise.all([
      prisma.profile.findMany({
        where: rankableProfile(),
        orderBy: sort === "new" ? { joinDate: "desc" } : { username: "asc" },
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
        select: PROFILE_SELECT,
      }),
      prisma.profile.count({ where: rankableProfile() }),
    ])
    if (profiles.length === 0) return { rows: [], total }

    const liveGrows = await prisma.growDiary.findMany({
      where: {
        authorId: { in: profiles.map((p) => p.user.id) },
        deleted: false,
        harvested: false,
        author: activeAuthor(),
        ...publicDiaryWhere,
      },
      orderBy: { updatedAt: "desc" },
      distinct: ["authorId"],
      select: LIVE_GROW_SELECT,
    })
    const growByUser = new Map(liveGrows.map((g) => [g.authorId, g]))
    return {
      rows: profiles.map((profile) => ({ profile, liveGrow: growByUser.get(profile.user.id) ?? null })),
      total,
    }
  },
  ["growers-directory"],
  { revalidate: 120, tags: ["diaries"] }
)

export default async function GrowersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const sort: Sort = SORTS.some((s) => s.key === sp?.sort) ? (sp!.sort as Sort) : "active"
  const rawPage = Number.parseInt(sp?.page ?? "1", 10)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGE) : 1

  const [data, session] = await Promise.all([
    getGrowers(sort, page),
    getServerSession(authOptions),
  ])
  // Cached payload is global — apply the viewer's block graph after read.
  const blockedIds = await blockedUserIds(session?.user?.id)
  const rows = data.rows.filter((r) => !blockedIds.includes(r.profile.user.id))
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const href = (s: Sort, p: number) => {
    const q = new URLSearchParams()
    if (s !== "active") q.set("sort", s)
    if (p > 1) q.set("page", String(p))
    const str = q.toString()
    return `/growers${str ? `?${str}` : ""}`
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <span className="tt-eyebrow">The garden</span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold mt-1.5 mb-2 tracking-tight">Growers</h1>
          <p className="text-muted-foreground max-w-2xl">
            Community members documenting real grows in public diaries — follow along, learn from their logs, say hi.
          </p>
        </div>

        {/* Sort tabs — discovery, not ranking. No order here is a status claim. */}
        <div className="flex flex-wrap gap-1.5 mb-6" role="tablist" aria-label="Browse growers">
          {SORTS.map((s) => (
            <Link
              key={s.key}
              href={href(s.key, 1)}
              role="tab"
              aria-selected={sort === s.key}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors min-h-9 inline-flex items-center",
                sort === s.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
            </Link>
          ))}
          <Link
            href="/leaderboard"
            className="ml-auto rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors min-h-9 inline-flex items-center"
          >
            View leaderboard →
          </Link>
        </div>

        {rows.length === 0 ? (
          <Surface padding="none">
            <EmptyState
              icon={Users}
              title={
                sort === "active"
                  ? "No live public grows right now"
                  : data.total === 0
                    ? "No growers to show yet"
                    : "No growers on this page"
              }
              description={
                sort === "active"
                  ? "When members document public diaries they'll appear here. Start yours to be first."
                  : data.total === 0
                    ? "Members with public profiles will appear here as the community grows."
                    : "Try an earlier page."
              }
              action={
                sort === "active"
                  ? { label: "Start a grow diary", href: "/diaries/new" }
                  : data.total === 0
                    ? { label: "Browse grow diaries", href: "/diaries" }
                    : { label: "Back to page one", href: href(sort, 1) }
              }
            />
          </Surface>
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {rows.map(({ profile, liveGrow }) => {
                const name = profile.username || profile.user.name || "Member"
                const diaryCount = profile.user._count.diaryCreator
                return (
                  <Link
                    key={profile.user.id}
                    href={`/u/${profile.username || profile.user.name}`}
                    className="tt-edge-card tt-spotlight block"
                  >
                    <Surface padding="sm" className="h-full">
                      <div className="flex items-start gap-3">
                        <Avatar
                          src={profile.avatarUrl}
                          alt=""
                          size="lg"
                          className="w-12 h-12 bg-primary/10 shrink-0"
                          fallback={<span className="text-primary font-bold">{name[0].toUpperCase()}</span>}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold truncate">{name}</span>
                            <RoleBadge role={profile.user.role} />
                            <TierChip reputation={profile.reputation} publicMilestoneOptOut={false} />
                          </div>
                          {profile.profileTitle && (
                            <p className="text-xs text-primary/90 font-medium mt-0.5 truncate">{profile.profileTitle}</p>
                          )}
                          {profile.bio && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{profile.bio}</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Leaf className="w-3.5 h-3.5" />
                          {diaryCount} public grow{diaryCount === 1 ? "" : "s"}
                        </span>
                        <span className="flex items-center gap-1">
                          <Sprout className="w-3.5 h-3.5" />
                          {profile.user._count.threadCreator} threads
                        </span>
                      </div>

                      {/* Live grow context — only when a public unharvested
                          diary exists; nothing is synthesized. */}
                      {liveGrow && (
                        <div className="mt-3 rounded-xl bg-primary/5 border border-primary/15 px-3 py-2">
                          <p className="text-[10px] uppercase tracking-wide text-primary/80 font-semibold mb-0.5">
                            Growing now · {(STAGE_LABELS[liveGrow.stage] ?? liveGrow.stage).toLowerCase()}
                          </p>
                          <p className="text-xs font-medium truncate">
                            {liveGrow.title}
                            {(liveGrow.strainRef?.name || liveGrow.strain) && (
                              <span className="text-muted-foreground font-normal">
                                {" "}· {liveGrow.strainRef?.name || liveGrow.strain}
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                    </Surface>
                  </Link>
                )
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between gap-3 mt-6">
                {page > 1 ? (
                  <Link
                    href={href(sort, page - 1)}
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
                    href={href(sort, page + 1)}
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
