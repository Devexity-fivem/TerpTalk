import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

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

export async function GET(request: Request) {
  try {
    const ip = getClientIp(request)
    const rl = await rateLimit(`stats:${hashIp(ip)}`, 30, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const stats = await getStats()
    return NextResponse.json(stats, {
      headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" },
    })
  } catch (error) {
    console.error("Stats error:", error)
    return NextResponse.json({ error: "Failed to load stats" }, { status: 500 })
  }
}
