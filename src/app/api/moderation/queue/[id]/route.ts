import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden, isSupport } from "@/lib/security"
import { requireStaff } from "@/lib/require-staff"
import { rateLimit } from "@/lib/rate-limit"
import { SIGNAL_LABELS } from "@/lib/trust-signals"

// GET /api/moderation/queue/[id]?kind=REPORT|FLAG — case detail: the item,
// its evidence, related open cases, the subject's staff-only context, and the
// case's audit activity. Context fields are role-gated: SUPPORT sees the
// summary card only; reporter identity is masked for SUPPORT.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const staff = await requireStaff()
  if (!staff) return forbidden()

  const rl = await rateLimit(`queue-case:${staff.id}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { id } = await params
  const kind = new URL(request.url).searchParams.get("kind") || "REPORT"
  const supportOnly = isSupport(staff.role)

  if (kind === "REPORT") {
    const report = await prisma.report.findUnique({
      where: { id },
      include: { reporter: { select: { id: true, profile: { select: { username: true } } } } },
    })
    if (!report) return NextResponse.json({ error: "Case not found" }, { status: 404 })

    const target = await reportTargetDetail(report.type, report.targetId)
    const subject = await subjectContext(report.reportedId, supportOnly)

    const [related, activity, assignee] = await Promise.all([
      prisma.report.findMany({
        where: {
          id: { not: report.id },
          status: { in: ["PENDING", "REVIEWING", "ESCALATED"] },
          OR: [
            { reportedId: report.reportedId },
            ...(report.targetId ? [{ targetId: report.targetId }] : []),
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, type: true, reason: true, status: true, priority: true, createdAt: true },
      }),
      caseActivity({ reportId: report.id }),
      report.assignedToId ? staffName(report.assignedToId) : Promise.resolve(null),
    ])

    const relatedFlags = await prisma.abuseFlag.findMany({
      where: { userId: report.reportedId, status: { in: ["PENDING", "REVIEWING", "ESCALATED"] } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, signal: true, status: true, priority: true, createdAt: true },
    })

    return NextResponse.json({
      kind: "REPORT",
      item: {
        id: report.id,
        type: report.type,
        reason: report.reason,
        description: report.description,
        status: report.status,
        priority: report.priority,
        resolution: report.resolution,
        createdAt: report.createdAt,
        reporter: supportOnly ? null : report.reporter.profile?.username ?? "unknown",
        ownReport: report.reporter.id === staff.id,
        reportedUserId: report.reportedId,
        targetId: report.targetId,
        assignedTo: assignee,
        resolvedBy: report.resolvedById ? await staffName(report.resolvedById) : null,
        resolvedAt: report.resolvedAt,
        target,
      },
      subject,
      related: [
        ...related.map((r) => ({ kind: "REPORT" as const, ...r })),
        ...relatedFlags.map((f) => ({
          kind: "FLAG" as const, id: f.id, signal: f.signal,
          signalLabel: SIGNAL_LABELS[f.signal] ?? f.signal,
          status: f.status, priority: f.priority, createdAt: f.createdAt,
        })),
      ],
      activity,
    })
  }

  if (kind === "FLAG") {
    const flag = await prisma.abuseFlag.findUnique({ where: { id } })
    if (!flag) return NextResponse.json({ error: "Case not found" }, { status: 404 })

    const [subject, counterparty, related, activity, assignee] = await Promise.all([
      subjectContext(flag.userId, supportOnly),
      flag.counterpartyId ? subjectContext(flag.counterpartyId, supportOnly) : Promise.resolve(null),
      prisma.abuseFlag.findMany({
        where: {
          id: { not: flag.id },
          status: { in: ["PENDING", "REVIEWING", "ESCALATED"] },
          OR: [{ userId: flag.userId }, ...(flag.counterpartyId ? [{ userId: flag.counterpartyId }] : [])],
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, signal: true, status: true, priority: true, createdAt: true },
      }),
      caseActivity({ flagId: flag.id }),
      flag.assignedToId ? staffName(flag.assignedToId) : Promise.resolve(null),
    ])

    return NextResponse.json({
      kind: "FLAG",
      item: {
        id: flag.id,
        signal: flag.signal,
        signalLabel: SIGNAL_LABELS[flag.signal] ?? flag.signal,
        status: flag.status,
        priority: flag.priority,
        resolution: flag.resolution,
        evidence: flag.evidence,
        createdAt: flag.createdAt,
        userId: flag.userId,
        counterpartyId: flag.counterpartyId,
        assignedTo: assignee,
        resolvedBy: flag.resolvedById ? await staffName(flag.resolvedById) : null,
        resolvedAt: flag.resolvedAt,
      },
      subject,
      counterparty,
      related: related.map((f) => ({
        kind: "FLAG" as const, ...f, signalLabel: SIGNAL_LABELS[f.signal] ?? f.signal,
      })),
      activity,
    })
  }

  return NextResponse.json({ error: "Invalid kind" }, { status: 400 })
}

async function staffName(userId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { profile: { select: { username: true } } },
  })
  return u?.profile?.username ?? null
}

async function caseActivity(where: { reportId?: string; flagId?: string }) {
  const actions = await prisma.moderationAction.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { moderator: { select: { profile: { select: { username: true } } } } },
  })
  return actions.map((a) => ({
    id: a.id,
    type: a.type,
    reason: a.reason,
    moderator: a.moderator.profile?.username ?? "unknown",
    createdAt: a.createdAt,
  }))
}

// Staff-only subject context. SUPPORT gets the summary card; MODERATOR+ also
// get suspension state, presence, recent rep events, and moderation history.
// ipHash/userAgent/security metadata never leave the database.
async function subjectContext(userId: string, supportOnly: boolean) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: {
      username: true,
      reputation: true,
      user: {
        select: {
          id: true, role: true, banned: true, bannedReason: true,
          suspendedUntil: true, createdAt: true, lastSeenAt: true,
        },
      },
    },
  })
  if (!profile) return { missing: true as const }

  const openReports = await prisma.report.count({
    where: { reportedId: userId, status: { in: ["PENDING", "REVIEWING", "ESCALATED"] } },
  })

  const base = {
    userId,
    username: profile.username,
    role: profile.user.role,
    banned: profile.user.banned,
    joined: profile.user.createdAt,
    reputation: profile.reputation,
    openReports,
  }
  if (supportOnly) return base

  const [repEvents, modHistory, openFlags] = await Promise.all([
    prisma.reputationEvent.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, type: true, amount: true, reason: true, reversedAt: true, createdAt: true },
    }),
    prisma.moderationAction.findMany({
      where: { targetUserId: userId },
      orderBy: { createdAt: "desc" },
      take: 5,
      include: { moderator: { select: { profile: { select: { username: true } } } } },
    }),
    prisma.abuseFlag.count({
      where: { userId, status: { in: ["PENDING", "REVIEWING", "ESCALATED"] } },
    }),
  ])

  return {
    ...base,
    bannedReason: profile.user.bannedReason,
    suspendedUntil: profile.user.suspendedUntil,
    lastSeen: profile.user.lastSeenAt,
    openFlags,
    recentReputation: repEvents,
    recentActions: modHistory.map((a) => ({
      id: a.id, type: a.type, reason: a.reason,
      moderator: a.moderator.profile?.username ?? "unknown",
      createdAt: a.createdAt, duration: a.duration,
    })),
  }
}

async function reportTargetDetail(type: string, targetId: string | null) {
  if (!targetId) return null
  try {
    switch (type) {
      case "THREAD": {
        const t = await prisma.thread.findUnique({
          where: { id: targetId },
          select: { id: true, title: true, slug: true, deleted: true, content: true },
        })
        return t && { title: t.title, content: t.content.slice(0, 2000), deleted: t.deleted, href: `/forum/thread/${t.slug}` }
      }
      case "POST": {
        const p = await prisma.post.findUnique({
          where: { id: targetId },
          select: { id: true, content: true, deleted: true, thread: { select: { slug: true, title: true } } },
        })
        return p && { title: p.thread?.title, content: p.content.slice(0, 2000), deleted: p.deleted, href: p.thread ? `/forum/thread/${p.thread.slug}` : null }
      }
      case "CHAT_MESSAGE": {
        const m = await prisma.chatMessage.findUnique({
          where: { id: targetId },
          select: { id: true, content: true, deleted: true },
        })
        return m && { content: m.content.slice(0, 2000), deleted: m.deleted, href: null }
      }
      case "DIARY": {
        const d = await prisma.growDiary.findUnique({
          where: { id: targetId },
          select: { id: true, title: true, deleted: true, description: true },
        })
        return d && { title: d.title, content: (d.description ?? "").slice(0, 2000), deleted: d.deleted, href: `/diaries/${d.id}` }
      }
      case "SETUP": {
        const s = await prisma.growSetup.findUnique({
          where: { id: targetId },
          select: { id: true, title: true, deleted: true, description: true },
        })
        return s && { title: s.title, content: (s.description ?? "").slice(0, 2000), deleted: s.deleted, href: `/setups/${s.id}` }
      }
      case "PROFILE": {
        const p = await prisma.profile.findUnique({
          where: { userId: targetId },
          select: { username: true, bio: true },
        })
        return p && { title: `@${p.username}`, content: (p.bio ?? "").slice(0, 2000), deleted: false, href: `/u/${p.username}` }
      }
    }
  } catch {
    return null
  }
  return null
}
