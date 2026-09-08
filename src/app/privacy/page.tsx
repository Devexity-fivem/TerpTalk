export const metadata = {
  title: "Privacy Policy",
  description: "How TerpTalk collects, stores, and protects your data.",
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: {new Date().toLocaleDateString()}</p>

        <div className="prose prose-invert max-w-none space-y-6 text-sm text-muted-foreground leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">What we collect</h2>
            <p>Account data: username, hashed password, profile fields you choose to fill in (bio, location, website, avatar photo, grow details). Content you post: threads, replies, diaries, photos, chat messages. Technical data: we store only a salted hash of your IP address for rate limiting and abuse prevention — never your raw IP.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">What we don&apos;t collect</h2>
            <p>No email address is required. No tracking pixels, advertising trackers, or third-party analytics are embedded. We do not sell or share your data with advertisers.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Cookies &amp; sessions</h2>
            <p>We use a session cookie to keep you signed in and nothing else. There are no marketing or analytics cookies.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Your controls</h2>
            <p>From your profile you can: export a full copy of your data, edit or delete your content, and permanently delete your account — which removes your profile, posts, messages, and associated data.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Data security</h2>
            <p>Passwords are hashed with bcrypt. Traffic is encrypted over HTTPS. Access to the database is restricted and security events (logins, rate-limit events) are logged without raw IPs.</p>
          </section>
          <section>
            <h2 className="text-lg font-semibold text-foreground mb-2">Data retention</h2>
            <p>Data is retained while your account exists. Security logs are kept for abuse-prevention purposes and pruned over time.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
