import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { canViewDiary } from "@/lib/diary-visibility"

export const dynamic = "force-dynamic"

// Cheap per-diary fingerprint for the diary page's LiveRefresh tickle —
// update count + newest update timestamps + diary edit time. Mirrors the
// page's visibility rules: PRIVATE diaries 404 for everyone but the
// author, deleted/inactive-author diaries 404 for everyone.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const session = await getServerSession(authOptions)

    const diary = await prisma.growDiary.findFirst({
      where: { OR: [{ slug: id }, { id }] },
      select: {
        id: true,
        deleted: true,
        visibility: true,
        authorId: true,
        updatedAt: true,
        author: { select: { banned: true, suspendedUntil: true } },
      },
    })
    const authorInactive =
      !!diary &&
      (diary.author.banned ||
        (diary.author.suspendedUntil && diary.author.suspendedUntil > new Date()))
    if (!diary || diary.deleted || authorInactive || !canViewDiary(diary, session?.user?.id)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const [updates, lastUpdate] = await Promise.all([
      prisma.diaryUpdate.count({ where: { diaryId: diary.id } }),
      prisma.diaryUpdate.findFirst({
        where: { diaryId: diary.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, updatedAt: true },
      }),
    ])

    const fingerprint = [
      updates,
      lastUpdate?.createdAt.toISOString() ?? "0",
      lastUpdate?.updatedAt.toISOString() ?? "0",
      diary.updatedAt.toISOString(),
    ].join(":")
    return NextResponse.json({ fingerprint }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    console.error("Diary activity error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
