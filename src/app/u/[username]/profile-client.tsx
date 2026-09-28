"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useParams } from "next/navigation"
import { User, MessageSquare, MapPin, Globe, Sprout, Dna, Leaf, Store, ChevronDown, ChevronUp, Bot, Zap, Users, Link2, HandMetal, CalendarClock, TrendingUp, Search, BookOpen, Trophy, BarChart3, AlertTriangle, Megaphone, Wrench, Award, Pin, FlaskConical, BadgeCheck, Target, CheckCircle2 } from "lucide-react"
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
import { MarkdownRenderer } from "@/lib/markdown"
import { diaryPath, setupPath } from "@/lib/slugs"
import { STAGE_LABELS } from "@/lib/diary-weeks"
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
}

interface HarvestRow extends GrowCard {
  harvestedAt: string | null
  yieldAmount: number | null
  yieldUnit: string | null
}

interface ExperimentCard {
  id: string
  title: string
  category: string
  status: string
  outcome: string | null
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
  strainPortfolio: { name: string; slug: string | null; grows: number }[]
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
  } | null
  growStreak: number
  totalUpdates: number
  harvestedDiaries: number
  profileSettings: {
    bannerImage: string | null
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
      <div className="w-11 h-11 bg-primary/10 rounded-xl flex items-center justify-center shrink-0">
        <Sprout className="w-5 h-5 text-primary" />
      </div>
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

/** Cursor-paged tab list — fetches page 1 on first open, then appends. */
function useProfileSection<T extends { id: string }>(username: string, section: string, active: boolean) {
  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(active)
  const started = useRef(false)

  const load = useCallback(
    (c?: string) => {
      setLoading(true)
      fetch(`/api/users/${encodeURIComponent(username)}/sections/${section}${c ? `?cursor=${encodeURIComponent(c)}` : ""}`, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return
          const page = await res.json()
          setItems((prev) => (c ? [...prev, ...page.items] : page.items))
          setCursor(page.nextCursor)
        })
        .finally(() => setLoading(false))
    },
    [username, section]
  )

  useEffect(() => {
    if (active && !started.current) {
      started.current = true
      load()
    }
  }, [active, load])

  return { items, loading, hasMore: !!cursor, loadMore: () => cursor && load(cursor) }
}

/* ── Member profile ──────────────────────────────────────────────── */

function MemberProfile({ data, isSelf, username }: { data: ProfileResponse; isSelf: boolean; username: string }) {
  const { profile, viewerBlocked, viewerFollowing, recentThreads, growSetups, recentProgression } = data
  const joinDate = new Date(profile.joinDate).toLocaleDateString("en-US", { year: "numeric", month: "long" })
  const [showAllBadges, setShowAllBadges] = useState(false)
  const [tab, setTab] = useState("overview")

  const heroGrow = profile.featuredGrow ?? profile.activeGrow
  const heroGrowLabel = profile.featuredGrow ? "Featured grow" : "Currently growing"
  const pinnedSection = profile.profileSettings.pinnedSection
    ? profile.customSections.find((s) => s.id === profile.profileSettings.pinnedSection) ?? null
    : null
  const hidden = new Set(profile.profileSettings.hiddenSections)
  const maxMasteryXp = Math.max(1, ...profile.mastery.map((m) => m.xp))
  const focusMastery = profile.mastery.reduce((top, m) => (m.xp > (top?.xp ?? -1) ? m : top), profile.mastery[0])
  const heroStats = profile.notableStats.slice(0, 4)

  const growsSection = useProfileSection<GrowCard>(username, "grows", tab === "grows")
  const harvestsSection = useProfileSection<HarvestRow>(username, "harvests", tab === "harvests")

  const show = (id: string) => !hidden.has(id)

  return (
    <div className="min-h-screen bg-background">
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
                      <span className={profile.statusHidden ? "" : (profile.rank.nameplate ?? "")}>@{profile.username}</span>
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
                    </p>
                    {/* Progression identity row */}
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      <Tooltip content={`${profile.rank.name} rank — earned from community contributions`}>
                        <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", profile.rank.bg, profile.rank.color)}>
                          <span className="text-sm" aria-hidden="true">{profile.rank.icon}</span>
                          {profile.rank.name}
                        </span>
                      </Tooltip>
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
                    <Link href="/profile" className="shrink-0 rounded-full bg-secondary/70 px-3.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      Edit profile
                    </Link>
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
          items={[
            { id: "overview", label: "Overview" },
            { id: "grows", label: <>Grows <span className="opacity-60 text-xs tabular-nums">{profile.stats.diaryCreator}</span></> },
            { id: "harvests", label: <>Harvests <span className="opacity-60 text-xs tabular-nums">{profile.stats.harvestCount}</span></> },
            { id: "contributions", label: "Contributions" },
            { id: "about", label: "About" },
          ]}
        >
          {(active) => (
            <>
              {active === "overview" && (
                <div className="space-y-4">
                  {/* Featured grow — the member's own pick, distinct from the
                      automatically-derived active grow shown in the hero. */}
                  {profile.featuredGrow && show("featured") && (
                    <SectionCard title="Featured grow" id="featured-grow">
                      <GrowRow grow={profile.featuredGrow} />
                    </SectionCard>
                  )}

                  {/* Mastery map — "what kind of grower am I becoming".
                      Relative share bars, not five competing currencies. */}
                  {show("stats") && (
                    <SectionCard
                      title="Grower profile"
                      id="mastery-map"
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
                  {profile.notableStats.length > heroStats.length && show("stats") && (
                    <SectionCard title="At a glance" id="profile-stats">
                      <StatStrip
                        className="sm:grid-cols-4"
                        items={profile.notableStats.map((s) => ({ label: s.label, value: s.value, hint: s.hint }))}
                      />
                    </SectionCard>
                  )}

                  {/* Progression — informative, never the point of the page */}
                  {show("stats") && (
                    <SectionCard title="Progression" id="progression" actions={<Link href="/reputation" className="text-xs text-primary hover:underline">How it works</Link>}>
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
                            : <>{profile.xp} XP — top of the ladder</>}
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

                  {pinnedSection && (
                    <SectionCard title={pinnedSection.title} id="pinned-section">
                      <div className="prose-sm max-w-none text-sm"><MarkdownRenderer content={pinnedSection.body} /></div>
                    </SectionCard>
                  )}

                  {/* Recent public activity */}
                  <SectionCard title="Recent activity" id="recent-activity">
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
                </div>
              )}

              {active === "grows" && show("grows") && (
                <div className="space-y-4">
                  {profile.strainPortfolio.length > 0 && (
                    <SectionCard title="Strain portfolio" id="strain-portfolio" description="Strains across this member's visible grows">
                      <div className="flex flex-wrap gap-1.5">
                        {profile.strainPortfolio.map((s) => (
                          <Tag key={s.name} href={`/strains?q=${encodeURIComponent(s.name)}`}>
                            <Dna className="w-3 h-3 mr-1" aria-hidden="true" />
                            {s.name}
                            {s.grows > 1 && <span className="ml-1 text-primary font-medium">×{s.grows}</span>}
                          </Tag>
                        ))}
                      </div>
                    </SectionCard>
                  )}
                  <SectionCard title="Grow portfolio" id="grow-portfolio" description={`${profile.stats.diaryCreator} grow${profile.stats.diaryCreator === 1 ? "" : "s"} — active first`}>
                    {growsSection.items.length === 0 && !growsSection.loading ? (
                      <EmptyState compact icon={Sprout} title="No grows to show" description="Documented grows appear here as the member journals them." />
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
                  {profile.pinnedHarvest && (
                    <SectionCard title={<span className="flex items-center gap-1.5"><Pin className="w-4 h-4 text-warning" />Pinned harvest</span>} id="pinned-harvest">
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
                  <SectionCard title="Harvest shelf" id="harvest-shelf" description={`${profile.stats.harvestCount} completed grow${profile.stats.harvestCount === 1 ? "" : "s"}`}>
                    {harvestsSection.items.length === 0 && !harvestsSection.loading ? (
                      <EmptyState compact icon={Trophy} title="No harvests yet" description="Finished grows land here once they're harvested." />
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
                />
              )}

              {active === "about" && (
                <AboutTab profile={profile} />
              )}
            </>
          )}
        </Tabs>
      </div>
    </div>
  )
}

/* ── Contributions tab ───────────────────────────────────────────── */

function ContributionsTab({
  profile, recentThreads, growSetups, showAllBadges, setShowAllBadges,
}: {
  profile: PublicProfile
  recentThreads: Thread[]
  growSetups: GrowSetup[]
  showAllBadges: boolean
  setShowAllBadges: (v: boolean | ((p: boolean) => boolean)) => void
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
          id="accepted-answers"
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
        <SectionCard title="Experiments" id="experiments" description={`${profile.stats.experiments} documented experiment${profile.stats.experiments === 1 ? "" : "s"}`}>
          <ul className="space-y-2">
            {profile.experiments.map((e) => (
              <li key={e.id} className="flex items-start gap-2.5 rounded-lg p-2 -m-2">
                <FlaskConical className="w-4 h-4 text-primary shrink-0 mt-0.5" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm break-words">{e.title}</p>
                  <p className="text-xs text-muted-foreground">
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
        <SectionCard title="Grow setups" id="grow-setups" description={`${profile.stats.setups} shared`}>
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
        <SectionCard title="Contests" id="contests">
          <p className="text-sm flex items-center gap-2">
            <Trophy className="w-4 h-4 text-warning" aria-hidden="true" />
            <span><span className="font-semibold tabular-nums">{profile.stats.contestWins}</span> contest win{profile.stats.contestWins === 1 ? "" : "s"}</span>
          </p>
        </SectionCard>
      )}

      {recentThreads.length > 0 && (
        <SectionCard title="Discussions" id="discussions">
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
        <SectionCard title="Badges" id="badges">
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

function AboutTab({ profile }: { profile: PublicProfile }) {
  const identity = profile.profileSettings.identity
  const hasIdentity = profile.growExperience || profile.growSpace || profile.favoriteStrain ||
    identity.mediums.length > 0 || identity.styles.length > 0 || identity.goals
  const hasAnything = profile.bio || hasIdentity || profile.businessName || profile.customSections.length > 0

  if (!hasAnything) {
    return <EmptyState icon={User} title="Nothing here yet" description="This member hasn't shared an about section." />
  }

  return (
    <div className="space-y-4">
      {profile.bio && (
        <SectionCard title="Bio" id="bio">
          <p className="text-sm whitespace-pre-wrap break-words">{profile.bio}</p>
        </SectionCard>
      )}

      {hasIdentity && (
        <SectionCard title="Grower identity" id="grower-identity">
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

      {profile.businessName && (
        <SectionCard title="Business" id="business">
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
        <SectionCard
          key={s.id}
          id={`section-${s.id}`}
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
        </SectionCard>
      ))}
    </div>
  )
}

/* ── TerpBot profile ─────────────────────────────────────────────── */

function BotProfile({ data }: { data: ProfileResponse }) {
  const { profile } = data
  const joinDate = new Date(profile.joinDate).toLocaleDateString("en-US", { year: "numeric", month: "long" })
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-card/80 rounded-2xl border border-border/70 mb-5 overflow-hidden">
          <div className="tt-spectrum-bar h-1" />
          <div className="p-4 sm:p-5">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="rounded-full shrink-0">
                <Avatar src={profile.avatarUrl} alt="TerpBot avatar" size="xl" className="w-20 h-20 bg-primary/10 text-primary" fallback={<Bot className="w-10 h-10 text-primary" />} />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="font-display text-2xl font-bold mb-1 break-words flex items-center gap-2 tracking-tight">
                  @{profile.username} <RoleBadge role={profile.role} />
                  <Tooltip content="Automated community assistant — not a person">
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary px-1.5 py-0.5 rounded">
                      <Bot className="w-3 h-3" /> Bot
                    </span>
                  </Tooltip>
                </h1>
                <p className="text-muted-foreground text-sm mb-2 flex items-center gap-2 flex-wrap">
                  <span>Active since {joinDate}</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                    <Zap className="w-3 h-3" /> Automated community helper
                  </span>
                </p>
                <p className="text-xs text-muted-foreground mb-3">
                  I&apos;m TerpTalk&apos;s built-in assistant — mention <span className="text-primary font-medium">@terpbot</span> in chat or type <span className="text-primary font-medium">/help</span> to see what I can do.
                </p>
                {profile.botStats && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-x-3 gap-y-4 mt-4">
                    {[
                      { icon: Zap, v: profile.botStats.commands, l: "Commands answered" },
                      { icon: Users, v: profile.botStats.membersAssisted, l: "Members helped" },
                      { icon: Link2, v: profile.botStats.entityLinks, l: "Links shared" },
                      { icon: HandMetal, v: profile.botStats.welcomes, l: "Welcomes sent" },
                      { icon: CalendarClock, v: profile.botStats.daysActive, l: "Days active" },
                      { icon: Megaphone, v: profile.botStats.announcements, l: "Announcements" },
                      { icon: Bot, v: profile.botStats.assists, l: "Assists sent" },
                      { icon: Users, v: profile.stats.followers, l: "Followers" },
                    ].map((s) => (
                      <div key={s.l} className="text-center">
                        <div className="text-lg font-bold text-primary flex items-center justify-center gap-1"><s.icon className="w-4 h-4" />{s.v}</div>
                        <div className="text-xs text-muted-foreground">{s.l}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <SectionCard title={<span className="flex items-center gap-2"><Bot className="w-4 h-4 text-primary" />What I do</span>} className="mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
            {[
              { icon: MessageSquare, label: "Chat" }, { icon: Search, label: "Search" },
              { icon: Zap, label: "Threads" }, { icon: Sprout, label: "Diaries" },
              { icon: Dna, label: "Strains" }, { icon: BookOpen, label: "Guides" },
              { icon: Trophy, label: "Community" }, { icon: BarChart3, label: "Stats" },
            ].map((c) => (
              <div key={c.label} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs font-medium">
                <c.icon className="w-3.5 h-3.5 text-primary shrink-0" />
                {c.label}
              </div>
            ))}
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><HandMetal className="w-4 h-4 text-primary shrink-0 mt-0.5" /> Welcome new members and post the daily digest in <Link href="/chat" className="text-primary hover:underline">Chat</Link>.</li>
            <li className="flex gap-2"><MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" /> Answer questions when you mention <span className="text-primary font-medium">@terpbot</span> — XP, streaks, diaries, strains, guides, and more.</li>
            <li className="flex gap-2"><Zap className="w-4 h-4 text-primary shrink-0 mt-0.5" /> Summarize linked threads and check whether a question got answered — try <span className="text-primary font-medium">@terpbot summarize this</span>.</li>
            <li className="flex gap-2"><Sprout className="w-4 h-4 text-primary shrink-0 mt-0.5" /> Send you a private heads-up when it&apos;s useful — a welcome note, first-diary tips, or a nudge when one of your threads goes quiet.</li>
          </ul>
          {profile.botStats && Object.keys(profile.botStats.byCommand).length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Most-used commands</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(profile.botStats.byCommand)
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

        <SectionCard title={<span className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary" />How to use me</span>}>
          <div className="space-y-1.5">
            {[
              "@terpbot what's my rank?",
              "@terpbot summarize this thread",
              "@terpbot find cloning guides",
              "@terpbot next badges",
            ].map((ex) => (
              <code key={ex} className="block text-xs bg-secondary/50 rounded px-2.5 py-1.5 text-foreground/90">{ex}</code>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border flex items-start gap-1.5">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
            <span>
              I&apos;m fully automated — everything I say comes from real TerpTalk data, never a script pretending to be a grower. I&apos;m not a moderator, and I don&apos;t give personalized cultivation, legal, or medical advice — just general info. Manage my notifications in{" "}
              <Link href="/settings/notifications" className="text-primary hover:underline">settings</Link>.
              {profile.botStats?.hasFallbacks && <span className="block mt-1">If I miss your meaning, rephrase — I&apos;m still learning.</span>}
            </span>
          </p>
        </SectionCard>
      </div>
    </div>
  )
}
