import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, isSupport, logSecurityEvent, STAFF_ROLES } from "@/lib/security"
import { requireStaff } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { notifyMany } from "@/lib/notify"
import {
  CASE_PRIORITIES,
  CASE_STATUSES,
  priorityRank,
  SIGNAL_LABELS,
  TERMINAL_STATUSES,
} from "@/lib/trust-signals"

const MAX_PAGE_SIZE = 100
// Upper bound of rows pulled per source before the merge — open items stay
// far below this at current scale; raise only if the backlog outgrows it.
const SOURCE_FETCH_CAP = 500

type QueueItem = Record<string, unknown>

// Merge comparator: urgent first, then oldest first (aged items surface).
function sortQueue(a: QueueItem, b: QueueItem): number {
  const pa = priorityRank(a.priority as string)
  const pb = priorityRank(b.priority as string)
  if (pa !== pb) return pb - pa
  return new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime()
}

async function usernames(ids: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set([...ids].filter(Boolean))]
  if (!unique.length) return new Map()
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, profile: { select: { username: true } } },
  })
  return new Map(users.map((u) => [u.id, u.profile?.username ?? "unknown"]))
}

// Batch-safe report target preview: group target ids by type, one bounded
// findMany per type, map lookup — replaces the per-report findUnique fan-out.
async function reportTargetLabels(reports: { type: string; targetId: string | null }[]) {
  const byType = new Map<string, string[]>()
  for (const r of reports) {
    if (!r.targetId) continue
    byType.set(r.type, [...(byType.get(r.type) ?? []), r.targetId])
  }
  const labels = new Map<string, { label: string; deleted: boolean; href: string | null }>()
  const fetch = async (type: string, rows: { id: string; label: string; deleted?: boolean; href?: string | null }[]) => {
    for (const row of rows) {
      labels.set(`${type}:${row.id}`, { label: row.label, deleted: !!row.deleted, href: row.href ?? null })
    }
  }
  await Promise.all([...byType.entries()].map(async ([type, ids]) => {
    switch (type) {
      case "THREAD": {
        const rows = await prisma.thread.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true, slug: true, deleted: true },
        })
        return fetch(type, rows.map((t) => ({ id: t.id, label: t.title, deleted: t.deleted, href: `/forum/thread/${t.slug}` })))
      }
      case "POST": {
        const rows = await prisma.post.findMany({
          where: { id: { in: ids } },
          select: { id: true, content: true, deleted: true, thread: { select: { slug: true } } },
        })
        return fetch(type, rows.map((p) => ({
          id: p.id,
          label: p.content.slice(0, 120),
          deleted: p.deleted,
          href: p.thread ? `/forum/thread/${p.thread.slug}` : null,
        })))
      }
      case "CHAT_MESSAGE": {
        const rows = await prisma.chatMessage.findMany({
          where: { id: { in: ids } },
          select: { id: true, content: true, deleted: true },
        })
        return fetch(type, rows.map((m) => ({ id: m.id, label: m.content.slice(0, 120), deleted: m.deleted })))
      }
      case "DIARY": {
        const rows = await prisma.growDiary.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true, deleted: true },
        })
        return fetch(type, rows.map((d) => ({ id: d.id, label: d.title, deleted: d.deleted, href: `/diaries/${d.id}` })))
      }
      case "SETUP": {
        const rows = await prisma.growSetup.findMany({
          where: { id: { in: ids } },
          select: { id: true, title: true, deleted: true },
        })
        return fetch(type, rows.map((s) => ({ id: s.id, label: s.title, deleted: s.deleted, href: `/setups/${s.id}` })))
      }
      case "PROFILE": {
        const rows = await prisma.profile.findMany({
          where: { userId: { in: ids } },
          select: { userId: true, username: true },
        })
        return fetch(type, rows.map((p) => ({ id: p.userId, label: `@${p.username}`, href: `/u/${p.username}` })))
      }
    }
  }))
  return labels
}

// GET — unified staff workqueue: open reports + persisted abuse flags,
// server-side filtered, priority-sorted, offset-paginated.
export async function GET(request: Request) {
  const staff = await requireStaff()
  if (!staff) return forbidden()

  const rl = await rateLimit(`queue:${staff.id}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const supportOnly = isSupport(staff.role)
  const { searchParams } = new URL(request.url)
  const status = searchParams.get("status") || "OPEN"
  const kind = searchParams.get("kind") || "ALL"
  const mine = searchParams.get("mine") === "1"
  const unassigned = searchParams.get("unassigned") === "1"
  const priority = searchParams.get("priority")
  const typeFilter = searchParams.get("type")
  const q = (searchParams.get("q") || "").trim().slice(0, 30)

  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("limit")) || 50))
  const skip = (page - 1) * limit

  const statusFilter =
    status === "OPEN" ? { in: ["PENDING", "REVIEWING", "ESCALATED"] }
    : status === "ALL" || !CASE_STATUSES.includes(status as never) ? undefined
    : status

  // Optional username search — resolve to a user id, then match the subject
  // (or reporter, for staff who can act; SUPPORT never matches reporter).
  let subjectId: string | undefined
  if (q) {
    const prof = await prisma.profile.findFirst({
      where: { username: { equals: q, mode: "insensitive" } },
      select: { userId: true },
    })
    if (!prof) return NextResponse.json({ items: [], page, counts: await queueCounts(staff.id) })
    subjectId = prof.userId
  }

  const items: QueueItem[] = []

  if (kind === "ALL" || kind === "REPORT") {
    const where: Record<string, unknown> = {}
    if (statusFilter) where.status = statusFilter
    if (priority && CASE_PRIORITIES.includes(priority as never)) where.priority = priority
    if (typeFilter) where.type = typeFilter
    if (mine) where.assignedToId = staff.id
    if (unassigned) where.assignedToId = null
    if (subjectId) {
      where.OR = [{ reportedId: subjectId }, { targetId: subjectId }, ...(supportOnly ? [] : [{ reporterId: subjectId }])]
    }
    const reports = await prisma.report.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: SOURCE_FETCH_CAP,
      include: { reporter: { select: { profile: { select: { username: true } } } } },
    })
    const [labels, names] = await Promise.all([
      reportTargetLabels(reports),
      usernames([...reports.map((r) => r.reportedId), ...reports.map((r) => r.assignedToId ?? "")]),
    ])
    for (const r of reports) {
      const t = r.targetId ? labels.get(`${r.type}:${r.targetId}`) : undefined
      items.push({
        kind: "REPORT",
        id: r.id,
        status: r.status,
        priority: r.priority,
        createdAt: r.createdAt,
        assignedTo: r.assignedToId ? names.get(r.assignedToId) ?? "unknown" : null,
        type: r.type,
        reason: r.reason,
        subject: names.get(r.reportedId) ?? "unknown",
        subjectId: r.reportedId,
        reporter: supportOnly ? null : r.reporter.profile?.username ?? "unknown",
        targetLabel: t?.label ?? null,
        targetDeleted: t?.deleted ?? false,
      })
    }
  }

  if (kind === "ALL" || kind === "FLAG") {
    const where: Record<string, unknown> = {}
    if (statusFilter) where.status = statusFilter
    if (priority && CASE_PRIORITIES.includes(priority as never)) where.priority = priority
    if (typeFilter) where.signal = typeFilter
    if (mine) where.assignedToId = staff.id
    if (unassigned) where.assignedToId = null
    if (subjectId) where.OR = [{ userId: subjectId }, { counterpartyId: subjectId }]
    const flags = await prisma.abuseFlag.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: SOURCE_FETCH_CAP,
    })
    const names = await usernames([
      ...flags.map((f) => f.userId),
      ...flags.map((f) => f.counterpartyId ?? ""),
      ...flags.map((f) => f.assignedToId ?? ""),
    ])
    for (const f of flags) {
      items.push({
        kind: "FLAG",
        id: f.id,
        status: f.status,
        priority: f.priority,
        createdAt: f.createdAt,
        assignedTo: f.assignedToId ? names.get(f.assignedToId) ?? "unknown" : null,
        signal: f.signal,
        signalLabel: SIGNAL_LABELS[f.signal] ?? f.signal,
        subject: names.get(f.userId) ?? "unknown",
        subjectId: f.userId,
        counterparty: f.counterpartyId ? names.get(f.counterpartyId) ?? "unknown" : null,
        evidence: f.evidence,
      })
    }
  }

  items.sort(sortQueue)
  return NextResponse.json({
    items: items.slice(skip, skip + limit),
    page,
    counts: await queueCounts(staff.id),
  })
}

async function queueCounts(staffId: string) {
  const open = { in: ["PENDING", "REVIEWING", "ESCALATED"] }
  const [openReports, openFlags, myReports, myFlags, escReports, escFlags] = await Promise.all([
    prisma.report.count({ where: { status: open } }),
    prisma.abuseFlag.count({ where: { status: open } }),
    prisma.report.count({ where: { status: open, assignedToId: staffId } }),
    prisma.abuseFlag.count({ where: { status: open, assignedToId: staffId } }),
    prisma.report.count({ where: { status: "ESCALATED" } }),
    prisma.abuseFlag.count({ where: { status: "ESCALATED" } }),
  ])
  return { open: openReports + openFlags, mine: myReports + myFlags, escalated: escReports + escFlags }
}

// PATCH — case transitions. SUPPORT may only triage (REVIEWING/ESCALATED);
// all other actions need MODERATOR+. Staff can't adjudicate reports they
// filed themselves. Every transition writes ModerationAction + SecurityEvent.
export async function PATCH(request: Request) {
  const staff = await requireStaff()
  if (!staff) return forbidden()

  const rl = await rateLimit(`queue-mutate:${staff.id}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const { kind, id, action, status, priority, assignTo, resolution } = body
  if ((kind !== "REPORT" && kind !== "FLAG") || typeof id !== "string" || !id) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  if (resolution && (typeof resolution !== "string" || resolution.length > 500)) {
    return NextResponse.json({ error: "Resolution note too long" }, { status: 400 })
  }

  const item = kind === "REPORT"
    ? await prisma.report.findUnique({ where: { id } })
    : await prisma.abuseFlag.findUnique({ where: { id } })
  if (!item) {
    return NextResponse.json({ error: "Case not found" }, { status: 404 })
  }

  // Self-adjudication guard — staff can't act on reports they filed.
  if (kind === "REPORT" && (item as { reporterId?: string }).reporterId === staff.id) {
    return NextResponse.json({ error: "You cannot act on your own report" }, { status: 403 })
  }

  const supportOnly = isSupport(staff.role)
  const table = kind === "REPORT" ? prisma.report : prisma.abuseFlag
  const prefix = kind === "REPORT" ? "REPORT" : "FLAG"
  const linkField = kind === "REPORT" ? { reportId: id } : { flagId: id }
  const targetUserId = kind === "REPORT"
    ? (item as { reportedId: string }).reportedId
    : (item as { userId: string }).userId

  const audit = async (type: string, reason: string) => {
    await prisma.moderationAction.create({
      data: { type, reason, targetUserId, moderatorId: staff.id, ...linkField },
    })
    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: staff.id,
      ip: getClientIp(request),
      metadata: { action: type.toLowerCase(), caseId: id, kind },
    })
  }

  if (action === "status") {
    if (!CASE_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 })
    }
    // SUPPORT triage: REVIEWING and ESCALATED only — never terminal states.
    if (supportOnly && status !== "REVIEWING" && status !== "ESCALATED") {
      return NextResponse.json({ error: "Support may only review or escalate" }, { status: 403 })
    }
    const terminal = TERMINAL_STATUSES.includes(status)
    await (table as typeof prisma.report).update({
      where: { id },
      data: {
        status,
        ...(resolution !== undefined ? { resolution: resolution?.trim() || null } : {}),
        resolvedById: terminal ? staff.id : null,
        resolvedAt: terminal ? new Date() : null,
      },
    })
    await audit(`${prefix}_${status}`, resolution?.trim() || `${kind === "REPORT" ? "Report" : "Flag"} marked ${status.toLowerCase()}`)

    if (status === "ESCALATED") {
      const admins = await prisma.user.findMany({
        where: { role: "ADMINISTRATOR", profile: { isNot: { username: "terpbot" } } },
        select: { id: true },
      })
      await notifyMany(
        admins.map((a) => ({
          userId: a.id,
          type: "MODERATOR_ANNOUNCEMENT" as const,
          title: "Case escalated",
          content: `A ${kind === "REPORT" ? "report" : "reputation flag"} was escalated for administrator review.`,
          link: "/moderation",
        }))
      ).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  }

  if (action === "assign") {
    if (supportOnly) return NextResponse.json({ error: "Insufficient role" }, { status: 403 })
    if (assignTo !== null && typeof assignTo !== "string") {
      return NextResponse.json({ error: "Invalid assignee" }, { status: 400 })
    }
    let assigneeName = "unassigned"
    if (assignTo) {
      const target = await prisma.user.findUnique({
        where: { id: assignTo },
        select: { role: true, banned: true, profile: { select: { username: true } } },
      })
      if (!target || target.banned || !STAFF_ROLES.has(target.role)) {
        return NextResponse.json({ error: "Assignee must be active staff" }, { status: 400 })
      }
      assigneeName = target.profile?.username ?? "unknown"
    }
    await (table as typeof prisma.report).update({
      where: { id },
      data: {
        assignedToId: assignTo,
        // Claiming a pending case moves it into review automatically.
        ...(assignTo && item.status === "PENDING" ? { status: "REVIEWING" } : {}),
      },
    })
    await audit(`${prefix}_ASSIGNED`, `Assigned to @${assigneeName}`)
    if (assignTo && assignTo !== staff.id) {
      await notifyMany([{
        userId: assignTo,
        type: "MODERATOR_ANNOUNCEMENT" as const,
        title: "Case assigned to you",
        content: `A ${kind === "REPORT" ? "report" : "reputation flag"} was assigned to you for review.`,
        link: "/moderation",
      }]).catch(() => {})
    }
    return NextResponse.json({ ok: true })
  }

  if (action === "priority") {
    if (supportOnly) return NextResponse.json({ error: "Insufficient role" }, { status: 403 })
    if (!CASE_PRIORITIES.includes(priority)) {
      return NextResponse.json({ error: "Invalid priority" }, { status: 400 })
    }
    await (table as typeof prisma.report).update({ where: { id }, data: { priority } })
    await audit(`${prefix}_PRIORITY`, `Priority set to ${priority}`)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
