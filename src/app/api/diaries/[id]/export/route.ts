import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { hasUnlock } from "@/lib/progression"
import { diaryDay, diaryWeek } from "@/lib/diary-weeks"

/**
 * GET /api/diaries/[id]/export — per-grow CSV export.
 *
 * The `export-tools` unlock (Trained rank): a spreadsheet-ready dump of
 * the diary's full update log. Owner-only — the whole-account JSON
 * export at /api/profile/export stays free for every member.
 */

const COLUMNS = [
  "date", "day", "week", "stage", "title", "content",
  "temperature_c", "humidity_pct", "vpd_kpa", "ph", "ec",
  "height_cm", "night_temp_c", "substrate_temp_c", "co2_ppm",
  "watering_l", "ppfd", "photoperiod_h", "runoff_ph", "runoff_ec",
  "lamp_distance_cm", "feeding", "training", "nutrients", "experiment",
] as const

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ""
  const s = typeof v === "object" ? JSON.stringify(v) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    // The unlock is the member's own rank gate — enforced before any read.
    if (!(await hasUnlock(session.user.id, "export-tools"))) {
      return forbidden("Per-grow CSV export unlocks at Trained rank")
    }

    const rl = await rateLimit(`export-grow:${session.user.id}`, 10, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id, ip: getClientIp(request), metadata: { endpoint: "diaries/[id]/export" },
      })
      return NextResponse.json({ error: "Too many export requests" }, { status: 429 })
    }

    const { id } = await params
    const diary = await prisma.growDiary.findUnique({
      where: { id },
      select: { id: true, slug: true, title: true, authorId: true, deleted: true, startDate: true },
    })
    // One 404 for missing/deleted/foreign — no existence oracle.
    if (!diary || diary.deleted || diary.authorId !== session.user.id) {
      return NextResponse.json({ error: "Diary not found" }, { status: 404 })
    }

    const updates = await prisma.diaryUpdate.findMany({
      where: { diaryId: diary.id },
      orderBy: { createdAt: "asc" },
      include: {
        nutrients: { orderBy: { productName: "asc" } },
        experiment: { select: { title: true } },
      },
    })

    const rows = updates.map((u) =>
      [
        u.createdAt.toISOString().slice(0, 10),
        diaryDay(diary.startDate, u.createdAt),
        diaryWeek(diary.startDate, u.createdAt),
        u.stage, u.title, u.content,
        u.temperature, u.humidity, u.vpd, u.ph, u.ec,
        u.heightCm, u.nightTemperature, u.substrateTemperature, u.co2Ppm,
        u.wateringLiters, u.ppfd, u.photoperiodHours, u.runoffPh, u.runoffEc,
        u.lampDistanceCm, u.feeding, u.training,
        u.nutrients.map((n) => `${n.productName}${n.doseMlPerL != null ? ` ${n.doseMlPerL}ml/L` : ""}`).join("; "),
        u.experiment?.title ?? null,
      ].map(csvCell).join(",")
    )

    const csv = [COLUMNS.join(","), ...rows].join("\n") + "\n"
    const name = (diary.slug || diary.id).replace(/[^a-z0-9-]/gi, "").slice(0, 60)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="terptalk-grow-${name}.csv"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("Grow export error:", error)
    return NextResponse.json({ error: "Failed to export grow" }, { status: 500 })
  }
}
