"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { useSession } from "next-auth/react"
import { useParams } from "next/navigation"
import { User, MessageSquare, MapPin, Globe, Sprout, Dna, Leaf, Store, ChevronDown, ChevronUp, Bot, Zap, Users, Link2, HandMetal, CalendarClock, TrendingUp, BookOpen, Trophy, BarChart3, AlertTriangle, Megaphone, Wrench, Award, Pin, FlaskConical, BadgeCheck, Target, CheckCircle2, X, Sparkles, ShieldCheck, Dices, AtSign, Terminal } from "@/lib/icons"
import Link from "next/link"
import UserActions from "@/components/user-actions"
import RoleBadge from "@/components/role-badge"
import AchievementBadge from "@/components/achievement-badge"
import { Avatar } from "@/components/ui/avatar"
import Tooltip from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import Tabs from "@/components/ui/tabs"
import StatStrip from "@/components/ui/stat-strip"
import SectionCard from "@/components/ui/section-card"
import EmptyState from "@/components/ui/empty-state"
import TimeAgo from "@/components/ui/time-ago"
import Tag from "@/components/ui/tag"
import TerpBotInsights from "@/components/terpbot-insights"
import { MarkdownRenderer } from "@/lib/markdown"
import { diaryPath, setupPath } from "@/lib/slugs"
import { STAGE_LABELS } from "@/lib/diary-weeks"
import { PROFILE_TAB_IDS } from "@/lib/profile-settings"
import { CHAT_COMMANDS, type ChatCommandCategory } from "@/lib/chat-commands"
import { cn } from "@/lib/utils"

interface GrowCard {
  id: string
  slug: string | null
  title: string
  strain: string | null
  stage: string
  harvested: boolean
  day: number | null
  updates: number
  visibility: string
  updatedAt: string
  startDate: string | null
  image?: string | null
  /** Real logged stage transitions (oldest → newest) — section pages only. */
  stages?: string[]
}

interface HarvestRow extends GrowCard {
  harvestedAt: string | null
  yieldAmount: number | null
  yieldUnit: string | null
  yieldPrivate?: boolean
}

interface FollowRow {
  id: string
  username: string
  avatarUrl: string | null
  rank: { name: string; icon: string; color: string }
  buildTitle: string | null
}

interface StrainRow {
  id: string
  name: string
  slug: string | null
  grows: number
}

interface ExperimentCard {
  id: string
  title: string
  change: string
  category: string
  status: string
  outcome: string | null
  conclusion: string | null
  startedAt: string
  endedAt: string | null
  diary: { id: string; slug: string | null; title: string }
}

interface AcceptedAnswer {
  id: string
  threadSlug: string | null
  threadTitle: string
  createdAt: string
}

interface NotableStat {
  id: string
  label: string
  value: string
  hint?: string
}

interface PublicProfile {
  id: string
  role: string
  username: string
  isBot?: boolean
  bio: string | null
  location: string | null
  website: string | null
  avatarUrl: string | null
  growExperience: string | null
  favoriteStrain: string | null
  growSpace: string | null
  businessName: string | null
  businessType: string | null
  businessUrl: string | null
  image: string | null
  joinDate: string
  xp: number
  standingTier?: { name: string; icon: string; color: string; bg: string } | null
  rank: { name: string; color: string; bg: string; icon: string; benefit: string; nameplate?: string }
  rankProgress: { current: number; next: number; percent: number }
  xpStage?: { level: number; stageName: string; stageIndex: number; stageCount: number; stageStart: number; stageEnd: number }
  stageProgress?: { current: number; next: number; percent: number; remaining: number }
  buildTitle: string | null
  verified: "legacy" | "progression" | null
  nextUnlock: { id: string; name: string; rank: string; xpNeeded: number } | null
  statusHidden: boolean
  mastery: { mastery: string; name: string; icon: string; xp: number; level: number; live: boolean }[]
  notableStats: NotableStat[]
  pinnedHarvest: {
    id: string; slug: string | null; title: string; strain: string | null
    harvestedAt: string | null; updatedAt: string
  } | null
  featuredGrow: GrowCard | null
  activeGrow: GrowCard | null
  experiments: ExperimentCard[]
  acceptedAnswersList: AcceptedAnswer[]
  strainPortfolio: StrainRow[]
  strainTotal: number
  equipmentChips: string[]
  harvestHighlights: {
    firstHarvestAt: string | null
    latestHarvestAt: string | null
    longestGrowDays: number
    mostGrownStrain: { name: string; grows: number } | null
    repeatStrains: number
    harvestCount: number
  } | null
  harvestYears: number[]
  customSections: { id: string; title: string; body: string; order: number; visibility: string }[]
  badges: Array<{ name: string; description: string; icon: string | null; pinned: boolean }>
  stats: {
    threadCreator: number
    posts: number
    diaryCreator: number
    followers: number
    following: number
    acceptedAnswers: number
    strainsGrown: number
    harvestCount: number
    activeGrows: number
    experiments: number
    setups: number
    contestWins: number
    detailedUpdates: number
    documentedWeeks: number
  }
  botStats?: {
    commands: number; membersAssisted: number; entityLinks: number; welcomes: number
    announcements: number; daysActive: number; assists: number
    byCommand: Record<string, number>; hasFallbacks: boolean
    mentions: number; unknownCommands: number; fallbacks: number
  } | null
  growStreak: number
  totalUpdates: number
  harvestedDiaries: number
  records: {
    longestGrowDays: number
    biggestYield: { title: string; amount: number; unit: string | null } | null
    growingSince: string | null
  } | null
  ownerInsights: { newFollowers: number; updatesLogged: number; growsStarted: number } | null
  profileSettings: {
    bannerImage: string | null
    accent: string
    theme: string
    density: string
    sectionOrder: string[]
    shownStats: string[]
    pinnedSection: string | null
    hiddenSections: string[]
    identity: { mediums: string[]; styles: string[]; goals: string }
  }
}

interface Thread {
  id: string
  title: string
  slug: string
  createdAt: string
  category: { name: string }
  replyCount: number
}

interface GrowDiary {
  id: string
  slug: string | null
  title: string
  strain: string | null
  stage: string
  featured: boolean
  _count: { updates: number; followers: number }
}

interface GrowSetup {
  id: string
  slug: string | null
  title: string
  strain: string | null
  images: { url: string }[]
  _count: { comments: number }
}

interface HarvestEntry {
  id: string
  slug: string | null
  title: string
  strain: string | null
  startDate: string
  harvestedAt: string | null
  yieldAmount: number | null
  yieldUnit: string | null
  _count: { updates: number }
}

interface ProgressionItem {
  id: string
  label: string
  amount: number
  reversed: boolean
  createdAt: string
}

interface ProfileResponse {
  profile: PublicProfile
  viewerBlocked: boolean
  viewerFollowing: boolean
  viewerLoggedIn: boolean
  recentThreads: Thread[]
  growDiaries: GrowDiary[]
  growSetups: GrowSetup[]
  harvestShelf: HarvestEntry[]
  recentProgression: ProgressionItem[]
}

export default function ProfileClient({ initial }: { initial?: ProfileResponse | null }) {
  const params = useParams()
  const { data: session } = useSession()
  const username = decodeURIComponent(String(params.username))
  const [data, setData] = useState<ProfileResponse | null>(initial ?? null)
  const [loading, setLoading] = useState(!initial)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    // The page server-renders the payload — only fetch when no initial data
    // was provided (direct client-side navigation fallback).
    if (initial) return
    fetch(`/api/users/${encodeURIComponent(username)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) { setNotFound(true); setLoading(false); return }
        const d = await res.json()
        setData(d)
        setLoading(false)
      })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [username, initial])

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <span className="sr-only" role="status">Loading profile…</span>
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-5 overflow-hidden">
            <div className="tt-spectrum-bar -mx-4 -mt-4 mb-4 h-1 opacity-60" />
            <div className="flex items-start gap-4">
              <Skeleton className="w-20 h-20 rounded-full shrink-0" />
              <div className="flex-1 min-w-0 space-y-3">
                <Skeleton className="h-7 w-48" />
                <Skeleton className="h-4 w-64 max-w-full" />
                <Skeleton className="h-4 w-full max-w-md" />
                <div className="flex gap-2 pt-1">
                  <Skeleton className="h-6 w-20 rounded-full" />
                  <Skeleton className="h-6 w-24 rounded-full" />
                  <Skeleton className="h-6 w-16 rounded-full" />
                </div>
              </div>
            </div>
          </div>
          <div className="flex gap-2 mb-5">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-9 w-24 rounded-full" />)}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="bg-card/80 rounded-2xl border border-border/70 p-4 space-y-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="font-display text-2xl font-bold mb-2 tracking-tight">User not found</h1>
          <p className="text-muted-foreground">This profile doesn&apos;t exist or isn&apos;t available.</p>
        </div>
      </div>
    )
  }

  const { profile } = data
  if (profile.isBot) {
    return <BotProfile data={data} />
  }
  return <MemberProfile data={data} isSelf={session?.user?.id === profile.id} username={username} />
}

/* ── Shared bits ─────────────────────────────────────────────────── */

function VisibilityTag({ visibility }: { visibility: string }) {
  // Owner-scope marker — visitors never receive non-PUBLIC rows, so this
  // chip only ever renders on the member's own profile.
  if (visibility === "PUBLIC") return null
  return (
    <Tag variant="muted" className="shrink-0">
      {visibility === "UNLISTED" ? "Unlisted" : "Only you"}
    </Tag>
  )
}

function GrowRow({ grow }: { grow: GrowCard }) {
  return (
    <Link
      href={diaryPath(grow)}
      className="flex items-center gap-3 rounded-xl p-2 -m-2 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {grow.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={grow.image} alt="" loading="lazy" decoding="async" className="w-11 h-11 rounded-xl object-cover shrink-0 bg-primary/10" />
      ) : (
        <div className="w-11 h-11 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
          <Sprout className="w-5 h-5 text-primary" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm truncate">{grow.title}</p>
        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <span className="px-1.5 py-0.5 bg-secondary rounded text-[10px]">
            {STAGE_LABELS[grow.stage] ?? grow.stage.toLowerCase()}
          </span>
          {grow.day != null && <span>day {grow.day}</span>}
          {grow.strain && <span className="truncate">{grow.strain}</span>}
          <span>{grow.updates} update{grow.updates === 1 ? "" : "s"}</span>
          <TimeAgo value={grow.updatedAt} />
        </div>
        {/* Real recorded stage transitions — only stages the member logged;
            nothing fabricated for undocumented gaps. */}
        {grow.stages && grow.stages.length > 1 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap" aria-label="Recorded grow stages">
            {grow.stages.map((s, i) => (
              <span key={s} className="flex items-center gap-1">
                {i > 0 && <span className="text-muted-foreground/60 text-[9px]" aria-hidden="true">→</span>}
                <span className="text-[10px] text-muted-foreground">{STAGE_LABELS[s] ?? s.toLowerCase()}</span>
              </span>
            ))}
          </div>
        )}
      </div>
      <VisibilityTag visibility={grow.visibility} />
    </Link>
  )
}

function LoadMore({ loading, done, onMore }: { loading: boolean; done: boolean; onMore: () => void }) {
  if (done) return null
  return (
    <div className="pt-3 text-center">
      <button
        type="button"
        onClick={onMore}
        disabled={loading}
        className="inline-flex items-center gap-1.5 rounded-full bg-secondary/70 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  )
}

/** Cursor-paged tab list — fetches page 1 on first open, then appends.
    `query` carries deterministic filter params; results are keyed by
    section+query so a filter change never merges with the previous set —
    stale pages render as empty until the fresh fetch lands. */
function useProfileSection<T extends { id: string }>(username: string, section: string, active: boolean, query = "") {
  const fetchKey = `${section}|${query}`
  const [state, setState] = useState<{ key: string; items: T[]; cursor: string | null }>({
    key: fetchKey, items: [], cursor: null,
  })
  const [fetching, setFetching] = useState(active)
  const startedKey = useRef<string | null>(null)

  const load = useCallback(
    (c?: string) => {
      setFetching(true)
      const suffix = `${query}${c ? `${query ? "&" : ""}cursor=${encodeURIComponent(c)}` : ""}`
      fetch(`/api/users/${encodeURIComponent(username)}/sections/${section}${suffix ? `?${suffix}` : ""}`, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return
          const page = await res.json()
          setState((prev) => ({
            key: fetchKey,
            items: c && prev.key === fetchKey ? [...prev.items, ...page.items] : page.items,
            cursor: page.nextCursor,
          }))
        })
        .finally(() => setFetching(false))
    },
    [username, section, query, fetchKey]
  )

  useEffect(() => {
    if (active && startedKey.current !== fetchKey) {
      startedKey.current = fetchKey
      load()
    }
  }, [active, fetchKey, load])

  const items = state.key === fetchKey ? state.items : []
  const cursor = state.key === fetchKey ? state.cursor : null
  return { items, loading: fetching || state.key !== fetchKey, hasMore: !!cursor, loadMore: () => cursor && load(cursor) }
}

/* ── Member profile ──────────────────────────────────────────────── */

const TAB_LABELS: Record<string, string> = {
  grows: "Grows",
  harvests: "Harvests",
  contributions: "Contributions",
  about: "About",
}

const GROW_STAGE_OPTIONS = ["GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER", "HARVEST", "DRYING", "CURING", "COMPLETED"]

const filterSelect =
  "rounded-full border border-border/70 bg-background px-2.5 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function MemberProfile({ data, isSelf, username }: { data: ProfileResponse; isSelf: boolean; username: string }) {
  const { profile, viewerBlocked, viewerFollowing, recentThreads, growSetups, recentProgression } = data
  const joinDate = new Date(profile.joinDate).toLocaleDateString("en-US", { year: "numeric", month: "long" })
  const [showAllBadges, setShowAllBadges] = useState(false)
  const [tab, setTab] = useState("overview")
  // P3 — deterministic portfolio filters (server-validated columns only)
  // + strain see-all + follow-list dialog state.
  const [growStatus, setGrowStatus] = useState<"" | "active" | "completed">("")
  const [growStrain, setGrowStrain] = useState("")
  const [growStage, setGrowStage] = useState("")
  const [harvestStrain, setHarvestStrain] = useState("")
  const [harvestYear, setHarvestYear] = useState("")
  const [showAllStrains, setShowAllStrains] = useState(false)
  const [followList, setFollowList] = useState<"followers" | "following" | null>(null)

  const settings = profile.profileSettings
  // Compact density — tighter spacing, same information architecture.
  const compact = settings.density === "compact"
  const heroGrow = profile.featuredGrow ?? profile.activeGrow
  const heroGrowLabel = profile.featuredGrow ? "Featured grow" : "Currently growing"
  const pinnedSection = settings.pinnedSection
    ? profile.customSections.find((s) => s.id === settings.pinnedSection) ?? null
    : null
  const hidden = new Set(settings.hiddenSections)
  const maxMasteryXp = Math.max(1, ...profile.mastery.map((m) => m.xp))
  const focusMastery = profile.mastery.reduce((top, m) => (m.xp > (top?.xp ?? -1) ? m : top), profile.mastery[0])
  const heroStats = profile.notableStats.slice(0, 4)

  const growsQuery = [
    growStatus ? `status=${growStatus}` : "",
    growStrain ? `strain=${encodeURIComponent(growStrain)}` : "",
    growStage ? `stage=${encodeURIComponent(growStage)}` : "",
  ].filter(Boolean).join("&")
  const harvestsQuery = [
    harvestStrain ? `strain=${encodeURIComponent(harvestStrain)}` : "",
    harvestYear ? `year=${encodeURIComponent(harvestYear)}` : "",
  ].filter(Boolean).join("&")
  const growsSection = useProfileSection<GrowCard>(username, "grows", tab === "grows", growsQuery)
  const harvestsSection = useProfileSection<HarvestRow>(username, "harvests", tab === "harvests", harvestsQuery)
  const strainsSection = useProfileSection<StrainRow>(username, "strains", showAllStrains)
  const followSection = useProfileSection<FollowRow>(username, followList ?? "followers", !!followList)

  // Dialog a11y — Escape closes.
  useEffect(() => {
    if (!followList) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFollowList(null) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [followList])

  const show = (id: string) => !hidden.has(id)

  // Member-reorderable tab strip — overview is required and always first;
  // hidden tabs are removed entirely (a hidden tab can never deep-link in).
  const orderedTabIds = [
    "overview",
    ...settings.sectionOrder.filter((id): id is (typeof PROFILE_TAB_IDS)[number] =>
      (PROFILE_TAB_IDS as readonly string[]).includes(id)),
  ].filter((id) => id === "overview" || show(id))
  const tabItems = orderedTabIds.map((id) =>
    id === "overview"
      ? { id, label: "Overview" }
      : id === "grows"
        ? { id, label: <>Grows <span className="opacity-60 text-xs tabular-nums">{profile.stats.diaryCreator}</span></> }
        : id === "harvests"
          ? { id, label: <>Harvests <span className="opacity-60 text-xs tabular-nums">{profile.stats.harvestCount}</span></> }
          : { id, label: TAB_LABELS[id] },
  )

  // ── Ordered Overview blocks ────────────────────────────────────────
  // sectionOrder positions the fixed overview blocks; hidden blocks drop
  // out; gated widgets render only when their data is actually shipped.
  const featuredBlock = profile.featuredGrow && show("featured") && (
    <SectionCard title="Featured grow" id="featured-grow" compact={compact}>
      <GrowRow grow={profile.featuredGrow} />
    </SectionCard>
  )

  const statsBlock = show("stats") && (
    <>
      {/* Mastery map — "what kind of grower am I becoming".
          Relative share bars, not five competing currencies. Empty for
          members who opted out of public status display (server ships []). */}
      {profile.mastery.length > 0 && (
      <SectionCard
        title="Grower profile"
        id="mastery-map"
        compact={compact}
        description={focusMastery && focusMastery.xp > 0 ? `Leaning ${focusMastery.name} — ${profile.mastery.filter((m) => m.live).length} live paths` : undefined}
      >
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {profile.mastery.map((m) => (
            <li key={m.mastery} className="min-w-0">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span aria-hidden="true">{m.icon}</span>
                  <span className="truncate">{m.name}</span>
                  {m === focusMastery && m.xp > 0 && <Tag variant="primary">Focus</Tag>}
                  {!m.live && <Tag variant="muted">Soon</Tag>}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                  {m.live ? `M${m.level}` : "—"}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-secondary overflow-hidden" role="img" aria-label={`${m.name} share of profile XP`}>
                <div
                  className="h-full rounded-full bg-primary/70 transition-all"
                  style={{ width: `${Math.round((m.xp / maxMasteryXp) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
      )}

      {/* Expanded stats — the full ≤8 registry beyond the hero 4 */}
      {profile.notableStats.length > heroStats.length && (
        <SectionCard title="At a glance" id="profile-stats" compact={compact}>
          <StatStrip
            className="sm:grid-cols-4"
            items={profile.notableStats.map((s) => ({ label: s.label, value: s.value, hint: s.hint }))}
          />
        </SectionCard>
      )}

      {/* Progression — informative, never the point of the page. Server
          nulls rank/xp fields for opt-outs, so the whole card drops out. */}
      {profile.rank && profile.rankProgress && (
      <SectionCard title="Progression" id="progression" compact={compact} actions={<Link href="/reputation" className="text-xs text-primary hover:underline">How it works</Link>}>
        <div className="flex items-center gap-2 flex-wrap text-sm mb-2">
          <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", profile.rank.bg, profile.rank.color)}>
            <span aria-hidden="true">{profile.rank.icon}</span> {profile.rank.name}
          </span>
          {profile.xpStage && (
            <span className="text-xs text-muted-foreground">
              Grow Level {profile.xpStage.level} · {profile.xpStage.stageName} · stage {profile.xpStage.stageIndex + 1} of {profile.xpStage.stageCount}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
          <span>
            {profile.stageProgress && profile.stageProgress.next > 0
              ? <>{profile.stageProgress.current} / {profile.stageProgress.next} XP to next stage</>
              : <>{profile.xp ?? 0} XP — top of the ladder</>}
          </span>
          <span>{profile.stageProgress?.percent ?? profile.rankProgress.percent}%</span>
        </div>
        <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary to-spectrum transition-all motion-reduce:transition-none"
            style={{ width: `${profile.stageProgress?.percent ?? profile.rankProgress.percent}%` }}
          />
        </div>
        {profile.nextUnlock && (
          <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
            <Award className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
            Next unlock: <span className="font-medium text-foreground">{profile.nextUnlock.name}</span> at {profile.nextUnlock.rank}
          </p>
        )}
      </SectionCard>
      )}
    </>
  )

  const recordsBlock = profile.records && show("records") && (
    <SectionCard title="Records" id="records" compact={compact} description="Personal records across visible grows">
      <ul className="grid gap-3 sm:grid-cols-3 text-sm">
        <li>
          <p className="text-xs text-muted-foreground mb-0.5">Longest grow</p>
          <p className="font-semibold tabular-nums">{profile.records.longestGrowDays > 0 ? `${profile.records.longestGrowDays} days` : "—"}</p>
        </li>
        <li className="min-w-0">
          <p className="text-xs text-muted-foreground mb-0.5">Biggest harvest</p>
          <p className="font-semibold truncate">
            {profile.records.biggestYield
              ? <>{profile.records.biggestYield.amount}{profile.records.biggestYield.unit ?? ""} <span className="font-normal text-muted-foreground">— {profile.records.biggestYield.title}</span></>
              : "—"}
          </p>
        </li>
        <li>
          <p className="text-xs text-muted-foreground mb-0.5">Growing since</p>
          <p className="font-semibold">
            {profile.records.growingSince
              ? new Date(profile.records.growingSince).toLocaleDateString("en-US", { month: "short", year: "numeric" })
              : "—"}
          </p>
        </li>
      </ul>
    </SectionCard>
  )

  const pinnedBlock = pinnedSection && (
    <SectionCard title={pinnedSection.title} id="pinned-section" compact={compact}>
      <div className="prose-sm max-w-none text-sm"><MarkdownRenderer content={pinnedSection.body} /></div>
    </SectionCard>
  )

  const historyBlock = show("history") && (
    <SectionCard title="Recent activity" id="recent-activity" compact={compact}>
      {recentThreads.length === 0 && recentProgression.length === 0 ? (
        <EmptyState compact title="Nothing public yet" description="Activity appears here as it happens." />
      ) : (
        <ul className="space-y-2">
          {recentThreads.slice(0, 5).map((t) => (
            <li key={`t-${t.id}`}>
              <Link href={`/forum/thread/${t.slug}`} className="block rounded-lg p-2 -m-2 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <p className="font-medium text-sm break-words">{t.title}</p>
                <p className="text-xs text-muted-foreground">{t.category.name} · {t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"} · <TimeAgo value={t.createdAt} /></p>
              </Link>
            </li>
          ))}
          {recentProgression.slice(0, 4).map((e) => (
            <li key={`e-${e.id}`} className={cn("flex items-center justify-between gap-3 rounded-lg p-2 -m-2 text-sm", e.reversed && "opacity-50")}>
              <span className={cn("truncate", e.reversed && "line-through")}>
                <TrendingUp className="inline w-3.5 h-3.5 mr-1 text-primary" aria-hidden="true" />
                {e.label}{e.reversed ? " (reversed)" : ""}
              </span>
              <span className="flex items-center gap-3 shrink-0 text-xs text-muted-foreground">
                <TimeAgo value={e.createdAt} />
                <span className={cn("font-medium w-10 text-right tabular-nums", e.amount >= 0 ? "text-primary" : "text-destructive")}>
                  {e.amount >= 0 ? "+" : ""}{e.amount}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )

  const overviewBlocks: Record<string, ReactNode> = {
    featured: featuredBlock,
    stats: statsBlock,
    records: recordsBlock,
    pinned: pinnedBlock,
    history: historyBlock,
  }
  const overviewOrder = settings.sectionOrder.filter((id) => id in overviewBlocks)

  return (
    <div
      className="min-h-screen bg-background"
      data-paccent={settings.accent}
      data-ptheme={settings.theme}
      data-pdensity={settings.density}
    >
      <div className="max-w-4xl mx-auto px-4 py-6 sm:py-8">
        {/* ── Hero ─────────────────────────────────────────────────── */}
        <div className="bg-card/80 rounded-2xl border border-border/70 mb-5 overflow-hidden">
          {profile.profileSettings.bannerImage ? (
            <div className="relative h-24 sm:h-32 w-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={profile.profileSettings.bannerImage} alt="" aria-hidden="true" className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-card/90 to-transparent" />
            </div>
          ) : (
            <div className="tt-spectrum-bar h-1" />
          )}
          <div className="p-4 sm:p-5">
            <div className="flex items-start gap-4 flex-wrap">
              <div className={cn("rounded-full shrink-0", profile.profileSettings.bannerImage && "-mt-12 sm:-mt-14 ring-4 ring-card")}>
                <Avatar
                  src={profile.avatarUrl}
                  alt={`${profile.username} avatar`}
                  size="xl"
                  className="w-20 h-20 bg-primary/10 text-primary"
                  fallback={<User className="w-10 h-10 text-primary" />}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0">
                    <h1 className="font-display text-2xl font-bold mb-1 break-words flex items-center gap-2 flex-wrap tracking-tight">
                      <span className={profile.statusHidden ? "" : (profile.rank?.nameplate ?? "")}>@{profile.username}</span>
                      <RoleBadge role={profile.role} />
                      {profile.verified && (
                        <Tooltip content={profile.verified === "legacy" ? "Verified member — established community account" : "Progression verified — Respected standing earned through real contributions"}>
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary px-1.5 py-0.5 rounded">
                            <BadgeCheck className="w-3 h-3" />
                            {profile.verified === "legacy" ? "Verified" : "Trusted"}
                          </span>
                        </Tooltip>
                      )}
                    </h1>
                    <p className="text-muted-foreground text-sm mb-2 flex items-center gap-x-3 gap-y-1 flex-wrap">
                      <span>Member since {joinDate}</span>
                      {profile.location && (
                        <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{profile.location}</span>
                      )}
                      {profile.website && (
                        <a href={profile.website} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 text-primary hover:underline">
                          <Globe className="w-3.5 h-3.5" />{profile.website.replace(/^https?:\/\//, "").slice(0, 40)}
                        </a>
                      )}
                      {/* Follow relationships — lists are members-visible
                          (locked #13); anonymous viewers see the counts
                          but nothing clickable. No ranking, no prestige. */}
                      <span className="flex items-center gap-1">
                        {data.viewerLoggedIn ? (
                          <>
                            <button
                              type="button"
                              onClick={() => setFollowList("followers")}
                              className="hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                            >
                              <span className="font-medium text-foreground tabular-nums">{profile.stats.followers}</span> follower{profile.stats.followers === 1 ? "" : "s"}
                            </button>
                            <span aria-hidden="true">·</span>
                            <button
                              type="button"
                              onClick={() => setFollowList("following")}
                              className="hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                            >
                              <span className="font-medium text-foreground tabular-nums">{profile.stats.following}</span> following
                            </button>
                          </>
                        ) : (
                          <>
                            <span className="font-medium text-foreground tabular-nums">{profile.stats.followers}</span> follower{profile.stats.followers === 1 ? "" : "s"}
                            <span aria-hidden="true">·</span>
                            <span className="font-medium text-foreground tabular-nums">{profile.stats.following}</span> following
                          </>
                        )}
                      </span>
                    </p>
                    {/* Progression identity row */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {profile.rank && (
                      <Tooltip content={`${profile.rank.name} rank — earned from community contributions`}>
                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", profile.rank.bg, profile.rank.color)}>
                          <span className="text-sm" aria-hidden="true">{profile.rank.icon}</span>
                          {profile.rank.name}
                        </span>
                      </Tooltip>
                      )}
                      {profile.xpStage && (
                        <span className="text-xs text-muted-foreground">
                          Grow Level {profile.xpStage.level} · {profile.xpStage.stageName}
                        </span>
                      )}
                      {profile.buildTitle && (
                        <Tooltip content="Deterministic build identity from mastery-path XP">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/70 text-xs font-medium">
                            <Target className="w-3 h-3" aria-hidden="true" />
                            {profile.buildTitle}
                          </span>
                        </Tooltip>
                      )}
                      {profile.standingTier && (
                        <Tooltip content="Community standing — a named tier, never a number">
                          <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", profile.standingTier.bg, profile.standingTier.color)}>
                            <span aria-hidden="true">{profile.standingTier.icon}</span>
                            {profile.standingTier.name}
                          </span>
                        </Tooltip>
                      )}
                    </div>
                    {profile.bio && <p className="text-sm mb-2 break-words whitespace-pre-wrap line-clamp-4">{profile.bio}</p>}
                    {/* Cultivation identity line */}
                    <div className="flex gap-x-4 gap-y-1 text-sm text-muted-foreground flex-wrap">
                      {profile.growExperience && (
                        <span className="flex items-center gap-1"><Sprout className="w-3.5 h-3.5" />{profile.growExperience}</span>
                      )}
                      {profile.growSpace && (
                        <span className="flex items-center gap-1"><Leaf className="w-3.5 h-3.5" />{profile.growSpace}</span>
                      )}
                      {profile.favoriteStrain && (
                        <Link href={`/strains?q=${encodeURIComponent(profile.favoriteStrain)}`} className="flex items-center gap-1 hover:text-primary transition-colors"><Dna className="w-3.5 h-3.5" />{profile.favoriteStrain}</Link>
                      )}
                      {profile.profileSettings.identity.mediums.map((m) => (
                        <Tag key={m} variant="muted">{m}</Tag>
                      ))}
                      {profile.profileSettings.identity.styles.map((s) => (
                        <Tag key={s} variant="muted">{s}</Tag>
                      ))}
                    </div>
                  </div>
                  {isSelf ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <Link href="/profile/customize" className="rounded-full bg-primary/10 text-primary px-3.5 py-1.5 text-xs font-medium hover:bg-primary/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Customize
                      </Link>
                      <Link href="/profile" className="rounded-full bg-secondary/70 px-3.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        Edit profile
                      </Link>
                    </div>
                  ) : (
                    <UserActions userId={profile.id} username={profile.username} initiallyBlocked={viewerBlocked} initiallyFollowing={viewerFollowing} />
                  )}
                </div>

                {/* Notable stats — ≤4 in the hero, deterministic + scoped */}
                {heroStats.length > 0 && (
                  <StatStrip
                    className="mt-4"
                    items={heroStats.map((s) => ({ label: s.label, value: s.value, hint: s.hint }))}
                  />
                )}

                {/* Hero grow — member's featured pick, else the live grow */}
                {heroGrow && (
                  <Link
                    href={diaryPath(heroGrow)}
                    className="mt-4 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 p-3 transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="w-11 h-11 bg-primary/15 rounded-xl flex items-center justify-center shrink-0">
                      <Sprout className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-primary mb-0.5">{heroGrowLabel}</p>
                      <p className="font-medium text-sm truncate">{heroGrow.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {STAGE_LABELS[heroGrow.stage] ?? heroGrow.stage.toLowerCase()}
                        {heroGrow.day != null && ` · day ${heroGrow.day}`}
                        {heroGrow.strain && ` · ${heroGrow.strain}`}
                        {` · ${heroGrow.updates} update${heroGrow.updates === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    <VisibilityTag visibility={heroGrow.visibility} />
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <Tabs
          syncWithUrl
          defaultValue="overview"
          onChange={setTab}
          ariaLabel="Profile sections"
          items={tabItems}
        >
          {(active) => (
            <>
              {active === "overview" && (
                <div className={compact ? "space-y-3" : "space-y-4"}>
                  {overviewOrder.map((id) => (
                    <div key={id} className="contents">{overviewBlocks[id]}</div>
                  ))}
                </div>
              )}

              {active === "grows" && show("grows") && (
                <div className="space-y-4">
                  {profile.strainPortfolio.length > 0 && (
                    <SectionCard
                      title="Strain portfolio" id="strain-portfolio" compact={compact}
                      description={`Strains across this member's visible grows${profile.strainTotal > profile.strainPortfolio.length ? ` — top ${profile.strainPortfolio.length} of ${profile.strainTotal}` : ""}`}
                      actions={profile.strainTotal > profile.strainPortfolio.length || showAllStrains ? (
                        <button
                          type="button"
                          onClick={() => setShowAllStrains((v) => !v)}
                          className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                        >
                          {showAllStrains ? "Show less" : `See all ${profile.strainTotal}`}
                        </button>
                      ) : undefined}
                    >
                      <div className="flex flex-wrap gap-1.5">
                        {profile.strainPortfolio.map((s) => (
                          <Tag key={s.name} href={`/strains?q=${encodeURIComponent(s.name)}`}>
                            <Dna className="w-3 h-3 mr-1" aria-hidden="true" />
                            {s.name}
                            {s.grows > 1 && <span className="ml-1 text-primary font-medium">×{s.grows}</span>}
                          </Tag>
                        ))}
                      </div>
                      {showAllStrains && (
                        <ul className="mt-3 space-y-1 border-t border-border/60 pt-3">
                          {strainsSection.items.map((s, i) => (
                            <li key={`${s.name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                              <Link href={`/strains?q=${encodeURIComponent(s.name)}`} className="truncate hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                                {s.name}
                              </Link>
                              <span className="text-xs text-muted-foreground shrink-0">{s.grows} grow{s.grows === 1 ? "" : "s"}</span>
                            </li>
                          ))}
                          {strainsSection.loading && <li className="text-xs text-muted-foreground">Loading…</li>}
                        </ul>
                      )}
                      {showAllStrains && <LoadMore loading={strainsSection.loading} done={!strainsSection.hasMore && strainsSection.items.length > 0} onMore={strainsSection.loadMore} />}
                    </SectionCard>
                  )}
                  <SectionCard title="Grow portfolio" id="grow-portfolio" compact={compact} description={`${profile.stats.diaryCreator} grow${profile.stats.diaryCreator === 1 ? "" : "s"} — active first`}>
                    <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Grow filters">
                      <select value={growStatus} onChange={(e) => setGrowStatus(e.target.value as "" | "active" | "completed")} className={filterSelect} aria-label="Status">
                        <option value="">All grows</option>
                        <option value="active">Active</option>
                        <option value="completed">Completed</option>
                      </select>
                      {profile.strainPortfolio.length > 1 && (
                        <select value={growStrain} onChange={(e) => setGrowStrain(e.target.value)} className={filterSelect} aria-label="Strain">
                          <option value="">Any strain</option>
                          {profile.strainPortfolio.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                        </select>
                      )}
                      <select value={growStage} onChange={(e) => setGrowStage(e.target.value)} className={filterSelect} aria-label="Stage">
                        <option value="">Any stage</option>
                        {GROW_STAGE_OPTIONS.map((s) => <option key={s} value={s}>{STAGE_LABELS[s] ?? s.toLowerCase()}</option>)}
                      </select>
                      {(growStatus || growStrain || growStage) && (
                        <button
                          type="button"
                          onClick={() => { setGrowStatus(""); setGrowStrain(""); setGrowStage("") }}
                          className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    {growsSection.items.length === 0 && !growsSection.loading ? (
                      <EmptyState
                        compact icon={Sprout} title={growStatus || growStrain || growStage ? "Nothing matches these filters" : "No grows to show"}
                        description={growStatus || growStrain || growStage ? "Try widening the filters — only real recorded data is listed." : "Documented grows appear here as the member journals them."}
                      />
                    ) : (
                      <ul className="space-y-2">
                        {growsSection.items.map((d) => (
                          <li key={d.id}><GrowRow grow={d} /></li>
                        ))}
                      </ul>
                    )}
                    <LoadMore loading={growsSection.loading} done={!growsSection.hasMore && growsSection.items.length > 0} onMore={growsSection.loadMore} />
                  </SectionCard>
                </div>
              )}

              {active === "harvests" && show("harvests") && (
                <div className="space-y-4">
                  {/* Deterministic harvest highlights — every line derives
                      from the harvests the viewer can actually see. */}
                  {profile.harvestHighlights && (
                    <SectionCard title="Harvest highlights" id="harvest-highlights" compact={compact}>
                      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                        <div><dt className="text-xs text-muted-foreground">Harvests</dt><dd className="font-semibold tabular-nums">{profile.harvestHighlights.harvestCount}</dd></div>
                        {profile.harvestHighlights.firstHarvestAt && (
                          <div><dt className="text-xs text-muted-foreground">First harvest</dt><dd className="font-medium">{new Date(profile.harvestHighlights.firstHarvestAt).toLocaleDateString("en-US", { year: "numeric", month: "short" })}</dd></div>
                        )}
                        {profile.harvestHighlights.latestHarvestAt && (
                          <div><dt className="text-xs text-muted-foreground">Most recent</dt><dd className="font-medium">{new Date(profile.harvestHighlights.latestHarvestAt).toLocaleDateString("en-US", { year: "numeric", month: "short" })}</dd></div>
                        )}
                        {profile.harvestHighlights.longestGrowDays > 0 && (
                          <div><dt className="text-xs text-muted-foreground">Longest grow</dt><dd className="font-medium">{profile.harvestHighlights.longestGrowDays} days</dd></div>
                        )}
                        {profile.harvestHighlights.mostGrownStrain && (
                          <div><dt className="text-xs text-muted-foreground">Most-grown strain</dt><dd className="font-medium truncate">{profile.harvestHighlights.mostGrownStrain.name} <span className="text-muted-foreground">×{profile.harvestHighlights.mostGrownStrain.grows}</span></dd></div>
                        )}
                        {profile.harvestHighlights.repeatStrains > 0 && (
                          <div><dt className="text-xs text-muted-foreground">Repeat strains</dt><dd className="font-medium tabular-nums">{profile.harvestHighlights.repeatStrains}</dd></div>
                        )}
                      </dl>
                    </SectionCard>
                  )}
                  {profile.pinnedHarvest && (
                    <SectionCard title={<span className="flex items-center gap-1.5"><Pin className="w-4 h-4 text-warning" />Pinned harvest</span>} id="pinned-harvest" compact={compact}>
                      <Link
                        href={diaryPath(profile.pinnedHarvest)}
                        className="block rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 transition-colors hover:bg-amber-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <p className="text-sm font-semibold truncate">{profile.pinnedHarvest.title}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {profile.pinnedHarvest.strain ?? "Harvest"}
                          {profile.pinnedHarvest.harvestedAt && (
                            <> · {new Date(profile.pinnedHarvest.harvestedAt).toLocaleDateString("en-US", { year: "numeric", month: "short" })}</>
                          )}
                        </p>
                      </Link>
                    </SectionCard>
                  )}
                  <SectionCard title="Harvest shelf" id="harvest-shelf" compact={compact} description={`${profile.stats.harvestCount} completed grow${profile.stats.harvestCount === 1 ? "" : "s"}`}>
                    {(profile.strainPortfolio.length > 1 || profile.harvestYears.length > 0) && (
                      <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Harvest filters">
                        {profile.strainPortfolio.length > 1 && (
                          <select value={harvestStrain} onChange={(e) => setHarvestStrain(e.target.value)} className={filterSelect} aria-label="Strain">
                            <option value="">Any strain</option>
                            {profile.strainPortfolio.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                          </select>
                        )}
                        {profile.harvestYears.length > 1 && (
                          <select value={harvestYear} onChange={(e) => setHarvestYear(e.target.value)} className={filterSelect} aria-label="Year">
                            <option value="">Any year</option>
                            {profile.harvestYears.map((y) => <option key={y} value={y}>{y}</option>)}
                          </select>
                        )}
                        {(harvestStrain || harvestYear) && (
                          <button
                            type="button"
                            onClick={() => { setHarvestStrain(""); setHarvestYear("") }}
                            className="text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    )}
                    {harvestsSection.items.length === 0 && !harvestsSection.loading ? (
                      <EmptyState
                        compact icon={Trophy}
                        title={harvestStrain || harvestYear ? "Nothing matches these filters" : "No harvests yet"}
                        description={harvestStrain || harvestYear ? "Try widening the filters — only real recorded harvests are listed." : "Finished grows land here once they're harvested."}
                      />
                    ) : (
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {harvestsSection.items.map((h) => {
                          const days = h.harvestedAt && h.startDate
                            ? Math.max(0, Math.round((new Date(h.harvestedAt).getTime() - new Date(h.startDate).getTime()) / 86400000))
                            : null
                          return (
                            <li key={h.id}>
                              <Link
                                href={diaryPath(h)}
                                className="block h-full rounded-lg border border-border p-3 transition-colors hover:border-amber-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <h3 className="font-medium text-sm break-words">{h.title}</h3>
                                  <VisibilityTag visibility={h.visibility} />
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  {h.strain ? `${h.strain} • ` : ""}
                                  {h.harvestedAt ? `harvested ${new Date(h.harvestedAt).toLocaleDateString()}` : "harvested"}
                                  {days != null && ` • ${days} days`}
                                </p>
                                <p className="text-xs mt-1">
                                  {h.yieldAmount != null && h.yieldUnit ? (
                                    <span className="text-warning font-medium">{h.yieldAmount}{h.yieldUnit}</span>
                                  ) : h.yieldPrivate ? (
                                    <span className="text-muted-foreground">yield hidden</span>
                                  ) : (
                                    <span className="text-muted-foreground">yield not recorded</span>
                                  )}
                                  <span className="text-muted-foreground"> • {h.updates} updates</span>
                                </p>
                              </Link>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    <LoadMore loading={harvestsSection.loading} done={!harvestsSection.hasMore && harvestsSection.items.length > 0} onMore={harvestsSection.loadMore} />
                  </SectionCard>
                </div>
              )}

              {active === "contributions" && show("contributions") && (
                <ContributionsTab
                  profile={profile}
                  recentThreads={recentThreads}
                  growSetups={growSetups}
                  showAllBadges={showAllBadges}
                  setShowAllBadges={setShowAllBadges}
                  compact={compact}
                />
              )}

              {active === "about" && (
                <AboutTab profile={profile} isSelf={isSelf} compact={compact} />
              )}
            </>
          )}
        </Tabs>
      </div>

      {/* Follow relationships — members-visible, block-filtered,
          cursor-paged (locked #13). Compact identity rows only. */}
      {followList && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={followList === "followers" ? "Followers" : "Following"}
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
          onClick={() => setFollowList(null)}
        >
          <div
            className="w-full sm:max-w-md max-h-[80vh] bg-card rounded-t-2xl sm:rounded-2xl border border-border/70 overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
              <h2 className="font-display text-base font-semibold">{followList === "followers" ? "Followers" : "Following"}</h2>
              <button
                type="button"
                onClick={() => setFollowList(null)}
                className="p-1.5 rounded-lg hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto p-2">
              {followSection.items.length === 0 && !followSection.loading ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {followList === "followers" ? "No followers yet." : "Not following anyone yet."}
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {followSection.items.map((m) => (
                    <li key={m.id}>
                      <Link
                        href={`/u/${encodeURIComponent(m.username)}`}
                        onClick={() => setFollowList(null)}
                        className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Avatar src={m.avatarUrl} alt="" size="sm" className="w-9 h-9" fallback={<User className="w-4 h-4" />} />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-sm truncate">@{m.username}</span>
                          {m.buildTitle && <span className="block text-xs text-muted-foreground truncate">{m.buildTitle}</span>}
                        </span>
                        <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0", m.rank.color)}>
                          <span aria-hidden="true">{m.rank.icon}</span>{m.rank.name}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {followSection.loading && <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>}
              <div className="pb-2"><LoadMore loading={followSection.loading} done={!followSection.hasMore && followSection.items.length > 0} onMore={followSection.loadMore} /></div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Contributions tab ───────────────────────────────────────────── */

function ContributionsTab({
  profile, recentThreads, growSetups, showAllBadges, setShowAllBadges, compact,
}: {
  profile: PublicProfile
  recentThreads: Thread[]
  growSetups: GrowSetup[]
  showAllBadges: boolean
  setShowAllBadges: (v: boolean | ((p: boolean) => boolean)) => void
  compact: boolean
}) {
  const pinnedBadges = profile.badges.filter((b) => b.pinned)
  const restBadges = profile.badges.filter((b) => !b.pinned)
  const hasAny =
    profile.stats.acceptedAnswers > 0 || profile.experiments.length > 0 ||
    growSetups.length > 0 || profile.stats.contestWins > 0 || recentThreads.length > 0 || profile.badges.length > 0

  if (!hasAny) {
    return <EmptyState icon={MessageSquare} title="No contributions yet" description="Answers, experiments, setups, and discussions build this member's community record." />
  }

  return (
    <div className="space-y-4">
      {profile.stats.acceptedAnswers > 0 && (
        <SectionCard
          title="Accepted answers"
          id="accepted-answers" compact={compact}
          description={`${profile.stats.acceptedAnswers} answer${profile.stats.acceptedAnswers === 1 ? "" : "s"} marked correct by the asker`}
        >
          <ul className="space-y-2">
            {profile.acceptedAnswersList.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/forum/thread/${a.threadSlug}`}
                  className="flex items-center gap-2.5 rounded-lg p-2 -m-2 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-sm truncate">{a.threadTitle}</span>
                    <span className="block text-xs text-muted-foreground"><TimeAgo value={a.createdAt} /></span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {profile.experiments.length > 0 && (
        <SectionCard title="Experiments" id="experiments" compact={compact} description={`${profile.stats.experiments} documented experiment${profile.stats.experiments === 1 ? "" : "s"}`}>
          <ul className="space-y-2">
            {profile.experiments.map((e) => (
              <li key={e.id} className="flex items-start gap-2.5 rounded-lg p-2 -m-2">
                <FlaskConical className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm break-words">{e.title}</p>
                  {e.change && <p className="text-xs text-muted-foreground mt-0.5 break-words line-clamp-2">{e.change}</p>}
                  {e.conclusion && <p className="text-xs mt-0.5 break-words line-clamp-2 italic">&ldquo;{e.conclusion}&rdquo;</p>}
                  <p className="text-xs text-muted-foreground mt-1">
                    <Tag variant="muted" className="mr-1.5">{e.status.toLowerCase().replace(/_/g, " ")}</Tag>
                    {e.outcome && <Tag variant="muted" className="mr-1.5">{e.outcome.toLowerCase().replace(/_/g, " ")}</Tag>}
                    in <Link href={diaryPath(e.diary)} className="text-primary hover:underline">{e.diary.title}</Link>
                    {" · "}<TimeAgo value={e.startedAt} />
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {growSetups.length > 0 && (
        <SectionCard title="Grow setups" id="grow-setups" compact={compact} description={`${profile.stats.setups} shared`}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {growSetups.map((s) => (
              <li key={s.id}>
                <Link
                  href={setupPath(s)}
                  className="flex items-center gap-3 h-full rounded-lg border border-border p-3 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {s.images[0]?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.images[0].url} alt="" loading="lazy" decoding="async" className="w-12 h-12 rounded-md object-cover shrink-0" />
                  ) : (
                    <div className="w-12 h-12 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <Wrench className="w-5 h-5 text-primary" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{s.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {s.strain ?? "Setup"}{s._count.comments > 0 && ` · ${s._count.comments} comments`}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {profile.stats.contestWins > 0 && (
        <SectionCard title="Contests" id="contests" compact={compact}>
          <p className="text-sm flex items-center gap-2">
            <Trophy className="w-4 h-4 text-warning" aria-hidden="true" />
            <span><span className="font-semibold tabular-nums">{profile.stats.contestWins}</span> contest win{profile.stats.contestWins === 1 ? "" : "s"}</span>
          </p>
        </SectionCard>
      )}

      {recentThreads.length > 0 && (
        <SectionCard title="Discussions" id="discussions" compact={compact}>
          <ul className="space-y-2">
            {recentThreads.map((t) => (
              <li key={t.id}>
                <Link href={`/forum/thread/${t.slug}`} className="block rounded-lg p-2 -m-2 transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <p className="font-medium text-sm break-words">{t.title}</p>
                  <p className="text-xs text-muted-foreground">{t.category.name} · {t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"} · <TimeAgo value={t.createdAt} /></p>
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {(pinnedBadges.length > 0 || restBadges.length > 0) && (
        <SectionCard title="Badges" id="badges" compact={compact}>
          {pinnedBadges.length > 0 && (
            <>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Showcase</p>
              <div className="flex flex-wrap gap-2 mb-3">
                {pinnedBadges.map((b) => <AchievementBadge key={b.name} name={b.name} mode="profile" />)}
              </div>
            </>
          )}
          {restBadges.length > 0 && (
            <>
              <div className="flex flex-wrap gap-2">
                {(showAllBadges ? restBadges : restBadges.slice(0, 6)).map((b) => (
                  <AchievementBadge key={b.name} name={b.name} mode="profile" />
                ))}
              </div>
              {restBadges.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAllBadges((v) => !v)}
                  className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
                >
                  {showAllBadges ? <>Show less <ChevronUp className="w-3 h-3" /></> : <>View all {restBadges.length} badges <ChevronDown className="w-3 h-3" /></>}
                </button>
              )}
            </>
          )}
        </SectionCard>
      )}
    </div>
  )
}

/* ── About tab ───────────────────────────────────────────────────── */

/** Custom sections collapse to headers on small screens — long member
 *  sections stay scannable. Desktop always renders the full body. */
function CollapsibleSectionCard({
  id, title, compact, children,
}: { id: string; title: ReactNode; compact: boolean; children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)")
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener("change", update)
    return () => mq.removeEventListener("change", update)
  }, [])

  if (!isMobile) {
    return <SectionCard id={id} title={title} compact={compact}>{children}</SectionCard>
  }
  const headingId = `${id}-title`
  return (
    <section aria-labelledby={headingId} className="bg-card/80 rounded-2xl border border-border/70">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl"
      >
        <h2 id={headingId} className="font-display text-base font-semibold break-words min-w-0">{title}</h2>
        {open ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </button>
      {open && <div id={`${id}-body`} className="px-3 pb-3">{children}</div>}
    </section>
  )
}

function AboutTab({ profile, isSelf, compact }: { profile: PublicProfile; isSelf: boolean; compact: boolean }) {
  const identity = profile.profileSettings.identity
  const hasIdentity = profile.growExperience || profile.growSpace || profile.favoriteStrain ||
    identity.mediums.length > 0 || identity.styles.length > 0 || identity.goals
  // The owner's private panels (30-day + TerpBot insights) can render
  // even when every public field is empty — but a hidden panel doesn't.
  const privatePanels = isSelf && (
    (profile.ownerInsights && !profile.profileSettings.hiddenSections.includes("owner-insights")) ||
    !profile.profileSettings.hiddenSections.includes("terpbot-insights")
  )
  const hasAnything = profile.bio || hasIdentity || profile.businessName || profile.customSections.length > 0 || profile.ownerInsights || profile.equipmentChips.length > 0 || privatePanels

  if (!hasAnything) {
    return <EmptyState icon={User} title="Nothing here yet" description="This member hasn't shared an about section." />
  }

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      {/* Profile insights (Cured) — the owner's private 30-day panel.
          Server ships ownerInsights only to the owner; double-gated here. */}
      {isSelf && profile.ownerInsights && !profile.profileSettings.hiddenSections.includes("owner-insights") && (
        <SectionCard
          title="Your last 30 days"
          id="owner-insights"
          compact={compact}
          actions={<Tag variant="muted">Only you</Tag>}
        >
          <StatStrip
            className="sm:grid-cols-3"
            items={[
              { label: "New followers", value: String(profile.ownerInsights.newFollowers) },
              { label: "Updates logged", value: String(profile.ownerInsights.updatesLogged) },
              { label: "Grows started", value: String(profile.ownerInsights.growsStarted) },
            ]}
          />
        </SectionCard>
      )}

      {/* TerpBot insights (P5) — owner-only, deferred fetch; the
          endpoint only answers for the session owner. */}
      {isSelf && !profile.profileSettings.hiddenSections.includes("terpbot-insights") && (
        <TerpBotInsights compact={compact} />
      )}

      {profile.bio && (
        <SectionCard title="Bio" id="bio" compact={compact}>
          <p className="text-sm whitespace-pre-wrap break-words">{profile.bio}</p>
        </SectionCard>
      )}

      {hasIdentity && (
        <SectionCard title="Grower identity" id="grower-identity" compact={compact}>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {profile.growExperience && (
              <div><dt className="text-xs text-muted-foreground mb-0.5">Experience</dt><dd>{profile.growExperience}</dd></div>
            )}
            {profile.growSpace && (
              <div><dt className="text-xs text-muted-foreground mb-0.5">Grow space</dt><dd>{profile.growSpace}</dd></div>
            )}
            {profile.favoriteStrain && (
              <div>
                <dt className="text-xs text-muted-foreground mb-0.5">Favorite strain</dt>
                <dd><Link href={`/strains?q=${encodeURIComponent(profile.favoriteStrain)}`} className="text-primary hover:underline">{profile.favoriteStrain}</Link></dd>
              </div>
            )}
            {identity.mediums.length > 0 && (
              <div>
                <dt className="text-xs text-muted-foreground mb-1">Mediums</dt>
                <dd className="flex flex-wrap gap-1.5">{identity.mediums.map((m) => <Tag key={m}>{m}</Tag>)}</dd>
              </div>
            )}
            {identity.styles.length > 0 && (
              <div>
                <dt className="text-xs text-muted-foreground mb-1">Growing style</dt>
                <dd className="flex flex-wrap gap-1.5">{identity.styles.map((s) => <Tag key={s}>{s}</Tag>)}</dd>
              </div>
            )}
          </dl>
          {identity.goals && (
            <div className="mt-4">
              <p className="text-xs text-muted-foreground mb-1">Goals</p>
              <p className="text-sm whitespace-pre-wrap break-words">{identity.goals}</p>
            </div>
          )}
        </SectionCard>
      )}

      {/* Equipment — derived label chips from the member's documented
          grows (label-first; catalog-ready when products land). */}
      {profile.equipmentChips.length > 0 && (
        <SectionCard title="Equipment & methods" id="equipment" compact={compact} description="From documented grows — mediums, lighting, space, techniques">
          <div className="flex flex-wrap gap-1.5">
            {profile.equipmentChips.map((c) => <Tag key={c} variant="muted">{c}</Tag>)}
          </div>
        </SectionCard>
      )}

      {profile.businessName && (
        <SectionCard title="Business" id="business" compact={compact}>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Store className="w-4 h-4 text-primary" />
            <span>{profile.businessName}</span>
            {profile.businessType && <span className="text-xs text-muted-foreground">({profile.businessType})</span>}
          </div>
          {profile.businessUrl && (
            <a href={profile.businessUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-primary hover:underline">
              {profile.businessUrl.replace(/^https?:\/\//, "").slice(0, 40)}
            </a>
          )}
        </SectionCard>
      )}

      {profile.customSections.map((s) => (
        <CollapsibleSectionCard
          key={s.id}
          id={`section-${s.id}`}
          compact={compact}
          title={
            <span className="flex items-center gap-2">
              {s.title}
              {s.visibility !== "PUBLIC" && (
                <Tag variant="muted">{s.visibility === "MEMBERS" ? "Members" : "Only you"}</Tag>
              )}
            </span>
          }
        >
          <div className="text-sm max-w-none"><MarkdownRenderer content={s.body} /></div>
        </CollapsibleSectionCard>
      ))}
    </div>
  )
}

/* ── TerpBot profile ─────────────────────────────────────────────── */

const BOT_COMMAND_GROUPS: { category: ChatCommandCategory; label: string; icon: typeof Sprout; blurb: string }[] = [
  { category: "grow", label: "Your grow", icon: Sprout, blurb: "Stage, streaks, readings, and what to do next — straight from your diary." },
  { category: "knowledge", label: "Answers & research", icon: BookOpen, blurb: "Search threads, guides, strains and setups without leaving chat." },
  { category: "community", label: "Community pulse", icon: Users, blurb: "Stats, digests, trending threads and who's around." },
  { category: "profile", label: "You", icon: Award, blurb: "Your rep, rank and badge progress." },
  { category: "utility", label: "Just for fun", icon: Dices, blurb: "Coin flips, dice rolls and a grow tip when you need one." },
]

const BOT_PUBLIC_COMMANDS = BOT_COMMAND_GROUPS.map((g) => ({
  ...g,
  commands: CHAT_COMMANDS.filter((c) => c.category === g.category && c.permission === "public" && c.handledBy === "bot"),
}))

function BotProfile({ data }: { data: ProfileResponse }) {
  const { profile } = data
  const joinDate = new Date(profile.joinDate).toLocaleDateString("en-US", { year: "numeric", month: "long" })
  const stats = profile.botStats
  const commandCount = BOT_PUBLIC_COMMANDS.reduce((n, g) => n + g.commands.length, 0)
  const learningMisses = (stats?.unknownCommands ?? 0) + (stats?.fallbacks ?? 0)
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* ── Hero ─────────────────────────────────────────────── */}
        <div className="bg-card/80 rounded-2xl border border-border/70 mb-5 overflow-hidden">
          <div className="tt-spectrum-bar h-1" />
          <div className="p-4 sm:p-5">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="relative rounded-full shrink-0">
                <Avatar src={profile.avatarUrl} alt="TerpBot avatar" size="xl" className="w-20 h-20 bg-primary/10 text-primary" fallback={<Bot className="w-10 h-10 text-primary" />} />
                <Tooltip content="Automated — I respond when invoked">
                  <span className="absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-card bg-emerald-500">
                    <span className="sr-only">Available</span>
                  </span>
                </Tooltip>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-2xl font-bold mb-1 break-words flex items-center gap-2 flex-wrap tracking-tight">
                  @{profile.username} <RoleBadge role={profile.role} />
                  <Tooltip content="Automated community assistant — not a person">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary px-1.5 py-0.5 rounded">
                      <Bot className="w-3 h-3" /> Bot
                    </span>
                  </Tooltip>
                  <Tooltip content="Every answer is computed from real TerpTalk data — no language model, no guessing">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-secondary text-muted-foreground px-1.5 py-0.5 rounded">
                      <ShieldCheck className="w-3 h-3" /> Deterministic · No LLM
                    </span>
                  </Tooltip>
                </h1>
                <p className="text-sm text-muted-foreground mb-1 flex items-center gap-2 flex-wrap">
                  <span>Answering since {joinDate}</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> Available in community chat
                  </span>
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  TerpBot uses TerpTalk&apos;s real community data and deterministic rules to answer grow, community, and profile questions.
                  Mention <span className="text-primary font-medium">@terpbot</span> in chat or type <span className="text-primary font-medium">/help</span> to see the full playbook.
                </p>
                {stats && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-x-3 gap-y-4 mt-4">
                    {[
                      { icon: Zap, v: stats.commands, l: "Commands answered" },
                      { icon: AtSign, v: stats.mentions, l: "Mentions answered" },
                      { icon: Users, v: stats.membersAssisted, l: "Members helped" },
                      { icon: Bot, v: stats.assists, l: "Assists sent" },
                      { icon: HandMetal, v: stats.welcomes, l: "Welcomes sent" },
                      { icon: Link2, v: stats.entityLinks, l: "Links shared" },
                      { icon: Megaphone, v: stats.announcements, l: "Announcements" },
                      { icon: CalendarClock, v: stats.daysActive, l: "Days active" },
                    ].map((s) => (
                      <div key={s.l} className="text-center">
                        <div className="text-lg font-bold text-primary flex items-center justify-center gap-1"><s.icon className="w-4 h-4" />{s.v}</div>
                        <div className="text-xs text-muted-foreground">{s.l}</div>
                      </div>
                    ))}
                  </div>
                )}
                {stats && learningMisses > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-2 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-primary shrink-0" />
                    Report card: {learningMisses.toLocaleString()} questions I couldn&apos;t parse — try rephrasing them and I&apos;ll keep working from the commands and rules I actually support.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Command menu — the real registry, grouped ─────────── */}
        <SectionCard
          title={<span className="flex items-center gap-2"><Terminal className="w-4 h-4 text-primary" />My playbook — {commandCount} commands</span>}
          className="mb-4"
        >
          <p className="text-xs text-muted-foreground mb-4">
            Slash commands in <Link href="/chat" className="text-primary hover:underline">chat</Link>, or just talk to me —
            anything tagged <Tag variant="muted">@mention</Tag> also works in plain English.
          </p>
          <div className="space-y-4">
            {BOT_PUBLIC_COMMANDS.filter((g) => g.commands.length > 0).map((g) => (
              <div key={g.category}>
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                  <g.icon className="w-3.5 h-3.5 text-primary" /> {g.label}
                  <span className="normal-case font-normal">· {g.blurb}</span>
                </p>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {g.commands.map((c) => (
                    <div key={c.name} className="flex items-baseline gap-2 rounded-lg border border-border/60 bg-secondary/20 px-2.5 py-1.5">
                      <code className="text-[11px] font-mono text-primary shrink-0">{c.usage.split(" ")[0]}</code>
                      <span className="text-xs text-muted-foreground min-w-0">{c.description}</span>
                      {c.surfaces.includes("mention") && (
                        <Tooltip content={`Also works as a natural-language mention, e.g. "${c.example ?? `@terpbot ${c.name}`}"`}>
                          <span className="ml-auto shrink-0"><Tag variant="muted">@mention</Tag></span>
                        </Tooltip>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {stats && Object.keys(stats.byCommand).length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">What members actually ask me</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(stats.byCommand)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([cmd, n]) => (
                    <span key={cmd} className="inline-flex items-center gap-1.5 rounded-full bg-secondary/60 px-2.5 py-1 text-xs">
                      <span className="font-mono text-primary">/{cmd}</span>
                      <span className="text-muted-foreground">×{n}</span>
                    </span>
                  ))}
              </div>
            </div>
          )}
        </SectionCard>

        {/* ── How I work ───────────────────────────────────────── */}
        <SectionCard title={<span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" />How I work</span>}>
          <ul className="space-y-2.5 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <Zap className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span><span className="font-medium text-foreground">Deterministic.</span> Every answer comes from explicit commands, structured data, and deterministic rules — no LLM, no generative AI, nothing made up.</span>
            </li>
            <li className="flex gap-2">
              <BarChart3 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span><span className="font-medium text-foreground">Real data.</span> Community-facing answers use data I&apos;m actually permitted to access. When I give you personalized grow analysis, it&apos;s computed from <em>your own</em> TerpTalk records — and only ever shown to you.</span>
            </li>
            <li className="flex gap-2">
              <ShieldCheck className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span><span className="font-medium text-foreground">Private by design.</span> Owner-only intelligence stays owner-scoped and respects your visibility and notification settings. I never read or expose another member&apos;s private data.</span>
            </li>
            <li className="flex gap-2">
              <Users className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span><span className="font-medium text-foreground">Not a moderator.</span> I don&apos;t make moderation decisions and can&apos;t take action against any member — humans handle all of that.</span>
            </li>
            <li className="flex gap-2">
              <HandMetal className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <span>I welcome new members, post the daily digest in <Link href="/chat" className="text-primary hover:underline">chat</Link>, and send a private heads-up when it&apos;s genuinely useful — manage those in{" "}
              <Link href="/settings/notifications" className="text-primary hover:underline">notification settings</Link>.</span>
            </li>
          </ul>
          <div className="space-y-1.5 mt-4 pt-4 border-t border-border">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Try me</p>
            {[
              "@terpbot what's my rank?",
              "@terpbot my grow",
              "@terpbot summarize this thread",
              "@terpbot what should I check",
              "@terpbot find cloning guides",
            ].map((ex) => (
              <code key={ex} className="block text-xs bg-secondary/50 rounded px-2.5 py-1.5 text-foreground/90">{ex}</code>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>
              I&apos;m fully automated — I don&apos;t give legal or medical advice, and my grow analysis is general computed guidance from your records, not professional consultation.
            </span>
          </p>
        </SectionCard>
      </div>
    </div>
  )
}
