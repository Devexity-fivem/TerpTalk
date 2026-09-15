import Link from "next/link"
import { HelpCircle, Stethoscope } from "lucide-react"

export const metadata = {
  title: "Help Center",
  description: "TerpTalk Help Center — how accounts, forums, grow diaries, chat, reputation, privacy controls, and moderation work.",
}

type QA = { q: string; a: React.ReactNode }

function Section({ title, items }: { title: string; items: QA[] }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-foreground mb-2">{title}</h2>
      <div className="bg-card rounded-lg border border-border divide-y divide-border">
        {items.map(({ q, a }) => (
          <details key={q} className="group p-4">
            <summary className="cursor-pointer font-medium text-sm text-foreground list-none flex items-center justify-between gap-3">
              {q}
              <span className="text-muted-foreground group-open:rotate-45 transition-transform text-lg leading-none">+</span>
            </summary>
            <div className="mt-2 text-sm text-muted-foreground leading-relaxed">{a}</div>
          </details>
        ))}
      </div>
    </section>
  )
}

const SECTIONS: { title: string; items: QA[] }[] = [
  {
    title: "Getting started",
    items: [
      {
        q: "How do I create an account?",
        a: <>Head to <Link href="/auth/signup" className="text-primary hover:underline">Sign up</Link>, pick a username and password, confirm you&apos;re 21+, and solve the captcha. <strong className="text-foreground">No email is collected</strong> — after signup you&apos;ll be guided through onboarding, which includes generating a recovery phrase.</>,
      },
      {
        q: "What happens after I sign up?",
        a: <>The onboarding tour lets you pick topics to follow, set up your profile, <strong className="text-foreground">save your 12-word recovery phrase</strong>, and follow a few growers. You can resume it anytime — but don&apos;t skip the recovery phrase; it&apos;s the only way back into your account.</>,
      },
      {
        q: "Where do I start posting?",
        a: <>Introduce yourself or ask a question in <Link href="/forum" className="text-primary hover:underline">Discussions</Link>, start a <Link href="/diaries" className="text-primary hover:underline">grow diary</Link>, or hop into <Link href="/chat" className="text-primary hover:underline">chat</Link>. New here? <Link href="/about" className="text-primary hover:underline">About</Link> has the tour, and <Link href="/rules" className="text-primary hover:underline">Community Rules</Link> covers the basics.</>,
      },
      {
        q: "Can I change my username?",
        a: <>No — usernames are permanent once onboarding is complete, since they anchor your profile URL, mentions, and referrals. Choose carefully.</>,
      },
    ],
  },
  {
    title: "Account & security",
    items: [
      {
        q: "What is the recovery phrase?",
        a: <>Your only way back in if you forget your password — there&apos;s no email reset. Generate it during onboarding or anytime under <Link href="/profile" className="text-primary hover:underline">your profile</Link> → Account Recovery. It&apos;s shown exactly once — write it down and keep it somewhere safe.</>,
      },
      {
        q: "I forgot my password",
        a: <>Use <Link href="/auth/recover" className="text-primary hover:underline">account recovery</Link> with your username and 12-word phrase. Heads up: recovering gives you a brand-new phrase (the old one is burned) and signs out all your sessions.</>,
      },
      {
        q: "Can I change my password?",
        a: <>There&apos;s no change-password form — the recovery flow is how passwords rotate today. Generate your recovery phrase first on your profile page, then use <Link href="/auth/recover" className="text-primary hover:underline">account recovery</Link> to set a new password.</>,
      },
    ],
  },
  {
    title: "Forums & posting",
    items: [
      {
        q: "How do I start a thread or reply?",
        a: <>Use <Link href="/forum/new" className="text-primary hover:underline">New Thread</Link> or the + menu — pick a category, add tags and images, optionally attach a poll. Replies support @mentions and basic formatting. You can edit or delete your own posts from the post menu.</>,
      },
      {
        q: "Why can't I post links?",
        a: <>New accounts can&apos;t post external links until the account is 24 hours old and has 150 reputation — it keeps spam out. Keep posting and it unlocks quickly.</>,
      },
      {
        q: "What are accepted answers?",
        a: <>The thread author or a moderator can mark a reply as the accepted answer — it&apos;s worth +30 rep and shows up highlighted. You can&apos;t mark your own reply.</>,
      },
      {
        q: "How do follows and bookmarks work?",
        a: <>You auto-follow threads you create or reply to. You can also follow whole categories, diaries, and members — new activity lands in your notifications. Bookmarks (the ribbon icon) save threads privately on your profile.</>,
      },
    ],
  },
  {
    title: "Grow diaries & setups",
    items: [
      {
        q: "How do grow diaries work?",
        a: <>Start one at <Link href="/diaries/new" className="text-primary hover:underline">New Diary</Link>, then post updates with photos, stage, and environment stats (temp, RH, VPD, pH, EC). Diaries group updates by week, track your streak, and when you harvest, your yield can appear on the <Link href="/leaderboard/yields" className="text-primary hover:underline">yield leaderboard</Link>.</>,
      },
      {
        q: "What's the difference between deleting a diary and an update?",
        a: <>Deleting a diary hides the whole thing (photos are permanently removed). Deleting an update removes just that update permanently — the rest of the diary stays.</>,
      },
      {
        q: "What are setups?",
        a: <>Setups (<Link href="/setups" className="text-primary hover:underline">/setups</Link>) are shareable grow-space builds — tent, lights, ventilation, and photos. Members can comment on them; you can delete your setup or your own comments anytime.</>,
      },
    ],
  },
  {
    title: "Chat & TerpBot",
    items: [
      {
        q: "How does chat work?",
        a: <><Link href="/chat" className="text-primary hover:underline">Chat</Link> is a live community room — reply to messages, @mention people, use emoji, or post an action with /me. You can delete your own messages from the message menu. <strong className="text-foreground">Chat is temporary</strong> — messages are removed after about 3 days. Use DMs or threads for anything you want kept.</>,
      },
      {
        q: "What is TerpBot?",
        a: <>TerpBot is TerpTalk&apos;s automated assistant — a bot, not a person and not a moderator. In chat, mention <strong className="text-foreground">@terpbot</strong> in plain language or use slash commands (type /help in chat for the list) — it can look up your rep, badges, streaks, diaries, strains, guides, who&apos;s online, and more.</>,
      },
      {
        q: "What does TerpBot do on its own?",
        a: <>It welcomes new members, posts a daily digest and grow tip, celebrates milestones publicly (tier-ups, badges, harvests, contest winners), and relays staff moderation messages. It may also send you occasional private tips — a welcome note, a first-diary pointer, or a nudge when your thread goes quiet. See its profile at <Link href="/u/terpbot" className="text-primary hover:underline">/u/terpbot</Link>.</>,
      },
      {
        q: "Can I turn TerpBot off?",
        a: <>Two controls in <Link href="/settings/notifications" className="text-primary hover:underline">Settings</Link>: <strong className="text-foreground">TerpBot tips</strong> turns off its private notifications, and <strong className="text-foreground">Opt out of public recognition</strong> keeps your name out of its public shout-outs. TerpBot can&apos;t receive DMs, can&apos;t moderate, and won&apos;t pretend to be human.</>,
      },
    ],
  },
  {
    title: "Direct messages",
    items: [
      {
        q: "How do I message someone?",
        a: <>Visit their profile and hit Message, or go to <Link href="/messages" className="text-primary hover:underline">Messages</Link>. You control who can message you under Settings → Privacy: everyone, only members you follow, or nobody. Blocked members can&apos;t message you, and TerpBot can&apos;t receive DMs.</>,
      },
    ],
  },
  {
    title: "Reputation, tiers & badges",
    items: [
      {
        q: "How does reputation work?",
        a: <>You earn rep for threads, replies, diaries, setups, accepted answers (+30), likes received, referrals, and daily check-ins — with daily caps to keep it fair. The full breakdown and tier perks (more images, poll voting, verified status) are on the <Link href="/reputation" className="text-primary hover:underline">Reputation</Link> page.</>,
      },
      {
        q: "Why did my reputation drop?",
        a: <>Reputation reverses automatically when the content it came from is deleted — by you or by moderation. Verified members who fall below the threshold can lose the badge. Nothing was taken away arbitrarily.</>,
      },
      {
        q: "What are badges?",
        a: <>Badges mark achievements — activity, streaks, contests, community roles. See yours and pin favorites on <Link href="/achievements" className="text-primary hover:underline">Achievements</Link>; they show on your public profile.</>,
      },
    ],
  },
  {
    title: "Notifications & privacy",
    items: [
      {
        q: "How do I control notifications?",
        a: <><Link href="/settings/notifications" className="text-primary hover:underline">Settings</Link> has a toggle per category — replies, mentions, follows, reactions, messages, milestones, and TerpBot tips. On the <Link href="/notifications" className="text-primary hover:underline">Notifications</Link> page you can mark things read or delete them. Notifications are kept about 90 days.</>,
      },
      {
        q: "Can I hide that I'm online?",
        a: <>Yes — Settings → Privacy → &quot;Hide my online status&quot; removes you from active-member lists and the online indicator. Your public posts and profile are still visible.</>,
      },
      {
        q: "Can I opt out of public shout-outs?",
        a: <>Settings → Privacy → &quot;Opt out of public recognition&quot; keeps your username out of TerpBot&apos;s public celebrations and leaderboard spotlights. You still earn everything — badges, rep, and private notifications — just without the public name-drop.</>,
      },
      {
        q: "Are my photos private?",
        a: <>Uploaded photos are stored as public links — anyone with the link can view them. We automatically strip location data (EXIF/GPS) on upload, but only post photos you&apos;re comfortable sharing publicly.</>,
      },
    ],
  },
  {
    title: "Deleting content & your account",
    items: [
      {
        q: "What can I delete?",
        a: <>Your own threads, replies, diaries, diary updates, setups, setup comments, chat messages, and notifications — look for the trash icon or the post/message menu. Deleted posts and diaries are hidden; updates, comments, and notifications are removed permanently. Photos are permanently removed either way.</>,
      },
      {
        q: "Can I download my data?",
        a: <>Yes — <Link href="/profile" className="text-primary hover:underline">your profile</Link> → &quot;Download my data&quot; gives you a JSON export of your account and content.</>,
      },
      {
        q: "How do I delete my account?",
        a: <>Profile → Delete my account. It&apos;s permanent: your profile, content, messages, and uploads are removed. A few moderation and security records are kept for safety, stripped of what identifies you where possible. Banned or suspended? Use the <Link href="/restricted" className="text-primary hover:underline">restricted account page</Link> to request deletion.</>,
      },
    ],
  },
  {
    title: "Reports & moderation",
    items: [
      {
        q: "How do I report something?",
        a: <>Use the Report button on threads, posts, diaries, setups, and profiles — pick a reason and add details. Reports are confidential and rate-limited. For chat issues, alert a staff member in the room. Please report rather than escalating publicly.</>,
      },
      {
        q: "My account was suspended or banned",
        a: <>Restricted accounts can&apos;t sign in normally. Go to <Link href="/restricted" className="text-primary hover:underline">/restricted</Link> and verify with your username and password to see your status and reason — then you can ask the moderation team to review it or request account deletion.</>,
      },
      {
        q: "Who are the staff?",
        a: <>Moderators handle reports, warnings, and content removal; administrators can also suspend and ban. Staff applications open at <Link href="/staff/apply" className="text-primary hover:underline">/staff/apply</Link> when the team is recruiting.</>,
      },
      {
        q: "Where are the rules?",
        a: <>The <Link href="/rules" className="text-primary hover:underline">Community Rules</Link> page is the short version; the <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link> is the legal document. The <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link> covers your data.</>,
      },
    ],
  },
]

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="flex items-center gap-3 mb-2">
          <HelpCircle className="w-7 h-7 text-primary" />
          <h1 className="text-3xl font-bold">Help Center</h1>
        </div>
        <p className="text-muted-foreground mb-8">
          How TerpTalk works — accounts, posting, diaries, chat, reputation, privacy, and moderation.
          New here? Start with <Link href="/about" className="text-primary hover:underline">About</Link> and the{" "}
          <Link href="/rules" className="text-primary hover:underline">Community Rules</Link>.
        </p>

        <Link
          href="/plant-doctor"
          className="flex items-center gap-3 mb-8 bg-card border border-border rounded-lg p-4 hover:border-primary/40 transition-colors"
        >
          <Stethoscope className="w-6 h-6 text-primary shrink-0" />
          <div>
            <div className="font-semibold">Plant Problem Solver</div>
            <div className="text-sm text-muted-foreground">Something wrong with your grow? Answer a few questions for likely causes and fixes.</div>
          </div>
        </Link>

        <div className="space-y-8">
          {SECTIONS.map((s) => (
            <Section key={s.title} title={s.title} items={s.items} />
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-border flex flex-wrap gap-4 text-sm">
          <Link href="/about" className="text-primary hover:underline">About</Link>
          <Link href="/rules" className="text-primary hover:underline">Community Rules</Link>
          <Link href="/terms" className="text-primary hover:underline">Terms</Link>
          <Link href="/privacy" className="text-primary hover:underline">Privacy</Link>
          <Link href="/u/terpbot" className="text-primary hover:underline">TerpBot</Link>
        </div>
      </div>
    </div>
  )
}
