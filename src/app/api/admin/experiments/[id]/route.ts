import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"

const STATUSES = new Set(["PLANNED", "ACTIVE", "CONCLUDED", "REVERTED"])

// Update a change/experiment record — status transitions plus result and
// conclusion notes. Admin-only; every edit is attributable via createdBy.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const rl = await rateLimit(`admin-experiments:${admin.id}`, 30, 60 * 1000)
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  const { id } = await params
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { status, result, conclusion } = body as Record<string, unknown>
  const data: Record<string, unknown> = {}
  if (typeof status === "string" && STATUSES.has(status)) {
    data.status = status
    if (status === "CONCLUDED" || status === "REVERTED") data.endedAt = new Date()
    if (status === "ACTIVE") data.endedAt = null
  }
  if (typeof result === "string") data.result = result.trim().slice(0, 2000) || null
  if (typeof conclusion === "string") data.conclusion = conclusion.trim().slice(0, 2000) || null
  if (!Object.keys(data).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 })
  const exists = await prisma.productChange.findUnique({ where: { id }, select: { id: true } })
  if (!exists) return NextResponse.json({ error: "Not found" }, { status: 404 })
  await prisma.productChange.update({ where: { id }, data })
  return NextResponse.json({ ok: true })
}
