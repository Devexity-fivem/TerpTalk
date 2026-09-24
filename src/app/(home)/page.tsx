import { MessageSquare, Award, Dna, Sprout, Calendar, Trophy, BookOpen, Tag, ArrowRight, TrendingUp, Users, Leaf, MessagesSquare } from "lucide-react"
import ChatTeaser from "@/components/chat-teaser"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { publicUserSelect, activeAuthor, rankableProfile, REPUTATION_ORDER } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { diaryPath } from "@/lib/slugs"
import CannabisLeaf from "@/components/cannabis-leaf"
import { getChatTeaser } from "@/lib/chat-activity"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getMemberHomeData } from "@/lib/member-home"
import MemberHome from "@/components/member-home"
import LiveStats from "@/components/live-stats"
import HeroCta from "@/components/hero-cta"
import { Avatar } from "@/components/ui/avatar"
import TierChip from "@/components/tier-chip"

// Public landing page for guests; signed-in members get the "Today"
// dashboard instead (see components/member-home). getServerSession makes
// the route dynamic; the landing's data still comes from unstable_cache,
// so guest renders stay cheap.
export const dynamic = "force-dynamic"

const getStats = unstable_cache(
  async () => {
    const [members, diaries, threads, posts] = await Promise.all([
      prisma.user.count({ where: activeAuthor() }),
      prisma.growDiary.count({ where: { deleted: false, author: activeAuthor(), ...publicDiaryWhere } }),
      prisma.thread.count({ where: { deleted: false, author: activeAuthor() } }),
      prisma.post.count({ where: { deleted: false, author: activeAuthor() } }),
    ])
    return { members, diaries, discussions: threads + posts }
  },
  ["home-stats"],
  { revalidate: 60, tags: ["diaries", "forum"] }
)

const getLatestDiscussions = unstable_cache(
  async () => {
    const [categories, latest, diaryUpdates] = await Promise.all([
      prisma.category.findMany({
        where: { hidden: false },
        orderBy: { order: "asc" },
        select: { name: true, slug: true, description: true, _count: { select: { threads: { where: { deleted: false } } } } },
      }),
      prisma.thread.findMany({
        where: { deleted: false, category: { hidden: false }, author: activeAuthor() },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: {
          author: { select: publicUserSelect },
          category: { select: { name: true, slug: true } },
          _count: { select: { posts: { where: { deleted: false } } } },
        },
      }),
      prisma.diaryUpdate.findMany({
        where: { author: activeAuthor(), diary: { deleted: false, author: activeAuthor(), ...publicDiaryWhere } },
        orderBy: { createdAt: "desc" },
        take: 4,
        include: {
          diary: {
            include: {
              author: { select: publicUserSelect },
              _count: { select: { followers: true } },
            },
          },
          author: { select: publicUserSelect },
          images: { take: 1 },
        },
      }),
    ])
    return { categories, latest, diaryUpdates }
  },
  ["home-latest"],
  { revalidate: 60, tags: ["diaries", "forum"] }
)

function threadScore(t: { views: number; replyCount: number; createdAt: Date }) {
  const hours = (Date.now() - new Date(t.createdAt).getTime()) / 36e5
  return (t.views + t.replyCount * 5) / Math.pow(hours + 2, 1.5)
}

const getTrendingDiscussions = unstable_cache(
  async () => {
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const candidates = await prisma.thread.findMany({
      where: { deleted: false, category: { hidden: false }, createdAt: { gte: oneWeekAgo }, author: activeAuthor() },
      take: 100,
      include: {
        author: { select: publicUserSelect },
        category: { select: { name: true, slug: true } },
        _count: { select: { posts: { where: { deleted: false } } } },
      },
    })
    return candidates
      .map((t) => ({ ...t, score: threadScore(t) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
  },
  ["home-trending"],
  { revalidate: 60 }
)

const getActiveMembers = unstable_cache(
  async () => {
    return await prisma.user.findMany({
      // TerpBot is permanently ONLINE — exclude it so real members lead.
      // Suspended members don't broadcast presence either.
      where: {
        banned: false,
        status: "ONLINE",
        OR: [{ suspendedUntil: null }, { suspendedUntil: { lt: new Date() } }],
        AND: [
          { profile: { isNot: { username: "terpbot" } } },
          { OR: [{ profile: { hideOnlineStatus: false } }, { profile: null }] },
        ],
      },
      take: 12,
      orderBy: { lastSeenAt: "desc" },
      select: publicUserSelect,
    })
  },
  ["home-active"],
  { revalidate: 60 }
)

const getGrowerOfWeek = unstable_cache(
  async () => {
    // Show the actual weekly-recognition winner — recorded as a keyed
    // WEEKLY_AWARD event — not merely the all-time rep leader. Falls back
    // to the top grower until the first award has been resolved.
    const award = await prisma.reputationEvent.findFirst({
      where: { type: "WEEKLY_AWARD", key: { startsWith: "weekly:gotw:" }, reversedAt: null },
      orderBy: { createdAt: "desc" },
      select: { userId: true },
    })
    if (award) {
      const winner = await prisma.profile.findFirst({
        where: { userId: award.userId, ...rankableProfile() },
        include: { user: { select: { id: true, image: true, createdAt: true } } },
      })
      if (winner) return winner
    }
    return await prisma.profile.findFirst({
      where: { ...rankableProfile(), user: { ...activeAuthor(), role: { not: "ADMINISTRATOR" } } },
      orderBy: REPUTATION_ORDER,
      include: { user: { select: { id: true, image: true, createdAt: true } } },
    })
  },
  ["home-grower-of-week"],
  { revalidate: 300 }
)

// Live-chat teaser for the hero — public-room metadata only, so it is safe
// to render for guests (no content, no gated/private room data).
const getChatTeaserData = unstable_cache(
  () => getChatTeaser(),
  ["home-chat-teaser"],
  { revalidate: 60 }
)

const EXPLORE_CARDS = [
  { icon: Sprout, title: "Grow Diaries", desc: "Document your grow from seed to harvest.", href: "/diaries" },
  { icon: MessageSquare, title: "Discussions", desc: "Ask questions and trade techniques.", href: "/forum" },
  { icon: Dna, title: "Strain Database", desc: "Compare genetics and grower photos.", href: "/strains" },
  { icon: Trophy, title: "Budshot of the Week", desc: "Photo contest and community votes.", href: "/contest" },
  { icon: BookOpen, title: "Grow Guides", desc: "Staff guides from germination to curing.", href: "/guides" },
  { icon: MessagesSquare, title: "Live Chat", desc: "Talk with growers in real time — TerpBot helps too.", href: "/chat" },
  { icon: Tag, title: "Deals", desc: "Partner gear and discount codes.", href: "/deals" },
]

export default async function Home() {
  // Signed-in members get the personalized dashboard; guests get the
  // landing below. The session check runs first so member requests never
  // pay for the landing queries.
  const session = await getServerSession(authOptions)
  if (session?.user?.id) {
    const memberData = await getMemberHomeData(session.user.id)
    if (memberData) return <MemberHome data={memberData} />
    // Missing user row (deleted mid-session) — fall through to landing.
  }

  const [stats, { categories, latest, diaryUpdates }, trending, active, growerOfWeek, chatTeaser] = await Promise.all([
    getStats(),
    getLatestDiscussions(),
    getTrendingDiscussions(),
    getActiveMembers(),
    getGrowerOfWeek(),
    getChatTeaserData(),
  ])
  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Hero — asymmetric split: pitch left, live canopy panel right */}
      <section className="relative overflow-hidden px-4 pb-16 pt-14 sm:px-6 lg:px-8 lg:pb-24 lg:pt-20">
        {/* Grow-light backdrop — blueprint grid + emerald/violet/amber wash */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="tt-grid-bg absolute inset-0" />
          <div className="absolute left-1/2 top-0 h-[440px] w-[780px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/20 blur-[130px]" />
          <div className="absolute right-[4%] top-24 h-[280px] w-[280px] rounded-full bg-spectrum/20 blur-[110px]" />
          <div className="absolute left-[6%] top-44 h-[200px] w-[200px] rounded-full bg-accent/15 blur-[100px]" />
        </div>
        <div className="mx-auto grid max-w-7xl items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div className="text-center lg:text-left">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              <CannabisLeaf className="h-3.5 w-3.5" />
              21+ growers&apos; commons
            </div>
            <h1 className="font-display text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight text-foreground mb-6">
              Grow better,{" "}
              <span className="tt-gradient-text bg-gradient-to-r from-primary via-emerald-500 to-spectrum">
                together.
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto lg:mx-0 mb-4 leading-relaxed">
              TerpTalk is a 21+ community built around cannabis cultivation. Ask questions, share your grow, compare genetics, troubleshoot problems, and learn from other growers.
            </p>
            {/* Primary and secondary actions (session-aware, client-side) */}
            <HeroCta />
            {chatTeaser && (
              <div className="mt-5 flex justify-center lg:justify-start">
                <ChatTeaser {...chatTeaser} />
              </div>
            )}
          </div>

          {/* Community canopy — a live panel rendered from real site data.
              Desktop only; the stats strip below covers mobile. */}
          <div className="relative hidden lg:block">
            <div className="absolute -inset-6 -z-10 rounded-[2.5rem] bg-primary/10 blur-2xl" />
            <div className="absolute -right-8 -top-8 -z-10 h-44 w-44 rounded-full bg-spectrum/25 blur-3xl" />
            <div className="tt-holo-border overflow-hidden rounded-3xl border border-border/70 bg-card/80 shadow-2xl backdrop-blur-xl">
              <div className="tt-spectrum-animated h-1.5" />
              <div className="p-6 sm:p-7">
                <div className="mb-5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Community canopy
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                    </span>
                    {active.length} online
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-secondary/70 px-3 py-4 text-center">
                    <div className="font-display text-2xl font-bold tabular-nums text-foreground">{stats.members.toLocaleString()}</div>
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Members</div>
                  </div>
                  <div className="rounded-xl bg-secondary/70 px-3 py-4 text-center">
                    <div className="font-display text-2xl font-bold tabular-nums text-foreground">{stats.diaries.toLocaleString()}</div>
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Diaries</div>
                  </div>
                  <div className="rounded-xl bg-secondary/70 px-3 py-4 text-center">
                    <div className="font-display text-2xl font-bold tabular-nums text-foreground">{stats.discussions.toLocaleString()}</div>
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Posts</div>
                  </div>
                </div>
                {trending.length > 0 && (
                  <div className="mt-6">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Trending transmission
                    </div>
                    <div className="space-y-2">
                      {trending.slice(0, 2).map((thread) => (
                        <Link
                          key={thread.id}
                          href={`/forum/thread/${thread.slug}`}
                          className="group flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-3.5 py-2.5 transition-colors hover:border-primary/40"
                        >
                          <TrendingUp className="h-4 w-4 shrink-0 text-spectrum" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-primary">
                            {thread.title}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {thread._count.posts} repl{thread._count.posts === 1 ? "y" : "ies"}
                          </span>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-6 flex items-center justify-between border-t border-border/50 pt-4 text-[11px] text-muted-foreground">
                  <span>21+ · pseudonymous · grower-run</span>
                  <span className="inline-flex items-center gap-1">
                    <Leaf className="h-3 w-3 text-primary" />
                    Real growers, real data
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Community Stats */}
      <section className="tt-reveal tt-hairline-t py-14 px-4 sm:px-6 lg:px-8 border-y border-border/60 bg-secondary/40">
        <div className="max-w-7xl mx-auto">
          <LiveStats initial={stats} />
        </div>
      </section>

      {/* Community Stream */}
      <section className="tt-reveal py-14 px-4 sm:px-6 lg:px-8 border-b border-border/60 bg-secondary/20">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
            <div>
              <span className="tt-eyebrow">Live feed</span>
              <h2 className="font-display text-3xl font-bold mt-2 mb-1 tracking-tight">The TerpTalk Stream</h2>
              <p className="text-sm text-muted-foreground">
                Recent discussions, grow updates, and new diaries.
              </p>
            </div>
            <Link href="/discover" className="text-sm font-medium text-primary inline-flex items-center gap-1 hover:underline">
              View all <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Categories */}
            <div>
              <h3 className="font-display text-base font-semibold mb-3 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-primary" />
                Explore Topics
              </h3>
              <div className="space-y-2">
                {categories.slice(0, 5).map((cat) => (
                  <Link
                    key={cat.slug}
                    href={`/forum/category/${cat.slug}`}
                    className="flex items-center justify-between p-3 bg-card/80 rounded-xl border border-border/70 hover:border-primary/50 tt-lift tt-edge-card tt-spotlight"
                  >
                    <div>
                      <div className="font-medium text-sm">{cat.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1">{cat.description}</div>
                    </div>
                    <div className="text-xs text-muted-foreground whitespace-nowrap">
                      {cat._count.threads}
                    </div>
                  </Link>
                ))}
                {categories.length > 5 && (
                  <Link href="/forum" className="text-sm text-primary inline-flex items-center gap-1 hover:underline">
                    All categories <ArrowRight className="w-3 h-3" />
                  </Link>
                )}
              </div>
            </div>

            {/* Latest discussions */}
            <div>
              <h3 className="font-display text-base font-semibold mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                Latest Discussions
              </h3>
              <div className="space-y-2">
                {latest.slice(0, 3).map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/forum/thread/${thread.slug}`}
                    className="flex items-start gap-3 p-3 bg-card/80 rounded-xl border border-border/70 hover:border-primary/50 tt-lift tt-edge-card tt-spotlight"
                  >
                    <Avatar src={thread.author.image ?? undefined} size="sm" alt={thread.author.profile?.username ?? thread.author.name ?? undefined} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm mb-0.5 line-clamp-1">{thread.title}</div>
                      <div className="text-xs text-muted-foreground flex items-center flex-wrap gap-x-2 gap-y-0.5">
                        <span className="text-primary">{thread.category.name}</span>
                        <span className="inline-flex items-center gap-1">{thread.author.profile?.username || thread.author.name}<TierChip reputation={thread.author.profile?.reputation ?? 0} publicMilestoneOptOut={thread.author.profile?.publicMilestoneOptOut} /></span>
                        <span>{thread.replyCount} repl{thread.replyCount === 1 ? "y" : "ies"}</span>
                      </div>
                    </div>
                  </Link>
                ))}
                <Link href="/forum" className="text-sm text-primary inline-flex items-center gap-1 hover:underline">
                  View all discussions <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>

            {/* Fresh grow updates */}
            <div>
              <h3 className="font-display text-base font-semibold mb-3 flex items-center gap-2">
                <Leaf className="w-4 h-4 text-primary" />
                Fresh Grow Updates
              </h3>
              <div className="space-y-2">
                {diaryUpdates.slice(0, 3).map((update) => (
                  <Link
                    key={update.id}
                    href={diaryPath(update.diary)}
                    className="flex items-start gap-3 p-3 bg-card/80 rounded-xl border border-border/70 hover:border-primary/50 tt-lift tt-edge-card tt-spotlight"
                  >
                    {update.images[0]?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={update.images[0].url}
                        alt={update.title}
                        className="w-10 h-10 rounded-md object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <Leaf className="w-4 h-4 text-primary" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm mb-0.5 line-clamp-1">{update.title}</div>
                      <div className="text-xs text-muted-foreground flex items-center flex-wrap gap-x-2 gap-y-0.5">
                        <span className="text-success">{update.diary.title}</span>
                        <span className="inline-flex items-center gap-1">{update.author.profile?.username || update.author.name}<TierChip reputation={update.author.profile?.reputation ?? 0} publicMilestoneOptOut={update.author.profile?.publicMilestoneOptOut} /></span>
                      </div>
                    </div>
                  </Link>
                ))}
                <Link href="/diaries" className="text-sm text-primary inline-flex items-center gap-1 hover:underline">
                  View all diaries <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Explore Section */}
      <section className="tt-reveal py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10">
            <span className="tt-eyebrow">Find your corner</span>
            <h2 className="font-display text-3xl sm:text-4xl font-bold mt-2 mb-3 tracking-tight">Explore the community</h2>
            <p className="text-muted-foreground max-w-xl mx-auto">
              The main places to grow, discuss, and discover.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {EXPLORE_CARDS.map(({ icon: Icon, title, desc, href }, i) => (
              <Link key={title} href={href} className="block group">
                <div className="tt-spotlight relative bg-card/80 p-5 rounded-2xl border border-border/70 h-full tt-lift hover:border-primary/50 flex flex-col overflow-hidden">
                  <span className="absolute right-4 top-4 font-display text-xs font-bold text-muted-foreground/40 tabular-nums">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="tt-brand-tile w-10 h-10 rounded-xl flex items-center justify-center mb-3">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h4 className="font-display text-base font-semibold mb-1">{title}</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1">{desc}</p>
                  <div className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">
                    Open <ArrowRight className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Community Pulse */}
      <section className="tt-reveal tt-hairline-t py-14 px-4 sm:px-6 lg:px-8 border-y border-border/60 bg-secondary/20">
        <div className="max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Trending */}
            <div>
              <span className="tt-eyebrow">Heating up</span>
              <h3 className="font-display text-xl font-semibold mb-4 mt-2 flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-spectrum" />
                Trending Now
              </h3>
              <div className="space-y-3">
                {trending.map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/forum/thread/${thread.slug}`}
                    className="flex items-start gap-3 p-4 bg-card/80 rounded-xl border border-border/70 hover:border-primary/50 tt-lift tt-edge-card tt-spotlight"
                  >
                    <Avatar src={thread.author.image ?? undefined} size="sm" alt={thread.author.profile?.username ?? thread.author.name ?? undefined} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium mb-1 line-clamp-1">{thread.title}</div>
                      <div className="text-sm text-muted-foreground flex items-center flex-wrap gap-2">
                        <span className="text-primary">{thread.category.name}</span>
                        <span>•</span>
                        <span>{thread.author.profile?.username || thread.author.name}</span>
                        <span>•</span>
                        <span>{thread.views} views</span>
                        <span>•</span>
                        <span>{thread._count.posts} repl{thread._count.posts === 1 ? "y" : "ies"}</span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Active members */}
            <div>
              <span className="tt-eyebrow">In the room</span>
              <h3 className="font-display text-xl font-semibold mb-4 mt-2 flex items-center gap-2">
                <Users className="w-5 h-5 text-primary" />
                Active Growers
              </h3>
              {active.length === 0 ? (
                <p className="text-muted-foreground">No growers are currently online.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {active.map((user) => (
                    <Link
                      key={user.id}
                      href={`/u/${user.profile?.username || user.name}`}
                      className="flex items-center gap-2 px-3 py-2 bg-card rounded-full border border-border hover:border-primary/40 transition-colors min-w-0"
                    >
                      <Avatar src={user.image ?? undefined} size="sm" alt={user.profile?.username ?? user.name ?? undefined} />
                      <span className="text-sm font-medium truncate">{user.profile?.username || user.name}</span>
                      <span className="w-2 h-2 rounded-full bg-green-500" aria-label="Online" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Grower of the Week */}
      {growerOfWeek && (
        <section className="tt-reveal py-14 px-4 sm:px-6 lg:px-8 border-y border-border bg-secondary/20">
          <div className="max-w-7xl mx-auto">
            <div className="bg-card rounded-2xl border border-border p-6 sm:p-8 overflow-hidden relative">
              <div className="tt-spectrum-bar absolute inset-x-0 top-0 h-1" />
              <div className="absolute top-0 right-0 p-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-warning text-xs font-semibold uppercase tracking-wide">
                  <Award className="w-3.5 h-3.5" />
                  Grower of the Week
                </span>
              </div>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
                <Avatar src={growerOfWeek.user.image ?? undefined} size="xl" alt={growerOfWeek.username ?? undefined} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-display text-2xl font-bold mb-1 tracking-tight">{growerOfWeek.username}</h3>
                  <p className="text-muted-foreground text-sm mb-3 max-w-xl">
                    {growerOfWeek.bio || `A dedicated cultivator sharing ${growerOfWeek.favoriteStrain ? `their love for ${growerOfWeek.favoriteStrain}` : "their grow journey"} with the community.`}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary/10 text-primary font-medium">
                      <Trophy className="w-4 h-4" />
                      {growerOfWeek.reputation} rep
                    </span>
                    {growerOfWeek.favoriteStrain && (
                      <span className="text-muted-foreground">Favorite strain: <span className="text-foreground font-medium">{growerOfWeek.favoriteStrain}</span></span>
                    )}
                    {growerOfWeek.growExperience && (
                      <span className="text-muted-foreground">Experience: <span className="text-foreground font-medium">{growerOfWeek.growExperience}</span></span>
                    )}
                  </div>
                </div>
                <Link
                  href={`/u/${growerOfWeek.username}`}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
                >
                  View profile <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* CTA — a contained grow-light banner rather than a bare strip */}
      <section className="tt-reveal px-4 pb-20 pt-4 sm:px-6 lg:px-8">
        <div className="tt-holo-border relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-border/70 bg-card/70 px-6 py-14 text-center shadow-xl backdrop-blur-sm sm:px-10">
          <div className="tt-spectrum-bar absolute inset-x-0 top-0 h-1" />
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute left-1/2 top-0 h-[220px] w-[480px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/15 blur-[90px]" />
            <div className="absolute -right-10 bottom-0 h-[160px] w-[160px] rounded-full bg-spectrum/15 blur-[80px]" />
          </div>
          <div className="relative">
            <span className="tt-eyebrow">Lights on</span>
            <h2 className="font-display text-3xl sm:text-4xl font-bold mt-2 mb-4 tracking-tight">Join TerpTalk Today</h2>
            <p className="text-lg text-muted-foreground mb-8 max-w-xl mx-auto">
              Create your account and start growing with the community. Refer friends with your personal link.
            </p>
            <Link
              href="/auth/signup"
              className="tt-cta inline-block rounded-full px-9 py-3.5 font-semibold text-primary-foreground transition-all"
            >
              Create Free Account
            </Link>
          </div>
        </div>
      </section>

    </div>
  )
}
