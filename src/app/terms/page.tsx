import Link from "next/link"

export const metadata = {
  title: "Terms of Service",
  description: "TerpTalk terms of service — rules for using our 21+ cannabis growing community.",
}

const LAST_UPDATED = "September 13, 2026"

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="font-display text-3xl font-bold mb-2 tracking-tight">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {LAST_UPDATED}</p>

        <div className="space-y-6 text-sm text-muted-foreground leading-relaxed break-words">
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">1. Who can join</h2>
            <p>TerpTalk is a cannabis community for adults 21 or older (or the legal cannabis age where you live, if higher). By creating an account you confirm you meet this requirement. Accounts belonging to underage users will be removed.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">2. The number-one rule: no buying or selling</h2>
            <p>TerpTalk is a place to discuss and learn about cannabis cultivation — nothing more. We do not sell cannabis, and the platform may not be used to buy, sell, trade, source, or solicit cannabis, seeds, or any other controlled substance. That includes posting vendor links, &quot;DM me for prices,&quot; or anything meant to arrange a transaction. Content like this may be removed and accounts suspended.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">3. Community rules</h2>
            <p className="mb-2">Don&apos;t:</p>
            <ul className="list-disc list-inside space-y-1.5">
              <li>Harass, threaten, or attack other members — no hate speech.</li>
              <li>Post illegal content, spam, or malicious links.</li>
              <li>Share anyone&apos;s private information — pseudonyms stay pseudonymous.</li>
              <li>Impersonate other members or staff.</li>
              <li>Create extra accounts to dodge a ban or manipulation limits.</li>
              <li>Advertise products or services without permission.</li>
              <li>Try to break, probe, or bypass the platform&apos;s security or moderation.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">4. Your account</h2>
            <p>You&apos;re responsible for keeping your password and recovery phrase safe. <span className="text-foreground">We never collect your email — your 12-word recovery phrase is the only way back into your account.</span> If you lose both your password and your phrase, the account can&apos;t be recovered. Anything done through your account is your responsibility.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">5. Your content</h2>
            <p>You own what you post. By posting, you give TerpTalk permission to display that content on the platform. Only upload photos and content you have the rights to share. You can delete posts and threads you created; deleting your account removes your profile and content (see the <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link> for the details, including what limited records may be kept for safety).</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">6. Moderation</h2>
            <p>Moderators can remove content, issue warnings, or suspend accounts that break these terms. If you think a decision was a mistake, use the Report button or contact a staff member in <Link href="/chat" className="text-primary hover:underline">chat</Link> while your account is active. If your account is suspended or banned, the <Link href="/restricted" className="text-primary hover:underline">restricted account page</Link> lets you check your status and ask the moderation team to review the restriction or delete your account.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">7. TerpBot</h2>
            <p>TerpBot is an automated assistant — a bot, not a person and not a moderator. It answers commands and mentions in chat, posts community announcements, and can send you optional notifications about your own activity. It doesn&apos;t give cultivation, legal, or medical advice, and it never pretends to be human.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">8. Deals and external links</h2>
            <p>Our Deals section links to third-party stores and may use affiliate links — if you buy through them, the partner may pay us a commission at no extra cost to you. We don&apos;t control and aren&apos;t responsible for external sites, their products, or their policies.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">9. The service itself</h2>
            <p>TerpTalk is provided &quot;as is&quot; without warranties of any kind. Features may change, and the service may be unavailable from time to time. Some content is intentionally temporary — public chat messages are removed after a few days. We&apos;re not liable for user-generated content or for what members do. Nothing on TerpTalk is legal, medical, or professional cultivation advice — follow the laws where you live.</p>
          </section>
          <section>
            <h2 className="font-display text-lg font-semibold text-foreground mb-2">10. Changes to these terms</h2>
            <p>We may update these terms as the platform evolves. Changes are posted on this page with an updated date; continuing to use TerpTalk after changes means you accept them. Questions? Reach a staff member through the Report button or in chat.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
