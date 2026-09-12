import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { notFound } from "next/navigation"
import { Leaf, Calendar, Users } from "lucide-react"
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
          images: { take: 12 },
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
          where: { name: { contains: diary.strain, mode: "insensitive" } },
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

  const canEdit = session?.user?.id === diary.author.id || (session?.user as { role?: string } | undefined)?.role === "ADMINISTRATOR"

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
              <div className="flex gap-2 items-start">
                <DiaryFollowButton diaryId={diary.id} initiallyFollowing={following} />
                <ShareButtons path={`/diaries/${diary.id}`} title={`${diary.title} — grow diary on TerpTalk`} />
              </div>
              {!following && (
                <p className="text-xs text-muted-foreground">Follow this diary to get notified of new updates.</p>
              )}
            </div>
          </div>
        </div>

        <HarvestForm
          diaryId={diary.id}
          canEdit={canEdit}
          initialHarvested={diary.harvested}
          initialAmount={diary.yieldAmount}
          initialUnit={diary.yieldUnit}
          initialAt={diary.harvestedAt}
        />

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

        {/* Timeline */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold">Grow Timeline</h2>
            <UpdateForm diaryId={diary.id} />
          </div>

          <EnvCharts
            updates={updates.map((u) => ({
              createdAt: u.createdAt.toISOString(),
              temperature: u.temperature,
              humidity: u.humidity,
              vpd: u.vpd,
              ph: u.ph,
              ec: u.ec,
            }))}
          />

          {updates.length === 0 ? (
            <div className="bg-card rounded-lg border border-border p-8 text-center">
              <Leaf className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-base font-semibold mb-1">No updates yet</h3>
              <p className="text-sm text-muted-foreground">Start documenting your grow journey with your first update!</p>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border"></div>

              {/* Timeline items */}
              <div className="space-y-6">
                {updates.map((update) => (
                  <div key={update.id} className="relative pl-16">
                    {/* Timeline dot */}
                    <div className="absolute left-4 w-4 h-4 bg-primary rounded-full border-4 border-background"></div>

                    <div className="bg-card rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                              {update.stage}
                            </span>
                            {update.dayNumber && (
                              <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                                Day {update.dayNumber}
                              </span>
                            )}
                            {update.weekNumber && (
                              <span className="text-xs text-muted-foreground px-2 py-1 bg-secondary rounded">
                                Week {update.weekNumber}
                              </span>
                            )}
                          </div>
                          <h3 className="font-semibold text-sm">{update.title}</h3>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(update.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      <p className="text-muted-foreground mb-4 whitespace-pre-wrap break-words">{update.content}</p>

                      {/* Environmental Data */}
                      {(update.temperature || update.humidity || update.vpd || update.ph || update.ec) && (
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 sm:gap-4 mb-4 p-4 bg-secondary/50 rounded-lg">
                          {update.temperature && (
                            <div className="text-center">
                              <div className="text-xs text-muted-foreground">Temp</div>
                              <div className="font-semibold">{update.temperature}°F</div>
                            </div>
                          )}
                          {update.humidity && (
                            <div className="text-center">
                              <div className="text-xs text-muted-foreground">Humidity</div>
                              <div className="font-semibold">{update.humidity}%</div>
                            </div>
                          )}
                          {update.vpd && (
                            <div className="text-center">
                              <div className="text-xs text-muted-foreground">VPD</div>
                              <div className="font-semibold">{update.vpd}</div>
                            </div>
                          )}
                          {update.ph && (
                            <div className="text-center">
                              <div className="text-xs text-muted-foreground">pH</div>
                              <div className="font-semibold">{update.ph}</div>
                            </div>
                          )}
                          {update.ec && (
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

                      {/* Images */}
                      {update.images.length > 0 && (
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                          {update.images.map((image) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={image.id}
                              src={image.url}
                              alt={image.caption || "Grow update photo"}
                              loading="lazy"
                              decoding="async"
                              className="aspect-square object-cover rounded-lg border border-border"
                            />
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-4">
                        <ShareButtons path={`/diaries/${diary.id}`} title={`${diary.title} — grow diary`} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}