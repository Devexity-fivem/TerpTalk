import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { notFound } from "next/navigation"
import { Leaf, Calendar, Users, ClipboardCheck, Camera } from "lucide-react"
import Link from "next/link"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import UpdateForm from "@/components/update-form"
import DiaryFollowButton from "@/components/diary-follow-button"
import ShareButtons from "@/components/share-buttons"
import { buildMetadata, snippet } from "@/lib/seo"
import { Breadcrumbs } from "@/components/breadcrumbs"
import EnvCharts from "@/components/env-chart"
import HarvestForm from "@/components/harvest-form"
import StageTimeline from "@/components/stage-timeline"
import ImageGallery from "@/components/image-gallery"
import { groupUpdatesByWeek, buildHarvestReport, diaryCompleteness, diaryDay, diaryWeek } from "@/lib/diary-weeks"
import ReportButton from "@/components/report-button"
import DiaryReactions from "@/components/diary-reactions"
import { escapeLike } from "@/lib/strain-stats"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const diary = await prisma.growDiary.findUnique({
    where: { id },
    select: { title: true, description: true, strain: true, deleted: true },
  })
  if (!diary || diary.deleted) return buildMetadata({ title: "Diary not found", robots: { index: false } })
  return buildMetadata({
    title: `${diary.title} — Cannabis Grow Diary${diary.strain ? ` (${diary.strain})` : ""}`,
    description: snippet(diary.description || `Cannabis grow diary${diary.strain ? ` — ${diary.strain}` : ""} on TerpTalk.`),
    keywords: [diary.strain || "cannabis", "grow diary", "grow journal"],
    pathname: `/diaries/${id}`,
    og: { type: "article" },
  })
}

async function getDiaryData(id: string) {
  const diary = await prisma.growDiary.findUnique({
    where: { id },
    include: {
      author: { select: publicUserSelect },
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

  if (!diary || diary.deleted) {
    notFound()
  }

  return diary
}

export default async function DiaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const diary = await getDiaryData(id)
  // Fetch the most recent 100 updates and restore chronological order for the timeline.
  const updates = [...diary.updates].reverse()
  const session = await getServerSession(authOptions)
  const [following, linkedStrain] = await Promise.all([
    session?.user?.id
      ? !!(await prisma.diaryFollow.findUnique({
          where: { userId_diaryId: { userId: session.user.id, diaryId: diary.id } },
          select: { id: true },
        }))
      : false,
    diary.strain
      ? prisma.strain.findFirst({
          where: { name: { contains: escapeLike(diary.strain), mode: "insensitive" } },
          select: { id: true, name: true },
        })
      : null,
  ])

  // eslint-disable-next-line react-hooks/purity
  const dayCount = Math.max(0, Math.floor((Date.now() - new Date(diary.startDate).getTime()) / 86400000))

  // Stage timeline — consecutive day-runs per stage from updates
  const stageRuns: { stage: string; days: number }[] = []
  let prevDay = -1
  for (const u of updates) {
    const d = Math.floor((new Date(u.createdAt).getTime() - new Date(diary.startDate).getTime()) / 86400000)
    const last = stageRuns[stageRuns.length - 1]
    if (last && last.stage === u.stage && d === prevDay + 1) last.days++
    else if (!last || last.stage !== u.stage) stageRuns.push({ stage: u.stage, days: 1 })
    prevDay = d
  }

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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <Breadcrumbs items={[
          { label: "Grow Diaries", href: "/diaries" },
          { label: diary.title },
        ]} />
        {/* Header */}
        <div className="mb-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                {diary.featured && (
                  <span className="text-xs text-primary px-2 py-1 bg-primary/10 rounded">
                    Featured
                  </span>
                )}
                <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                  {diary.growType}
                </span>
                <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                  {diary.stage}
                </span>
                {diary.harvested && (
                  <span className="text-xs text-emerald-500 px-2 py-1 bg-emerald-500/10 rounded">
                    Harvested
                  </span>
                )}
              </div>
              <h1 className="text-2xl font-bold mb-2">{diary.title}</h1>
              <p className="text-sm text-muted-foreground mb-3">{diary.description}</p>
              <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {diary.author.profile?.username || diary.author.name}
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
                <span className="flex items-center gap-1 font-medium text-primary">
                  <Calendar className="w-3.5 h-3.5" />
                  Day {dayCount}
                </span>
                {streak >= 2 && (
                  <span className="flex items-center gap-1 text-amber-500 font-medium">
                    🔥 {streak}-day streak
                  </span>
                )}
              </div>
              <StageTimeline current={diary.stage} runs={stageRuns} />

              {/* Vitals row */}
              {(avgTemp || avgRh || harvestEta !== null) && (
                <div className="flex flex-wrap gap-4 mt-4 text-sm">
                  {avgTemp && <span className="text-muted-foreground">avg temp <span className="text-foreground font-medium">{avgTemp}°</span></span>}
                  {avgRh && <span className="text-muted-foreground">avg RH <span className="text-foreground font-medium">{avgRh}%</span></span>}
                  {harvestEta !== null && harvestEta > 0 && (
                    <span className="text-muted-foreground">est. harvest in <span className="text-primary font-medium">{harvestEta}d</span></span>
                  )}
                  {harvestEta !== null && harvestEta <= 0 && (
                    <span className="text-primary font-medium">🌾 Past estimated harvest window</span>
                  )}
                </div>
              )}


            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex gap-2 items-center">
                <DiaryReactions diaryId={diary.id} initialCounts={reactionCounts} initialMine={myReaction} />
                <DiaryFollowButton diaryId={diary.id} initiallyFollowing={following} />
                <ShareButtons path={`/diaries/${diary.id}`} title={`${diary.title} — grow diary on TerpTalk`} />
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
          />
        )}

        {/* Harvest report — the grow's final result, shown to everyone */}
        {harvestReport && (
          <div className="bg-card rounded-xl border border-border p-5 mt-4">
            <div className="flex items-center gap-2 mb-4">
              <ClipboardCheck className="w-4 h-4 text-emerald-500" />
              <h2 className="font-semibold">Harvest Report</h2>
              {harvestReport.yieldAmount != null && (
                <span className="ml-auto px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-500 font-medium text-sm">
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
                  <div className="text-xs text-muted-foreground">avg VPD</div>
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
            <p className="text-xs text-muted-foreground mt-3">
              Harvested {harvestReport.harvestedAt.toLocaleDateString()} · started {new Date(diary.startDate).toLocaleDateString()}
            </p>
          </div>
        )}

        {/* Completeness nudge — owner only, encourages better records */}
        {completeness && !diary.harvested && completeness.percent < 100 && (
          <div className="bg-card rounded-xl border border-border p-4 mt-4">
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
        <details className="bg-card rounded-lg border border-border mb-8 group">
          <summary className="p-4 text-sm font-semibold cursor-pointer flex items-center justify-between list-none marker:content-none">
            <span>Grow setup</span>
            <span aria-hidden="true" className="text-muted-foreground group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <div className="px-4 pb-4">
            <div className="grid md:grid-cols-3 gap-4">
            {diary.strain && (
              <div>
                <span className="text-sm text-muted-foreground">Strain:</span>
                {linkedStrain ? (
                  <Link href={`/strains/${linkedStrain.id}`} className="font-medium text-primary hover:underline block">
                    {diary.strain}
                  </Link>
                ) : (
                  <p className="font-medium">{diary.strain}</p>
                )}
              </div>
            )}
            {diary.genetics && (
              <div>
                <span className="text-sm text-muted-foreground">Genetics:</span>
                <p className="font-medium">{diary.genetics}</p>
              </div>
            )}
            {diary.medium && (
              <div>
                <span className="text-sm text-muted-foreground">Medium:</span>
                <p className="font-medium">{diary.medium}</p>
              </div>
            )}
            {diary.containerSize && (
              <div>
                <span className="text-sm text-muted-foreground">Container:</span>
                <p className="font-medium">{diary.containerSize}</p>
              </div>
            )}
            {diary.lighting && (
              <div>
                <span className="text-sm text-muted-foreground">Lighting:</span>
                <p className="font-medium">{diary.lighting}</p>
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
          </div>
        </details>

        {/* Timeline — grouped by grow week */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Grow Timeline</h2>
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

          {truncated && (
            <p className="text-xs text-muted-foreground">
              Showing the latest {updates.length} of {diary._count.updates} updates.
            </p>
          )}

          {updates.length === 0 ? (
            <div className="bg-card rounded-lg border border-border p-8 text-center">
              <Leaf className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-base font-semibold mb-1">No updates yet</h3>
              <p className="text-sm text-muted-foreground">Start documenting your grow journey with your first update!</p>
            </div>
          ) : (
            <div className="space-y-6">
              {weeks.map((week) => (
                <section key={week.week} id={`week-${week.week}`} className="scroll-mt-20">
                  <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-sm font-semibold">
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
                      <div key={update.id} className="bg-card rounded-lg border border-border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                                {update.stage}
                              </span>
                              <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                                Day {diaryDay(diary.startDate, update.createdAt)}
                              </span>
                            </div>
                            <h4 className="font-semibold text-sm">{update.title}</h4>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(update.createdAt).toLocaleDateString()}
                          </span>
                        </div>

                        {update.images.length > 0 && (
                          <ImageGallery
                            images={update.images.map((img) => ({ id: img.id, url: img.url, caption: img.caption }))}
                          />
                        )}

                        <p className="text-muted-foreground my-4 whitespace-pre-wrap break-words">{update.content}</p>

                        {/* Environmental Data */}
                        {(update.temperature != null || update.humidity != null || update.vpd != null || update.ph != null || update.ec != null) && (
                          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-4 mb-4 p-4 bg-secondary/50 rounded-lg">
                            {update.temperature != null && (
                              <div className="text-center">
                                <div className="text-xs text-muted-foreground">Temp</div>
                                <div className="font-semibold">{update.temperature}°F</div>
                              </div>
                            )}
                            {update.humidity != null && (
                              <div className="text-center">
                                <div className="text-xs text-muted-foreground">Humidity</div>
                                <div className="font-semibold">{update.humidity}%</div>
                              </div>
                            )}
                            {update.vpd != null && (
                              <div className="text-center">
                                <div className="text-xs text-muted-foreground">VPD</div>
                                <div className="font-semibold">{update.vpd}</div>
                              </div>
                            )}
                            {update.ph != null && (
                              <div className="text-center">
                                <div className="text-xs text-muted-foreground">pH</div>
                                <div className="font-semibold">{update.ph}</div>
                              </div>
                            )}
                            {update.ec != null && (
                              <div className="text-center">
                                <div className="text-xs text-muted-foreground">EC</div>
                                <div className="font-semibold">{update.ec}</div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Additional Info */}
                        {(update.feeding || update.training) && (
                          <div className="space-y-2 mb-4">
                            {update.feeding && (
                              <div>
                                <span className="text-sm text-muted-foreground">Feeding:</span>
                                <p className="text-sm">{update.feeding}</p>
                              </div>
                            )}
                            {update.training && (
                              <div>
                                <span className="text-sm text-muted-foreground">Training:</span>
                                <p className="text-sm">{update.training}</p>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}