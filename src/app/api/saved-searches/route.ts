import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma, lockUserRow } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { savedSearchLimit } from "@/lib/progression"

// GET — list current user's saved searches
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
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

    // Tiered cap (locked §8): 3 for everyone — basic capability stays
    // free — 6 at Germinated, 10 once the member reaches Trained. Existing
    // rows above the cap stay readable and deletable; only new creation
    // is gated. Falls back to base on progression-read failure.
    const cap = await savedSearchLimit(session.user.id).catch(() => 3)

    let filtersString = "{}"
    if (typeof filters === "string" && filters.length <= 1000) {
      try { JSON.parse(filters); filtersString = filters } catch { /* ignore */ }
    }

    // The tier cap has no unique constraint to enforce it — lock the user
    // row inside the tx and count under the lock so concurrent saves can't
    // both pass and overshoot the cap.
    const saved = await prisma.$transaction(async (tx) => {
      await lockUserRow(tx, session.user.id)
      const existing = await tx.savedSearch.count({ where: { userId: session.user.id } })
      if (existing >= cap) return null
      return tx.savedSearch.create({
        data: {
          userId: session.user.id,
          name: name.trim().slice(0, 100),
          query: query.trim().slice(0, 200),
          filters: filtersString,
        },
      })
    })
    if (!saved) {
      const hint = cap < 6 ? "reach Germinated rank for 6" : "reach Trained rank for 10"
      return NextResponse.json(
        { error: `You can save ${cap} searches — ${hint}.` },
        { status: 400 }
      )
    }

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
