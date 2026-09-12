import { NextResponse } from "next/server"
import { revalidateTag } from "next/cache"
import { prisma } from "@/lib/prisma"
import { publicUserSelect, forbidden } from "@/lib/security"
import { requireModerator } from "@/lib/require-staff"
import { GUIDE_TOPICS } from "@/lib/guides"

// POST — staff creates a guide: { title, excerpt, content, topic }
export async function POST(request: Request) {
  try {
    const staff = await requireModerator()
    if (!staff) return forbidden("Staff only")

    const { title, excerpt, content, topic } = await request.json().catch(() => ({}))
    if (!title || !excerpt || !content || !topic) {
      return NextResponse.json({ error: "All fields required" }, { status: 400 })
    }
    if (String(content).length > 50_000) {
      return NextResponse.json({ error: "Guide too long" }, { status: 400 })
    }
    if (!GUIDE_TOPICS.has(String(topic))) {
      return NextResponse.json({ error: "Invalid topic" }, { status: 400 })
    }

    const base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
    let slug = base
    while (await prisma.guide.findUnique({ where: { slug } })) {
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
    }

    const guide = await prisma.guide.create({
      data: { title: String(title).slice(0, 120), slug, excerpt: String(excerpt).slice(0, 300), content: String(content), topic: String(topic).slice(0, 40), authorId: staff.id },
      include: { author: { select: publicUserSelect } },
    })
    revalidateTag("guides", { expire: 0 })
    revalidateTag("forum", { expire: 0 })
    return NextResponse.json({ guide }, { status: 201 })
  } catch (e) {
    console.error("Guide create error:", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
