import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { notFound } from "next/navigation"
import { Leaf, Calendar, Users, Heart, Share2, Bookmark } from "lucide-react"
import Link from "next/link"
import UpdateForm from "@/components/update-form"

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
              </div>
            </div>
            <div className="flex gap-2">
              <button className="p-2 hover:bg-secondary rounded-lg transition-colors" title="Follow">
                <Users className="w-5 h-5" />
              </button>
              <button className="p-2 hover:bg-secondary rounded-lg transition-colors" title="Bookmark">
                <Bookmark className="w-5 h-5" />
              </button>
              <button className="p-2 hover:bg-secondary rounded-lg transition-colors" title="Share">
                <Share2 className="w-5 h-5" />
              </button>
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
                            <div key={image.id} className="aspect-square bg-secondary rounded-lg overflow-hidden">
                              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                <Leaf className="w-8 h-8" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-4">
                        <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                          <Heart className="w-4 h-4" />
                          Like
                        </button>
                        <button className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors">
                          Share
                        </button>
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