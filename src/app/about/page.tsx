import Link from "next/link"
import { MessageSquare, Sprout, MessageCircle, Dna, Users, Award } from "lucide-react"

export const metadata = {
  title: "About",
  description: "What TerpTalk is — a privacy-first, 21+ cannabis growing community with forums, grow journals, strain database and live chat.",
}

const FAQ = [
  {
    q: "Is TerpTalk free?",
    a: "Yes — completely free. No subscriptions, no ads, no selling your data.",
  },
  {
    q: "Do I need to give my email?",
    a: "No. Signup only requires a username and password. We're privacy-first by design.",
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
    q: "Can I delete my data?",
    a: "Yes. Your profile page has full data export and account deletion tools. We store no raw IPs and require no email.",
  },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold tracking-tight mb-4">
          About <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-300">TerpTalk</span>
        </h1>
        <p className="text-lg text-muted-foreground leading-relaxed mb-10 max-w-2xl">
          TerpTalk is a privacy-first, 21+ community built by growers, for growers.
          Document your grows, compare genetics, show off your setup, and get real
          answers from people who actually grow.
        </p>

        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4 mb-14">
          {[
            { icon: MessageSquare, label: "Discussion forums", href: "/forum" },
            { icon: Sprout, label: "Grow diaries", href: "/diaries" },
            { icon: Dna, label: "Strain database", href: "/strains" },
            { icon: Users, label: "Setup showcases", href: "/setups" },
            { icon: MessageCircle, label: "Live community chat", href: null },
            { icon: Award, label: "Reputation & badges", href: null },
          ].map(({ icon: Icon, label, href }) => (
            <div key={label} className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
              <Icon className="w-5 h-5 text-primary shrink-0" />
              {href ? <Link href={href} className="font-medium hover:text-primary">{label}</Link> : <span className="font-medium">{label}</span>}
            </div>
          ))}
        </div>

        <h2 className="text-2xl font-bold mb-6">Frequently Asked Questions</h2>
        <div className="space-y-4 mb-12">
          {FAQ.map((f) => (
            <div key={f.q} className="bg-card border border-border rounded-xl p-5">
              <h3 className="font-semibold mb-1.5">{f.q}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>

        <div className="text-center bg-card border border-border rounded-xl p-8">
          <h2 className="text-xl font-bold mb-2">Ready to grow with us?</h2>
          <p className="text-sm text-muted-foreground mb-5">Free forever. No email required. 21+ only.</p>
          <Link href="/auth/signup" className="inline-block bg-primary text-primary-foreground px-8 py-3 rounded-xl font-semibold hover:bg-primary/90 transition-colors">
            Create Account
          </Link>
        </div>
      </div>
    </div>
  )
}
