import { prisma } from "@/lib/prisma"
import { publicUserSelect, activeAuthor, blockedUserIds } from "@/lib/security"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unstable_cache } from "next/cache"
import Link from "next/link"
import { MessageSquare, Clock, CheckCircle2, HelpCircle, Stethoscope, ChevronLeft, ChevronRight } from "lucide-react"
import RoleBadge from "@/components/role-badge"
import TierChip from "@/components/tier-chip"
import Surface from "@/components/ui/surface"
import TimeAgo from "@/components/ui/time-ago"
import EmptyState from "@/components/ui/empty-state"
import { cn } from "@/lib/utils"

export const metadata = {
  title: "Grow Questions",
  description:
    "Cannabis growing questions answered by the TerpTalk community — troubleshooting, techniques, nutrients, environment, and more. Solved answers marked by the asker.",
}

// The question-surface convention used across ops-metrics and Plant
// Doctor handoffs: categories whose slug or name reads as a help surface.
// No separate Question model — these are ordinary forum threads.
const QUESTION_RE = /question|help|problem|doctor/i

const PAGE_SIZE = 20
const MAX_PAGE = 50

const TABS = [
  { key: "unanswered", label: "Unanswered" },
  { key: "all", label: "All" },
  { key: "solved", label: "Solved" },
  { key: "newest", label: "Newest" },
  { key: "active", label: "Active" },
] as const
type Tab = (typeof TABS)[number]["key"]

const getQuestions = unstable_cache(
  async (tab: Tab, categorySlug: string | null, page: number) => {
    const allCategories = await prisma.category.findMany({
      where: { hidden: false },
      orderBy: { order: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        _count: {
          select: { threads: { where: { deleted: false, author: activeAuthor() } } },
        },
      },
    })
    const categories = allCategories.filter((c) => QUESTION_RE.test(`${c.slug} ${c.name}`))
    const activeCat = categorySlug ? categories.find((c) => c.slug === categorySlug) ?? null : null

    const where = {
      deleted: false,
      author: activeAuthor(),
      categoryId: { in: activeCat ? [activeCat.id] : categories.map((c) => c.id) },
      ...(tab === "unanswered" ? { replyCount: 0 } : {}),
      // "Solved" is the accepted-answer state the asker marked — never
      // inferred from reply counts or engagement.
      ...(tab === "solved" ? { acceptedAnswerId: { not: null } } : {}),
    }
    const orderBy =
      tab === "active"
        ? [{ lastActivityAt: "desc" as const }]
        : tab === "all"
          // Unanswered-first ordering — the people who need help float up.
          ? [{ replyCount: "asc" as const }, { lastActivityAt: "desc" as const }]
          : [{ createdAt: "desc" as const }]

    const [threads, total] = await Promise.all([
      prisma.thread.findMany({
        where,
        orderBy,
        take: PAGE_SIZE,
        skip: (page - 1) * PAGE_SIZE,
        select: {
          id: true,
          slug: true,
          title: true,
          replyCount: true,
          views: true,
          createdAt: true,
          lastActivityAt: true,
          acceptedAnswerId: true,
          authorId: true,
          author: { select: publicUserSelect },
          category: { select: { name: true, slug: true } },
          tags: { take: 4, select: { tag: { select: { name: true, slug: true } } } },
        },
      }),
      prisma.thread.count({ where }),
    ])

    return { categories, threads, total, invalidCategory: !!categorySlug && !activeCat }
  },
  ["questions-list"],
  { revalidate: 60, tags: ["forum"] }
)

function qs(tab: Tab, category: string | null, page: number) {
  const p = new URLSearchParams()
  if (tab !== "unanswered") p.set("filter", tab)
  if (category) p.set("category", category)
  if (page > 1) p.set("page", String(page))
  const s = p.toString()
  return `/questions${s ? `?${s}` : ""}`
}

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const tab: Tab = TABS.some((t) => t.key === sp?.filter) ? (sp!.filter as Tab) : "unanswered"
  const rawPage = Number.parseInt(sp?.page ?? "1", 10)
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.min(rawPage, MAX_PAGE) : 1
  const categorySlug = sp?.category?.trim() || null

  const [data, session] = await Promise.all([
    getQuestions(tab, categorySlug, page),
    getServerSession(authOptions),
  ])
  // The cached payload is global — hide authors this viewer has blocked
  // (or been blocked by) after the cache read, same as the forum index.
  const blockedIds = await blockedUserIds(session?.user?.id)
  const threads = data.threads.filter((t) => !blockedIds.includes(t.authorId))
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  // An unknown category slug silently broadens to all topics — surface it
  // honestly rather than pretending the filter applied.
  const activeCategory = categorySlug && !data.invalidCategory ? categorySlug : null
  // The ask flow reuses /forum/new — a selected topic rides along as the
  // existing ?category= prefill so the question lands in the right board.
  const askHref = `/forum/new${activeCategory ? `?category=${encodeURIComponent(activeCategory)}` : ""}`

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <span className="tt-eyebrow">Community</span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold mt-1.5 mb-2 tracking-tight">Grow Questions</h1>
          <p className="text-muted-foreground max-w-2xl">
            Real questions from real grows — answer what you can, and mark the reply that solved yours.
          </p>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1.5 mb-4" role="tablist" aria-label="Filter questions">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={qs(t.key, activeCategory, 1)}
              role="tab"
              aria-selected={tab === t.key}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors min-h-9 inline-flex items-center",
                tab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {/* Question-category chips — only categories that read as help surfaces */}
        {data.categories.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-6" aria-label="Question topics">
            <Link
              href={qs(tab, null, 1)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                !activeCategory
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-card/80 text-muted-foreground hover:text-foreground"
              )}
            >
              All topics
            </Link>
            {data.categories.map((c) => (
              <Link
                key={c.id}
                href={qs(tab, c.slug, 1)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                  activeCategory === c.slug
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-card/80 text-muted-foreground hover:text-foreground"
                )}
              >
                {c.name} · {c._count.threads}
              </Link>
            ))}
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="min-w-0 lg:col-span-2">
            <Surface padding="none" className="overflow-hidden">
              <div className="p-4 border-b border-border/60 flex items-center justify-between gap-3">
                <h2 className="font-display text-lg font-semibold">
                  {data.total} {tab === "unanswered" ? "unanswered " : tab === "solved" ? "solved " : ""}
                  question{data.total === 1 ? "" : "s"}
                </h2>
                <Link href={askHref} className="text-sm font-medium text-primary hover:underline shrink-0">
                  Ask a question →
                </Link>
              </div>

              {threads.length === 0 ? (
                <EmptyState
                  icon={HelpCircle}
                  title={
                    tab === "unanswered"
                      ? "Nothing unanswered right now"
                      : data.total === 0
                        ? "No questions yet"
                        : "No questions on this page"
                  }
                  description={
                    tab === "unanswered"
                      ? "Every open question has a reply — check back soon, or ask the next one."
                      : data.total === 0
                        ? "Grow questions live in the forum's help categories. Ask the first one and the community can jump in."
                        : "Try an earlier page or a different topic."
                  }
                  action={
                    data.total === 0 || tab === "unanswered"
                      ? { label: "Ask a grow question", href: askHref }
                      : { label: "Back to page one", href: qs(tab, activeCategory, 1) }
                  }
                />
              ) : (
                <div className="divide-y divide-border/60">
                  {threads.map((thread) => {
                    const solved = !!thread.acceptedAnswerId
                    return (
                      <Link
                        key={thread.id}
                        href={`/forum/thread/${thread.slug}`}
                        className="tt-edge-card tt-spotlight block p-4 hover:bg-secondary/50 transition-colors"
                      >
                        <div className="flex items-start gap-4">
                          {/* State column — solved check or open reply count */}
                          <div
                            className={cn(
                              "shrink-0 mt-0.5 flex flex-col items-center justify-center w-11 rounded-xl py-1.5 border",
                              solved
                                ? "border-success/40 bg-success/10 text-success"
                                : thread.replyCount === 0
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-border bg-secondary text-muted-foreground"
                            )}
                            aria-label={solved ? "Solved" : `${thread.replyCount} replies`}
                          >
                            {solved ? (
                              <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
                            ) : (
                              <MessageSquare className="w-4 h-4" aria-hidden="true" />
                            )}
                            <span className="text-[10px] font-semibold mt-0.5">
                              {solved ? "Solved" : thread.replyCount === 0 ? "0" : thread.replyCount}
                            </span>
                          </div>

                          <div className="flex-1 min-w-0">
                            <h3 className="font-display font-semibold mb-1 break-words">{thread.title}</h3>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                              <span className="flex min-w-0 items-center gap-1">
                                <span className="truncate">{thread.author.profile?.username || thread.author.name}</span>
                                <RoleBadge role={thread.author.role} />
                                <TierChip
                                  reputation={thread.author.profile?.reputation ?? 0}
                                  publicMilestoneOptOut={thread.author.profile?.publicMilestoneOptOut}
                                />
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                <TimeAgo value={thread.createdAt} />
                              </span>
                              {thread.replyCount === 0 && !solved && (
                                <span className="text-xs font-medium text-primary">Awaiting first reply</span>
                              )}
                            </div>
                            {thread.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {thread.tags.map((t) => (
                                  <span
                                    key={t.tag.slug}
                                    className="rounded-full bg-secondary/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                                  >
                                    {t.tag.name}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded shrink-0">
                            {thread.category.name}
                          </div>
                        </div>
                      </Link>
                    )
                  })}
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-between gap-3 p-4 border-t border-border/60">
                  {page > 1 ? (
                    <Link
                      href={qs(tab, activeCategory, page - 1)}
                      className="inline-flex items-center gap-1 px-4 py-2 rounded-full border border-border text-sm font-medium hover:border-primary/40 transition-colors"
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
                      href={qs(tab, activeCategory, page + 1)}
                      className="inline-flex items-center gap-1 px-4 py-2 rounded-full border border-border text-sm font-medium hover:border-primary/40 transition-colors"
                    >
                      Next <ChevronRight className="w-4 h-4" />
                    </Link>
                  ) : (
                    <span />
                  )}
                </div>
              )}
            </Surface>
          </div>

          {/* Sidebar — the two ways a question gets answered */}
          <div className="min-w-0 space-y-6">
            <Surface padding="sm">
              <h3 className="font-display text-base font-semibold mb-1">Stuck on your grow?</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Ask in a help category — add photos and environment details so growers can actually diagnose it.
              </p>
              <Link
                href={askHref}
                className="tt-cta block w-full text-center text-primary-foreground px-4 py-2.5 rounded-full font-semibold transition-all"
              >
                Ask a question
              </Link>
            </Surface>

            <Surface padding="sm">
              <h3 className="font-display text-base font-semibold mb-1 flex items-center gap-2">
                <Stethoscope className="w-4 h-4 text-spectrum" />
                Plant Doctor
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Not sure what&apos;s wrong? Walk the deterministic symptom checker first — it can hand your diagnosis to the community with context attached.
              </p>
              <Link
                href="/plant-doctor"
                className="block w-full text-center border border-border px-4 py-2 rounded-full hover:bg-secondary hover:border-primary/40 transition-colors text-sm font-medium"
              >
                Check symptoms first
              </Link>
            </Surface>

            <Surface padding="sm">
              <h3 className="font-display text-base font-semibold mb-3">More community</h3>
              <div className="space-y-2 text-sm">
                <Link href="/forum" className="block text-muted-foreground hover:text-foreground transition-colors">
                  All discussions →
                </Link>
                <Link href="/diaries" className="block text-muted-foreground hover:text-foreground transition-colors">
                  Browse grow diaries →
                </Link>
                <Link href="/growers" className="block text-muted-foreground hover:text-foreground transition-colors">
                  Meet the growers →
                </Link>
              </div>
            </Surface>
          </div>
        </div>
      </div>
    </div>
  )
}
