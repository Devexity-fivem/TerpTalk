import { MessageSquare, Award, MessageCircle, Dna, Sprout } from "lucide-react"
import Link from "next/link"
import { prisma } from "@/lib/prisma"
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

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Community Forums",
    desc: "Engage in discussions about growing techniques, equipment, genetics, and more with experienced cultivators.",
    href: "/forum",
  },
  {
    icon: Sprout,
    title: "Grow Diaries",
    desc: "Document your entire grow journey from seed to harvest with detailed updates and environmental data.",
    href: "/diaries",
  },
  {
    icon: MessageCircle,
    title: "Community Chat",
    desc: "Hang out in the community chat. Get quick answers and share experiences in real time.",
    href: null,
  },
  {
    icon: Award,
    title: "Reputation & Staff Badges",
    desc: "Earn reputation through helpful contributions. Admins and mods are clearly badged so you know who's legit.",
    href: null,
  },
  {
    icon: Sprout,
    title: "Setup Showcases",
    desc: "Share your grow setup and equipment. Get feedback and inspiration from the community.",
    href: "/setups",
  },
  {
    icon: Dna,
    title: "Strain Database",
    desc: "Explore and contribute to our community-maintained strain database with genetics and growing characteristics.",
    href: "/strains",
  },
]

export default async function Home() {
  const stats = await getStats()
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
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
            The community for cannabis growers — share grow diaries, trade setups, talk genetics, and learn together.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/auth/signup"
              className="bg-primary text-primary-foreground px-8 py-3 rounded-xl font-semibold hover:bg-primary/90 transition-all shadow-lg shadow-primary/25 hover:shadow-primary/40 text-center"
            >
              Join Community
            </Link>
            <Link
              href="/diaries"
              className="border border-border bg-card/60 backdrop-blur px-8 py-3 rounded-xl font-semibold hover:bg-secondary transition-colors text-center"
            >
              Explore Grow Diaries
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

      {/* Features Section */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-3 tracking-tight">Everything You Need to Grow</h2>
          <p className="text-center text-muted-foreground mb-12 max-w-xl mx-auto">
            Built by growers, for growers — every tool you need in one place.
          </p>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-6">
            {FEATURES.map(({ icon: Icon, title, desc, href }) => {
              const card = (
                <div className="bg-card p-6 rounded-xl border border-border h-full transition-all hover:border-primary/40 hover:-translate-y-1 hover:shadow-lg hover:shadow-primary/10">
                  <div className="bg-primary/10 w-12 h-12 rounded-xl flex items-center justify-center mb-4 ring-1 ring-primary/20">
                    <Icon className="w-6 h-6 text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
                </div>
              )
              return href ? (
                <Link key={title} href={href}>{card}</Link>
              ) : (
                <div key={title}>{card}</div>
              )
            })}
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
            <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
