import { getSession } from "@/lib/session"
import { redirect } from "next/navigation"
import { signInHref } from "@/lib/callback-url"
import Link from "next/link"
import { weeklyDigestForUser } from "@/lib/weekly-digest"
import { helpWantedReasonText } from "@/lib/answer-match"
import PageHeader from "@/components/ui/page-header"
import Surface from "@/components/ui/surface"
import EmptyState from "@/components/ui/empty-state"
import { Bell, Leaf, HeartHandshake, Target, Flame, TrendingUp, MessageSquare } from "@/lib/icons"

export const metadata = {
  title: "Your Weekly Digest",
  description: "Your TerpTalk week — unread activity, followed grows, questions you can answer, and progress.",
}

export const dynamic = "force-dynamic"

export default async function MyDigestPage() {
  const session = await getSession()
  if (!session?.user?.id) redirect(signInHref("/mydigest"))

  const d = await weeklyDigestForUser(session.user.id)

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
      <PageHeader
        title="Your TerpTalk week"
        description={`Week ${d.weekKey} — what happened in your TerpTalk world since last week.`}
      />

      {!d.hasValue && (
        <Surface>
          <EmptyState
            icon={Bell}
            title="Quiet week so far"
            description="Nothing new in your corner of TerpTalk yet — follow a grow, join a discussion, or answer a question and your weekly recap will start filling up."
          />
        </Surface>
      )}

      {d.unreadCount > 0 && (
        <Surface>
          <Link href="/notifications" className="flex items-center gap-3 group">
            <Bell className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="font-medium group-hover:underline">
                {d.unreadCount} unread notification{d.unreadCount === 1 ? "" : "s"}
              </p>
              <p className="text-sm text-muted-foreground">Replies, mentions, and updates waiting in your inbox.</p>
            </div>
          </Link>
        </Surface>
      )}

      {(d.followedThreads.total > 0 || d.followedGrows.total > 0) && (
        <Surface>
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <Leaf className="h-5 w-5 text-primary" /> Activity you follow
          </h2>
          <ul className="space-y-2 text-sm">
            {d.followedThreads.items.map((t) => (
              <li key={t.slug}>
                <Link href={`/forum/thread/${t.slug}`} className="hover:underline font-medium">
                  {t.title}
                </Link>
                <span className="text-muted-foreground"> — thread you follow had new activity</span>
              </li>
            ))}
            {d.followedThreads.total > d.followedThreads.items.length && (
              <li className="text-muted-foreground">
                +{d.followedThreads.total - d.followedThreads.items.length} more followed thread
                {d.followedThreads.total - d.followedThreads.items.length === 1 ? "" : "s"}
              </li>
            )}
            {d.followedGrows.items.map((g) => (
              <li key={g.href}>
                <Link href={g.href} className="hover:underline font-medium">
                  {g.title}
                </Link>
                <span className="text-muted-foreground">
                  {" "}— {g.updates} new update{g.updates === 1 ? "" : "s"} this week
                </span>
              </li>
            ))}
          </ul>
        </Surface>
      )}

      {d.questions.total > 0 && (
        <Surface>
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <HeartHandshake className="h-5 w-5 text-primary" /> Could use your help
          </h2>
          <ul className="space-y-2 text-sm">
            {d.questions.items.map((q) => (
              <li key={q.slug}>
                <Link href={`/forum/thread/${q.slug}`} className="hover:underline font-medium">
                  {q.title}
                </Link>
                <span className="text-muted-foreground"> — {helpWantedReasonText(q)}</span>
              </li>
            ))}
            {d.questions.total > d.questions.items.length && (
              <li>
                <Link href="/questions" className="text-primary hover:underline">
                  +{d.questions.total - d.questions.items.length} more question
                  {d.questions.total - d.questions.items.length === 1 ? "" : "s"} that match you
                </Link>
              </li>
            )}
          </ul>
        </Surface>
      )}

      {(d.openQuests.length > 0 || d.streak > 1) && (
        <Surface>
          <h2 className="font-semibold flex items-center gap-2 mb-3">
            <Target className="h-5 w-5 text-primary" /> Progress
          </h2>
          <ul className="space-y-1.5 text-sm">
            {d.openQuests.length > 0 && (
              <li>
                <Link href="/" className="hover:underline font-medium">
                  {d.openQuests.length} quest{d.openQuests.length === 1 ? "" : "s"} open
                </Link>
                <span className="text-muted-foreground">
                  {" "}(+{d.openQuests.reduce((n, q) => n + q.reward, 0)} XP)
                </span>
              </li>
            )}
            {d.streak > 1 && (
              <li className="flex items-center gap-1.5">
                <Flame className="h-4 w-4 text-orange-500" />
                {d.streak}-day update streak — keep it alive
              </li>
            )}
          </ul>
        </Surface>
      )}

      {d.highlight && (
        <Surface>
          <h2 className="font-semibold flex items-center gap-2 mb-2">
            <TrendingUp className="h-5 w-5 text-primary" /> Community highlight
          </h2>
          <Link href={`/forum/thread/${d.highlight.slug}`} className="text-sm font-medium hover:underline flex items-center gap-2">
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate">{d.highlight.title}</span>
          </Link>
        </Surface>
      )}
    </div>
  )
}
