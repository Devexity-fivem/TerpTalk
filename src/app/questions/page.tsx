import { prisma } from "@/lib/prisma"
import { publicUserSelect, activeAuthor, blockedUserIds } from "@/lib/security"
import { getSession } from "@/lib/session"
import { unstable_cache } from "next/cache"
import Link from "next/link"
import { MessageSquare, Clock, CheckCircle2, HelpCircle, Stethoscope, ChevronLeft, ChevronRight, HeartHandshake, Sprout } from "@/lib/icons"
import RoleBadge from "@/components/role-badge"
import ProfileCard from "@/components/ui/profile-card"
import Surface from "@/components/ui/surface"
import TimeAgo from "@/components/ui/time-ago"
import EmptyState from "@/components/ui/empty-state"
import LinkTabs from "@/components/ui/link-tabs"
import PageHeader from "@/components/ui/page-header"
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

// Symptom taxonomy — the Plant Doctor vocabulary, reused as ordinary
// thread tags. /questions?symptom=<slug> filters to threads carrying
// that tag; chips only render for tags that actually have questions.
import { SYMPTOM_TAGS } from "@/lib/symptom-tags"
const SYMPTOM_BY_SLUG = new Map(SYMPTOM_TAGS.map((t) => [t.slug, t]))

const TABS = [
  { key: "unanswered", label: "Unanswered" },
  { key: "all", label: "All" },
  { key: "solved", label: "Solved" },
  { key: "newest", label: "Newest" },
  { key: "active", label: "Active" },
] as const
type Tab = (typeof TABS)[number]["key"]

const getQuestions = unstable_cache(
  async (tab: Tab, categorySlug: string | null, symptomSlug: string | null, page: number) => {
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
    const questionCatIds = (activeCat ? [activeCat.id] : categories.map((c) => c.id))
    const symptom = symptomSlug ? SYMPTOM_BY_SLUG.get(symptomSlug) ?? null : null

    // Which symptom tags actually have open questions — chips render only
    // for these (no dead-end filters). A single groupBy over the question
    // categories; symptom tags are ordinary Tag rows by name.
    const symptomCounts = new Map<string, number>()
    if (questionCatIds.length) {
      const rows = await prisma.threadTag.groupBy({
        by: ["tagId"],
        where: {
          thread: {
            deleted: false,
            author: activeAuthor(),
            categoryId: { in: questionCatIds },
          },
          tag: { name: { in: SYMPTOM_TAGS.map((t) => t.name) } },
        },
        _count: { threadId: true },
      })
      if (rows.length) {
        const tagNames = await prisma.tag.findMany({
          where: { name: { in: SYMPTOM_TAGS.map((t) => t.name) } },
          select: { id: true, name: true },
        })
        const byId = new Map(tagNames.map((t) => [t.id, t.name]))
        for (const r of rows) {
          const name = byId.get(r.tagId)
          if (name) symptomCounts.set(name, r._count.threadId)
        }
      }
    }

    const where = {
      deleted: false,
      author: activeAuthor(),
      categoryId: { in: questionCatIds },
      ...(symptom ? { tags: { some: { tag: { name: { equals: symptom.name, mode: "insensitive" as const } } } } } : {}),
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
          // Linked-grow indicator only — title/details stay on the thread
          // page. PUBLIC check mirrors the thread-page disclosure rule so
          // a PRIVATE/UNLISTED grow's existence never surfaces here.
          contextDiary: { select: { visibility: true, deleted: true } },
        },
      }),
      prisma.thread.count({ where }),
    ])

    // Answer-recruitment visibility — unanswered threads show how many
    // growers TerpBot has already invited. Aggregate count only; the
    // candidate list itself never leaves the private notification.
    const openIds = threads.filter((t) => t.replyCount === 0).map((t) => t.id)
    const helperCounts = new Map<string, number>()
    if (openIds.length) {
      const events = await prisma.botEvent.findMany({
        where: { OR: openIds.map((id) => ({ key: { startsWith: `assist:answer-match:${id}:` } })) },
        select: { key: true },
      })
      for (const e of events) {
        const tid = e.key.split(":")[2]
        helperCounts.set(tid, (helperCounts.get(tid) ?? 0) + 1)
      }
    }
    const decorated = threads.map((t) => ({
      ...t,
      helpers: helperCounts.get(t.id) ?? 0,
      growLinked: !!t.contextDiary && !t.contextDiary.deleted && t.contextDiary.visibility === "PUBLIC",
    }))

    return {
      categories,
      threads: decorated,
      total,
      invalidCategory: !!categorySlug && !activeCat,
      invalidSymptom: !!symptomSlug && !symptom,
      symptomChips: SYMPTOM_TAGS
        .map((t) => ({ slug: t.slug, name: t.name, count: symptomCounts.get(t.name) ?? 0 }))
        .filter((t) => t.count > 0)
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }
  },
  ["questions-list"],
  { revalidate: 60, tags: ["forum"] }
)

function qs(tab: Tab, category: string | null, symptom: string | null, page: number) {
  const p = new URLSearchParams()
  if (tab !== "unanswered") p.set("filter", tab)
  if (category) p.set("category", category)
  if (symptom) p.set("symptom", symptom)
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
  const symptomParam = sp?.symptom?.trim() || null

  const [data, session] = await Promise.all([
    getQuestions(tab, categorySlug, symptomParam, page),
    getSession(),
  ])
  // The cached payload is global — hide authors this viewer has blocked
  // (or been blocked by) after the cache read, same as the forum index.
  const blockedIds = await blockedUserIds(session?.user?.id)
  const threads = data.threads.filter((t) => !blockedIds.includes(t.authorId))
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  // An unknown category slug silently broadens to all topics — surface it
  // honestly rather than pretending the filter applied.
  const activeCategory = categorySlug && !data.invalidCategory ? categorySlug : null
  const activeSymptom = symptomParam && !data.invalidSymptom ? symptomParam : null
  // The ask flow reuses /forum/new — a selected topic rides along as the
  // existing ?category= prefill so the question lands in the right board.
  const askHref = `/forum/new${activeCategory ? `?category=${encodeURIComponent(activeCategory)}` : ""}`

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <PageHeader
          context={<span className="tt-eyebrow">Community</span>}
          title="Grow Questions"
          description="Real questions from real grows — answer what you can, and mark the reply that solved yours."
        />

        {/* Tabs */}
        <LinkTabs
          ariaLabel="Filter questions"
          className="mb-4"
          value={tab}
          items={TABS.map((t) => ({ id: t.key, label: t.label, href: qs(t.key, activeCategory, activeSymptom, 1) }))}
        />

        {/* Question-category chips — only categories that read as help surfaces */}
        {data.categories.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-6" aria-label="Question topics">
            <Link
              href={qs(tab, null, activeSymptom, 1)}
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
                href={qs(tab, c.slug, activeSymptom, 1)}
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

        {/* Symptom filters — Plant Doctor vocabulary as ordinary tags.
            Only tags with live questions render (no dead ends). */}
        {data.symptomChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6" aria-label="Filter by symptom">
            <Link
              href={qs(tab, activeCategory, null, 1)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                !activeSymptom
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-card/80 text-muted-foreground hover:text-foreground"
              )}
            >
              All symptoms
            </Link>
            {data.symptomChips.map((s) => (
              <Link
                key={s.slug}
                href={qs(tab, activeCategory, s.slug, 1)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
                  activeSymptom === s.slug
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border bg-card/80 text-muted-foreground hover:text-foreground"
                )}
              >
                {s.name} · {s.count}
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
                      : { label: "Back to page one", href: qs(tab, activeCategory, activeSymptom, 1) }
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
                            <h3 className="font-display font-semibold mb-1 wrap-break-word">{thread.title}</h3>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                              <span className="flex min-w-0 items-center gap-1.5">
                                <ProfileCard
                                  username={thread.author.profile?.username}
                                  name={thread.author.profile?.username || thread.author.name}
                                  avatarUrl={thread.author.image}
                                  xp={thread.author.profile?.xp}
                                  publicMilestoneOptOut={thread.author.profile?.publicMilestoneOptOut}
                                  size="sm"
                                  linked={false}
                                />
                                <RoleBadge role={thread.author.role} />
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" />
                                <TimeAgo value={thread.createdAt} />
                              </span>
                              {thread.replyCount === 0 && !solved && (
                                <span className="text-xs font-medium text-primary">Awaiting first reply</span>
                              )}
                              {thread.replyCount === 0 && !solved && thread.helpers > 0 && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <HeartHandshake className="w-3.5 h-3.5 text-primary" />
                                  {thread.helpers} grower{thread.helpers === 1 ? "" : "s"} invited to help
                                </span>
                              )}
                              {thread.growLinked && (
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Sprout className="w-3.5 h-3.5 text-primary" />
                                  grow linked
                                </span>
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
                      href={qs(tab, activeCategory, activeSymptom, page - 1)}
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
                      href={qs(tab, activeCategory, activeSymptom, page + 1)}
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
                Not sure what&apos;s wrong? Walk the symptom checker first — it can hand your diagnosis to the community with context attached.
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
