import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isBanned, getClientIp, logSecurityEvent, enforceLinkTrust } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { revalidateTag } from "next/cache"
import { parseExperimentPatch, serializeExperiment } from "@/lib/experiments"

/**
 * /api/diaries/[id]/experiments/[experimentId]
 *
 * PATCH  — owner only. Edit fields, move the lifecycle
 *          (PLANNED|ACTIVE|OBSERVING|COMPLETED|ABANDONED), record the
 *          grower-stated outcome. endedAt stamps on COMPLETED/ABANDONED
 *          and clears on re-open.
 * DELETE — owner only. Linked updates keep their content; their
 *          experimentId is SetNull'd by the FK.
 */

const EXPERIMENT_INCLUDE = {
  updates: {
    orderBy: { createdAt: "desc" as const },
    take: 5,
    select: { createdAt: true },
  },
  _count: { select: { updates: true } },
}

async function loadOwned(diaryId: string, experimentId: string, userId: string) {
  const exp = await prisma.growExperiment.findUnique({
    where: { id: experimentId },
    select: { id: true, diaryId: true, authorId: true, diary: { select: { authorId: true, deleted: true } } },
  })
  // One 404 for missing/deleted-parent/foreign — no probing.
  if (!exp || exp.diaryId !== diaryId || exp.diary.deleted) return null
  if (exp.authorId !== userId || exp.diary.authorId !== userId) return "forbidden" as const
  return exp
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; experimentId: string }> }
) {
  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const rl = await rateLimit(`experiment-edit:${session.user.id}`, 30, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "experiments PATCH" },
      })
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { id, experimentId } = await params
    const owned = await loadOwned(id, experimentId, session.user.id)
    if (!owned) return NextResponse.json({ error: "Experiment not found" }, { status: 404 })
    if (owned === "forbidden") return forbidden()

    const parsed = parseExperimentPatch(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    if (Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
    }

    const textFields = [parsed.data.title, parsed.data.change, parsed.data.reason, parsed.data.expected, parsed.data.conclusion]
      .filter((f): f is string => typeof f === "string")
    if (textFields.length) {
      const linkBlock = await enforceLinkTrust(textFields.join("\n"), session.user.id, request, "experiments PATCH")
      if (linkBlock) return linkBlock
    }

    // Guarded write — a concurrent delete between load and write yields
    // count 0 → 404, no resurrection.
    const res = await prisma.growExperiment.updateMany({
      where: { id: experimentId },
      data: parsed.data,
    })
    if (res.count === 0) {
      return NextResponse.json({ error: "Experiment not found" }, { status: 404 })
    }

    const row = await prisma.growExperiment.findUnique({
      where: { id: experimentId },
      include: EXPERIMENT_INCLUDE,
    })
    revalidateTag("diaries", { expire: 0 })
    return NextResponse.json({ experiment: row ? serializeExperiment(row, undefined, row._count.updates) : null })
  } catch (error) {
    console.error("Experiment edit error:", error)
    return NextResponse.json({ error: "Failed to update experiment" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; experimentId: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const { id, experimentId } = await params
    const owned = await loadOwned(id, experimentId, session.user.id)
    if (!owned) return NextResponse.json({ error: "Experiment not found" }, { status: 404 })
    if (owned === "forbidden") return forbidden()

    await prisma.growExperiment.delete({ where: { id: experimentId } })
    revalidateTag("diaries", { expire: 0 })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Experiment delete error:", error)
    return NextResponse.json({ error: "Failed to delete experiment" }, { status: 500 })
  }
}
