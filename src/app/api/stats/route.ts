import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"

export const dynamic = "force-dynamic"
export const revalidate = 60

const getStats = unstable_cache(
  async () => {
    const [members, diaries, threads, posts] = await Promise.all([
      prisma.user.count({ where: { banned: false } }),
      prisma.growDiary.count({ where: { deleted: false } }),
      prisma.thread.count({ where: { deleted: false } }),
      prisma.post.count({ where: { deleted: false } }),
    ])
    return { members, diaries, discussions: threads + posts }
  },
  ["api-stats"],
  { revalidate: 60 }
)

export async function GET() {
  try {
    const stats = await getStats()
    return NextResponse.json(stats, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" },
    })
  } catch (error) {
    console.error("Stats error:", error)
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 })
  }
}
