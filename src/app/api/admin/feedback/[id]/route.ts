import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { FEEDBACK_TYPES } from "@/app/api/feedback/route"

const FEEDBACK_STATUSES = new Set(["NEW", "REVIEWING", "PLANNED", "IN_PROGRESS", "RESOLVED", "DECLINED"])
const FEEDBACK_PRIORITIES = new Set(["LOW", "NORMAL", "HIGH"])

const ADMIN_NOTES_MAX = 5000

// GET — full feedback detail including internal notes (admin only).
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const { id } = await params
  const item = await prisma.feedback.findUnique({
    where: { id },
    select: {
      id: true, type: true, status: true, priority: true, source: true,
      title: true, message: true, pagePath: true, adminNotes: true,
      createdAt: true, updatedAt: true, resolvedAt: true, resolvedById: true,
      author: { select: { id: true, name: true, profile: { select: { username: true } } } },
    },
  })
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json({ item })
}

// PATCH — update classification and internal notes.
// { type?, priority?, status?, adminNotes? }
// RESOLVED sets resolvedAt/resolvedById; leaving RESOLVED clears them.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const { type, priority, status, adminNotes } = body

  if (
    (type !== undefined && (typeof type !== "string" || !FEEDBACK_TYPES.has(type))) ||
    (priority !== undefined && (typeof priority !== "string" || !FEEDBACK_PRIORITIES.has(priority))) ||
    (status !== undefined && (typeof status !== "string" || !FEEDBACK_STATUSES.has(status))) ||
    (adminNotes !== undefined && adminNotes !== null && (typeof adminNotes !== "string" || adminNotes.length > ADMIN_NOTES_MAX))
  ) {
    return NextResponse.json({ error: "Invalid update" }, { status: 400 })
  }

  const existing = await prisma.feedback.findUnique({ where: { id }, select: { status: true } })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const data: Record<string, unknown> = {}
  if (type !== undefined) data.type = type
  if (priority !== undefined) data.priority = priority
  if (adminNotes !== undefined) data.adminNotes = adminNotes === null ? null : (adminNotes as string).trim() || null

  if (status !== undefined && status !== existing.status) {
    data.status = status
    if (status === "RESOLVED") {
      data.resolvedAt = new Date()
      data.resolvedById = admin.id
    } else if (existing.status === "RESOLVED") {
      data.resolvedAt = null
      data.resolvedById = null
    }
  }

  const item = await prisma.feedback.update({ where: { id }, data, select: { id: true, status: true } })
  return NextResponse.json({ ok: true, item })
}
