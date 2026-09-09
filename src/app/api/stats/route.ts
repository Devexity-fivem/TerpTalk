import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const [members, diaries, threads, posts] = await Promise.all([
      prisma.user.count({ where: { banned: false } }),
      prisma.growDiary.count({ where: { deleted: false } }),
      prisma.thread.count({ where: { deleted: false } }),
      prisma.post.count({ where: { deleted: false } }),
    ])

    return NextResponse.json({ members, diaries, discussions: threads + posts })
  } catch (error) {
    console.error("Stats error:", error)
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 })
  }
}
