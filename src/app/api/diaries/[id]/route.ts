import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import {
  unauthorized, forbidden, isBanned, isAdmin,
  getClientIp, logSecurityEvent, publicUserSelect, enforceLinkTrust,
} from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { revalidateTag } from "next/cache"
import { parseDiaryPatch, patchTouchesStrainStats } from "@/lib/diary-edit"

// PATCH /api/diaries/[id] — owner/admin metadata editing.
// Scope: mutable descriptive fields only. startDate anchors every derived
// analytic (day/week, stage durations, harvest duration, strain grow-day
// averages) and stays immutable; stage moves via the updates route;
// harvest state via the dedicated harvest PATCH; threadId is
// system-managed; featured/deleted/authorId/timestamps are never editable.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const rl = await rateLimit(`diary-edit:${session.user.id}`, 10, 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "diaries/[id]" },
      })
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { id } = await params
    const diary = await prisma.growDiary.findUnique({
      where: { id },
      select: {
        id: true, authorId: true, deleted: true,
        strain: true, strainId: true, mediumType: true, lightType: true, techniques: true,
      },
    })
    // One 404 for missing and deleted — no existence oracle.
    if (!diary || diary.deleted) {
      return NextResponse.json({ error: "Diary not found" }, { status: 404 })
    }

    const canEdit = diary.authorId === session.user.id || isAdmin((session.user as { role?: string }).role)
    if (!canEdit) return forbidden()

    const parsed = parseDiaryPatch(await request.json().catch(() => null))
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    const data = parsed.data

    // Member-authored text — same link gate as creation.
    if ("title" in data || "description" in data) {
      const text = [data.title, data.description].filter((f): f is string => typeof f === "string").join("\n")
      const linkBlock = await enforceLinkTrust(text, session.user.id, request, "diaries/[id]")
      if (linkBlock) return linkBlock
    }

    // Catalog strain link — must point at a real strain; the catalog name
    // wins the free-text field, exactly as on creation.
    if (typeof data.strainId === "string") {
      const strainRow = await prisma.strain.findUnique({
        where: { id: data.strainId },
        select: { id: true, name: true },
      })
      if (!strainRow) {
        return NextResponse.json({ error: "Strain not found" }, { status: 400 })
      }
      data.strain = strainRow.name
    }

    // Setup link — only the member's own non-deleted setups. One generic
    // error for missing/deleted/foreign so ownership can't be probed.
    if (typeof data.setupId === "string") {
      const setup = await prisma.growSetup.findUnique({
        where: { id: data.setupId },
        select: { id: true, authorId: true, deleted: true },
      })
      if (!setup || setup.deleted || setup.authorId !== session.user.id) {
        return NextResponse.json({ error: "Setup not found" }, { status: 400 })
      }
    }

    const touchesStrainStats = patchTouchesStrainStats(diary, data)

    // Guarded update: a concurrent delete between load and write can't be
    // resurrected by this PATCH.
    const updated = await prisma.growDiary.updateMany({
      where: { id, deleted: false },
      data,
    })
    if (updated.count === 0) {
      return NextResponse.json({ error: "Diary not found" }, { status: 404 })
    }

    const result = await prisma.growDiary.findUnique({
      where: { id },
      include: { author: { select: publicUserSelect } },
    })

    revalidateTag("diaries", { expire: 0 })
    // Strain stats aggregate on strain/strainId/mediumType/lightType/
    // techniques — bust only when one of those actually changed.
    if (touchesStrainStats) revalidateTag("strains", { expire: 0 })

    return NextResponse.json({ diary: result })
  } catch (error) {
    console.error("Diary edit error:", error)
    return NextResponse.json({ error: "Failed to update diary" }, { status: 500 })
  }
}
