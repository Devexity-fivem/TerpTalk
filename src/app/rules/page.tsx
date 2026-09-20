import Link from "next/link"
import { ScrollText } from "lucide-react"

export const metadata = {
  title: "Community Rules",
  description: "TerpTalk community rules — the plain-language version of how we keep a 21+ cannabis growing community safe and useful.",
}

export default function RulesPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="flex items-center gap-3 mb-2">
          <ScrollText className="w-7 h-7 text-primary" />
          <h1 className="font-display text-3xl font-bold tracking-tight">Community Rules</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-8">
          The short, plain-language version of how we keep TerpTalk safe. The{" "}
          <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>{" "}
          is the legal document — this page is the everyday version.
        </p>

        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed break-words">
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">1. You must be 21 or older</h2>
            <p>TerpTalk is for adults 21+ — or the legal cannabis age where you live, if that&apos;s higher. Accounts belonging to underage users are removed.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">2. No buying, selling, or sourcing — ever</h2>
            <p>This is the rule we enforce hardest. No selling, buying, trading, sourcing, or soliciting cannabis, seeds, or anything else controlled — no vendor links, no &quot;DM me for prices,&quot; no hook-ups. The Deals section is the one exception: it&apos;s staff-curated affiliate content, not member sales.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">3. Treat people well</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>No harassment, threats, personal attacks, or hate speech.</li>
              <li>No impersonating members or staff.</li>
              <li>No sharing anyone&apos;s private information — pseudonyms stay pseudonymous.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">4. Keep the platform clean and safe</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>No illegal content, spam, or malicious links.</li>
              <li>No advertising products or services without permission.</li>
              <li>No extra accounts to dodge a ban or game the limits.</li>
              <li>Don&apos;t try to break, probe, or bypass the platform&apos;s security or moderation.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">5. Only post content you have rights to</h2>
            <p>You own what you post — but only upload photos and content you actually have the rights to share. Don&apos;t repost other people&apos;s grow photos as your own.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">6. When rules are broken</h2>
            <p>Moderators can warn you, remove content, or lock threads. Administrators can also suspend accounts temporarily or ban them permanently. When action is taken on your account you&apos;ll get a notification with the reason. Serious reports — threats, illegal content — get reviewed first.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">7. How to report a problem</h2>
            <p>Use the Report button on threads, posts, diaries, setups, and profiles — pick a reason and add details if you want. Reports are confidential. For problems in chat, alert a staff member in the room. Please report issues instead of escalating them in public.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">8. Think a decision was wrong?</h2>
            <p>If your account is active, reach a staff member in <Link href="/chat" className="text-primary hover:underline">chat</Link>. If you&apos;re suspended or banned, use the <Link href="/restricted" className="text-primary hover:underline">restricted account page</Link> — sign in with your username and password to see your status and ask the team to review it.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">9. TerpBot isn&apos;t a moderator</h2>
            <p>TerpBot is our automated assistant — it answers questions, posts announcements, and relays staff actions, but it never makes moderation decisions. Rule problems go to real staff via the Report button, not to the bot.</p>
          </section>
        </div>

        <div className="mt-10 pt-6 border-t border-border flex flex-wrap gap-4 text-sm">
          <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>
          <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>
          <Link href="/help" className="text-primary hover:underline">Help Center</Link>
          <Link href="/about" className="text-primary hover:underline">About TerpTalk</Link>
        </div>
      </div>
    </div>
  )
}
