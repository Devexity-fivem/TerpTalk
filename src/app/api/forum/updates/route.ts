import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"

export const dynamic = "force-dynamic"

const getForumUpdates = unstable_cache(
  async () => {
    const [threadCount, latest] = await Promise.all([
      prisma.thread.count({
        where: {
          deleted: false,
          category: { hidden: false },
        },
      }),
      prisma.thread.findFirst({
        where: {
          deleted: false,
          category: { hidden: false },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      }),
    ])
    return { threadCount, latestThreadId: latest?.id ?? null, latestThreadAt: latest?.createdAt ?? null }
  },
  ["forum-updates"],
  { revalidate: 15, tags: ["forum"] }
)

// Lightweight "are there new threads?" endpoint. The forum page polls this
// and calls router.refresh() when it sees a new latest thread ID.
export async function GET() {
  try {
    const data = await getForumUpdates()
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, max-age=15, s-maxage=15" },
    })
  } catch (error) {
    console.error("Forum updates error:", error)
    return NextResponse.json(
      { threadCount: 0, latestThreadId: null, latestThreadAt: null },
      { status: 500 }
    )
  }
}
