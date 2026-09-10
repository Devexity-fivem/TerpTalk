import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

function escapeLike(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
}

export async function GET(request: Request) {
  const ip = getClientIp(request)
  const rl = await rateLimit(`search:${hashIp(ip)}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ suggestions: [] }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const raw = (searchParams.get("q") || "").trim().slice(0, 100)
  if (raw.length < 2) {
    return NextResponse.json({ suggestions: [] })
  }

  const q = escapeLike(raw)
  const threads = await prisma.thread.findMany({
    where: { deleted: false, category: { hidden: false }, title: { contains: q, mode: "insensitive" } },
    take: 5,
    orderBy: { views: "desc" },
    select: { title: true, slug: true },
  })

  return NextResponse.json({ suggestions: threads.map((t) => ({ title: t.title, slug: t.slug })) })
}
