import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { Leaf, Dna, Sprout, ImageIcon, BookOpen, Wrench, MessageSquare, CheckCircle2, BarChart3 } from "lucide-react"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import StrainPhotoUpload from "@/components/strain-photo-upload"
import ShareButtons from "@/components/share-buttons"
import { buildMetadata, snippet } from "@/lib/seo"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { publicUserSelect, activeAuthor } from "@/lib/security"
import { getStrainGrowStats, escapeLike } from "@/lib/strain-stats"
import Link from "next/link"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const strain = await prisma.strain.findUnique({
    where: { id },
    select: { name: true, description: true, genetics: true, type: true },
  })
  if (!strain) return buildMetadata({ title: "Strain not found", robots: { index: false } })
  const desc = strain.description
    ? snippet(strain.description)
    : `${strain.name}${strain.type ? ` (${strain.type})` : ""}${strain.genetics ? ` — ${strain.genetics}` : ""}. Cannabis strain info and grower photos on TerpTalk.`
  return buildMetadata({
    title: `${strain.name} Cannabis Strain — Reviews & Grower Photos`,
    description: desc,
    keywords: [strain.name, "cannabis strain", "strain review", "cannabis genetics"],
    pathname: `/strains/${id}`,
  })
}

export default async function StrainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [strain, session] = await Promise.all([
    prisma.strain.findUnique({
      where: { id },
      include: {
        createdBy: { select: { profile: { select: { username: true } }, name: true } },
        photos: {
          orderBy: { createdAt: "desc" },
          take: 100,
          include: {
            user: { select: { profile: { select: { username: true } }, name: true } },
          },
        },
      },
    }),
    getServerSession(authOptions),
  ])

  if (!strain) notFound()

  const [relatedDiaries, relatedSetups, relatedThreads, growStats] = await Promise.all([
    prisma.growDiary.findMany({
      where: { deleted: false, author: activeAuthor(), strain: { contains: escapeLike(strain.name), mode: "insensitive" } },
      orderBy: { updatedAt: "desc" },
      take: 6,
      include: {
        author: { select: publicUserSelect },
        updates: { take: 1, orderBy: { createdAt: "desc" }, include: { images: { take: 1, orderBy: { order: "asc" } } } },
      },
    }),
    prisma.growSetup.findMany({
      where: { deleted: false, author: activeAuthor(), strain: { contains: escapeLike(strain.name), mode: "insensitive" } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { author: { select: publicUserSelect }, images: { take: 1 } },
    }),
    // Threads tagged with the strain name are the precise signal; title
    // matching adds recall but is skipped for short names ("OG", "CBD")
    // that would false-positive on unrelated words.
    prisma.thread.findMany({
      where: {
        deleted: false,
        category: { hidden: false },
        OR: [
          { tags: { some: { tag: { name: { equals: strain.name, mode: "insensitive" } } } } },
          ...(strain.name.trim().length >= 4
            ? [{ title: { contains: escapeLike(strain.name), mode: "insensitive" as const } }]
            : []),
        ],
      },
      orderBy: { lastActivityAt: "desc" },
      take: 6,
      select: {
        slug: true,
        title: true,
        replyCount: true,
        views: true,
        // Relation select — acceptedAnswerId can point at a deleted post.
        acceptedAnswer: { select: { id: true, deleted: true } },
        category: { select: { name: true } },
      },
    }),
    getStrainGrowStats(strain.name),
  ])

  const plantPhotos = strain.photos.filter((p) => p.kind === "PLANT")
  const flowerPhotos = strain.photos.filter((p) => p.kind === "FLOWER")

  const diaryThumb = (d: typeof relatedDiaries[0]) =>
    d.updates[0]?.images[0]?.url

  const setupThumb = (s: typeof relatedSetups[0]) =>
    s.images[0]?.url

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Breadcrumbs items={[
          { label: "Strains", href: "/strains" },
          { label: strain.name },
        ]} />

        {/* Header */}
        <div className="bg-card rounded-xl border border-border p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 bg-primary/10 rounded-xl flex items-center justify-center shrink-0 ring-1 ring-primary/20">
              <Leaf className="w-8 h-8 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{strain.name}</h1>
              <div className="flex gap-3 text-sm text-muted-foreground mt-1 flex-wrap">
                {strain.type && <span className="px-2 py-0.5 bg-primary/10 text-primary rounded">{strain.type}</span>}
                {strain.breeder && <span>Breeder: {strain.breeder}</span>}
                {strain.createdBy && (
                  <span>
                    Added by{" "}
                    {strain.createdBy.profile?.username || strain.createdBy.name}
                  </span>
                )}
              </div>
              <div className="mt-3">
                <ShareButtons path={`/strains/${strain.id}`} title={`${strain.name} strain — TerpTalk`} />
              </div>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-6 items-start">
          {strain.genetics && (
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-2">
                <Dna className="w-4 h-4 text-primary" />
                <h2 className="font-semibold">Genetics</h2>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{strain.genetics}</p>
            </div>
          )}
          {strain.growingInfo && (
            <div className="bg-card rounded-xl border border-border p-5">
              <div className="flex items-center gap-2 mb-2">
                <Sprout className="w-4 h-4 text-primary" />
                <h2 className="font-semibold">Growing Info</h2>
              </div>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{strain.growingInfo}</p>
            </div>
          )}
        </div>

        {strain.description && (
          <div className="bg-card rounded-xl border border-border p-5 mb-6">
            <h2 className="font-semibold mb-2">Description</h2>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{strain.description}</p>
          </div>
        )}

        {/* Community grow data — stats stay honest about sample size */}
        {growStats.tier !== "none" && (
          <div className="bg-card rounded-xl border border-border p-5 mb-6">
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <BarChart3 className="w-4 h-4 text-primary" />
              <h2 className="font-semibold">Community grow data</h2>
              <span className={`text-xs px-2 py-0.5 rounded ml-auto ${growStats.tier === "early" ? "bg-amber-500/10 text-amber-500" : "bg-secondary text-muted-foreground"}`}>
                {growStats.label}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-primary">{growStats.growCount}</div>
                <div className="text-xs text-muted-foreground">grow{growStats.growCount === 1 ? "" : "s"}</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">{growStats.growerCount}</div>
                <div className="text-xs text-muted-foreground">grower{growStats.growerCount === 1 ? "" : "s"}</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">{growStats.setupCount}</div>
                <div className="text-xs text-muted-foreground">setup{growStats.setupCount === 1 ? "" : "s"}</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-primary">{growStats.harvestedCount}</div>
                <div className="text-xs text-muted-foreground">harvested</div>
              </div>
              {growStats.avgYieldOz != null && (
                <div>
                  <div className="text-2xl font-bold text-emerald-500">{growStats.avgYieldOz} oz</div>
                  <div className="text-xs text-muted-foreground">avg yield · {growStats.yieldSample} harvests</div>
                </div>
              )}
              {growStats.medianYieldOz != null && (
                <div>
                  <div className="text-2xl font-bold">{growStats.medianYieldOz} oz</div>
                  <div className="text-xs text-muted-foreground">median yield</div>
                </div>
              )}
              {growStats.topYieldOz != null && (
                <div>
                  <div className="text-2xl font-bold">{growStats.topYieldOz} oz</div>
                  <div className="text-xs text-muted-foreground">best reported</div>
                </div>
              )}
              {growStats.avgTotalDays != null && (
                <div>
                  <div className="text-2xl font-bold">{growStats.avgTotalDays}d</div>
                  <div className="text-xs text-muted-foreground">avg seed→harvest · {growStats.totalDaysSample}</div>
                </div>
              )}
              {growStats.avgFlowerDays != null && (
                <div>
                  <div className="text-2xl font-bold">{growStats.avgFlowerDays}d</div>
                  <div className="text-xs text-muted-foreground">avg flower time · {growStats.flowerSample}</div>
                </div>
              )}
            </div>
            {(growStats.env.temp != null || growStats.env.rh != null || growStats.env.vpd != null) && (
              <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                {growStats.env.temp != null && <span>avg temp {growStats.env.temp}°F ({growStats.envSamples.temp} readings)</span>}
                {growStats.env.rh != null && <span>avg RH {growStats.env.rh}% ({growStats.envSamples.rh})</span>}
                {growStats.env.vpd != null && <span>avg VPD {growStats.env.vpd} kPa ({growStats.envSamples.vpd})</span>}
                {growStats.env.ph != null && <span>avg pH {growStats.env.ph} ({growStats.envSamples.ph})</span>}
                {growStats.env.ec != null && <span>avg EC {growStats.env.ec} ({growStats.envSamples.ec})</span>}
              </div>
            )}
          </div>
        )}

        {/* Community diaries for this strain */}
        {relatedDiaries.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <BookOpen className="w-4 h-4 text-primary" />
              <h2 className="font-semibold">Grows with this strain</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {relatedDiaries.map((d) => (
                <Link
                  key={d.id}
                  href={`/diaries/${d.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary/50 transition-colors"
                >
                  <div className="w-16 h-16 bg-secondary rounded-lg overflow-hidden shrink-0">
                    {diaryThumb(d) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={diaryThumb(d)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <BookOpen className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{d.title}</p>
                    <p className="text-xs text-muted-foreground truncate">by {d.author.profile?.username || d.author.name}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Community setups for this strain */}
        {relatedSetups.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Wrench className="w-4 h-4 text-primary" />
              <h2 className="font-semibold">Setups growing this strain</h2>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {relatedSetups.map((s) => (
                <Link
                  key={s.id}
                  href={`/setups/${s.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-secondary/50 transition-colors"
                >
                  <div className="w-16 h-16 bg-secondary rounded-lg overflow-hidden shrink-0">
                    {setupThumb(s) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={setupThumb(s)} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                        <Wrench className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{s.title}</p>
                    <p className="text-xs text-muted-foreground truncate">by {s.author.profile?.username || s.author.name}</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Discussions about this strain */}
        {relatedThreads.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-5 mb-6">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-4 h-4 text-primary" />
              <h2 className="font-semibold">Discussions</h2>
            </div>
            <div className="divide-y divide-border -mx-5 px-5">
              {relatedThreads.map((t) => (
                <Link
                  key={t.slug}
                  href={`/forum/thread/${t.slug}`}
                  className="flex items-center justify-between gap-3 py-2.5 hover:bg-secondary/50 transition-colors -mx-2 px-2 rounded"
                >
                  <span className="min-w-0 text-sm font-medium truncate flex items-center gap-2">
                    {t.title}
                    {t.acceptedAnswer && !t.acceptedAnswer.deleted && <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" aria-label="Solved" />}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {t.category.name} · {t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Photo galleries */}
        {(["PLANT", "FLOWER"] as const).map((kind) => {
          const photos = kind === "PLANT" ? plantPhotos : flowerPhotos
          return (
            <div key={kind} className="bg-card rounded-xl border border-border p-5 mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-primary" />
                  {kind === "PLANT" ? "Plant Photos" : "Harvested Flower"}
                </h2>
                {session && <StrainPhotoUpload strainId={strain.id} kind={kind} />}
              </div>
              {photos.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No {kind === "PLANT" ? "plant" : "flower"} photos yet
                  {session ? " — be the first to share!" : "."}
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {photos.map((photo) => (
                    <div key={photo.id} className="group relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.imageUrl}
                        alt={photo.caption || `${strain.name} ${kind.toLowerCase()}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full aspect-square object-cover rounded-lg border border-border"
                      />
                      <div className="absolute bottom-0 inset-x-0 bg-black/60 text-[10px] text-white px-2 py-1 rounded-b-lg opacity-0 group-hover:opacity-100 transition-opacity">
                        by {photo.user.profile?.username || photo.user.name}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
