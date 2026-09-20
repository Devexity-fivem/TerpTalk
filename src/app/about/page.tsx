import Link from "next/link"
import { MessageSquare, Sprout, MessageCircle, Dna, Users, Award, Trophy, BookOpen, Tag, Bot } from "lucide-react"

export const metadata = {
  title: "About",
  description: "What TerpTalk is — a privacy-first, 21+ cannabis growing community with forums, grow journals, strain database and live chat.",
}

const FEATURES = [
  { icon: MessageSquare, label: "Discussion forums", href: "/forum" },
  { icon: Sprout, label: "Grow diaries", href: "/diaries" },
  { icon: Dna, label: "Strain database", href: "/strains" },
  { icon: Users, label: "Setup showcases", href: "/setups" },
  { icon: BookOpen, label: "Grow guides", href: "/guides" },
  { icon: MessageCircle, label: "Live community chat", href: "/chat" },
  { icon: Trophy, label: "Weekly & monthly contests", href: "/contest" },
  { icon: Tag, label: "Grow gear deals", href: "/deals" },
  { icon: Award, label: "Reputation & badges", href: "/reputation" },
]

const FAQ = [
  {
    q: "Is TerpTalk free?",
    a: "Yes — completely free. No subscriptions, no ads, no selling your data.",
  },
  {
    q: "Do I need to give my email?",
    a: "No. Signup only requires a username and password — plus a recovery phrase you write down. We're privacy-first by design.",
  },
  {
    q: "Can I buy or sell cannabis here?",
    a: "No. TerpTalk is strictly a discussion and education community. Solicitation or sales of any kind are not permitted.",
  },
  {
    q: "Who can join?",
    a: "Anyone 21 or older (or of legal cannabis age in your jurisdiction).",
  },
  {
    q: "How do badges and reputation work?",
    a: "You earn reputation for contributing — threads, replies, diaries, strains, photos, referrals, and likes from other members. Badges unlock automatically at milestones.",
  },
  {
    q: "How do I report something or get help?",
    a: "Use the Report button on any post or profile to flag something for the team. For plant problems, try the Plant Help wizard. For site help, ask in chat — the community and staff are active there.",
  },
  {
    q: "Can I delete my data?",
    a: "Yes. Your profile page has full data export and account deletion tools. We never store your real IP address and require no email.",
  },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="font-display text-4xl font-bold tracking-tight mb-4">
          About <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-spectrum">TerpTalk</span>
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed mb-10 max-w-2xl">
          TerpTalk is a privacy-first, 21+ community built by growers, for growers.
          Document your grows, compare genetics, show off your setup, and get real
          answers from people who actually grow.
        </p>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 mb-14">
          {FEATURES.map(({ icon: Icon, label, href }) => (
            <Link key={label} href={href} className="tt-edge-card bg-card/80 border border-border/70 rounded-2xl p-4 flex items-center gap-3 hover:border-primary/50 transition-all">
              <Icon className="w-5 h-5 text-primary shrink-0" />
              <span className="font-medium">{label}</span>
            </Link>
          ))}
        </div>

        <div className="bg-card/80 border border-border/70 rounded-2xl p-6 mb-14">
          <div className="flex items-center gap-2 mb-3">
            <Bot className="w-5 h-5 text-primary" />
            <h2 className="font-display text-2xl font-bold">Meet TerpBot</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            TerpBot is our automated community assistant — a bot, not a person. It welcomes new
            members, posts the daily digest, celebrates milestones, and answers questions in chat.
            Mention <span className="text-foreground font-medium">@terpbot</span> or type{" "}
            <span className="text-foreground font-medium">/help</span> in chat to see what it can do.
            It can also send you occasional helpful notifications about your own threads and diaries —
            you can turn those off in notification settings.
          </p>
          <Link href="/u/terpbot" className="text-sm text-primary hover:underline">
            See TerpBot&apos;s profile and commands →
          </Link>
        </div>

        <div className="bg-card/80 border border-border/70 rounded-2xl p-6 mb-14">
          <h2 className="font-display text-2xl font-bold mb-3">The short version of our rules</h2>
          <ul className="text-sm text-muted-foreground leading-relaxed space-y-1.5 list-disc list-inside">
            <li>21+ only — no exceptions.</li>
            <li>Be respectful — no harassment, hate speech, or personal attacks.</li>
            <li>No buying, selling, trading, or sourcing — ever.</li>
            <li>No spam or unsolicited advertising.</li>
            <li>Keep everyone pseudonymous — no sharing private info.</li>
          </ul>
          <p className="text-sm text-muted-foreground mt-3">
            Full rules on the{" "}
            <Link href="/rules" className="text-primary hover:underline">Community Rules</Link> page; legal terms in the{" "}
            <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>.
          </p>
        </div>

        <h2 className="font-display text-2xl font-bold mb-6">Frequently Asked Questions</h2>
        <div className="space-y-4 mb-12">
          {FAQ.map((f) => (
            <div key={f.q} className="bg-card/80 border border-border/70 rounded-2xl p-5">
              <h3 className="font-semibold mb-1.5">{f.q}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>

        <div className="relative overflow-hidden text-center bg-card/80 border border-border/70 rounded-2xl p-8 mb-8">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary via-spectrum to-amber-500" aria-hidden="true" />
          <h2 className="font-display text-xl font-bold mb-2">Ready to grow with us?</h2>
          <p className="text-sm text-muted-foreground mb-5">Free forever. No email required. 21+ only.</p>
          <Link href="/auth/signup" className="tt-cta inline-block px-8 py-3 rounded-full font-semibold text-primary-foreground transition-all">
            Create Account
          </Link>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground underline underline-offset-2">Terms of Service</Link>
          {" · "}
          <Link href="/privacy" className="hover:text-foreground underline underline-offset-2">Privacy Policy</Link>
          {" · "}
          <Link href="/rules" className="hover:text-foreground underline underline-offset-2">Community Rules</Link>
          {" · "}
          <Link href="/help" className="hover:text-foreground underline underline-offset-2">Help Center</Link>
        </p>
      </div>
    </div>
  )
}
