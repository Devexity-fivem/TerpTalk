import { buildMetadata, snippet } from "@/lib/seo"
import { Breadcrumbs } from "@/components/breadcrumbs"
import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { notFound } from "next/navigation"
import { Settings, Users, MessageSquare } from "lucide-react"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import SetupComments from "@/components/setup-comments"
import ShareButtons from "@/components/share-buttons"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const setup = await prisma.growSetup.findUnique({
    where: { id },
    select: { title: true, description: true, deleted: true, strain: true },
  })
  if (!setup || setup.deleted) return buildMetadata({ title: "Setup not found", robots: { index: false } })
  return buildMetadata({
    title: `${setup.title} ${setup.strain ? `(${setup.strain})` : ""} — Cannabis Grow Setup`,
    description: snippet(setup.description),
    keywords: ["grow setup", "grow tent", "grow lights", "cannabis setup", setup.strain || ""].filter(Boolean),
    pathname: `/setups/${id}`,
  })
}

export default async function SetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const setup = await prisma.growSetup.findUnique({
    where: { id },
    include: {
      author: { select: publicUserSelect },
      images: { orderBy: { order: "asc" } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: { author: { select: publicUserSelect } },
      },
    },
  })

  if (!setup || setup.deleted) notFound()

  const specs: [string, string | null][] = [
    ["Space", setup.space],
    ["Tent", setup.tent],
    ["Lighting", setup.lighting],
    ["Ventilation", setup.ventilation],
    ["Fans", setup.fans],
    ["Containers", setup.containers],
    ["Medium", setup.medium],
    ["Nutrients", setup.nutrients],
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
          <h1 className="text-3xl font-bold mb-2">{setup.title}</h1>
          <p className="text-muted-foreground mb-4 whitespace-pre-wrap">{setup.description}</p>
          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
            <Link
              href={`/u/${setup.author.profile?.username || setup.author.name}`}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <Users className="w-4 h-4" />
              {setup.author.profile?.username || setup.author.name}
              <RoleBadge role={setup.author.role} />
            </Link>
            <span>{new Date(setup.createdAt).toLocaleDateString()}</span>
          </div>
          <ShareButtons path={`/setups/${setup.id}`} title={`${setup.title} — grow setup on TerpTalk`} />

          {setup.images.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-5">
              {setup.images.map((img) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={img.id} src={img.url} alt={img.caption || "Setup photo"} className="aspect-video object-cover rounded-lg border border-border" />
              ))}
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
                <p className="text-sm font-medium">{value}</p>
              </div>
            ))}
            {specs.every(([, v]) => !v) && (
              <p className="text-sm text-muted-foreground">No specs listed.</p>
            )}
          </div>
        </div>

        {/* Comments */}
        <div className="bg-card rounded-xl border border-border p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-primary" /> Comments ({setup.comments.length})
          </h2>
          <div className="space-y-4 mb-6">
            {setup.comments.map((c) => (
              <div key={c.id} className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-primary text-xs font-bold">
                  {(c.author.profile?.username || c.author.name || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <Link href={`/u/${c.author.profile?.username || c.author.name}`} className="font-medium hover:text-primary">
                      {c.author.profile?.username || c.author.name}
                    </Link>
                    <RoleBadge role={c.author.role} />
                    <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</span>
                  </div>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.content}</p>
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
