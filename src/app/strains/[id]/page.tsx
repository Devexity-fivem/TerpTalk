import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { Leaf, Dna, Sprout, ImageIcon } from "lucide-react"
import Link from "next/link"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import StrainPhotoUpload from "@/components/strain-photo-upload"

export const dynamic = "force-dynamic"

export default async function StrainPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [strain, session] = await Promise.all([
    prisma.strain.findUnique({
      where: { id },
      include: {
        createdBy: { select: { profile: { select: { username: true } }, name: true } },
        photos: {
          orderBy: { createdAt: "desc" },
          include: {
            user: { select: { profile: { select: { username: true } }, name: true } },
          },
        },
      },
    }),
    getServerSession(authOptions),
  ])

  if (!strain) notFound()

  const plantPhotos = strain.photos.filter((p) => p.kind === "PLANT")
  const flowerPhotos = strain.photos.filter((p) => p.kind === "FLOWER")

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Link href="/strains" className="text-sm text-muted-foreground hover:text-foreground mb-4 block">
          ← Back to Strains
        </Link>

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
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-6">
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
