import Link from "next/link"
import type { ReactNode } from "react"
import {
  Zap, Sprout, Bell, ArrowRight, Leaf, Users, Radio, TrendingUp, CheckCircle2, Circle,
  MessageCircle, Eye, AlertTriangle, Gauge, Bug, Wrench, Clock, Wheat, FlaskConical, BookOpen,
} from "lucide-react"
import MemberGreeting from "@/components/member-greeting"
import OpenChatButton from "@/components/open-chat-button"
import Tooltip, { InfoTip } from "@/components/ui/tooltip"
import EmptyState from "@/components/ui/empty-state"
import StageProgress from "@/components/stage-progress"
import type { MemberHomeData } from "@/lib/member-home"
import { diaryPath } from "@/lib/slugs"
import { cn } from "@/lib/utils"

// The signed-in "Today" homepage — a compact dashboard composing the
// member's progression, grows, followed activity, and live chat state.
// Guests never see this; src/app/(home)/page.tsx renders the marketing landing.

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
  tip,
  action,
  children,
}: {
  icon: React.ReactNode
  title: string
  tip?: string
  action?: { href: string; label: string }
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0 tt-spotlight bg-card/80 rounded-2xl border border-border/70 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
          {icon}
          {title}
          {tip && <InfoTip content={tip} />}
        </h2>
        {action && (
          <Link
            href={action.href}
            className="tap-target shrink-0 text-xs font-medium text-primary inline-flex items-center gap-0.5 hover:underline"
          >
            {action.label} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </div>
      {children}
    </section>
  )
}

function MiniEmpty({ text, cta, children }: { text: string; cta?: { href: string; label: string }; children?: ReactNode }) {
  return (
    <EmptyState
      compact
      title={text}
      action={cta ? { href: cta.href, label: cta.label } : undefined}
    >
      {children}
    </EmptyState>
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
          <Tooltip content="View your progress" side="bottom">
            <Link
              href="/progress"
              className={cn(
                "tap-target inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold",
                data.tier.bg,
                data.tier.color
              )}
            >
              <span aria-hidden="true">{data.tier.icon}</span>
              Level {data.level} · {data.tier.name}
              <span className="font-normal opacity-80">· {data.rep} rep</span>
            </Link>
          </Tooltip>
        </div>

        {/* Next action — the single most useful thing to do */}
        <Link
          href={data.nextAction.href}
          className="group relative mb-6 flex items-center gap-4 overflow-hidden rounded-2xl border border-primary/30 bg-primary/5 p-4 transition-colors hover:border-primary/60 hover:bg-primary/10 sm:p-5"
        >
          <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary via-spectrum to-amber-500" aria-hidden="true" />
          <span className="text-2xl" aria-hidden="true">{data.nextAction.icon}</span>
          <div className="min-w-0 flex-1">
            <Tooltip content="Suggested next step — picked from your progress and activity">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                Next up
              </p>
            </Tooltip>
            <p className="truncate text-sm font-medium sm:text-base">{data.nextAction.text}</p>
          </div>
          <span className="tt-cta inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold text-primary-foreground transition-all">
            {data.nextAction.cta} <ArrowRight className="h-4 w-4" />
          </span>
        </Link>

        {/* Needs attention — deterministic grow signals, not notifications */}
        {data.attention.length > 0 && (
          <section className="mb-6 bg-card/80 rounded-2xl border border-warning/30 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
                <AlertTriangle className="h-4 w-4 text-warning" />
                Needs attention
                <InfoTip content="Signals from the deterministic grow engine — out-of-band readings, open symptom reports, pending adjustments and stale logs. Not notifications; nothing here is manufactured." />
              </h2>
            </div>
            <ul className="space-y-1.5">
              {data.attention.map((a, i) => (
                <li key={`${a.diaryId}-${i}`}>
                  <Link
                    href={a.href}
                    className="group flex items-center gap-2.5 rounded-xl px-3 py-2 hover:bg-secondary/60"
                  >
                    {a.kind === "concern" ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-label="Reading out of range" />
                    ) : a.kind === "episode" ? (
                      <Bug className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Open symptom report" />
                    ) : a.kind === "due" ? (
                      <Gauge className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Measurement due" />
                    ) : a.kind === "intervention" ? (
                      <Wrench className="h-3.5 w-3.5 shrink-0 text-spectrum" aria-label="Adjustment awaiting follow-up" />
                    ) : a.kind === "experiment" ? (
                      <FlaskConical className="h-3.5 w-3.5 shrink-0 text-primary" aria-label="Experiment awaiting observation" />
                    ) : (
                      <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Diary going stale" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {a.text}
                      <span className="text-muted-foreground"> — {a.diaryTitle}</span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {/* Today's quests */}
          <Card
            icon={<Zap className="h-4 w-4 text-warning" />}
            title="Today's quests"
            tip="Small optional tasks that refresh daily — each pays the listed reputation. Hover a quest to see how to complete it."
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
                        <Tooltip content={q.description} align="start" className="min-w-0">
                          <p className={cn("truncate text-sm font-medium", q.done && "text-muted-foreground line-through")}>
                            {q.title}
                          </p>
                        </Tooltip>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary to-spectrum transition-all"
                          style={{ width: `${Math.min(100, Math.round((q.progress / q.target) * 100))}%` }}
                        />
                      </div>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {q.done ? (
                        <CheckCircle2 className="h-4 w-4 text-primary" aria-label="Done" />
                      ) : (
                        <Tooltip content={`+${q.reward} reputation on completion`}>
                          {`${q.progress}/${q.target} · +${q.reward}`}
                        </Tooltip>
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
            tip="Your active grow diaries — stage, age, latest readings and what the deterministic engine suggests next."
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
                      href={diaryPath(g)}
                      className="flex items-start gap-3 rounded-xl border border-border/70 bg-secondary/30 p-3 transition-colors hover:border-primary/40"
                    >
                      {g.photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={g.photo}
                          alt=""
                          className="h-14 w-14 shrink-0 rounded-lg border border-border/50 object-cover"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-medium">{g.title}</p>
                          <Tooltip
                            content={
                              g.journey?.next
                                ? `Journey: next milestone is ${g.journey.next.name} — ${g.journey.next.summary}`
                                : "Grow journey complete"
                            }
                            align="end"
                          >
                            <span className="shrink-0 text-xs">{g.stageLabel}</span>
                          </Tooltip>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground" suppressHydrationWarning>
                          {[
                            g.strain?.name,
                            g.day != null ? `day ${g.day}` : null,
                            g.week != null && g.week > 0 ? `wk ${g.week}` : null,
                            g.latestReading,
                            g.activeExperiments > 0
                              ? `${g.activeExperiments} experiment${g.activeExperiments === 1 ? "" : "s"}`
                              : null,
                            timeAgo(g.updatedAt),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <StageProgress stage={g.stage} className="mt-1.5" />
                        {/* Log completeness — the owner-facing documentation
                            signal, same metric as the diary hero. */}
                        <div className="mt-1.5 flex items-center gap-1.5" title="Log completeness">
                          <span className="h-1 w-16 overflow-hidden rounded-full bg-secondary">
                            <span
                              className={cn("block h-full rounded-full", g.completeness >= 80 ? "bg-success" : "bg-primary/70")}
                              style={{ width: `${g.completeness}%` }}
                            />
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {g.completeness >= 80 ? "Well documented" : `${g.completeness}% logged`}
                          </span>
                        </div>
                        {g.nextStep && (
                          <p className={cn(
                            "mt-1 truncate text-xs",
                            g.flagCount > 0 ? "text-foreground/90" : "text-muted-foreground"
                          )}>
                            <span className={cn(
                              "mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle",
                              g.flagCount > 0 ? "bg-warning" : "bg-primary"
                            )} aria-hidden="true" />
                            {g.nextStep}
                          </p>
                        )}
                      </div>
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
            tip="New activity on threads and grow diaries you follow, plus unread notifications."
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
                      className="flex items-center gap-2 rounded-xl bg-primary/10 px-3 py-2 font-medium text-primary hover:bg-primary/15"
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
                      className="group flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-secondary/60"
                    >
                      <Tooltip content="New activity since your last visit">
                        <Circle className="h-2 w-2 shrink-0 fill-primary text-primary" aria-label="New activity" />
                      </Tooltip>
                      <span className="min-w-0 flex-1 truncate group-hover:text-primary">{t.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{t.category}</span>
                    </Link>
                  </li>
                ))}
                {s.unreadThreadCount > s.unreadThreads.length && (
                  <li>
                    <Link
                      href="/forum"
                      className="tap-target block px-3 py-1.5 text-xs text-muted-foreground hover:text-primary"
                    >
                      +{s.unreadThreadCount - s.unreadThreads.length} more thread
                      {s.unreadThreadCount - s.unreadThreads.length === 1 ? "" : "s"} with new activity
                    </Link>
                  </li>
                )}
                {s.diaryUpdates.map((u, i) => (
                  <li key={`${u.diaryId}-${i}`}>
                    <Link
                      href={diaryPath({ id: u.diaryId, slug: u.diarySlug })}
                      className="group flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-secondary/60"
                    >
                      <Leaf className="h-3.5 w-3.5 shrink-0 text-success" />
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
          <Card
            icon={<Radio className="h-4 w-4 text-success" />}
            title="Live now"
            tip="Real-time community activity — who's online and the latest chat message."
          >
            {data.live ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Tooltip content="Members active on TerpTalk in the last 15 minutes">
                    <span>
                      <span className="font-medium">{data.live.onlineCount}</span>{" "}
                      grower{data.live.onlineCount === 1 ? "" : "s"} online
                    </span>
                  </Tooltip>
                </div>
                <p className="text-sm text-muted-foreground" suppressHydrationWarning>
                  {data.live.latestAt
                    ? <>Last message in <span className="font-medium text-foreground">#{data.live.roomName}</span> {timeAgo(data.live.latestAt)}</>
                    : <>#{data.live.roomName} is quiet — be the first to say hi.</>}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <OpenChatButton />
                  <Link
                    href="/discover"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <TrendingUp className="h-4 w-4" aria-hidden="true" />
                    Discover
                  </Link>
                </div>
              </div>
            ) : (
              <MiniEmpty text="The community is quiet right now — start a conversation.">
                <OpenChatButton className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline" />
              </MiniEmpty>
            )}
          </Card>
        </div>

        {/* Grow knowledge — the member's own documented history:
            experiments, techniques, strains. Real rows only; hidden when
            there's nothing recorded yet. */}
        {data.knowledge && (
          <section className="mt-4 tt-spotlight bg-card/80 rounded-2xl border border-border/70 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
                <BookOpen className="h-4 w-4 text-primary" />
                Your grow knowledge
                <InfoTip content="Aggregated from your own diaries — experiments you've documented, techniques you've logged, strains you've run. Your records, not generated advice." />
              </h2>
            </div>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-3 text-sm">
              {data.knowledge.experimentsTotal > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Experiments</p>
                  <p className="mb-1.5">
                    {data.knowledge.experimentsTotal} recorded
                    {data.knowledge.experimentsOpen > 0 && (
                      <span className="text-muted-foreground"> · {data.knowledge.experimentsOpen} open</span>
                    )}
                  </p>
                  <ul className="space-y-1">
                    {data.knowledge.experimentCategories.map((c) => (
                      <li key={c.label} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <FlaskConical className="h-3 w-3 shrink-0" />
                        {c.label} <span className="tabular-nums">×{c.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.knowledge.techniques.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Techniques used</p>
                  <ul className="space-y-1">
                    {data.knowledge.techniques.map((t) => (
                      <li key={t.label}>
                        <Link
                          href={diaryPath({ id: t.diaryId, slug: t.diarySlug })}
                          className="flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
                        >
                          <Sprout className="h-3 w-3 shrink-0" />
                          {t.label} <span className="tabular-nums">×{t.count}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.knowledge.strains.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Strains grown</p>
                  <ul className="space-y-1">
                    {data.knowledge.strains.map((s) => (
                      <li key={s.name} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Leaf className="h-3 w-3 shrink-0" />
                        <span className="truncate">{s.name}</span> <span className="tabular-nums">×{s.count}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Around your grows — community activity tied to what you're growing */}
        {(data.aroundGrows.threads.length > 0 || data.aroundGrows.harvests.length > 0) && (
          <section className="mt-4 tt-spotlight bg-card/80 rounded-2xl border border-border/70 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
                <Leaf className="h-4 w-4 text-primary" />
                Around your grows
                <InfoTip content="Discussions and harvested community grows for the strains you're running right now." />
              </h2>
            </div>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <ul className="space-y-1.5">
                {data.aroundGrows.threads.map((t) => (
                  <li key={t.slug}>
                    <Link
                      href={`/forum/thread/${t.slug}`}
                      className="group flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-secondary/60"
                    >
                      <MessageCircle className="h-3.5 w-3.5 shrink-0 text-spectrum" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm group-hover:text-primary">{t.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <ul className="space-y-1.5">
                {data.aroundGrows.harvests.map((h) => (
                  <li key={h.id}>
                    <Link
                      href={diaryPath(h)}
                      className="group flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-secondary/60"
                    >
                      <Wheat className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-sm group-hover:text-primary">
                        {h.title}
                        <span className="text-muted-foreground"> — {h.strainName}</span>
                      </span>
                      {h.yieldText && (
                        <span className="shrink-0 text-xs text-muted-foreground">{h.yieldText}</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Community pulse — trending threads make the cockpit feel alive */}
        {data.trending.length > 0 && (
          <section className="mt-6 tt-spotlight bg-card/80 rounded-2xl border border-border/70 p-4 sm:p-5">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 font-display text-sm font-semibold">
                <TrendingUp className="h-4 w-4 text-spectrum" />
                Community pulse
                <InfoTip content="Trending discussions from the past week — ranked by activity velocity." />
              </h2>
              <Link
                href="/discover"
                className="tap-target shrink-0 text-xs font-medium text-primary inline-flex items-center gap-0.5 hover:underline"
              >
                Discover more <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {data.trending.map((t) => (
                <Link
                  key={t.slug}
                  href={`/forum/thread/${t.slug}`}
                  className="group flex items-start gap-3 rounded-xl border border-border/60 bg-secondary/30 p-3 transition-colors hover:border-primary/40 hover:bg-secondary/50"
                >
                  <TrendingUp className="h-4 w-4 shrink-0 mt-0.5 text-spectrum" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium line-clamp-1 group-hover:text-primary">{t.title}</p>
                    <p className="mt-0.5 flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="text-primary">{t.category}</span>
                      <span>{t.authorName}</span>
                      <span className="inline-flex items-center gap-0.5"><MessageCircle className="h-3 w-3" />{t.replyCount}</span>
                      <span className="inline-flex items-center gap-0.5"><Eye className="h-3 w-3" />{t.views}</span>
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
