import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isBanned, getClientIp, logSecurityEvent, enforceLinkTrust } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { revalidateTag } from "next/cache"
import { parseExperimentCreate, serializeExperiment } from "@/lib/experiments"

/**
 * /api/diaries/[id]/experiments
 *
 * GET  — list a diary's experiments. Visibility follows the diary:
 *        owner sees all; PUBLIC/UNLISTED diaries expose experiments to
 *        any viewer (they are part of the grow's documented history);
 *        PRIVATE diaries expose them to the owner only.
 * POST — create an experiment. Owner only.
 */

const EXPERIMENT_INCLUDE = {
  updates: {
    orderBy: { createdAt: "desc" as const },
    take: 5,
    select: { createdAt: true },
  },
  _count: { select: { updates: true } },
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  const { id } = await params

  const diary = await prisma.growDiary.findUnique({
    where: { id },
    select: { id: true, authorId: true, deleted: true, visibility: true },
  })
  // One 404 for missing/deleted — no existence oracle.
  if (!diary || diary.deleted) {
    return NextResponse.json({ error: "Diary not found" }, { status: 404 })
  }
  const isOwner = session?.user?.id === diary.authorId
  if (!isOwner && diary.visibility === "PRIVATE") {
    return NextResponse.json({ error: "Diary not found" }, { status: 404 })
  }

  const rows = await prisma.growExperiment.findMany({
    where: { diaryId: id },
    orderBy: [{ status: "asc" }, { startedAt: "desc" }],
    take: 50,
    include: EXPERIMENT_INCLUDE,
  })
  return NextResponse.json({
    experiments: rows.map((r) => serializeExperiment(r, undefined, r._count.updates)),
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const rl = await rateLimit(`experiment-create:${session.user.id}`, 20, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "diaries/[id]/experiments POST" },
      })
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { id } = await params
    const diary = await prisma.growDiary.findUnique({
      where: { id },
      select: { id: true, authorId: true, deleted: true, harvested: true },
    })
    if (!diary || diary.deleted) {
      return NextResponse.json({ error: "Diary not found" }, { status: 404 })
    }
    if (diary.authorId !== session.user.id) return forbidden()

    const parsed = parseExperimentCreate(await request.json().catch(() => null))
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

    // Member-authored text — same link gate as diary updates.
    const text = [parsed.data.title, parsed.data.change, parsed.data.reason, parsed.data.expected]
      .filter((f): f is string => typeof f === "string")
      .join("\n")
    const linkBlock = await enforceLinkTrust(text, session.user.id, request, "diaries/experiments")
    if (linkBlock) return linkBlock

    const created = await prisma.growExperiment.create({
      data: {
        diaryId: diary.id,
        authorId: session.user.id,
        category: "OTHER",
        ...parsed.data,
      } as Parameters<typeof prisma.growExperiment.create>[0]["data"],
      include: EXPERIMENT_INCLUDE,
    })

    revalidateTag("diaries", { expire: 0 })
    return NextResponse.json({ experiment: serializeExperiment(created, undefined, created._count.updates) }, { status: 201 })
  } catch (error) {
    console.error("Experiment create error:", error)
    return NextResponse.json({ error: "Failed to create experiment" }, { status: 500 })
  }
}
