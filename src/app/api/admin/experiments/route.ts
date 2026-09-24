import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireAdmin } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"

const KINDS = new Set(["CHANGE", "EXPERIMENT"])
const STATUSES = new Set(["PLANNED", "ACTIVE", "CONCLUDED", "REVERTED"])
const TITLE_MAX = 200
const TEXT_MAX = 2000

// Operator record of meaningful product changes / small experiments.
// Admin-only, bounded list — newest 100.
export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const items = await prisma.productChange.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true, kind: true, title: true, surface: true, hypothesis: true,
      description: true, primaryMetric: true, status: true, result: true,
      conclusion: true, createdAt: true, endedAt: true,
      createdBy: { select: { profile: { select: { username: true } }, name: true } },
    },
  })
  return NextResponse.json({ items })
}

export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  const rl = await rateLimit(`admin-experiments:${admin.id}`, 30, 60 * 1000)
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { kind, title, surface, hypothesis, description, primaryMetric, status } = body as Record<string, unknown>
  if (typeof title !== "string" || !title.trim() || title.length > TITLE_MAX)
    return NextResponse.json({ error: "Title required (≤200 chars)" }, { status: 400 })
  if (typeof description !== "string" || !description.trim() || description.length > TEXT_MAX)
    return NextResponse.json({ error: "Description required (≤2000 chars)" }, { status: 400 })
  const k = typeof kind === "string" && KINDS.has(kind) ? kind : "CHANGE"
  const st = typeof status === "string" && STATUSES.has(status) ? status : "ACTIVE"
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, TEXT_MAX) : null)
  const item = await prisma.productChange.create({
    data: {
      kind: k, status: st,
      title: title.trim(),
      description: description.trim(),
      surface: clean(surface)?.slice(0, 80) ?? null,
      hypothesis: clean(hypothesis),
      primaryMetric: clean(primaryMetric)?.slice(0, 120) ?? null,
      createdById: admin.id,
    },
    select: { id: true },
  })
  return NextResponse.json({ id: item.id })
}
