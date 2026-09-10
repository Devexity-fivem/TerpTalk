import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Public: list tags. Optionally search with ?q=soil
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get("q")?.trim().toLowerCase() || ""

    const tags = await prisma.tag.findMany({
      where: q
        ? {
            OR: [
              { name: { startsWith: q } },
              { slug: { startsWith: q } },
            ],
          }
        : undefined,
      take: q ? 10 : 200,
      orderBy: { name: "asc" },
      include: {
        _count: {
          select: { threads: true },
        },
      },
    })

    return NextResponse.json({
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        color: t.color,
        count: t._count.threads,
      })),
    })
  } catch (error) {
    console.error("Tag list error:", error)
    return NextResponse.json({ tags: [] }, { status: 500 })
  }
}
