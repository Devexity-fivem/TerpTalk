import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { FEEDBACK_TYPES } from "@/app/api/feedback/route"

const FEEDBACK_STATUSES = new Set(["NEW", "REVIEWING", "PLANNED", "IN_PROGRESS", "RESOLVED", "DECLINED"])
const FEEDBACK_PRIORITIES = new Set(["LOW", "NORMAL", "HIGH"])
const FEEDBACK_SOURCES = new Set(["USER", "ADMIN_OBSERVATION"])

const PAGE_SIZE = 25
const TITLE_MAX = 150
const MESSAGE_MAX = 5000

const ITEM_SELECT = {
  id: true, type: true, status: true, priority: true, source: true,
  title: true, message: true, pagePath: true,
  createdAt: true, updatedAt: true, resolvedAt: true,
  author: { select: { id: true, name: true, profile: { select: { username: true } } } },
} as const

// GET — paginated feedback queue with filters and status counts.
// ?status=&type=&priority=&source=&page=
export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status")
  const type = searchParams.get("type")
  const priority = searchParams.get("priority")
  const source = searchParams.get("source")
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1)

  const where: Record<string, string> = {}
  if (status && FEEDBACK_STATUSES.has(status)) where.status = status
  if (type && FEEDBACK_TYPES.has(type)) where.type = type
  if (priority && FEEDBACK_PRIORITIES.has(priority)) where.priority = priority
  if (source && FEEDBACK_SOURCES.has(source)) where.source = source

  const [items, total, counts] = await Promise.all([
    prisma.feedback.findMany({
      where,
      select: ITEM_SELECT,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.feedback.count({ where }),
    prisma.feedback.groupBy({ by: ["status"], _count: { _all: true } }),
  ])

  const statusCounts: Record<string, number> = {
    NEW: 0, REVIEWING: 0, PLANNED: 0, IN_PROGRESS: 0, RESOLVED: 0, DECLINED: 0,
  }
  for (const c of counts) statusCounts[c.status] = c._count._all

  return NextResponse.json({
    items,
    total,
    page,
    pageSize: PAGE_SIZE,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    counts: statusCounts,
  })
}

// POST — admin observation: same record, source = ADMIN_OBSERVATION.
// { type, title, message, pagePath?, priority? }
export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const rl = await rateLimit(`feedback:admin:${admin.id}`, 30, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many observations too fast" }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const { type, title, message, pagePath, priority } = body

  if (
    typeof type !== "string" ||
    !FEEDBACK_TYPES.has(type) ||
    typeof title !== "string" ||
    !title.trim() ||
    title.length > TITLE_MAX ||
    typeof message !== "string" ||
    !message.trim() ||
    message.length > MESSAGE_MAX ||
    (priority !== undefined && (typeof priority !== "string" || !FEEDBACK_PRIORITIES.has(priority)))
  ) {
    return NextResponse.json({ error: "Invalid observation" }, { status: 400 })
  }

  let path: string | null = null
  if (typeof pagePath === "string" && pagePath.startsWith("/") && !pagePath.startsWith("//") && pagePath.length <= 300) {
    path = pagePath
  }

  const feedback = await prisma.feedback.create({
    data: {
      authorId: admin.id,
      type,
      title: title.trim(),
      message: message.trim(),
      pagePath: path,
      priority: typeof priority === "string" ? priority : "NORMAL",
      source: "ADMIN_OBSERVATION",
    },
    select: { id: true },
  })

  return NextResponse.json({ ok: true, id: feedback.id })
}
