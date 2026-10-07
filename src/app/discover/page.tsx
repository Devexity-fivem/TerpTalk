import { blockedUserIds } from "@/lib/security"
import { getSession } from "@/lib/session"
import Link from "next/link"
import {
  MessageSquare, TrendingUp, Users, Flame, HelpCircle, Sprout,
  Leaf, Dna, Wrench, CheckCircle2, Award, Globe,
} from "@/lib/icons"
import RoleBadge from "@/components/role-badge"
import ProfileCard from "@/components/ui/profile-card"
import { LiveRefresh } from "@/components/live-refresh"
import EmptyState from "@/components/ui/empty-state"
import SectionCard from "@/components/ui/section-card"
import TimeAgo from "@/components/ui/time-ago"
import PageHeader from "@/components/ui/page-header"
import {
  DISCOVER_TABS,
  getDiscoverBrowse,
  filterDiscoverBlocked,
  type DiscoverItem,
  type DiscoverTab,
} from "@/lib/discover"
import { getSuggestedGrowers } from "@/lib/suggested-growers"
import SuggestedGrowerCard from "@/components/suggested-grower-card"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Discover",
  description:
    "Browse what's happening across TerpTalk — questions, grows, harvests, strains, setups, and growers.",
}

const TAB_LABEL: Record<DiscoverTab, string> = {
  latest: "Latest",
  trending: "Trending",
  questions: "Questions",
  grows: "Grows",
  harvests: "Harvests",
  strains: "Strains",
  setups: "Setups",
  growers: "Growers",
}

const KIND_ICON = {
  THREAD: MessageSquare,
  QUESTION: HelpCircle,
  DIARY: Sprout,
  HARVEST: Leaf,
  STRAIN: Dna,
  SETUP: Wrench,
  GROWER: Users,
} as const

const EMPTY: Record<DiscoverTab, { title: string; description: string; action?: { href: string; label: string } }> = {
  latest: { title: "Nothing new yet", description: "Be the first to start a conversation or document a grow.", action: { href: "/forum/new", label: "Start a discussion" } },
  trending: { title: "Nothing trending this week", description: "Fresh discussions and featured grows will land here.", action: { href: "/forum/new", label: "Start a discussion" } },
  questions: { title: "No questions yet", description: "Ask the first question and the community can help.", action: { href: "/forum/new", label: "Ask a question" } },
  grows: { title: "No public grows yet", description: "Document a grow diary and it will show up here.", action: { href: "/diaries/new", label: "Start a diary" } },
  harvests: { title: "No harvests yet", description: "Finished public grows appear here once growers harvest." },
  strains: { title: "No strains yet", description: "The strain catalog is still growing.", action: { href: "/strains", label: "Browse strains" } },
  setups: { title: "No setups yet", description: "Share your grow setup to help other growers.", action: { href: "/setups/new", label: "Share a setup" } },
  growers: { title: "No active growers yet", description: "Members with public contributions show up here." },
}

function ItemCard({ item }: { item: DiscoverItem }) {
  const Icon = KIND_ICON[item.kind]
  return (
    <Link
      href={item.href}
      className="tt-spotlight group flex gap-3 p-4 bg-secondary/30 rounded-2xl border border-border/70 hover:border-primary/40 hover:bg-secondary/50 transition-all tt-edge-card"
    >
      {item.thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.thumb} alt="" loading="lazy" decoding="async" className="w-14 h-14 rounded-xl object-cover shrink-0" />
      ) : (
        <div className="w-14 h-14 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Icon className="w-6 h-6 text-primary" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        {item.author && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap mb-1">
            <ProfileCard
              username={item.author.username}
              name={item.author.username || item.author.name}
              avatarUrl={item.author.image}
              xp={item.author.xp}
              publicMilestoneOptOut={item.author.publicMilestoneOptOut}
              size="sm"
              linked={false}
            />
            <RoleBadge role={item.author.role} />
          </div>
        )}
        <h3 className="font-display font-semibold text-sm wrap-break-word group-hover:text-primary transition-colors flex items-center gap-1.5">
          <span className="min-w-0 truncate">{item.title}</span>
          {item.flag === "solved" && <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" aria-label="Solved" />}
        </h3>
        {item.subtitle && <p className="text-xs text-muted-foreground truncate mt-0.5">{item.subtitle}</p>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mt-2">
          {item.flag && (
            <span
              className={
                item.flag === "open"
                  ? "text-warning font-medium"
                  : item.flag === "solved"
                    ? "text-success font-medium"
                    : ""
              }
            >
              {item.flag === "open" ? "Needs answers" : item.flag === "solved" ? "Solved" : "Answered"}
            </span>
          )}
          {item.meta.map((m) => (
            <span key={m}>{m}</span>
          ))}
          {item.timestamp && <TimeAgo value={item.timestamp} />}
        </div>
      </div>
    </Link>
  )
}

function ItemGrid({ items }: { items: DiscoverItem[] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {items.map((item) => (
        <ItemCard key={`${item.kind}-${item.id}`} item={item} />
      ))}
    </div>
  )
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = (await searchParams) || {}
  const activeTab: DiscoverTab = DISCOVER_TABS.includes(tab as DiscoverTab) ? (tab as DiscoverTab) : "latest"
  const session = await getSession()
  const [browse, blockedIds, suggestedGrowers] = await Promise.all([
    getDiscoverBrowse(activeTab),
    blockedUserIds(session?.user?.id),
    // Suggestions only load for the growers tab — personalized for
    // members, public-evidence ranking for guests. Never cached:
    // follow/block state is re-applied every request.
    activeTab === "growers" ? getSuggestedGrowers(session?.user?.id ?? null) : Promise.resolve(null),
  ])

  const tabCls = (t: DiscoverTab) =>
    `shrink-0 px-4 py-2 text-sm font-medium rounded-full transition-colors ${
      activeTab === t ? "bg-primary/12 text-primary ring-1 ring-inset ring-primary/25" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
    }`

  const filtered = (items: DiscoverItem[]) => filterDiscoverBlocked(items, blockedIds).slice(0, 12)

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <LiveRefresh endpoint="/api/forum/updates" />
        <LiveRefresh endpoint="/api/diaries/updates" />
        <PageHeader
          context={<span className="tt-eyebrow">Fresh from the garden</span>}
          title="Discover"
          description="Browse what's happening across TerpTalk — questions, grows, harvests, strains, setups, and growers."
        />

        {/* Browse tabs — scrollable on narrow screens */}
        <div className="flex gap-1.5 mb-2 p-1 rounded-2xl bg-secondary/50 border border-border/60 overflow-x-auto scrollbar-none w-full sm:w-fit">
          {DISCOVER_TABS.map((t) => (
            <Link
              key={t}
              href={t === "latest" ? "/discover" : `/discover?tab=${t}`}
              className={tabCls(t)}
            >
              {t === "trending" && <TrendingUp className="w-4 h-4 inline mr-1" />}
              {TAB_LABEL[t]}
            </Link>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mb-6 px-1">
          Browsing everything public — <Link href="/feed" className="text-primary hover:underline">your Feed</Link> is the personalized stream.
        </p>

        {browse.layout === "trending" ? (
          <div className="space-y-6">
            <SectionCard title={<span className="flex items-center gap-2"><Flame className="w-5 h-5 text-primary" />Trending discussions</span>}>
              {filtered(browse.threads).length === 0 ? (
                <EmptyState icon={Flame} title={EMPTY.trending.title} description={EMPTY.trending.description} action={EMPTY.trending.action} />
              ) : (
                <ItemGrid items={filtered(browse.threads)} />
              )}
            </SectionCard>
            <SectionCard title={<span className="flex items-center gap-2"><Award className="w-5 h-5 text-primary" />Featured grows</span>}>
              {filtered(browse.diaries).length === 0 ? (
                <p className="text-sm text-muted-foreground">No featured grows yet.</p>
              ) : (
                <ItemGrid items={filtered(browse.diaries)} />
              )}
            </SectionCard>
          </div>
        ) : activeTab === "growers" ? (
          <div className="space-y-6">
            <SectionCard title={<span className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" />Growers you may want to follow</span>}>
              {suggestedGrowers && suggestedGrowers.length > 0 ? (
                <div className="grid sm:grid-cols-2 gap-3">
                  {suggestedGrowers.map((g) => (
                    <SuggestedGrowerCard key={g.userId} grower={g} />
                  ))}
                </div>
              ) : (
                <EmptyState icon={Users} title={EMPTY.growers.title} description={EMPTY.growers.description} action={EMPTY.growers.action} />
              )}
            </SectionCard>
            {(() => {
              const suggestedIds = new Set((suggestedGrowers ?? []).map((g) => g.userId))
              const rest = filtered(browse.layout === "list" ? browse.items : []).filter((i) => !suggestedIds.has(i.userId ?? ""))
              return rest.length === 0 ? null : (
                <SectionCard title={<span className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" />Active growers</span>}>
                  <ItemGrid items={rest} />
                </SectionCard>
              )
            })()}
          </div>
        ) : (
          <SectionCard
            title={
              <span className="flex items-center gap-2">
                {activeTab === "questions" ? (
                  <HelpCircle className="w-5 h-5 text-primary" />
                ) : activeTab === "strains" ? (
                  <Dna className="w-5 h-5 text-primary" />
                ) : activeTab === "setups" ? (
                  <Wrench className="w-5 h-5 text-primary" />
                ) : activeTab === "grows" ? (
                  <Sprout className="w-5 h-5 text-primary" />
                ) : activeTab === "harvests" ? (
                  <Leaf className="w-5 h-5 text-primary" />
                ) : (
                  <Globe className="w-5 h-5 text-primary" />
                )}
                {TAB_LABEL[activeTab]}
              </span>
            }
            actions={activeTab === "questions" ? <Link href="/questions" className="text-xs text-primary hover:underline">All questions →</Link> : undefined}
          >
            {(() => {
              const items = filtered(browse.layout === "list" ? browse.items : [])
              return items.length === 0 ? (
                <EmptyState
                  icon={KIND_ICON[activeTab === "questions" ? "QUESTION" : activeTab === "strains" ? "STRAIN" : activeTab === "setups" ? "SETUP" : activeTab === "harvests" ? "HARVEST" : activeTab === "grows" ? "DIARY" : "THREAD"]}
                  title={EMPTY[activeTab].title}
                  description={EMPTY[activeTab].description}
                  action={EMPTY[activeTab].action}
                />
              ) : (
                <ItemGrid items={items} />
              )
            })()}
          </SectionCard>
        )}
      </div>
    </div>
  )
}
