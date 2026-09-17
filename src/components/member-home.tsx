import Link from "next/link"
import {
  Zap, Sprout, Bell, ArrowRight, Leaf, Users, Radio, TrendingUp, CheckCircle2, Circle,
} from "lucide-react"
import MemberGreeting from "@/components/member-greeting"
import OpenChatButton from "@/components/open-chat-button"
import type { MemberHomeData } from "@/lib/member-home"
import { cn } from "@/lib/utils"

// The signed-in "Today" homepage — a compact dashboard composing the
// member's progression, grows, followed activity, and live chat state.
// Guests never see this; src/app/page.tsx renders the marketing landing.

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function Card({
  icon,
  title,
  action,
  children,
}: {
  icon: React.ReactNode
  title: string
  action?: { href: string; label: string }
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0 bg-card rounded-xl border border-border p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h2>
        {action && (
          <Link
            href={action.href}
            className="shrink-0 text-xs font-medium text-primary inline-flex items-center gap-0.5 hover:underline"
          >
            {action.label} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

function MiniEmpty({ text, cta }: { text: string; cta?: { href: string; label: string } }) {
  return (
    <div className="rounded-lg bg-secondary/40 px-4 py-5 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {cta.label} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  )
}

export default function MemberHome({ data }: { data: MemberHomeData }) {
  const { sinceLastVisit: s } = data
  const hasActivity =
    s.unreadThreads.length > 0 || s.diaryUpdates.length > 0 || s.unreadNotifications > 0

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:py-8">
        {/* Header — greeting + standing, compact */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <MemberGreeting name={data.displayName} />
            <p className="mt-1 text-sm text-muted-foreground">
              Here&apos;s your TerpTalk day.
            </p>
          </div>
          <Link
            href="/progress"
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
              data.tier.bg,
              data.tier.color
            )}
            title="View your progress"
          >
            <span aria-hidden="true">{data.tier.icon}</span>
            Level {data.level} · {data.tier.name}
            <span className="font-normal opacity-80">· {data.rep} rep</span>
          </Link>
        </div>

        {/* Next action — the single most useful thing to do */}
        <Link
          href={data.nextAction.href}
          className="group mb-6 flex items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4 transition-colors hover:border-primary/60 hover:bg-primary/10 sm:p-5"
        >
          <span className="text-2xl" aria-hidden="true">{data.nextAction.icon}</span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
              Next up
            </p>
            <p className="truncate text-sm font-medium sm:text-base">{data.nextAction.text}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors group-hover:bg-primary/90">
            {data.nextAction.cta} <ArrowRight className="h-4 w-4" />
          </span>
        </Link>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Today's quests */}
          <Card
            icon={<Zap className="h-4 w-4 text-amber-500" />}
            title="Today's quests"
            action={{ href: "/progress", label: "All progress" }}
          >
            {data.quests.length === 0 ? (
              <MiniEmpty
                text="No quests today — check the leaderboard or help a grower."
                cta={{ href: "/leaderboard", label: "Leaderboard" }}
              />
            ) : (
              <ul className="space-y-2.5">
                {data.quests.map((q) => (
                  <li key={q.slug} className="flex items-center gap-3">
                    <span className="text-lg" aria-hidden="true">{q.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={cn("truncate text-sm font-medium", q.done && "text-muted-foreground line-through")}>
                          {q.title}
                        </p>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.min(100, Math.round((q.progress / q.target) * 100))}%` }}
                        />
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {q.done ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" aria-label="Done" />
                      ) : (
                        `${q.progress}/${q.target} · +${q.reward}`
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Your grows */}
          <Card
            icon={<Sprout className="h-4 w-4 text-primary" />}
            title="Your grows"
            action={data.grows.length > 0 ? { href: "/diaries", label: "All diaries" } : undefined}
          >
            {data.grows.length === 0 ? (
              <MiniEmpty
                text="No active grow diary — documenting your grow unlocks journey milestones and rep."
                cta={{ href: "/diaries/new", label: "Start your first grow diary" }}
              />
            ) : (
              <ul className="space-y-2.5">
                {data.grows.map((g) => (
                  <li key={g.id}>
                    <Link
                      href={`/diaries/${g.id}`}
                      className="block rounded-lg border border-border bg-secondary/30 p-3 transition-colors hover:border-primary/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium">{g.title}</p>
                        <span className="shrink-0 text-xs">{g.stageLabel}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {g.journey?.next
                          ? `Next: ${g.journey.next.name} — ${g.journey.next.summary}`
                          : "Journey complete"}{" "}
                        · {g.updates} update{g.updates === 1 ? "" : "s"} · {timeAgo(g.updatedAt)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Since your last visit */}
          <Card
            icon={<Bell className="h-4 w-4 text-primary" />}
            title="Since your last visit"
            action={{ href: "/notifications", label: "Notifications" }}
          >
            {!hasActivity ? (
              <MiniEmpty
                text="You're all caught up — nothing new on threads or grows you follow."
                cta={{ href: "/discover", label: "Discover what's happening" }}
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {s.unreadNotifications > 0 && (
                  <li>
                    <Link
                      href="/notifications"
                      className="flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-2 font-medium text-primary hover:bg-primary/15"
                    >
                      <Bell className="h-3.5 w-3.5 shrink-0" />
                      {s.unreadNotifications} unread notification{s.unreadNotifications === 1 ? "" : "s"}
                    </Link>
                  </li>
                )}
                {s.unreadThreads.map((t) => (
                  <li key={t.slug}>
                    <Link
                      href={`/forum/thread/${t.slug}`}
                      className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-secondary/60"
                    >
                      <Circle className="h-2 w-2 shrink-0 fill-primary text-primary" aria-label="New activity" />
                      <span className="min-w-0 flex-1 truncate group-hover:text-primary">{t.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{t.category}</span>
                    </Link>
                  </li>
                ))}
                {s.unreadThreadCount > s.unreadThreads.length && (
                  <li>
                    <Link
                      href="/forum"
                      className="block px-3 py-1.5 text-xs text-muted-foreground hover:text-primary"
                    >
                      +{s.unreadThreadCount - s.unreadThreads.length} more thread
                      {s.unreadThreadCount - s.unreadThreads.length === 1 ? "" : "s"} with new activity
                    </Link>
                  </li>
                )}
                {s.diaryUpdates.map((u, i) => (
                  <li key={`${u.diaryId}-${i}`}>
                    <Link
                      href={`/diaries/${u.diaryId}`}
                      className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-secondary/60"
                    >
                      <Leaf className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      <span className="min-w-0 flex-1 truncate group-hover:text-primary">
                        {u.title} <span className="text-muted-foreground">— {u.diaryTitle}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Live now */}
          <Card icon={<Radio className="h-4 w-4 text-emerald-500" />} title="Live now">
            {data.live ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="font-medium">{data.live.onlineCount}</span>{" "}
                    grower{data.live.onlineCount === 1 ? "" : "s"} online
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {data.live.latestAt
                    ? <>Last message in <span className="font-medium text-foreground">#{data.live.roomName}</span> {timeAgo(data.live.latestAt)}</>
                    : <>#{data.live.roomName} is quiet — be the first to say hi.</>}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <OpenChatButton />
                  <Link
                    href="/discover"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <TrendingUp className="h-4 w-4" aria-hidden="true" />
                    Discover
                  </Link>
                </div>
              </div>
            ) : (
              <MiniEmpty
                text="The community is quiet right now — start a conversation."
                cta={{ href: "/chat", label: "Open chat" }}
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
