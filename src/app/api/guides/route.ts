import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, isBanned, forbidden } from "@/lib/security"

const STAFF = new Set(["MODERATOR", "ADMINISTRATOR"])

// POST — staff creates a guide: { title, excerpt, content, topic }
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const role = (session.user as { role?: string }).role
    if (!STAFF.has(role || "")) return forbidden("Staff only")
    if (await isBanned(session.user.id)) return forbidden()

    const { title, excerpt, content, topic } = await request.json().catch(() => ({}))
    if (!title || !excerpt || !content || !topic) {
      return NextResponse.json({ error: "All fields required" }, { status: 400 })
    }
    if (String(content).length > 50_000) {
      return NextResponse.json({ error: "Guide too long" }, { status: 400 })
    }

    const base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
    let slug = base
    while (await prisma.guide.findUnique({ where: { slug } })) {
      slug = `${base}-${Math.random().toString(36).slice(2, 6)}`
    }

    const guide = await prisma.guide.create({
      data: { title: String(title).slice(0, 120), slug, excerpt: String(excerpt).slice(0, 300), content: String(content), topic: String(topic).slice(0, 40), authorId: session.user.id },
      include: { author: { select: publicUserSelect } },
    })
    return NextResponse.json({ guide }, { status: 201 })
  } catch (e) {
    console.error("Guide create error:", e)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
