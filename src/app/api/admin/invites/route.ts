import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, isAdmin, forbidden } from "@/lib/security"
import { randomBytes } from "crypto"

// GET — list invites (admin only)
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return unauthorized()
  }
  if (!isAdmin(session.user.role)) {
    return forbidden()
  }

  const invites = await prisma.betaInvite.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      code: true,
      note: true,
      usedById: true,
      usedAt: true,
      expiresAt: true,
      createdAt: true,
    },
  })

  return NextResponse.json({ invites })
}

// POST — create invite codes (admin only): { count?, note?, expiresInDays? }
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return unauthorized()
  }
  if (!isAdmin(session.user.role)) {
    return forbidden()
  }

  const body = await request.json().catch(() => ({}))
  const count = Math.min(Math.max(Number(body.count) || 1, 1), 20)
  const note = typeof body.note === "string" ? body.note.slice(0, 200) : null
  const expiresInDays = typeof body.expiresInDays === "number" ? body.expiresInDays : null

  const created = []
  for (let i = 0; i < count; i++) {
    const code = `TERP-${randomBytes(4).toString("hex").toUpperCase()}`
    const invite = await prisma.betaInvite.create({
      data: {
        code,
        note,
        createdById: session.user.id,
        expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null,
      },
    })
    created.push({ code: invite.code, id: invite.id })
  }

  return NextResponse.json({ invites: created }, { status: 201 })
}
