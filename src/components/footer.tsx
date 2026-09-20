import Link from "next/link"
import CannabisLeaf from "@/components/cannabis-leaf"
import FooterChatLink from "@/components/footer-chat-link"
import FooterFeedbackLink from "@/components/footer-feedback-link"

const LINK_CLASS = "text-sm text-muted-foreground transition-colors hover:text-foreground"
const HEADING_CLASS = "mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80"

export default function Footer() {
  return (
    <footer className="relative mt-auto border-t border-border/60 px-4 pb-20 pt-10 sm:px-6 lg:px-8 lg:pb-10">
      <div className="tt-spectrum-bar absolute inset-x-0 top-0 h-[2px] opacity-70" />
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-1">
            <div className="flex items-center gap-2">
              <div className="tt-brand-tile rounded-lg p-1.5">
                <CannabisLeaf className="h-5 w-5 text-primary" />
              </div>
              <span className="font-display text-base font-bold tracking-tight text-foreground">TerpTalk</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              A 21+ growers&apos; commons — diaries, strains, setups, and real answers.
            </p>
          </div>

          <div>
            <h4 className={HEADING_CLASS}>Community</h4>
            <ul className="space-y-2">
              <li><Link href="/forum" className={LINK_CLASS}>Discussions</Link></li>
              <li><Link href="/diaries" className={LINK_CLASS}>Grow Diaries</Link></li>
              <li><FooterChatLink className={LINK_CLASS} /></li>
              <li><Link href="/setups" className={LINK_CLASS}>Setups</Link></li>
              <li><Link href="/contest" className={LINK_CLASS}>Contest</Link></li>
              <li><Link href="/youtubers" className={LINK_CLASS}>Creators</Link></li>
            </ul>
          </div>

          <div>
            <h4 className={HEADING_CLASS}>Learn</h4>
            <ul className="space-y-2">
              <li><Link href="/guides" className={LINK_CLASS}>Grow Guides</Link></li>
              <li><Link href="/plant-doctor" className={LINK_CLASS}>Plant Doctor</Link></li>
              <li><Link href="/strains" className={LINK_CLASS}>Strain Database</Link></li>
              <li><Link href="/calculator" className={LINK_CLASS}>Grow Cost Calculator</Link></li>
              <li><Link href="/deals" className={LINK_CLASS}>Deals</Link></li>
            </ul>
          </div>

          <div>
            <h4 className={HEADING_CLASS}>Progress</h4>
            <ul className="space-y-2">
              <li><Link href="/leaderboard" className={LINK_CLASS}>Leaderboard</Link></li>
              <li><Link href="/reputation" className={LINK_CLASS}>Reputation</Link></li>
              <li><Link href="/achievements" className={LINK_CLASS}>Achievements</Link></li>
              <li><Link href="/staff/apply" className={LINK_CLASS}>Join the team</Link></li>
            </ul>
          </div>

          <div>
            <h4 className={HEADING_CLASS}>Site</h4>
            <ul className="space-y-2">
              <li><Link href="/about" className={LINK_CLASS}>About</Link></li>
              <li><Link href="/help" className={LINK_CLASS}>Help Center</Link></li>
              <li><FooterFeedbackLink className={LINK_CLASS} /></li>
              <li><Link href="/rules" className={LINK_CLASS}>Rules</Link></li>
              <li><Link href="/terms" className={LINK_CLASS}>Terms</Link></li>
              <li><Link href="/privacy" className={LINK_CLASS}>Privacy</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex items-center justify-between gap-4 border-t border-border/50 pt-5 text-xs text-muted-foreground">
          <span>TerpTalk — for adults 21+. Grow responsibly.</span>
          <span className="hidden sm:inline">Built by growers, for growers.</span>
        </div>
      </div>
    </footer>
  )
}
