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
import EnvCharts from "@/components/env-chart"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const diary = await prisma.growDiary.findUnique({
    where: { id },
    select: { title: true, description: true, strain: true, deleted: true },
  })
  if (!diary || diary.deleted) return { title: "Diary not found" }
  return {
    title: diary.title,
    description: diary.description.slice(0, 155) || `Cannabis grow diary${diary.strain ? ` — ${diary.strain}` : ""} on TerpTalk.`,
    openGraph: { title: diary.title, type: "article" },
  }
}

async function getDiaryData(id: string) {
  const diary = await prisma.growDiary.findUnique({
    where: { id },
    include: {
      author: { select: publicUserSelect },
      updates: {
        include: {
          author: { select: publicUserSelect },
          images: true,
        },
        orderBy: { createdAt: "asc" },
      },
      _count: {
        select: { followers: true },
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
  const session = await getServerSession(authOptions)
  const following = session?.user?.id
    ? !!(await prisma.diaryFollow.findUnique({
        where: { userId_diaryId: { userId: session.user.id, diaryId: diary.id } },
        select: { id: true },
      }))
    : false

  // Grow progress: day count + stage position
  const STAGES = ["GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER", "HARVEST", "DRYING", "CURING", "COMPLETED"]
  // eslint-disable-next-line react-hooks/purity
  const dayCount = Math.max(0, Math.floor((Date.now() - new Date(diary.startDate).getTime()) / 86400000))
  const stageIdx = Math.max(0, STAGES.indexOf(diary.stage))
  const progress = Math.round(((stageIdx + 1) / STAGES.length) * 100)

  // Stage timeline — consecutive day-runs per stage from updates
  const stageRuns: { stage: string; days: number }[] = []
  let prevDay = -1
  for (const u of diary.updates) {
    const d = Math.floor((new Date(u.createdAt).getTime() - new Date(diary.startDate).getTime()) / 86400000)
    const last = stageRuns[stageRuns.length - 1]
    if (last && last.stage === u.stage && d === prevDay + 1) last.days++
    else if (!last || last.stage !== u.stage) stageRuns.push({ stage: u.stage, days: 1 })
    prevDay = d
  }
  const STAGE_COLORS: Record<string, string> = {
    GERMINATION: "bg-stone-500", SEEDLING: "bg-lime-400", VEGETATIVE: "bg-green-500",
    FLOWER: "bg-amber-500", HARVEST: "bg-orange-500", DRYING: "bg-yellow-700",
    CURING: "bg-purple-500", COMPLETED: "bg-yellow-400",
  }

  // Harvest estimate — first FLOWER update + 9 weeks typical flower time
  const flip = diary.updates.find((u) => u.stage === "FLOWER")
  const harvestEta = flip
    // eslint-disable-next-line react-hooks/purity
    ? Math.round((new Date(flip.createdAt).getTime() + 63 * 86400000 - Date.now()) / 86400000)
    : null

  // Env vitals — averages across updates
  const temps = diary.updates.map((u) => u.temperature).filter((v): v is number => v != null)
  const rhs = diary.updates.map((u) => u.humidity).filter((v): v is number => v != null)
  const avgTemp = temps.length ? (temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : null
  const avgRh = rhs.length ? Math.round(rhs.reduce((a, b) => a + b, 0) / rhs.length) : null

  // Update streak: consecutive days with updates (most recent run)
  const days = [...new Set(diary.updates.map((u) => new Date(u.createdAt).toDateString()))].map((d) => new Date(d).getTime()).sort((a, b) => b - a)
  let streak = 0
  for (let i = 0; i < days.length; i++) {
    const expected = days[0] - i * 86400000
    if (Math.abs(days[i] - expected) < 43200000) streak++
    else break
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/diaries" className="text-sm text-muted-foreground hover:text-foreground mb-2 block">
            ← Back to Diaries
          </Link>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
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
              </div>
              <h1 className="text-3xl font-bold mb-2">{diary.title}</h1>
              <p className="text-muted-foreground mb-4">{diary.description}</p>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  {diary.author.profile?.username || diary.author.name}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  Started: {new Date(diary.startDate).toLocaleDateString()}
                </span>
                <span className="flex items-center gap-1">
                  <Leaf className="w-4 h-4" />
                  {diary.updates.length} updates
                </span>
                <span className="flex items-center gap-1">
                  <Users className="w-4 h-4" />
                  {diary._count.followers} followers
                </span>
                <span className="flex items-center gap-1 font-medium text-primary">
                  <Calendar className="w-4 h-4" />
                  Day {dayCount}
                </span>
                {streak >= 2 && (
                  <span className="flex items-center gap-1 text-amber-500 font-medium">
                    🔥 {streak}-day streak
                  </span>
                )}
              </div>
              {/* Stage progress */}
              <div className="mt-3">
                <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                  <span>{diary.stage.replace("_", " ")}</span>
                  <span>{progress}% to harvest</span>
                </div>
                <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>

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

              {/* Stage timeline */}
              {stageRuns.length > 1 && (
                <div className="mt-4">
                  <div className="flex h-2 rounded-full overflow-hidden">
                    {stageRuns.map((r, i) => (
                      <div
                        key={i}
                        className={`${STAGE_COLORS[r.stage] || "bg-secondary"} h-full`}
                        style={{ width: `${(r.days / Math.max(1, stageRuns.reduce((a, b) => a + b.days, 0))) * 100}%` }}
                        title={`${r.stage} — ${r.days}d`}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1.5">
                    {stageRuns.map((r, i) => (
                      <span key={i} className="text-[10px] text-muted-foreground flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-sm ${STAGE_COLORS[r.stage] || "bg-secondary"}`} />
                        {r.stage.toLowerCase()} {r.days}d
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 items-start">
              <DiaryFollowButton diaryId={diary.id} initiallyFollowing={following} />
              <ShareButtons path={`/diaries/${diary.id}`} title={`${diary.title} — grow diary on TerpTalk`} />
            </div>
          </div>
        </div>

        {/* Grow Setup Info */}
        <div className="bg-card rounded-lg border border-border p-6 mb-8">
          <h3 className="font-semibold mb-4">Grow Setup</h3>
          <div className="grid md:grid-cols-3 gap-4">
            {diary.strain && (
              <div>
                <span className="text-sm text-muted-foreground">Strain:</span>
                <p className="font-medium">{diary.strain}</p>
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

        {/* Timeline */}
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Grow Timeline</h2>
            <UpdateForm diaryId={diary.id} />
          </div>

          <EnvCharts
            updates={diary.updates.map((u) => ({
              createdAt: u.createdAt.toISOString(),
              temperature: u.temperature,
              humidity: u.humidity,
              vpd: u.vpd,
              ph: u.ph,
              ec: u.ec,
            }))}
          />

          {diary.updates.length === 0 ? (
            <div className="bg-card rounded-lg border border-border p-12 text-center">
              <Leaf className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No updates yet</h3>
              <p className="text-muted-foreground">Start documenting your grow journey with your first update!</p>
            </div>
          ) : (
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-border"></div>

              {/* Timeline items */}
              <div className="space-y-6">
                {diary.updates.map((update) => (
                  <div key={update.id} className="relative pl-16">
                    {/* Timeline dot */}
                    <div className="absolute left-4 w-4 h-4 bg-primary rounded-full border-4 border-background"></div>

                    <div className="bg-card rounded-lg border border-border p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
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
                          <h3 className="font-semibold">{update.title}</h3>
                        </div>
                        <span className="text-sm text-muted-foreground">
                          {new Date(update.createdAt).toLocaleDateString()}
                        </span>
                      </div>

                      <p className="text-muted-foreground mb-4 whitespace-pre-wrap">{update.content}</p>

                      {/* Environmental Data */}
                      {(update.temperature || update.humidity || update.vpd || update.ph || update.ec) && (
                        <div className="grid grid-cols-5 gap-4 mb-4 p-4 bg-secondary/50 rounded-lg">
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