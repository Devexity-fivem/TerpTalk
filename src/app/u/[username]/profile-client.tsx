"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useParams } from "next/navigation"
import { User, MessageSquare, Loader2, MapPin, Globe, Sprout, Dna, Leaf, Store, Flame, ChevronDown, ChevronUp, Bot, Zap, Users, Link2, HandMetal, CalendarClock, TrendingUp, Search, BookOpen, Trophy, BarChart3, AlertTriangle, Megaphone, Wrench } from "lucide-react"
import Link from "next/link"
import UserActions from "@/components/user-actions"
import RoleBadge from "@/components/role-badge"
import AchievementBadge from "@/components/achievement-badge"
import { Avatar } from "@/components/ui/avatar"
import Tooltip from "@/components/ui/tooltip"
import { getAvatarFrame, getProfileTheme } from "@/lib/cosmetics"
import { diaryPath, setupPath } from "@/lib/slugs"
import { cn } from "@/lib/utils"

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
  reputation: number
  trustLevel: string
  reputationTier: {
    name: string
    color: string
    bg: string
    icon: string
    benefit: string
  }
  tierProgress: {
    current: number
    next: number
    percent: number
  }
  repStage?: {
    level: number
    stageName: string
    stageIndex: number
    stageCount: number
    stageStart: number
    stageEnd: number
  }
  stageProgress?: {
    current: number
    next: number
    percent: number
    remaining: number
  }
  avatarFrame: string | null
  profileTitle: string | null
  customTitle: string | null
  profileTheme: string | null
  badges: Array<{ name: string; description: string; icon: string | null; pinned: boolean }>
  stats: {
    threadCreator: number
    posts: number
    diaryCreator: number
    followers: number
    following: number
  }
  botStats?: {
    commands: number
    membersAssisted: number
    entityLinks: number
    welcomes: number
    announcements: number
    daysActive: number
    assists: number
    byCommand: Record<string, number>
    hasFallbacks: boolean
  } | null
  growStreak: number
  totalUpdates: number
  harvestedDiaries: number
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

interface RepEvent {
  id: string
  label: string
  amount: number
  reversed: boolean
  createdAt: string
}

export default function ProfileClient() {
  const params = useParams()
  const { data: session } = useSession()
  const username = decodeURIComponent(String(params.username))
  const [data, setData] = useState<{ profile: PublicProfile; viewerBlocked: boolean; viewerFollowing: boolean; recentThreads: Thread[]; growDiaries: GrowDiary[]; growSetups: GrowSetup[]; harvestShelf: HarvestEntry[]; recentRep: RepEvent[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [showAllBadges, setShowAllBadges] = useState(false)

  useEffect(() => {
    fetch(`/api/users/${encodeURIComponent(username)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) { setNotFound(true); setLoading(false); return }
        const d = await res.json()
        setData(d)
        setLoading(false)
      })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [username])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
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

  const { profile, viewerBlocked, viewerFollowing, recentThreads, growDiaries, growSetups, harvestShelf, recentRep } = data
  const joinDate = new Date(profile.joinDate).toLocaleDateString("en-US", { year: "numeric", month: "long" })
  const frame = getAvatarFrame(profile.avatarFrame)
  const theme = getProfileTheme(profile.profileTheme)
  const pinnedBadges = profile.badges.filter((b) => b.pinned)
  const restBadges = profile.badges.filter((b) => !b.pinned)

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className={cn("bg-card/80 rounded-2xl border p-4 mb-5 overflow-hidden", theme ? theme.borderClass : "border-border/70", theme?.className)}>
          <div className="tt-spectrum-bar -mx-4 -mt-4 mb-4 h-1" />
          <div className="flex items-start gap-4 flex-wrap">
            <div className={cn("rounded-full shrink-0", frame?.className)}>
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
                <div>
                  <h1 className="font-display text-2xl font-bold mb-1 break-words flex items-center gap-2 tracking-tight">@{profile.username} <RoleBadge role={profile.role} />
                      {profile.isBot && (
                        <Tooltip content="Automated community assistant — not a person">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-primary/15 text-primary px-1.5 py-0.5 rounded">
                            <Bot className="w-3 h-3" /> Bot
                          </span>
                        </Tooltip>
                      )}</h1>
                  {profile.customTitle && (
                    <p className="text-xs font-semibold uppercase tracking-wider text-warning mb-1">{profile.customTitle}</p>
                  )}
                  <p className="text-muted-foreground text-sm mb-2 flex items-center gap-2 flex-wrap">
                    <span>{profile.isBot ? "Active since" : "Member since"} {joinDate}</span>
                    {profile.isBot ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                        <Zap className="w-3 h-3" /> Automated community helper
                      </span>
                    ) : (
                      <Tooltip content={`${profile.reputationTier.name} reputation tier — earned from community contributions`}>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${profile.reputationTier.bg} ${profile.reputationTier.color} text-xs font-medium`}>
                          <span className="text-sm">{profile.reputationTier.icon}</span>
                          {profile.reputationTier.name}
                        </span>
                      </Tooltip>
                    )}
                  </p>
                  {profile.isBot ? (
                    <p className="text-xs text-muted-foreground mb-3">
                      I&apos;m TerpTalk&apos;s built-in assistant — mention <span className="text-primary font-medium">@terpbot</span> in chat or type <span className="text-primary font-medium">/help</span> to see what I can do.
                    </p>
                  ) : (
                    <div className="mb-3">
                      {profile.repStage && (
                        <p className="text-xs text-muted-foreground mb-1">
                          Grow Level {profile.repStage.level}
                          <span className="mx-1">·</span>
                          {profile.repStage.stageName} stage
                          <span className="mx-1">·</span>
                          stage {profile.repStage.stageIndex + 1} of {profile.repStage.stageCount} as {profile.reputationTier.name}
                        </p>
                      )}
                      <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                        <span>
                          {profile.stageProgress && profile.stageProgress.next > 0
                            ? <>{profile.stageProgress.current} / {profile.stageProgress.next} rep to next stage</>
                            : <>{profile.reputation} rep — top of the ladder</>}
                        </span>
                        <span>{profile.stageProgress?.percent ?? profile.tierProgress.percent}%</span>
                      </div>
                      <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-spectrum transition-all"
                          style={{ width: `${profile.stageProgress?.percent ?? profile.tierProgress.percent}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {profile.reputation} rep total · {profile.reputationTier.benefit}
                      </p>
                    </div>
                  )}
                  {profile.bio && <p className="text-sm mb-3 break-words whitespace-pre-wrap">{profile.bio}</p>}
                  <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                    {profile.location && (
                      <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{profile.location}</span>
                    )}
                    {profile.website && (
                      <a href={profile.website} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 text-primary hover:underline">
                        <Globe className="w-3.5 h-3.5" />{profile.website.replace(/^https?:\/\//, "").slice(0, 40)}
                      </a>
                    )}
                    {profile.growExperience && (
                      <span className="flex items-center gap-1"><Sprout className="w-3.5 h-3.5" />{profile.growExperience}</span>
                    )}
                    {profile.favoriteStrain && (
                      <Link href={`/strains?q=${encodeURIComponent(profile.favoriteStrain)}`} className="flex items-center gap-1 hover:text-primary transition-colors"><Dna className="w-3.5 h-3.5" />{profile.favoriteStrain}</Link>
                    )}
                    {profile.growSpace && (
                      <span className="flex items-center gap-1"><Leaf className="w-3.5 h-3.5" />{profile.growSpace}</span>
                    )}
                  </div>
                </div>
                {session && session.user?.id !== profile.id && !profile.isBot && (
                  <UserActions userId={profile.id} username={profile.username} initiallyBlocked={viewerBlocked} initiallyFollowing={viewerFollowing} />
                )}
                {profile.businessName && (
                  <div className="mt-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
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
                  </div>
                )}
              </div>
              {profile.isBot && profile.botStats ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-x-3 gap-y-4 mt-4">
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary flex items-center justify-center gap-1"><Zap className="w-4 h-4" />{profile.botStats.commands}</div>
                    <div className="text-xs text-muted-foreground">Commands answered</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary flex items-center justify-center gap-1"><Users className="w-4 h-4" />{profile.botStats.membersAssisted}</div>
                    <div className="text-xs text-muted-foreground">Members helped</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary flex items-center justify-center gap-1"><Link2 className="w-4 h-4" />{profile.botStats.entityLinks}</div>
                    <div className="text-xs text-muted-foreground">Links shared</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary flex items-center justify-center gap-1"><HandMetal className="w-4 h-4" />{profile.botStats.welcomes}</div>
                    <div className="text-xs text-muted-foreground">Welcomes sent</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary flex items-center justify-center gap-1"><CalendarClock className="w-4 h-4" />{profile.botStats.daysActive}</div>
                    <div className="text-xs text-muted-foreground">Days active</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary flex items-center justify-center gap-1"><Megaphone className="w-4 h-4" />{profile.botStats.announcements}</div>
                    <div className="text-xs text-muted-foreground">Announcements</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary flex items-center justify-center gap-1"><Bot className="w-4 h-4" />{profile.botStats.assists}</div>
                    <div className="text-xs text-muted-foreground">Assists sent</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary">{profile.stats.followers}</div>
                    <div className="text-xs text-muted-foreground">Followers</div>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-x-3 gap-y-4 mt-4">
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary">{profile.reputation}</div>
                    <div className="text-xs text-muted-foreground">Reputation</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary">{profile.stats.threadCreator}</div>
                    <div className="text-xs text-muted-foreground">Threads</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary">{profile.stats.posts}</div>
                    <div className="text-xs text-muted-foreground">Posts</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary">{profile.stats.followers}</div>
                    <div className="text-xs text-muted-foreground">Followers</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary">{profile.stats.following}</div>
                    <div className="text-xs text-muted-foreground">Following</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary">{profile.stats.diaryCreator}</div>
                    <div className="text-xs text-muted-foreground">Diaries</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary">{profile.harvestedDiaries}</div>
                    <div className="text-xs text-muted-foreground">Harvests</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-primary">{profile.totalUpdates}</div>
                    <div className="text-xs text-muted-foreground">Updates</div>
                  </div>
                </div>
              )}
              {profile.growStreak >= 2 && (
                <Tooltip content="Consecutive days with a grow-diary update">
                  <div className="mt-4 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-warning text-xs font-semibold">
                    <Flame className="w-3.5 h-3.5" /> {profile.growStreak}-day grow streak
                  </div>
                </Tooltip>
              )}
              {pinnedBadges.length > 0 && (
                <div className="mt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Showcase</p>
                  <div className="flex flex-wrap gap-2">
                    {pinnedBadges.map((b) => (
                      <AchievementBadge key={b.name} name={b.name} mode="profile" />
                    ))}
                  </div>
                </div>
              )}
              {restBadges.length > 0 && (
                <div className="mt-4">
                  {pinnedBadges.length > 0 && (
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">All badges</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {(showAllBadges ? restBadges : restBadges.slice(0, 6)).map((b) => (
                      <AchievementBadge key={b.name} name={b.name} mode="profile" />
                    ))}
                  </div>
                  {restBadges.length > 6 && (
                    <button
                      onClick={() => setShowAllBadges((v) => !v)}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
                    >
                      {showAllBadges ? (
                        <>Show less <ChevronUp className="w-3 h-3" /></>
                      ) : (
                        <>View all {restBadges.length} badges <ChevronDown className="w-3 h-3" /></>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {!profile.isBot && recentRep.length > 0 && (
          <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <h2 className="font-display text-lg font-semibold">Reputation</h2>
              </div>
              <Link href="/reputation" className="text-xs text-primary hover:underline">How it works</Link>
            </div>
            <div className="space-y-1">
              {recentRep.map((e) => (
                <div key={e.id} className={`flex items-center justify-between text-sm py-1 ${e.reversed ? "opacity-50" : ""}`}>
                  <span className={`truncate ${e.reversed ? "line-through" : ""}`}>{e.label}{e.reversed ? " (reversed)" : ""}</span>
                  <span className="flex items-center gap-3 shrink-0 ml-3">
                    <span className="text-xs text-muted-foreground">{new Date(e.createdAt).toLocaleDateString()}</span>
                    <span className={`font-medium w-10 text-right ${e.amount >= 0 ? "text-primary" : "text-destructive"}`}>{e.amount >= 0 ? "+" : ""}{e.amount}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {profile.isBot ? (
          <>
            <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <Bot className="w-4 h-4 text-primary" />
                <h2 className="font-display text-lg font-semibold">What I do</h2>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {[
                  { icon: MessageSquare, label: "Chat" },
                  { icon: Search, label: "Search" },
                  { icon: Zap, label: "Threads" },
                  { icon: Sprout, label: "Diaries" },
                  { icon: Dna, label: "Strains" },
                  { icon: BookOpen, label: "Guides" },
                  { icon: Trophy, label: "Community" },
                  { icon: BarChart3, label: "Stats" },
                ].map((c) => (
                  <div key={c.label} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs font-medium">
                    <c.icon className="w-3.5 h-3.5 text-primary shrink-0" />
                    {c.label}
                  </div>
                ))}
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2"><HandMetal className="w-4 h-4 text-primary shrink-0 mt-0.5" /> Welcome new members and post the daily digest in <Link href="/chat" className="text-primary hover:underline">Chat</Link>.</li>
                <li className="flex gap-2"><MessageSquare className="w-4 h-4 text-primary shrink-0 mt-0.5" /> Answer questions when you mention <span className="text-primary font-medium">@terpbot</span> — rep, streaks, diaries, strains, guides, and more.</li>
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
            </div>
            <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
              <div className="flex items-center gap-2 mb-3">
                <MessageSquare className="w-4 h-4 text-primary" />
                <h2 className="font-display text-lg font-semibold">How to use me</h2>
              </div>
              <div className="space-y-1.5">
                {[
                  "@terpbot what's my reputation?",
                  "@terpbot summarize this thread",
                  "@terpbot find cloning guides",
                  "@terpbot next badges",
                ].map((ex) => (
                  <code key={ex} className="block text-xs bg-secondary/50 rounded px-2.5 py-1.5 text-foreground/90">{ex}</code>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                I&apos;m fully automated — everything I say comes from real TerpTalk data, never a script pretending to be a grower. I&apos;m not a moderator, and I don&apos;t give personalized cultivation, legal, or medical advice — just general info. Manage my notifications in{" "}
                <Link href="/settings/notifications" className="text-primary hover:underline">settings</Link>.
                {profile.botStats?.hasFallbacks && (
                  <span className="block mt-1">If I miss your meaning, rephrase — I&apos;m still learning.</span>
                )}
              </p>
            </div>
          </>
        ) : (
          <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-4 h-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Recent Discussions</h2>
          </div>
          {recentThreads.length === 0 ? (
            <p className="text-muted-foreground">No discussions yet</p>
          ) : (
            <div className="space-y-2">
              {recentThreads.map((t) => (
                <Link
                  key={t.id}
                  href={`/forum/thread/${t.slug}`}
                  className="block p-3 rounded-lg hover:bg-secondary/50 transition-colors"
                >
                  <h3 className="font-medium mb-1 break-words">{t.title}</h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{t.category.name}</span>
                    <span>•</span>
                    <span>{t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}</span>
                    <span>•</span>
                    <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
        )}

        {!profile.isBot && harvestShelf.length > 0 && (
        <div className="bg-card rounded-lg border border-amber-500/30 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy className="w-4 h-4 text-warning" />
            <h2 className="font-display text-lg font-semibold">Harvest Shelf</h2>
            <span className="text-xs text-muted-foreground">{harvestShelf.length} completed grow{harvestShelf.length === 1 ? "" : "s"}</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {harvestShelf.map((h) => {
              const days = h.harvestedAt
                ? Math.max(0, Math.round((new Date(h.harvestedAt).getTime() - new Date(h.startDate).getTime()) / 86400000))
                : null
              return (
                <Link
                  key={h.id}
                  href={diaryPath(h)}
                  className="block p-3 rounded-lg border border-border hover:border-amber-500/40 transition-colors"
                >
                  <h3 className="font-medium text-sm mb-1 break-words truncate">{h.title}</h3>
                  <p className="text-xs text-muted-foreground">
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
                    <span className="text-muted-foreground"> • {h._count.updates} updates</span>
                  </p>
                </Link>
              )
            })}
          </div>
        </div>
        )}

        {!profile.isBot && growSetups.length > 0 && (
        <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Wrench className="w-4 h-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Grow Setups</h2>
            <span className="text-xs text-muted-foreground">{growSetups.length} shared</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {growSetups.map((s) => (
              <Link
                key={s.id}
                href={setupPath(s)}
                className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/40 transition-colors"
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
                  <h3 className="font-medium text-sm truncate">{s.title}</h3>
                  <p className="text-xs text-muted-foreground truncate">
                    {s.strain ? `${s.strain} • ` : ""}{s._count.comments} comment{s._count.comments === 1 ? "" : "s"}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
        )}

        {!profile.isBot && (
        <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <Sprout className="w-4 h-4 text-primary" />
            <h2 className="font-display text-lg font-semibold">Recent Grows</h2>
          </div>
          {growDiaries.length === 0 ? (
            <p className="text-muted-foreground">No grow diaries yet</p>
          ) : (
            <div className="space-y-2">
              {growDiaries.map((d) => (
                <Link
                  key={d.id}
                  href={diaryPath(d)}
                  className="block p-3 rounded-lg hover:bg-secondary/50 transition-colors"
                >
                  <h3 className="font-medium mb-1 break-words">{d.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    {d.stage.replace("_", " ")} {d.strain ? "• " + d.strain : ""} • {d._count.updates} updates • {d._count.followers} followers
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  )
}
