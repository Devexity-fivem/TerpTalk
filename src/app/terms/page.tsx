export const metadata = {
  title: "Terms of Service",
  description: "TerpTalk terms of service — rules for using our 21+ cannabis growing community.",
}

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="prose prose-invert max-w-none space-y-6 text-sm text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">1. Age requirement</h2>
            <p>TerpTalk is a cannabis-related community intended only for adults aged 21 or older (or the age of majority for cannabis in your jurisdiction, whichever is higher). By creating an account you attest that you meet this requirement. Accounts found to belong to underage users will be removed.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">2. Purpose</h2>
            <p>TerpTalk is a discussion, journaling, and educational community about cannabis cultivation. We do not sell cannabis, facilitate sales, or permit buying/selling/solicitation of cannabis or any other controlled substance on the platform. Content implying transactions may be removed and accounts suspended.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">3. Legal compliance</h2>
            <p>You are responsible for complying with the laws of your jurisdiction. Content shared on TerpTalk is for informational and community purposes only and does not constitute legal, medical, or cultivation advice.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">4. Acceptable use</h2>
            <p>You agree not to: harass or threaten other members; post illegal content, spam, or malicious links; share others&apos; private information; attempt to circumvent security or moderation controls; impersonate staff; or use the platform to advertise products or services without permission.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">5. Your content</h2>
            <p>You retain ownership of content you post. By posting, you grant TerpTalk a non-exclusive license to display that content on the platform. You may delete your account and content at any time from your profile settings.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">6. Moderation</h2>
            <p>Moderators may remove content, issue warnings, or suspend accounts that violate these terms. Decisions can be appealed by contacting the team through a report or reply to your moderation notification.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">7. Liability</h2>
            <p>TerpTalk is provided &quot;as is&quot; without warranties. We are not liable for user-generated content or actions taken by members.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
