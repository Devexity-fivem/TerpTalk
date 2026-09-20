import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { signInHref } from "@/lib/callback-url"
import { buildMetadata } from "@/lib/seo"
import EditSetupForm from "./edit-setup-form"
import { setupPath } from "@/lib/slugs"
import Link from "next/link"

export const dynamic = "force-dynamic"

export async function generateMetadata() {
  return buildMetadata({ title: "Edit setup", description: "Edit grow setup details", robots: { index: false } })
}

// Dedicated edit page — server-authoritative: loads the setup, enforces
// the same owner-only rule the PATCH route uses, and hands the form only
// the editable fields. Non-owners get a plain 404 rather than a hint
// that an edit surface exists.
export default async function EditSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect(signInHref(`/setups/${id}/edit`))

  const setup = await prisma.growSetup.findUnique({
    where: { id },
    select: {
      id: true, slug: true, authorId: true, deleted: true,
      title: true, description: true, space: true, tent: true,
      lighting: true, ventilation: true, fans: true, containers: true,
      medium: true, nutrients: true, controllers: true, equipment: true,
      strain: true,
      images: { orderBy: { order: "asc" }, select: { id: true, url: true } },
    },
  })
  if (!setup || setup.deleted) notFound()
  if (setup.authorId !== session.user.id) notFound()

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <Link href={setupPath(setup)} className="text-sm text-muted-foreground hover:text-foreground mb-2 block">
            ← Back to Setup
          </Link>
          <h1 className="font-display text-3xl font-bold mb-2 tracking-tight">Edit Setup</h1>
          <p className="text-muted-foreground">
            Update your setup&apos;s details — linked grow diaries keep pointing to this setup.
          </p>
        </div>

        <div className="bg-card/80 rounded-2xl border border-border/70 p-6">
          <EditSetupForm
            setupId={setup.id}
            setupHref={setupPath(setup)}
            initial={{
              title: setup.title,
              description: setup.description,
              space: setup.space ?? "",
              tent: setup.tent ?? "",
              lighting: setup.lighting ?? "",
              ventilation: setup.ventilation ?? "",
              fans: setup.fans ?? "",
              containers: setup.containers ?? "",
              medium: setup.medium ?? "",
              nutrients: setup.nutrients ?? "",
              controllers: setup.controllers ?? "",
              equipment: setup.equipment ?? "",
              strain: setup.strain ?? "",
            }}
            images={setup.images}
          />
        </div>
      </div>
    </div>
  )
}
