import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

export const dynamic = "force-dynamic"

// Lightweight "are there new threads?" endpoint. The forum page polls this
// and calls router.refresh() when it sees a new latest thread ID.
export async function GET() {
  const [threadCount, latest] = await Promise.all([
    prisma.thread.count({ where: { deleted: false } }),
    prisma.thread.findFirst({
      where: { deleted: false },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    }),
  ])

  return NextResponse.json({
    threadCount,
    latestThreadId: latest?.id ?? null,
    latestThreadAt: latest?.createdAt ?? null,
  })
}
