import { prisma } from "@/lib/prisma"
import { publicUserSelect, activeAuthor, blockedUserIds } from "@/lib/security"
import { notFound, permanentRedirect } from "next/navigation"
import { Leaf, Calendar, Users, ClipboardCheck, Camera, TrendingUp, Pencil, Sprout, Link2, Lock, MessagesSquare } from "lucide-react"
import Link from "next/link"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import UpdateForm from "@/components/update-form"
import DiaryFollowButton from "@/components/diary-follow-button"
import ShareButtons from "@/components/share-buttons"
import { buildMetadata, snippet } from "@/lib/seo"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { JsonLd } from "@/components/json-ld"
import { EnvChartsLazy as EnvCharts, HeightChartLazy as HeightChart } from "@/components/diary-charts"
import HarvestForm from "@/components/harvest-form"
import StageTimeline from "@/components/stage-timeline"
import TierChip from "@/components/tier-chip"
import { getGrowJourney, GROW_STAGES } from "@/lib/grow-journey"
import UpdateEditSection from "@/components/update-edit-form"
import { groupUpdatesByWeek, buildHarvestReport, diaryCompleteness, diaryDay, diaryWeek, growthSummary, stageDurations } from "@/lib/diary-weeks"
import ReportButton from "@/components/report-button"
import DiaryReactions from "@/components/diary-reactions"
import OwnerDeleteButton from "@/components/owner-delete-button"
import DiaryDiscussButton from "@/components/diary-discuss-button"
import { escapeLike, strainFieldMatches, suggestStrainLink } from "@/lib/strain-stats"
import UserPopover from "@/components/user-popover"
import { MEDIUM_LABELS, LIGHT_LABELS, TECHNIQUE_LABELS, DIFFICULTY_LABELS } from "@/lib/grow-fields"
import { canViewDiary, publicDiaryWhere } from "@/lib/diary-visibility"
import { diaryPath, strainPath, setupPath } from "@/lib/slugs"
import Tooltip from "@/components/ui/tooltip"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [diary, session] = await Promise.all([
    prisma.growDiary.findFirst({
      where: { OR: [{ slug: id }, { id }] },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        strain: true,
        deleted: true,
        visibility: true,
        authorId: true,
        author: { select: { banned: true, suspendedUntil: true } },
      },
    }),
    getServerSession(authOptions),
  ])
  const authorInactive =
    !!diary &&
    (diary.author.banned ||
      (diary.author.suspendedUntil && diary.author.suspendedUntil.getTime() > Date.now()))
  if (!diary || diary.deleted || authorInactive || !canViewDiary(diary, session?.user?.id)) {
    return buildMetadata({ title: "Diary not found", robots: { index: false } })
  }
  if (diary.visibility === "UNLISTED") {
    // Unlisted grows are reachable by link but must not be indexed.
    return buildMetadata({
      title: `${diary.title} — Cannabis Grow Diary${diary.strain ? ` (${diary.strain})` : ""}`,
      description: snippet(diary.description || `Cannabis grow diary${diary.strain ? ` — ${diary.strain}` : ""} on TerpTalk.`),
      robots: { index: false, follow: false },
    })
  }
  return buildMetadata({
    title: `${diary.title} — Cannabis Grow Diary${diary.strain ? ` (${diary.strain})` : ""}`,
    description: snippet(diary.description || `Cannabis grow diary${diary.strain ? ` — ${diary.strain}` : ""} on TerpTalk.`),
    keywords: [diary.strain || "cannabis", "grow diary", "grow journal"],
    pathname: diaryPath(diary),
    og: { type: "article" },
  })
}

async function getDiaryData(id: string, viewerId?: string | null) {
  const diary = await prisma.growDiary.findFirst({
    where: { OR: [{ slug: id }, { id }] },
    include: {
      author: { select: { ...publicUserSelect, banned: true, suspendedUntil: true } },
      strainRef: { select: { id: true, slug: true, name: true } },
      setup: { select: { id: true, slug: true, title: true, deleted: true } },
      discussion: { select: { id: true, slug: true, deleted: true } },
      updates: {
        include: {
          author: { select: publicUserSelect },
          images: { take: 12, orderBy: { order: "asc" } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
      _count: {
        select: { followers: true, updates: true },
      },
    },
  })

  const authorInactive =
    !diary ||
    diary.author.banned ||
    (diary.author.suspendedUntil && diary.author.suspendedUntil.getTime() > Date.now())
  if (!diary || diary.deleted || authorInactive || !canViewDiary(diary, viewerId)) {
    notFound()
  }

  // Legacy id URL → canonical slug URL. This runs AFTER the existence,
  // deletion, and visibility gates above, so a 308 can never leak whether
  // a PRIVATE diary exists. Rows without a slug (created mid-deploy) keep
  // serving at their id URL.
  if (id === diary.id && diary.slug) {
    permanentRedirect(diaryPath(diary))
  }

  return diary
}

export default async function DiaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  const [diary, blockedIds] = await Promise.all([
    getDiaryData(id, session?.user?.id),
    blockedUserIds(session?.user?.id),
  ])
  // Fetch the most recent 100 updates and restore chronological order for the timeline.
  const updates = [...diary.updates].reverse()
  // Related-grows matching: a structured strainId or setupId link is exact;
  // the free-text strain field is a recall pre-filter checked by
  // strainFieldMatches below. growType is the fallback when the diary has
  // no strain/setup linkage at all.
  const similarOr = [
    ...(diary.strainId ? [{ strainId: diary.strainId }] : []),
    ...(diary.setupId ? [{ setupId: diary.setupId }] : []),
    ...(diary.strain ? [{ strain: { contains: escapeLike(diary.strain), mode: "insensitive" as const } }] : []),
  ]
  if (similarOr.length === 0) similarOr.push({ growType: diary.growType } as never)

  const [following, linkedStrain, journey, growthUpdates, moreFromAuthor, similarRaw] = await Promise.all([
    session?.user?.id
      ? !!(await prisma.diaryFollow.findUnique({
          where: { userId_diaryId: { userId: session.user.id, diaryId: diary.id } },
          select: { id: true },
        }))
      : false,
    diary.strain ? suggestStrainLink(diary.strain) : null,
    getGrowJourney(diary.id),
    // Lean analytics series — the updates payload above is capped at 100,
    // which would silently drop early history from long grows. This query
    // carries only what the height chart and stage spans need.
    prisma.diaryUpdate.findMany({
      where: { diaryId: diary.id },
      select: { id: true, createdAt: true, stage: true, heightCm: true },
      orderBy: { createdAt: "asc" },
      take: 500,
    }),
    // More from this grower — bounded, active grows only. The owner sees
    // all their own diaries; everyone else only sees PUBLIC ones.
    prisma.growDiary.findMany({
      where: {
        authorId: diary.author.id,
        deleted: false,
        id: { not: diary.id },
        author: activeAuthor(),
        ...(session?.user?.id === diary.author.id ? {} : publicDiaryWhere),
      },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: {
        updates: { take: 1, orderBy: { createdAt: "desc" }, select: { images: { take: 1, orderBy: { order: "asc" }, select: { url: true } } } },
        _count: { select: { updates: true, followers: true } },
      },
    }),
    // Similar grows — other growers only; this author's other diaries are
    // covered by the section above. Blocked authors are excluded, matching
    // every other discovery surface.
    prisma.growDiary.findMany({
      where: {
        deleted: false,
        author: activeAuthor(),
        ...publicDiaryWhere,
        id: { not: diary.id },
        // Both constraints on one key — a spread + a second `authorId` key
        // would silently clobber the block filter (object-spread collision).
        authorId: { not: diary.author.id, ...(blockedIds.length ? { notIn: blockedIds } : {}) },
        OR: similarOr,
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
      include: {
        author: { select: publicUserSelect },
        updates: { take: 1, orderBy: { createdAt: "desc" }, select: { images: { take: 1, orderBy: { order: "asc" }, select: { url: true } } } },
        _count: { select: { updates: true, followers: true } },
      },
    }),
  ])
  // The explicit catalog link wins over the fuzzy text match.
  const strainLink = diary.strainRef ?? linkedStrain

  // Precision post-filter for the strain-text recall path — structured
  // strainId/setupId matches count only when the diary actually carries
  // them (null === null would pass everything), and growType only counts
  // when it was the OR fallback.
  const growTypeWasFallback = similarOr.length === 1 && "growType" in similarOr[0]
  const similarGrows = similarRaw
    .filter(
      (d) =>
        (diary.strainId != null && d.strainId === diary.strainId) ||
        (diary.setupId != null && d.setupId === diary.setupId) ||
        (growTypeWasFallback && d.growType === diary.growType) ||
        (diary.strain ? strainFieldMatches(d.strain, diary.strain) : false)
    )
    .slice(0, 6)

  // eslint-disable-next-line react-hooks/purity
  const dayCount = Math.max(0, Math.floor((Date.now() - new Date(diary.startDate).getTime()) / 86400000))

  const now = new Date()

  // Growth summary + stage spans — the lean series covers the full grow
  // (the timeline payload is capped at 100 updates).
  const growth = growthSummary(diary, growthUpdates, now)
  // Mirrors EnvCharts' own render guard so the chart bundle is only
  // requested when there is something to plot.
  const hasEnvChartData =
    updates.filter((u) => u.temperature != null || u.humidity != null || u.vpd != null).length >= 2 ||
    updates.filter((u) => u.ph != null || u.ec != null).length >= 2
  // Stage timeline — elapsed-day runs from update stage snapshots; the
  // current stage extends through now (or harvest day when harvested).
  const stageRuns = stageDurations(diary, growthUpdates, now)

  // Harvest estimate — first FLOWER update + 9 weeks typical flower time
  const flip = updates.find((u) => u.stage === "FLOWER")
  const harvestEta = flip
    // eslint-disable-next-line react-hooks/purity
    ? Math.round((new Date(flip.createdAt).getTime() + 63 * 86400000 - Date.now()) / 86400000)
    : null

  // Env vitals — averages across updates
  const temps = updates.map((u) => u.temperature).filter((v): v is number => v != null)
  const rhs = updates.map((u) => u.humidity).filter((v): v is number => v != null)
  const avgTemp = temps.length ? (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : null
  const avgRh = rhs.length ? Math.round(rhs.reduce((a, b) => a + b, 0) / rhs.length) : null

  // Update streak: consecutive days with updates (most recent run)
  const days = [...new Set(updates.map((u) => new Date(u.createdAt).toDateString()))].map((d) => new Date(d).getTime()).sort((a, b) => b - a)
  let streak = 0
  for (let i = 0; i < days.length; i++) {
    const expected = days[0] - i * 86400000
    if (Math.abs(days[i] - expected) < 43200000) streak++
    else break
  }

  // Diary reactions — aggregate counts + the viewer's own reaction. Reactor
  // identities are never shipped to the client.
  const reactionRows = await prisma.reaction.findMany({
    where: { diaryId: diary.id },
    select: { userId: true, type: true },
  })
  const reactionCounts: Record<string, number> = {}
  let myReaction: string | null = null
  for (const r of reactionRows) {
    reactionCounts[r.type] = (reactionCounts[r.type] || 0) + 1
    if (r.userId === session?.user?.id) myReaction = r.type
  }

  const canEdit = session?.user?.id === diary.author.id || (session?.user as { role?: string } | undefined)?.role === "ADMINISTRATOR"

  // Week-organized timeline — weeks derived from update dates vs startDate
  const weeks = groupUpdatesByWeek(updates, diary.startDate)
  const harvestReport = buildHarvestReport(diary, updates)
  const completeness = canEdit ? diaryCompleteness(diary, updates) : null
  const truncated = diary._count.updates > updates.length

  const diaryBase = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"
  const diaryUrl = `${diaryBase}${diaryPath(diary)}`
  const authorName = diary.author.profile?.username || diary.author.name || "Member"
  const diarySchema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: diary.title,
    description: snippet(diary.description || `Cannabis grow diary${diary.strain ? ` — ${diary.strain}` : ""} on TerpTalk.`),
    author: { "@type": "Person", name: authorName, url: `${diaryBase}/u/${authorName}` },
    datePublished: diary.createdAt.toISOString(),
    dateModified: diary.updatedAt.toISOString(),
    url: diaryUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": diaryUrl },
    publisher: { "@type": "Organization", name: "TerpTalk", url: diaryBase },
    keywords: [diary.strain, "grow diary", "grow journal", "cannabis cultivation"].filter(Boolean).join(", "),
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: "https://schema.org/CommentAction",
      userInteractionCount: diary._count.updates,
    },
  }

  return (
    <div className="min-h-screen bg-background" data-tt-diary={JSON.stringify({ id: diary.id, title: diary.title, stage: diary.stage, harvested: diary.harvested, own: canEdit })}>
      <div className="max-w-7xl mx-auto px-4 py-8">
        {diary.visibility === "PUBLIC" && <JsonLd data={diarySchema} />}
        <Breadcrumbs items={[
          { label: "Grow Diaries", href: "/diaries" },
          { label: diary.title },
        ]} />
        {/* Header */}
        <div className="mb-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {diary.featured && (
                  <span className="rounded-full bg-amber-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-warning">
                    Featured
                  </span>
                )}
                <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-primary">
                  {diary.growType}
                </span>
                <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {diary.stage}
                </span>
                {diary.harvested && (
                  <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-success">
                    Harvested
                  </span>
                )}
                {canEdit && diary.visibility === "UNLISTED" && (
                  <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                    <Link2 className="w-3 h-3" /> Unlisted
                  </span>
                )}
                {canEdit && diary.visibility === "PRIVATE" && (
                  <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground inline-flex items-center gap-1">
                    <Lock className="w-3 h-3" /> Private
                  </span>
                )}
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-bold mb-2 tracking-tight">{diary.title}</h1>
              <p className="text-sm text-muted-foreground mb-3">{diary.description}</p>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  <UserPopover username={diary.author.profile?.username}>
                    <Link
                      href={`/u/${diary.author.profile?.username || diary.author.name}`}
                      className="hover:text-foreground hover:underline"
                    >
                      {diary.author.profile?.username || diary.author.name}
                    </Link>
                  </UserPopover>
                  <TierChip reputation={diary.author.profile?.reputation ?? 0} publicMilestoneOptOut={diary.author.profile?.publicMilestoneOptOut} />
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  Started {new Date(diary.startDate).toLocaleDateString()}
                </span>
                <span className="flex items-center gap-1">
                  <Leaf className="w-3.5 h-3.5" />
                  {diary._count.updates} updates
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {diary._count.followers} followers
                </span>
                <Tooltip content="Days since this grow started">
                  <span className="flex items-center gap-1 font-medium text-primary">
                    <Calendar className="w-3.5 h-3.5" />
                    Day {dayCount}
                  </span>
                </Tooltip>
                {streak >= 2 && (
                  <Tooltip content="Consecutive days with a diary update">
                    <span className="flex items-center gap-1 text-warning font-medium">
                      🔥 {streak}-day streak
                    </span>
                  </Tooltip>
                )}
              </div>
              <StageTimeline current={diary.stage} runs={stageRuns} />

              {/* Grow Journey — derived milestones with rep rewards */}
              {journey && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                  <div className="flex items-center gap-1.5">
                    {GROW_STAGES.map((s, i) => (
                      <Tooltip
                        key={s.key}
                        content={
                          i <= journey.stageIndex
                            ? `${s.name} — reached${s.rep > 0 ? ` · +${s.rep} rep` : ""}`
                            : `${s.name} — not reached yet`
                        }
                      >
                        <span
                          className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-sm ${
                            i <= journey.stageIndex ? "bg-primary/15 ring-1 ring-primary/40" : "bg-secondary/60 opacity-50"
                          }`}
                        >
                          {s.icon}
                        </span>
                      </Tooltip>
                    ))}
                    <span className="ml-1 font-medium text-foreground">{journey.stage === "PLANTED" ? "Planted" : GROW_STAGES[journey.stageIndex].name}</span>
                  </div>
                  {journey.next && (
                    <span className="text-muted-foreground">
                      Next: {journey.next.icon} {journey.next.name} — {journey.next.summary}
                    </span>
                  )}
                </div>
              )}

              {/* Vitals row */}
              {(avgTemp || avgRh || harvestEta !== null) && (
                <div className="flex flex-wrap gap-4 mt-4 text-sm">
                  {avgTemp && <span className="text-muted-foreground">avg temp <span className="text-foreground font-medium">{avgTemp}°</span></span>}
                  {avgRh && <span className="text-muted-foreground">avg RH <span className="text-foreground font-medium">{avgRh}%</span></span>}
                  {harvestEta !== null && harvestEta > 0 && (
                    <Tooltip content="Estimated from the first flower-stage update">
                      <span className="text-muted-foreground">est. harvest in <span className="text-primary font-medium">{harvestEta}d</span></span>
                    </Tooltip>
                  )}
                  {harvestEta !== null && harvestEta <= 0 && (
                    <span className="text-primary font-medium">🌾 Past estimated harvest window</span>
                  )}
                </div>
              )}


            </div>
            <div className="flex flex-col sm:items-end gap-1">
              <div className="flex flex-wrap gap-2 items-center sm:justify-end">
                <DiaryReactions diaryId={diary.id} initialCounts={reactionCounts} initialMine={myReaction} />
                {diary.visibility !== "PRIVATE" && (
                  <DiaryFollowButton diaryId={diary.id} initiallyFollowing={following} />
                )}
                {diary.visibility === "PUBLIC" && (
                  <DiaryDiscussButton
                    diaryId={diary.id}
                    diaryHref={diaryPath(diary)}
                    existingSlug={diary.discussion && !diary.discussion.deleted ? diary.discussion.slug : null}
                  />
                )}
                <ShareButtons path={diaryPath(diary)} title={`${diary.title} — grow diary on TerpTalk`} />
                {canEdit && (
                  <Tooltip content="Edit diary">
                    <Link
                      href={`/diaries/${diary.id}/edit`}
                      aria-label="Edit diary"
                      className="inline-flex items-center justify-center p-2 rounded-lg hover:bg-secondary transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </Link>
                  </Tooltip>
                )}
                <OwnerDeleteButton
                  endpoint="/api/diaries"
                  id={diary.id}
                  authorId={diary.author.id}
                  confirmText="Delete this diary? This permanently removes the diary, its updates, and its photos."
                  redirectTo="/diaries"
                  iconOnly
                />
                <ReportButton type="DIARY" targetId={diary.id} authorId={diary.author.id} />
              </div>
              {!following && (
                <p className="text-xs text-muted-foreground">Follow this diary to get notified of new updates.</p>
              )}
            </div>
          </div>
        </div>

        {canEdit && (
          <HarvestForm
            diaryId={diary.id}
            canEdit={canEdit}
            initialHarvested={diary.harvested}
            initialAmount={diary.yieldAmount}
            initialUnit={diary.yieldUnit}
            initialAt={diary.harvestedAt}
            initialRating={diary.harvestRating}
            initialDifficulty={diary.harvestDifficulty}
            initialNotes={diary.harvestNotes}
          />
        )}

        {/* Harvest report — the grow's final result, shown to everyone */}
        {harvestReport && (
          <div className="bg-card/80 rounded-2xl border border-border/70 p-5 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardCheck className="w-4 h-4 text-success" />
              <h2 className="font-display font-semibold">Harvest Report</h2>
              {harvestReport.yieldAmount != null && (
                <span className="ml-auto px-2.5 py-1 rounded-lg bg-emerald-500/10 text-success font-medium text-sm">
                  {harvestReport.yieldAmount} {harvestReport.yieldUnit || "g"}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-primary">{harvestReport.totalDays}</div>
                <div className="text-xs text-muted-foreground">total days</div>
              </div>
              {harvestReport.vegDays != null && (
                <div>
                  <div className="text-2xl font-bold">{harvestReport.vegDays}</div>
                  <div className="text-xs text-muted-foreground">veg days</div>
                </div>
              )}
              {harvestReport.flowerDays != null && (
                <div>
                  <div className="text-2xl font-bold">{harvestReport.flowerDays}</div>
                  <div className="text-xs text-muted-foreground">flower days</div>
                </div>
              )}
              <div>
                <div className="text-2xl font-bold">{harvestReport.updateCount}</div>
                <div className="text-xs text-muted-foreground">updates</div>
              </div>
              <div>
                <div className="text-2xl font-bold">{harvestReport.photoCount}</div>
                <div className="text-xs text-muted-foreground">photos</div>
              </div>
              {harvestReport.avgTemp != null && (
                <div>
                  <div className="text-2xl font-bold">{harvestReport.avgTemp}°</div>
                  <div className="text-xs text-muted-foreground">avg temp</div>
                </div>
              )}
              {harvestReport.avgHumidity != null && (
                <div>
                  <div className="text-2xl font-bold">{harvestReport.avgHumidity}%</div>
                  <div className="text-xs text-muted-foreground">avg RH</div>
                </div>
              )}
              {harvestReport.avgVpd != null && (
                <div>
                  <div className="text-2xl font-bold">{harvestReport.avgVpd}</div>
                  <div className="text-xs text-muted-foreground">
                    <Tooltip content="Vapor pressure deficit — a combined measure of temperature and humidity stress">avg VPD</Tooltip>
                  </div>
                </div>
              )}
            </div>
            {(harvestReport.stageDays.length > 0 || harvestReport.trainingTechniques.length > 0) && (
              <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                {harvestReport.stageDays.map((s) => (
                  <span key={s.stage}>{s.stage.toLowerCase()} {s.days}d</span>
                ))}
                {harvestReport.trainingTechniques.length > 0 && (
                  <span>training: {harvestReport.trainingTechniques.join(", ")}</span>
                )}
              </div>
            )}
            {(diary.harvestRating != null || diary.harvestDifficulty || diary.harvestNotes) && (
              <div className="mt-4 pt-4 border-t border-border">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {diary.harvestRating != null && (
                    <span className="font-medium">
                      Strain rating: <span className="text-primary">{diary.harvestRating}/10</span>
                    </span>
                  )}
                  {diary.harvestDifficulty && (
                    <span className="text-muted-foreground">
                      Difficulty: {DIFFICULTY_LABELS[diary.harvestDifficulty as keyof typeof DIFFICULTY_LABELS] ?? diary.harvestDifficulty}
                    </span>
                  )}
                </div>
                {diary.harvestNotes && (
                  <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{diary.harvestNotes}</p>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              Harvested {harvestReport.harvestedAt.toLocaleDateString()} · started {new Date(diary.startDate).toLocaleDateString()}
            </p>
          </div>
        )}

        {/* Completeness nudge — owner only, encourages better records */}
        {completeness && !diary.harvested && completeness.percent < 100 && (
          <div className="bg-card/80 rounded-2xl border border-border/70 p-4 mt-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium">Log completeness</span>
              <span className="text-muted-foreground text-xs">{completeness.percent}%</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden mb-2">
              <div className="h-full bg-primary rounded-full" style={{ width: `${completeness.percent}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              Make this grow more useful: {completeness.missing.join(" · ")}
            </p>
          </div>
        )}

        {/* Grow Setup Info */}
        <details className="bg-card/80 rounded-2xl border border-border/70 mb-8 group">
          <summary className="p-4 text-sm font-semibold cursor-pointer flex items-center justify-between list-none marker:content-none">
            <span>Grow setup</span>
            <span aria-hidden="true" className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <div className="px-4 pb-4">
            <div className="grid md:grid-cols-3 gap-4">
            {diary.strain && (
              <div>
                <span className="text-sm text-muted-foreground">Strain:</span>
                {strainLink ? (
                  <Link href={strainPath(strainLink)} className="font-medium text-primary hover:underline block">
                    {diary.strain}
                  </Link>
                ) : (
                  <p className="font-medium">{diary.strain}</p>
                )}
              </div>
            )}
            {diary.setup && !diary.setup.deleted && (
              <div>
                <span className="text-sm text-muted-foreground">Setup:</span>
                <Link href={setupPath(diary.setup)} className="font-medium text-primary hover:underline block">
                  {diary.setup.title}
                </Link>
              </div>
            )}
            {diary.genetics && (
              <div>
                <span className="text-sm text-muted-foreground">Genetics:</span>
                <p className="font-medium">{diary.genetics}</p>
              </div>
            )}
            {(diary.mediumType || diary.medium) && (
              <div>
                <span className="text-sm text-muted-foreground">Medium:</span>
                <p className="font-medium">
                  {diary.mediumType ? MEDIUM_LABELS[diary.mediumType as keyof typeof MEDIUM_LABELS] ?? diary.mediumType : ""}
                  {diary.mediumType && diary.medium ? " — " : ""}
                  {diary.medium}
                </p>
              </div>
            )}
            {diary.containerSize && (
              <div>
                <span className="text-sm text-muted-foreground">Container:</span>
                <p className="font-medium">{diary.containerSize}</p>
              </div>
            )}
            {(diary.lightType || diary.lighting) && (
              <div>
                <span className="text-sm text-muted-foreground">Lighting:</span>
                <p className="font-medium">
                  {diary.lightType ? LIGHT_LABELS[diary.lightType as keyof typeof LIGHT_LABELS] ?? diary.lightType : ""}
                  {diary.lightType && diary.lighting ? " — " : ""}
                  {diary.lighting}
                </p>
              </div>
            )}
            {diary.nutrients && (
              <div>
                <span className="text-sm text-muted-foreground">Nutrients:</span>
                <p className="font-medium">{diary.nutrients}</p>
              </div>
            )}
            {diary.spaceDimensions && (
              <div>
                <span className="text-sm text-muted-foreground">Space:</span>
                <p className="font-medium">{diary.spaceDimensions}</p>
              </div>
            )}
          </div>
          {diary.equipment && (
            <div className="mt-4">
              <span className="text-sm text-muted-foreground">Equipment:</span>
              <p className="font-medium">{diary.equipment}</p>
            </div>
          )}
          {diary.techniques.length > 0 && (
            <div className="mt-4">
              <span className="text-sm text-muted-foreground">Techniques:</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {diary.techniques.map((t) => (
                  <span key={t} className="text-xs px-2 py-1 bg-secondary rounded">
                    {TECHNIQUE_LABELS[t as keyof typeof TECHNIQUE_LABELS] ?? t}
                  </span>
                ))}
              </div>
            </div>
          )}
          </div>
        </details>

        {/* Timeline — grouped by grow week, with desktop context rail */}
        <div className="lg:grid lg:grid-cols-[1fr_240px] lg:gap-6">
        <div className="space-y-4 min-w-0">
          <div className="flex justify-between items-center">
            <h2 className="font-display text-lg font-semibold">Grow Timeline</h2>
            {canEdit && (
              <UpdateForm
                diaryId={diary.id}
                currentStage={diary.stage}
                currentDay={diaryDay(diary.startDate, new Date())}
                currentWeek={diaryWeek(diary.startDate, new Date())}
              />
            )}
          </div>

          {weeks.length > 1 && (
            <nav aria-label="Jump to week" className="flex flex-wrap gap-1.5">
              {weeks.map((w) => (
                <a
                  key={w.week}
                  href={`#week-${w.week}`}
                  className="text-xs px-2.5 py-1 rounded-full bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground transition-colors"
                >
                  W{w.week}
                </a>
              ))}
            </nav>
          )}

          <section className="bg-card/80 rounded-2xl border border-border/70 p-4 mb-4" aria-label="Grow progress">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <h2 className="font-display font-semibold text-sm">Growth</h2>
                <span className="text-xs text-muted-foreground ml-auto">
                  day {growth.totalDays}{diary.harvested ? " (harvested)" : ""}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                {growth.measurements === 0
                  ? "Height measurements will appear here as they are recorded."
                  : growth.measurements === 1
                    ? `Day ${growth.latestDay} · week ${growth.latestWeek} — height ${growth.currentHeight} cm`
                    : `Day ${growth.latestDay} · week ${growth.latestWeek} — ${growth.currentHeight} cm (${growth.delta! >= 0 ? "+" : ""}${growth.delta} cm since previous reading${growth.deltaDays! > 0 ? `, ${growth.deltaDays}d earlier` : ", same day"})`}
              </p>
              {growth.measurements >= 2 && (
                <div className="mt-3">
                  <HeightChart
                    points={growthUpdates
                      .filter((u) => u.heightCm != null)
                      .map((u) => ({
                        createdAt: u.createdAt.toISOString(),
                        day: diaryDay(diary.startDate, u.createdAt),
                        week: diaryWeek(diary.startDate, u.createdAt),
                        stage: u.stage,
                        heightCm: u.heightCm!,
                      }))}
                  />
                </div>
              )}
            </section>

          {hasEnvChartData && (
            <EnvCharts
              updates={updates.map((u) => ({
                createdAt: u.createdAt.toISOString(),
                day: diaryDay(diary.startDate, u.createdAt),
                week: diaryWeek(diary.startDate, u.createdAt),
                temperature: u.temperature,
                humidity: u.humidity,
                vpd: u.vpd,
                ph: u.ph,
                ec: u.ec,
              }))}
            />
          )}

          {truncated && (
            <p className="text-xs text-muted-foreground">
              Showing the latest {updates.length} of {diary._count.updates} updates.
            </p>
          )}

          {updates.length === 0 ? (
            <div className="bg-card/80 rounded-2xl border border-border/70 p-8 text-center">
              <Leaf className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-display text-base font-semibold mb-1">No updates yet</h3>
              <p className="text-sm text-muted-foreground">Start documenting your grow journey with your first update!</p>
            </div>
          ) : (
            <div className="space-y-6">
              {weeks.map((week, wi) => {
                const prevStage = wi > 0 ? weeks[wi - 1].stage : null
                const stageChanged = prevStage != null && prevStage !== week.stage
                return (
                <section key={week.week} id={`week-${week.week}`} className="scroll-mt-20">
                  {/* Stage transition marker */}
                  {stageChanged && (
                    <div className="flex items-center gap-2 mb-3 -mt-1">
                      <Sprout className="w-4 h-4 text-primary shrink-0" />
                      <span className="text-xs font-semibold text-primary uppercase tracking-wider">
                        {week.stage.toLowerCase()} stage
                      </span>
                      <span className="flex-1 border-t border-primary/25" />
                    </div>
                  )}
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="font-display text-sm font-semibold">
                      Week {week.week}
                      <span className="text-muted-foreground font-normal"> — {week.stage.toLowerCase()}</span>
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      days {week.dayStart}–{week.dayEnd}
                    </span>
                    <span className="text-xs text-muted-foreground flex items-center gap-2 ml-auto">
                      {week.photoCount > 0 && (
                        <span className="flex items-center gap-1">
                          <Camera className="w-3 h-3" />{week.photoCount}
                        </span>
                      )}
                      {week.updates.length} update{week.updates.length === 1 ? "" : "s"}
                    </span>
                  </div>

                  <div className="space-y-4 border-l-2 border-border pl-4 sm:pl-6">
                    {week.updates.map((update) => (
                      <UpdateEditSection
                        key={update.id}
                        update={{
                          id: update.id,
                          authorId: update.authorId,
                          title: update.title,
                          content: update.content,
                          stage: update.stage,
                          temperature: update.temperature,
                          humidity: update.humidity,
                          vpd: update.vpd,
                          ph: update.ph,
                          ec: update.ec,
                          heightCm: update.heightCm,
                          feeding: update.feeding,
                          training: update.training,
                          images: update.images.map((img) => ({ id: img.id, url: img.url, caption: img.caption })),
                        }}
                        day={diaryDay(diary.startDate, update.createdAt)}
                        dateLabel={new Date(update.createdAt).toLocaleDateString()}
                        edited={update.updatedAt.getTime() - update.createdAt.getTime() > 60_000}
                      />
                    ))}
                  </div>
                </section>
                )
              })}
            </div>
          )}

          {/* Cross-links: onward paths to this grower's other diaries and
              similar grows — keeps a leaf page from being a dead end. */}
          {(moreFromAuthor.length > 0 || similarGrows.length > 0) && (
            <div className="grid md:grid-cols-2 gap-6 mt-8">
              {moreFromAuthor.length > 0 && (
                <section>
                  <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
                    <Users className="w-5 h-5 text-primary" />
                    More from {authorName}
                  </h2>
                  <div className="space-y-2">
                    {moreFromAuthor.map((d) => (
                      <Link
                        key={d.id}
                        href={diaryPath(d)}
                        className="flex items-start gap-3 p-3 bg-card/80 rounded-2xl border border-border/70 hover:border-primary/40 transition-colors"
                      >
                        {d.updates[0]?.images[0]?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={d.updates[0].images[0].url} alt="" loading="lazy" decoding="async" className="w-10 h-10 rounded-md object-cover shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                            <Leaf className="w-4 h-4 text-primary" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm mb-0.5 line-clamp-1">{d.title}</div>
                          <div className="text-xs text-muted-foreground flex items-center flex-wrap gap-x-2 gap-y-0.5">
                            {d.strain && <span className="text-success">{d.strain}</span>}
                            <span>{d._count.updates} update{d._count.updates === 1 ? "" : "s"}</span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
              {similarGrows.length > 0 && (
                <section>
                  <h2 className="font-display text-lg font-semibold mb-3 flex items-center gap-2">
                    <Sprout className="w-5 h-5 text-primary" />
                    Similar grows
                  </h2>
                  <div className="space-y-2">
                    {similarGrows.map((d) => (
                      <Link
                        key={d.id}
                        href={diaryPath(d)}
                        className="flex items-start gap-3 p-3 bg-card/80 rounded-2xl border border-border/70 hover:border-primary/40 transition-colors"
                      >
                        {d.updates[0]?.images[0]?.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={d.updates[0].images[0].url} alt="" loading="lazy" decoding="async" className="w-10 h-10 rounded-md object-cover shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                            <Leaf className="w-4 h-4 text-primary" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm mb-0.5 line-clamp-1">{d.title}</div>
                          <div className="text-xs text-muted-foreground flex items-center flex-wrap gap-x-2 gap-y-0.5">
                            {d.strain && <span className="text-success">{d.strain}</span>}
                            <span>{d.author.profile?.username || d.author.name}</span>
                            <span>{d._count.updates} update{d._count.updates === 1 ? "" : "s"}</span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}
        </div>{/* end main timeline column */}

        {/* ── Diary context rail — desktop only ───────────────────── */}
        <aside className="hidden lg:block" aria-label="Grow context">
          <div className="sticky top-20 space-y-4">
            {/* Grow summary card */}
            <div className="bg-card/80 rounded-2xl border border-border/70 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Grow summary</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Day</dt>
                  <dd className="font-medium text-primary tabular-nums">{dayCount}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Week</dt>
                  <dd className="font-medium tabular-nums">{Math.ceil(dayCount / 7) || 1}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Stage</dt>
                  <dd className="text-xs">{diary.harvested ? "Harvested" : diary.stage}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Updates</dt>
                  <dd className="font-medium tabular-nums">{diary._count.updates}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Followers</dt>
                  <dd className="font-medium tabular-nums">{diary._count.followers}</dd>
                </div>
                {streak >= 2 && (
                  <div className="flex items-center justify-between">
                    <dt className="text-warning">Streak</dt>
                    <dd className="font-medium text-warning tabular-nums">{streak} days</dd>
                  </div>
                )}
                {avgTemp && (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Avg temp</dt>
                    <dd className="tabular-nums">{avgTemp}°</dd>
                  </div>
                )}
                {avgRh != null && (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Avg RH</dt>
                    <dd className="tabular-nums">{avgRh}%</dd>
                  </div>
                )}
                {harvestEta !== null && harvestEta > 0 && (
                  <div className="flex items-center justify-between">
                    <dt className="text-muted-foreground">Est. harvest</dt>
                    <dd className="text-primary font-medium tabular-nums">{harvestEta}d</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Grower card */}
            <div className="bg-card/80 rounded-2xl border border-border/70 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Grower</h3>
              <Link
                href={`/u/${diary.author.profile?.username || diary.author.name}`}
                className="flex items-center gap-2 rounded-lg p-1 -mx-1 hover:bg-secondary/60 transition-colors"
              >
                <span className="font-medium text-sm hover:text-primary">{authorName}</span>
                <TierChip reputation={diary.author.profile?.reputation ?? 0} publicMilestoneOptOut={diary.author.profile?.publicMilestoneOptOut} />
              </Link>
            </div>

            {/* Strain link */}
            {strainLink && (
              <div className="bg-card/80 rounded-2xl border border-border/70 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Strain</h3>
                <Link
                  href={strainPath(strainLink)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {diary.strain || strainLink.name}
                </Link>
              </div>
            )}

            {/* Discussion link */}
            {diary.discussion && !diary.discussion.deleted && (
              <div className="bg-card/80 rounded-2xl border border-border/70 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Discussion</h3>
                <Link
                  href={`/forum/thread/${diary.discussion.slug}`}
                  className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1"
                >
                  <Leaf className="w-3.5 h-3.5" /> Join the conversation
                </Link>
              </div>
            )}

            {/* Live chat */}
            <div className="bg-card/80 rounded-2xl border border-border/70 p-4">
              <Link
                href="/chat"
                className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors -mx-3 -my-2"
              >
                <MessagesSquare className="w-4 h-4 text-primary" /> Discuss in chat
              </Link>
            </div>

            {/* Setup link */}
            {diary.setup && !diary.setup.deleted && (
              <div className="bg-card/80 rounded-2xl border border-border/70 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Setup</h3>
                <Link
                  href={setupPath(diary.setup)}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {diary.setup.title}
                </Link>
              </div>
            )}

            {/* Week jump — mini nav */}
            {weeks.length > 1 && (
              <div className="bg-card/80 rounded-2xl border border-border/70 p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Jump to week</h3>
                <div className="flex flex-wrap gap-1">
                  {weeks.map((w) => (
                    <a
                      key={w.week}
                      href={`#week-${w.week}`}
                      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-medium bg-secondary/60 text-muted-foreground hover:bg-primary/12 hover:text-primary transition-colors tabular-nums"
                    >
                      {w.week}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
        </div>{/* end grid */}
      </div>
    </div>
  )
}