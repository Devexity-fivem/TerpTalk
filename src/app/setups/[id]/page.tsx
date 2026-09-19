import { buildMetadata, snippet } from "@/lib/seo"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { prisma } from "@/lib/prisma"
import { publicUserSelect, activeAuthor } from "@/lib/security"
import { notFound, permanentRedirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { Settings, Users, MessageSquare, Pencil } from "lucide-react"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import TierChip from "@/components/tier-chip"
import SetupComments from "@/components/setup-comments"
import ShareButtons from "@/components/share-buttons"
import ReportButton from "@/components/report-button"
import OwnerDeleteButton from "@/components/owner-delete-button"
import ImageGallery from "@/components/image-gallery"
import { escapeLike } from "@/lib/strain-stats"
import Tooltip from "@/components/ui/tooltip"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { diaryPath, strainPath, setupPath } from "@/lib/slugs"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const setup = await prisma.growSetup.findFirst({
    where: { OR: [{ slug: id }, { id }] },
    select: { id: true, slug: true, title: true, description: true, deleted: true, strain: true },
  })
  if (!setup || setup.deleted) return buildMetadata({ title: "Setup not found", robots: { index: false } })
  return buildMetadata({
    title: `${setup.title} ${setup.strain ? `(${setup.strain})` : ""} — Cannabis Grow Setup`,
    description: snippet(setup.description),
    keywords: ["grow setup", "grow tent", "grow lights", "cannabis setup", setup.strain || ""].filter(Boolean),
    pathname: setupPath(setup),
  })
}

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const setup = await prisma.growSetup.findFirst({
    where: { OR: [{ slug: id }, { id }], author: activeAuthor() },
    include: {
      author: { select: publicUserSelect },
      images: { orderBy: { order: "asc" }, take: 50 },
      comments: {
        where: { author: activeAuthor() },
        orderBy: { createdAt: "asc" },
        take: 50,
        include: { author: { select: publicUserSelect } },
      },
      _count: {
        select: { comments: { where: { author: activeAuthor() } } },
      },
    },
  })

  if (!setup || setup.deleted) notFound()

  // Legacy id URL → canonical slug URL.
  if (id === setup.id && setup.slug) permanentRedirect(setupPath(setup))

  const session = await getServerSession(authOptions)
  const isOwner = session?.user?.id === setup.authorId
  // Derived "edited" marker — same 60s grace as diary updates: a plain
  // creation write must not count as an edit.
  const edited = setup.updatedAt.getTime() - setup.createdAt.getTime() > 60_000

  // Grows that linked this setup — only publicly viewable diaries.
  const usedIn = await prisma.growDiary.findMany({
    where: { setupId: setup.id, deleted: false, author: activeAuthor(), ...publicDiaryWhere },
    orderBy: { updatedAt: "desc" },
    take: 6,
    select: {
      id: true,
      slug: true,
      title: true,
      strain: true,
      stage: true,
      harvested: true,
      author: { select: publicUserSelect },
      updates: { take: 1, orderBy: { createdAt: "desc" }, select: { images: { take: 1, orderBy: { order: "asc" }, select: { url: true } } } },
    },
  })

  // Link free-text strain names to the strain catalogue when they match —
  // same soft-linking the diary page uses.
  const linkedStrain = setup.strain
    ? await prisma.strain.findFirst({
        where: { name: { contains: escapeLike(setup.strain), mode: "insensitive" } },
        select: { id: true, slug: true },
      })
    : null

  const specs: [string, string | null][] = [
    ["Space", setup.space],
    ["Tent", setup.tent],
    ["Lighting", setup.lighting],
    ["Ventilation", setup.ventilation],
    ["Fans", setup.fans],
    ["Containers", setup.containers],
    ["Medium", setup.medium],
    ["Nutrients", setup.nutrients],
    ["Controllers", setup.controllers],
    ["Other equipment", setup.equipment],
    ["Strain", setup.strain],
  ]

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <Breadcrumbs items={[
          { label: "Setup Showcases", href: "/setups" },
          { label: setup.title },
        ]} />

        <div className="bg-card rounded-xl border border-border p-6 mb-6">
          <h1 className="text-3xl font-bold mb-2 break-words">{setup.title}</h1>
          <p className="text-muted-foreground mb-4 whitespace-pre-wrap break-words">{setup.description}</p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
            <Link
              href={`/u/${setup.author.profile?.username || setup.author.name}`}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <Users className="w-4 h-4" />
              {setup.author.profile?.username || setup.author.name}
              <RoleBadge role={setup.author.role} />
              <TierChip reputation={setup.author.profile?.reputation ?? 0} publicMilestoneOptOut={setup.author.profile?.publicMilestoneOptOut} />
            </Link>
            <span>{new Date(setup.createdAt).toLocaleDateString()}</span>
            {edited && (
              <Tooltip content="Edited after posting">
                <span>· edited</span>
              </Tooltip>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ShareButtons path={setupPath(setup)} title={`${setup.title} — grow setup on TerpTalk`} />
            {isOwner && (
              <Tooltip content="Edit setup">
                <Link
                  href={`/setups/${setup.id}/edit`}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="Edit setup"
                >
                  <Pencil className="w-4 h-4" />
                </Link>
              </Tooltip>
            )}
            <OwnerDeleteButton
              endpoint="/api/setups"
              id={setup.id}
              authorId={setup.authorId}
              confirmText="Delete this setup? This permanently removes the setup, its photos, and its comments."
              redirectTo="/setups"
              iconOnly
            />
            <ReportButton type="SETUP" targetId={setup.id} authorId={setup.authorId} />
          </div>

          {setup.images.length > 0 && (
            <div className="mt-5">
              <ImageGallery images={setup.images} />
            </div>
          )}
        </div>

        {/* Specs */}
        <div className="bg-card rounded-xl border border-border p-6 mb-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5 text-primary" /> Equipment &amp; Specs
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {specs.filter(([, v]) => v).map(([label, value]) => (
              <div key={label}>
                <span className="text-xs text-muted-foreground">{label}</span>
                {label === "Strain" && linkedStrain ? (
                  <p className="text-sm font-medium">
                    <Link href={strainPath(linkedStrain)} className="text-primary hover:underline">{value}</Link>
                  </p>
                ) : (
                  <p className="text-sm font-medium">{value}</p>
                )}
              </div>
            ))}
            {specs.every(([, v]) => !v) && (
              <p className="text-sm text-muted-foreground">No specs listed.</p>
            )}
          </div>
        </div>

        {/* Grows using this setup */}
        {usedIn.length > 0 && (
          <div className="bg-card rounded-xl border border-border p-6 mb-6">
            <h2 className="font-semibold mb-4">Used in {usedIn.length} grow{usedIn.length === 1 ? "" : "s"}</h2>
            <ul className="grid sm:grid-cols-2 gap-3">
              {usedIn.map((d) => (
                <li key={d.id}>
                  <Link href={diaryPath(d)} className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-secondary/50 transition-colors">
                    {d.updates[0]?.images[0]?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.updates[0].images[0].url} alt="" className="w-12 h-12 rounded-lg object-cover border border-border" />
                    ) : (
                      <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {(d.strain || d.title)[0].toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {d.author.profile?.username || d.author.name}
                        {d.strain ? ` · ${d.strain}` : ""}
                        {d.harvested ? " · harvested" : ` · ${d.stage.toLowerCase()}`}
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Comments */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" /> Comments ({setup._count.comments})
          </h2>
          <div className="space-y-4 mb-6">
            {setup.comments.map((c) => (
              <div key={c.id} id={`comment-${c.id}`} className="flex gap-3 scroll-mt-20">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary text-xs font-bold">
                  {(c.author.profile?.username || c.author.name || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    <Link href={`/u/${c.author.profile?.username || c.author.name}`} className="font-medium hover:text-primary">
                      {c.author.profile?.username || c.author.name}
                    </Link>
                    <RoleBadge role={c.author.role} />
              <TierChip reputation={c.author.profile?.reputation ?? 0} publicMilestoneOptOut={c.author.profile?.publicMilestoneOptOut} />
                    <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</span>
                    <OwnerDeleteButton
                      endpoint="/api/setups/comments"
                      id={c.id}
                      authorId={c.author.id}
                      confirmText="Delete this comment? This cannot be undone."
                      iconOnly
                    />
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">{c.content}</p>
                </div>
              </div>
            ))}
            {setup.comments.length === 0 && (
              <p className="text-sm text-muted-foreground">No comments yet — be the first to ask about this setup.</p>
            )}
          </div>
          <SetupComments setupId={setup.id} />
        </div>
      </div>
    </div>
  )
}
