import Link from "next/link"

export const metadata = {
  title: "Privacy Policy",
  description: "How TerpTalk collects, stores, and protects your data.",
}

const LAST_UPDATED = "September 13, 2026"

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="font-display text-3xl font-bold mb-2 tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed break-words">
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">What we collect</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li><span className="text-foreground font-medium">Account info</span> — your username, a one-way scrambled version of your password (never stored in plain text), your 21+ confirmation, and your recovery phrase (stored scrambled — it&apos;s the only way back in, since we don&apos;t have your email).</li>
              <li><span className="text-foreground font-medium">Profile info</span> — whatever you choose to add: bio, location, website, avatar, grow details.</li>
              <li><span className="text-foreground font-medium">What you post</span> — threads, replies, grow diaries, setups, photos, chat messages, and private messages between members.</li>
              <li><span className="text-foreground font-medium">Technical info</span> — a one-way scrambled version of your IP address (we never store your real IP), your browser type in security logs, and when you were last active. Your online status may be shown publicly.</li>
              <li><span className="text-foreground font-medium">Activity</span> — likes, follows, votes, referrals, badge progress, and clicks on partner links in our Deals section.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">What we don&apos;t collect</h2>
            <p>No email address is required — ever. We don&apos;t use advertising trackers or tracking pixels, and we never sell or share your data with advertisers. We use Vercel Analytics for anonymized page-view counts only; it uses no cookies and does not identify you.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">TerpBot</h2>
            <p>TerpBot is our automated community assistant — a bot, not a person. It reads public chat messages to answer <span className="text-foreground">@terpbot</span> mentions, and it can send you occasional private notifications (welcome tips, grow-diary pointers, a nudge when one of your threads goes quiet). You can turn these off anytime under <Link href="/settings/notifications" className="text-primary hover:underline">Settings → TerpBot tips</Link>. TerpBot may also celebrate your milestones publicly in chat — those posts can mention your username; you can opt out under Settings → Privacy.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">Cookies &amp; browser storage</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>A session cookie that keeps you signed in.</li>
              <li>A security cookie that protects forms from forgery.</li>
              <li>A cookie that remembers which threads you&apos;ve already viewed, so views aren&apos;t counted twice.</li>
              <li>Your browser stores your theme choice locally — that never leaves your device.</li>
            </ul>
            <p className="mt-2">There are no marketing or advertising cookies.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">Services we rely on</h2>
            <p>TerpTalk runs on a small number of infrastructure providers that process data on our behalf: Vercel (hosting, image storage, anonymized analytics), a managed PostgreSQL database, and Pusher (delivers live chat and notifications in real time — message content passes through it to reach your browser). Uploaded photos are stored as public links — we strip location data (EXIF/GPS) from images automatically, but anyone with a photo&apos;s link can view it.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">Your controls</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>Edit your profile and delete your own threads, replies, diaries, setups, comments, chat messages, and notifications.</li>
              <li>Export a copy of your data from <Link href="/profile" className="text-primary hover:underline">your profile</Link>.</li>
              <li>Choose which notifications you get, hide your online status, opt out of public milestone shout-outs, and control who can message you in <Link href="/settings/notifications" className="text-primary hover:underline">settings</Link>.</li>
              <li>Permanently delete your account from your profile — this removes your profile, posts, messages, and uploads. If your account is restricted, you can request deletion from the <Link href="/restricted" className="text-primary hover:underline">restricted account page</Link>.</li>
            </ul>
            <p className="mt-2">Two things worth knowing: deleting a post or message hides it, but a copy may be kept briefly for moderation and safety. And when you delete your account, a few records tied to moderation, security, or abuse prevention can remain so people can&apos;t wipe evidence of violations — they&apos;re stripped of what identifies you wherever the system allows.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">How long we keep things</h2>
            <ul className="list-disc list-inside space-y-1.5">
              <li>Chat messages are automatically removed after about 3 days — chat is casual, not an archive.</li>
              <li>Notifications and security logs are kept for roughly 90 days.</li>
              <li>Moderation records are kept for as long as needed to keep the community safe.</li>
              <li>Everything else stays while your account exists, or until you delete it.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">How we protect your data</h2>
            <p>We use reasonable technical and organizational safeguards designed to protect account information and the service — including encrypted connections, securely stored credentials, and access controls. No method of storage or transmission is 100% secure, but we work to keep your pseudonymous identity pseudonymous.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">Changes &amp; questions</h2>
            <p>If we change this policy we&apos;ll update this page and the date above. Questions about your data or privacy? Use the Report button anywhere on the site or contact a staff member in <Link href="/chat" className="text-primary hover:underline">chat</Link>.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
