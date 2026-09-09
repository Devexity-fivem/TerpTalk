import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// GET — list current user's saved searches
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden()

    const searches = await prisma.savedSearch.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, query: true, filters: true, createdAt: true },
    })

    return NextResponse.json({ searches })
  } catch (error) {
    console.error("Saved searches GET error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// POST — save a search { name, query, filters? }
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const body = await request.json().catch(() => ({}))
    const { name, query, filters } = body

    if (typeof name !== "string" || !name.trim() || typeof query !== "string" || query.length > 200) {
      return NextResponse.json({ error: "Invalid name or query" }, { status: 400 })
    }

    const rl = await rateLimit(`saved-search:${session.user.id}`, 30, 10 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "saved-searches" },
      })
      return NextResponse.json({ error: "Slow down." }, { status: 429 })
    }

    const existing = await prisma.savedSearch.count({ where: { userId: session.user.id } })
    if (existing >= 50) {
      return NextResponse.json({ error: "You can only save 50 searches" }, { status: 400 })
    }

    let filtersString = "{}"
    if (typeof filters === "string" && filters.length <= 1000) {
      try { JSON.parse(filters); filtersString = filters } catch { /* ignore */ }
    }

    const saved = await prisma.savedSearch.create({
      data: {
        userId: session.user.id,
        name: name.trim().slice(0, 100),
        query: query.trim().slice(0, 200),
        filters: filtersString,
      },
    })

    return NextResponse.json({ search: saved }, { status: 201 })
  } catch (error) {
    console.error("Saved search POST error:", error)
    return NextResponse.json({ error: "Failed to save" }, { status: 500 })
  }
}

// DELETE — remove a saved search { id }
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden()

    const body = await request.json().catch(() => ({}))
    const { id } = body
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 })
    }

    const existing = await prisma.savedSearch.findUnique({
      where: { id },
      select: { userId: true },
    })
    if (!existing || existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    await prisma.savedSearch.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Saved search DELETE error:", error)
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 })
  }
}
