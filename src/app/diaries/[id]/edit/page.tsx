import { notFound, redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin } from "@/lib/security"
import { signInHref } from "@/lib/callback-url"
import { buildMetadata } from "@/lib/seo"
import { suggestStrainLink } from "@/lib/strain-stats"
import EditDiaryForm from "./edit-diary-form"
import Link from "next/link"

export const dynamic = "force-dynamic"

export async function generateMetadata() {
  return buildMetadata({ title: "Edit diary", description: "Edit grow diary details", robots: { index: false } })
}

// Dedicated edit page — server-authoritative: loads the diary, enforces
// the same owner-or-admin rule the PATCH route uses, and hands the form
// only the editable fields. Non-owners get a plain 404 rather than a
// hint that an edit surface exists.
export default async function EditDiaryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect(signInHref(`/diaries/${id}/edit`))

  const diary = await prisma.growDiary.findUnique({
    where: { id },
    select: {
      id: true, authorId: true, deleted: true, startDate: true,
      title: true, description: true, strain: true, strainId: true, genetics: true,
      growType: true, medium: true, mediumType: true, containerSize: true,
      lighting: true, lightType: true, nutrients: true, equipment: true,
      techniques: true, spaceDimensions: true, setupId: true, visibility: true,
    },
  })
  if (!diary || diary.deleted) notFound()

  const canEdit =
    diary.authorId === session.user.id ||
    isAdmin((session.user as { role?: string }).role)
  if (!canEdit) notFound()

  const startDateDisplay = new Date(diary.startDate).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  })

  // Legacy strain hint — only for unlinked diaries with usable free text.
  // A suggestion appears solely on a unique normalized-exact match; the
  // owner still has to select it and save. Server-side and owner-gated, so
  // it can never surface another member's data.
  const strainSuggestion =
    !diary.strainId && diary.strain ? await suggestStrainLink(diary.strain) : null

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="mb-8">
          <Link href={`/diaries/${diary.id}`} className="text-sm text-muted-foreground hover:text-foreground mb-2 block">
            ← Back to Diary
          </Link>
          <h1 className="text-3xl font-bold mb-2">Edit Diary</h1>
          <p className="text-muted-foreground">
            Update your diary&apos;s details — past updates, harvest results, and the discussion thread are not affected.
          </p>
        </div>

        <div className="bg-card rounded-lg border border-border p-6">
          <EditDiaryForm
            diaryId={diary.id}
            startDateDisplay={startDateDisplay}
            strainSuggestion={strainSuggestion}
            initial={{
              title: diary.title,
              description: diary.description,
              strain: diary.strain ?? "",
              strainId: diary.strainId,
              genetics: diary.genetics ?? "",
              growType: diary.growType,
              startDate: diary.startDate.toISOString().slice(0, 10),
              medium: diary.medium ?? "",
              mediumType: diary.mediumType ?? "",
              containerSize: diary.containerSize ?? "",
              lighting: diary.lighting ?? "",
              lightType: diary.lightType ?? "",
              nutrients: diary.nutrients ?? "",
              equipment: diary.equipment ?? "",
              techniques: diary.techniques,
              spaceDimensions: diary.spaceDimensions ?? "",
              setupId: diary.setupId ?? "",
              visibility: diary.visibility,
            }}
          />
        </div>
      </div>
    </div>
  )
}
