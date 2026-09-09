import { MessageSquare, Award, MessageCircle, Dna, Sprout, Calendar, Settings, Trophy, BookOpen, Stethoscope, Tag, Medal, Menu, PenLine, ArrowRight, Calculator } from "lucide-react"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import CannabisLeaf from "@/components/cannabis-leaf"

export const dynamic = "force-dynamic"

async function getStats() {
  const [members, diaries, threads, posts] = await Promise.all([
    prisma.user.count({ where: { banned: false } }),
    prisma.growDiary.count({ where: { deleted: false } }),
    prisma.thread.count({ where: { deleted: false } }),
    prisma.post.count({ where: { deleted: false } }),
  ])
  return { members, diaries, discussions: threads + posts }
}

async function getLatestDiscussions() {
  const [categories, latest] = await Promise.all([
    prisma.category.findMany({
      where: { hidden: false },
      orderBy: { order: "asc" },
      select: { name: true, slug: true, description: true, _count: { select: { threads: { where: { deleted: false } } } } },
    }),
    prisma.thread.findMany({
      where: { deleted: false },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        author: { select: publicUserSelect },
        category: { select: { name: true, slug: true } },
        _count: { select: { posts: { where: { deleted: false } } } },
      },
    }),
  ])
  return { categories, latest }
}

const NAV_SECTIONS = [
  {
    title: "Grow",
    description: "Track, document, and improve your cultivation",
    items: [
      { icon: Sprout, title: "Grow Diaries", desc: "Document your grow from seed to harvest.", href: "/diaries" },
      { icon: Settings, title: "Setup Showcases", desc: "Show off your tent, lights, and gear.", href: "/setups" },
      { icon: Dna, title: "Strain Database", desc: "Compare genetics and grower photos.", href: "/strains" },
      { icon: Stethoscope, title: "Plant Problem Solver", desc: "Diagnose symptoms and find fixes.", href: "/help" },
    ],
  },
  {
    title: "Community",
    description: "Talk, share, and connect with other growers",
    items: [
      { icon: MessageSquare, title: "Discussions", desc: "Ask questions and trade techniques.", href: "/forum" },
      { icon: Calendar, title: "Feed", desc: "Latest posts from growers you follow.", href: "/feed" },
      { icon: MessageCircle, title: "Community Chat", desc: "Real-time help and hangout.", href: null },
      { icon: Trophy, title: "Budshot of the Week", desc: "Photo contest and community votes.", href: "/contest" },
      { icon: Medal, title: "Leaderboard", desc: "Top contributors by reputation.", href: "/leaderboard" },
    ],
  },
  {
    title: "Learn & Save",
    description: "Guides, tools, and partner deals",
    items: [
      { icon: BookOpen, title: "Grow Guides", desc: "Staff guides from germination to curing.", href: "/guides" },
      { icon: Tag, title: "Deals", desc: "Partner gear and discount codes.", href: "/deals" },
      { icon: Calculator, title: "Grow Light Calculator", desc: "Estimate electricity costs.", href: "/calculator" },
      { icon: Award, title: "Reputation & Badges", desc: "Earn rep and unlock badges.", href: "/leaderboard" },
    ],
  },
]

export default async function Home() {
  const [stats, { categories, latest }] = await Promise.all([getStats(), getLatestDiscussions()])
  return (
    <div className="flex flex-col min-h-screen bg-background">
      {/* Hero Section */}
      <section className="relative overflow-hidden py-24 px-4 sm:px-6 lg:px-8">
        {/* Glow backdrop */}
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 top-0 h-[400px] w-[700px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-primary/15 blur-[120px]" />
        </div>
        <div className="max-w-7xl mx-auto text-center">
          <div className="flex justify-center mb-8">
            <div className="bg-primary/10 p-5 rounded-2xl ring-1 ring-primary/30 shadow-[0_0_40px_-10px] shadow-primary/40">
              <CannabisLeaf className="w-14 h-14 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-foreground mb-6">
            Welcome to{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-300">
              TerpTalk
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-4">
            A 21+ community built around cannabis cultivation. Ask questions, share your grow, compare genetics, troubleshoot problems, and learn from other growers.
          </p>
          <p className="text-sm text-muted-foreground max-w-xl mx-auto mb-6 flex items-center justify-center gap-2">
            <Menu className="w-4 h-4" />
            Open the menu or jump below to explore every corner of the community.
          </p>

          {/* Quick-start actions */}
          <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 mb-8">
            <Link
              href="/forum/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-card border border-border hover:border-primary/40 hover:bg-secondary transition-colors"
            >
              <PenLine className="w-4 h-4" />
              Start a thread
            </Link>
            <Link
              href="/diaries/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-card border border-border hover:border-primary/40 hover:bg-secondary transition-colors"
            >
              <Sprout className="w-4 h-4" />
              New diary
            </Link>
            <Link
              href="/setups/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-card border border-border hover:border-primary/40 hover:bg-secondary transition-colors"
            >
              <Settings className="w-4 h-4" />
              Share setup
            </Link>
            <Link
              href="/strains/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-card border border-border hover:border-primary/40 hover:bg-secondary transition-colors"
            >
              <Dna className="w-4 h-4" />
              Add strain
            </Link>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/forum"
              className="bg-primary text-primary-foreground px-8 py-3 rounded-xl font-semibold hover:bg-primary/90 transition-all shadow-lg shadow-primary/25 hover:shadow-primary/40 text-center inline-flex items-center justify-center gap-2"
            >
              Browse the Forums
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/auth/signup"
              className="border border-border bg-card/60 backdrop-blur px-8 py-3 rounded-xl font-semibold hover:bg-secondary transition-colors text-center"
            >
              Join Community
            </Link>
          </div>
        </div>
      </section>

      {/* Community Stats */}
      <section className="py-14 px-4 sm:px-6 lg:px-8 border-y border-border bg-secondary/30">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-3 gap-8">
            <div className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-primary mb-1 tabular-nums">
                {stats.members.toLocaleString()}
              </div>
              <div className="text-sm text-muted-foreground uppercase tracking-wide">Members</div>
            </div>
            <div className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-primary mb-1 tabular-nums">
                {stats.diaries.toLocaleString()}
              </div>
              <div className="text-sm text-muted-foreground uppercase tracking-wide">Grow Diaries</div>
            </div>
            <div className="text-center">
              <div className="text-3xl sm:text-4xl font-bold text-primary mb-1 tabular-nums">
                {stats.discussions.toLocaleString()}
              </div>
              <div className="text-sm text-muted-foreground uppercase tracking-wide">Discussions</div>
            </div>
          </div>
        </div>
      </section>

      {/* Forum Preview */}
      <section className="py-14 px-4 sm:px-6 lg:px-8 border-y border-border bg-secondary/20">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold mb-3 tracking-tight">What are the TerpTalk forums about?</h2>
          <p className="text-muted-foreground mb-8 max-w-2xl">
            The forums are where the community lives — ask questions, share experiences, compare genetics, troubleshoot grow problems, and talk shop with other cultivators. Jump into a category or join the latest conversation below.
          </p>

          <div className="grid md:grid-cols-2 gap-8">
            {/* Categories */}
            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary" />
                Forum Categories
              </h3>
              <div className="space-y-3">
                {categories.map((cat) => (
                  <Link
                    key={cat.slug}
                    href={`/forum/category/${cat.slug}`}
                    className="flex items-center justify-between p-4 bg-card rounded-xl border border-border hover:border-primary/40 transition-colors"
                  >
                    <div>
                      <div className="font-medium">{cat.name}</div>
                      <div className="text-sm text-muted-foreground">{cat.description}</div>
                    </div>
                    <div className="text-sm text-muted-foreground whitespace-nowrap">
                      {cat._count.threads} thread{cat._count.threads === 1 ? "" : "s"}
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Latest discussions */}
            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-primary" />
                Latest Discussions
              </h3>
              <div className="space-y-3">
                {latest.map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/forum/thread/${thread.slug}`}
                    className="block p-4 bg-card rounded-xl border border-border hover:border-primary/40 transition-colors"
                  >
                    <div className="font-medium mb-1 line-clamp-1">{thread.title}</div>
                    <div className="text-sm text-muted-foreground flex items-center flex-wrap gap-2">
                      <span className="text-primary">{thread.category.name}</span>
                      <span>•</span>
                      <span>{thread.author.profile?.username || thread.author.name}</span>
                      <span>•</span>
                      <span>{thread.replyCount} repl{thread.replyCount === 1 ? "y" : "ies"}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-3 tracking-tight">Find your way around</h2>
          <p className="text-center text-muted-foreground mb-14 max-w-xl mx-auto">
            Every feature, organized by what you want to do.
          </p>
          <div className="space-y-16">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title}>
                <div className="mb-6">
                  <h3 className="text-xl font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    {section.title}
                  </h3>
                  <p className="text-sm text-muted-foreground ml-4">{section.description}</p>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {section.items.map(({ icon: Icon, title, desc, href }) => {
                    const card = (
                      <div className="bg-card p-5 rounded-xl border border-border h-full transition-all hover:border-primary/40 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10 flex flex-col">
                        <div className="bg-primary/10 w-10 h-10 rounded-lg flex items-center justify-center mb-3 ring-1 ring-primary/20">
                          <Icon className="w-5 h-5 text-primary" />
                        </div>
                        <h4 className="text-base font-semibold mb-1">{title}</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed flex-1">{desc}</p>
                        {href && (
                          <div className="mt-3 flex items-center gap-1 text-xs font-medium text-primary">
                            Open <ArrowRight className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    )
                    return href ? (
                      <Link key={title} href={href} className="block">{card}</Link>
                    ) : (
                      <div key={title}>{card}</div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="relative overflow-hidden py-20 px-4 sm:px-6 lg:px-8">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute left-1/2 bottom-0 h-[300px] w-[600px] -translate-x-1/2 translate-y-1/3 rounded-full bg-primary/10 blur-[100px]" />
        </div>
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4 tracking-tight">Join TerpTalk Today</h2>
          <p className="text-lg text-muted-foreground mb-8">
            Create your account and start growing with the community. Refer friends with your personal link.
          </p>
          <Link
            href="/auth/signup"
            className="inline-block bg-primary text-primary-foreground px-8 py-3 rounded-xl font-semibold hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
          >
            Create Free Account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <CannabisLeaf className="w-4 h-4 text-primary" />
            <span className="font-semibold text-foreground">TerpTalk</span>
            <span>— 21+ cannabis community</span>
          </div>
          <div className="flex items-center gap-5 flex-wrap">
            <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
            <Link href="/forum" className="hover:text-foreground transition-colors">Discussions</Link>
            <Link href="/diaries" className="hover:text-foreground transition-colors">Diaries</Link>
            <Link href="/strains" className="hover:text-foreground transition-colors">Strains</Link>
            <Link href="/deals" className="hover:text-foreground transition-colors">Deals</Link>
            <Link href="/guides" className="hover:text-foreground transition-colors">Guides</Link>
            <Link href="/help" className="hover:text-foreground transition-colors">Plant Help</Link>
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
