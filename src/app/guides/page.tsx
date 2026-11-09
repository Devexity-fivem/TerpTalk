import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { BookOpen, Plus, Search, X } from "@/lib/icons"
import Link from "next/link"
import EmptyState from "@/components/ui/empty-state"
import ProfileCard from "@/components/ui/profile-card"
import PageHeader from "@/components/ui/page-header"
import { getSession } from "@/lib/session"
import { blockedUserIds } from "@/lib/security"
import { isModerator } from "@/lib/roles"
import { GUIDE_TOPICS } from "@/lib/guides"
import { buildMetadata } from "@/lib/seo"
import type { ReactNode } from "react"

export const dynamic = "force-dynamic"

export const metadata = buildMetadata({
  title: "Grow Guides",
  description: "Staff-written guides for cannabis growers — from first germination to harvest and curing.",
  pathname: "/guides",
})

const getGuides = unstable_cache(
  async () => {
    return prisma.guide.findMany({
      where: { published: true },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { author: { select: { name: true, image: true, profile: { select: { username: true, xp: true, publicMilestoneOptOut: true } } } } },
    })
  },
  ["guides-list"],
  { revalidate: 300, tags: ["guides"] }
)

// Display labels for the canonical topic vocabulary (lib/guides GUIDE_TOPICS).
// Unknown topics fall back to the raw value so a new topic never breaks the page.
const TOPIC_LABELS: Record<string, string> = {
  BASICS: "Basics",
  NUTRIENTS: "Nutrients",
  HARVEST: "Harvest",
  PESTS: "Pests",
  ENVIRONMENT: "Environment",
  GENETICS: "Genetics",
  TRAINING: "Training",
  LAW: "Law",
}
const topicLabel = (t: string) => TOPIC_LABELS[t] ?? t.charAt(0) + t.slice(1).toLowerCase()

type GuideFilters = { topic?: string; q?: string }

// Server-side discovery params — stable URLs, no client state (same pattern
// as the diaries journal wall). Values are validated against the loaded set.
function filterHref(filters: GuideFilters, patch: GuideFilters): string {
  const next = { ...filters, ...patch }
  const params = new URLSearchParams()
  if (next.topic) params.set("topic", next.topic)
  if (next.q) params.set("q", next.q)
  const qs = params.toString()
  return qs ? `/guides?${qs}` : "/guides"
}

function FilterPill({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-card border border-border/70 text-muted-foreground hover:border-primary/40 hover:text-foreground"
      }`}
    >
      {children}
    </Link>
  )
}

export default async function GuidesPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string; q?: string }>
}) {
  const sp = await searchParams
  const session = await getSession()
  const isStaff = isModerator((session?.user as { role?: string })?.role)

  const [allGuides, blockedIds] = await Promise.all([getGuides(), blockedUserIds(session?.user?.id)])
  const visible = blockedIds.length ? allGuides.filter((g) => !blockedIds.includes(g.authorId)) : allGuides

  // Canonical topic order first (learning path order), then any extras.
  const present = new Set(visible.map((g) => g.topic))
  const topics = [
    ...[...GUIDE_TOPICS].filter((t) => present.has(t)),
    ...[...present].filter((t) => !GUIDE_TOPICS.has(t)).sort(),
  ]

  const q = (sp?.q ?? "").trim().slice(0, 80)
  const topic = sp?.topic && present.has(sp.topic) ? sp.topic : undefined
  const filters: GuideFilters = { topic, q: q || undefined }
  const filtered = !!(topic || q)

  const needle = q.toLowerCase()
  const guides = visible.filter((g) => {
    if (topic && g.topic !== topic) return false
    if (needle && !(`${g.title} ${g.excerpt} ${topicLabel(g.topic)}`).toLowerCase().includes(needle)) return false
    return true
  })

  const topicCounts = new Map<string, number>()
  for (const g of visible) topicCounts.set(g.topic, (topicCounts.get(g.topic) ?? 0) + 1)

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <PageHeader
          context={<span className="tt-eyebrow">Knowledge base</span>}
          title={
            <span className="flex items-center gap-3">
              <BookOpen className="w-8 h-8 text-primary" /> Grow Guides
            </span>
          }
          description="Staff-written knowledge — from seed to cure."
          actions={
            isStaff && (
              <Link href="/guides/new" className="tt-cta inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground transition-all">
                <Plus className="w-4 h-4" /> New Guide
              </Link>
            )
          }
        />

        {visible.length > 0 && (
          <div className="mb-6 space-y-3">
            {/* Search — plain GET form, composes with the topic pills */}
            <form action="/guides" method="get" role="search" className="relative max-w-md">
              {topic && <input type="hidden" name="topic" value={topic} />}
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search guides…"
                aria-label="Search guides"
                className="w-full rounded-full border border-border/70 bg-card py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </form>
            {/* Topic pills — one tap isolates a shelf; counts stay honest */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none" role="group" aria-label="Filter by topic">
              <FilterPill href={filterHref(filters, { topic: undefined })} active={!topic}>
                All topics
              </FilterPill>
              {topics.map((t) => (
                <FilterPill key={t} href={filterHref(filters, { topic: filters.topic === t ? undefined : t })} active={topic === t}>
                  {topicLabel(t)}
                  <span className={topic === t ? "text-primary-foreground/70" : "text-muted-foreground/70"}>
                    {" "}· {topicCounts.get(t)}
                  </span>
                </FilterPill>
              ))}
            </div>
          </div>
        )}

        {visible.length === 0 ? (
          <div className="tt-spotlight bg-card/80 rounded-2xl border border-border/70">
            <EmptyState
              icon={BookOpen}
              title="No guides yet"
              description="Staff guides are coming soon."
            />
          </div>
        ) : guides.length === 0 ? (
          <div className="tt-spotlight bg-card/80 rounded-2xl border border-border/70">
            <EmptyState
              icon={Search}
              title="No guides match"
              description={q ? `Nothing found for “${q}”${topic ? ` in ${topicLabel(topic)}` : ""}.` : "Try another topic."}
              action={{ label: "Clear filters", href: "/guides" }}
            />
          </div>
        ) : (
          <>
            {filtered && (
              <p className="mb-4 text-xs text-muted-foreground">
                {guides.length} guide{guides.length === 1 ? "" : "s"}
                {topic ? ` in ${topicLabel(topic)}` : ""}
                {q ? ` matching “${q}”` : ""}
                {" — "}
                <Link href="/guides" className="text-primary hover:underline inline-flex items-center gap-0.5">
                  <X className="w-3 h-3" aria-hidden="true" /> Clear
                </Link>
              </p>
            )}
            {topics
              .filter((t) => !topic || t === topic)
              .map((t) => {
                const list = guides.filter((g) => g.topic === t)
                if (list.length === 0) return null
                return (
                  <div key={t} className="mb-8">
                    <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3 flex items-baseline gap-2">
                      {topicLabel(t)}
                      <span className="text-[11px] font-normal normal-case tracking-normal">{list.length}</span>
                    </h2>
                    <div className="grid sm:grid-cols-2 gap-4">
                      {list.map((g) => (
                        <Link
                          key={g.id}
                          href={`/guides/${g.slug}`}
                          className="tt-spotlight tt-lift bg-card/80 border border-border/70 rounded-2xl p-5 hover:border-primary/50 transition-colors flex flex-col"
                        >
                          <h3 className="font-display font-semibold mb-1.5">{g.title}</h3>
                          <p className="text-sm text-muted-foreground line-clamp-2 flex-1">{g.excerpt}</p>
                          <div className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border/50 flex items-center gap-1.5">
                            by <ProfileCard
                              username={g.author.profile?.username}
                              name={g.author.profile?.username || g.author.name}
                              avatarUrl={g.author.image}
                              xp={g.author.profile?.xp}
                              publicMilestoneOptOut={g.author.profile?.publicMilestoneOptOut}
                              size="sm"
                              linked={false}
                            /> · {new Date(g.createdAt).toLocaleDateString()}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )
              })}
          </>
        )}
      </div>
    </div>
  )
}
