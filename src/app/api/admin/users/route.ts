import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, logSecurityEvent } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { BADGE_ICONS } from "@/lib/badges"

const ASSIGNABLE_ROLES = new Set(["MEMBER", "VERIFIED_MEMBER", "MODERATOR", "ADMINISTRATOR"])

// GET — list/search users (ADMINISTRATOR only)
export async function GET(request: Request) {
  if (!(await requireAdmin())) return forbidden()

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get("q") || "").trim().slice(0, 60)
  const filter = searchParams.get("filter") || "all" // all | banned | staff

  const users = await prisma.user.findMany({
    where: {
      ...(q && {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { profile: { username: { contains: q, mode: "insensitive" } } },
        ],
      }),
      ...(filter === "banned" && { banned: true }),
      ...(filter === "staff" && { role: { in: ["MODERATOR", "ADMINISTRATOR"] } }),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      role: true,
      banned: true,
      bannedReason: true,
      createdAt: true,
      lastSeenAt: true,
      profile: {
        select: {
          username: true,
          reputation: true,
          _count: { select: { referrals: true } },
        },
      },
      _count: {
        select: { posts: true, threadCreator: true, diaryCreator: true, reports: true },
      },
    },
  })

  // One extra query for the Beta Tester badge membership of this page
  const betaBadge = await prisma.badge.findUnique({
    where: { name: "Beta Tester" },
    select: { id: true },
  })
  let betaUserIds = new Set<string>()
  if (betaBadge) {
    const rows = await prisma.userBadge.findMany({
      where: { badgeId: betaBadge.id, userId: { in: users.map((u) => u.id) } },
      select: { userId: true },
    })
    betaUserIds = new Set(rows.map((r) => r.userId))
  }

  return NextResponse.json({
    users: users.map((u) => ({
      id: u.id,
      username: u.profile?.username ?? u.name,
      role: u.role,
      banned: u.banned,
      bannedReason: u.bannedReason,
      joined: u.createdAt,
      lastSeen: u.lastSeenAt,
      reputation: u.profile?.reputation ?? 0,
      referrals: u.profile?._count.referrals ?? 0,
      stats: u._count,
      isBeta: betaUserIds.has(u.id),
    })),
  })
}

// PATCH — change a user's role or beta badge (ADMINISTRATOR only)
// { userId, role } or { userId, beta: boolean }
export async function PATCH(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const body = await request.json().catch(() => ({}))
  const { userId, role, beta } = body

  if (typeof userId !== "string" || !userId) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  if (userId === admin.id) {
    return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 })
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }
  if (target.role === "ADMINISTRATOR") {
    return forbidden("Cannot change an administrator's role")
  }

  // Role change path
  if (role !== undefined) {
    if (!ASSIGNABLE_ROLES.has(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 })
    }

    await prisma.user.update({ where: { id: userId }, data: { role } })

    await prisma.moderationAction.create({
      data: {
        type: "ROLE_CHANGE",
        reason: `Role changed: ${target.role} → ${role}`,
        targetUserId: userId,
        moderatorId: admin.id,
      },
    })

    await prisma.notification.create({
      data: {
        userId,
        type: "MODERATOR_ANNOUNCEMENT",
        title: "Role updated",
        content:
          role === "MODERATOR"
            ? "You've been promoted to Moderator. You can now access the moderation queue."
            : role === "ADMINISTRATOR"
              ? "You've been promoted to Administrator. You now have full admin access."
              : role === "VERIFIED_MEMBER"
                ? "Your account has been verified by the team."
                : "Your staff role has been removed.",
      },
    }).catch(() => {})

    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: admin.id,
      ip: getClientIp(request),
      metadata: { adminAction: "role_change", targetUserId: userId, newRole: role },
    })

    return NextResponse.json({ ok: true })
  }

  // Beta badge toggle path
  if (typeof beta === "boolean") {
    const badge = await prisma.badge.upsert({
      where: { name: "Beta Tester" },
      create: {
        name: "Beta Tester",
        description: "Joined TerpTalk during the beta and helped shape the community.",
        icon: BADGE_ICONS["Beta Tester"],
        requirement: "Early access member",
      },
      update: {},
    })

    if (beta) {
      await prisma.userBadge.upsert({
        where: { userId_badgeId: { userId, badgeId: badge.id } },
        create: { userId, badgeId: badge.id },
        update: {},
      })
    } else {
      await prisma.userBadge.deleteMany({ where: { userId, badgeId: badge.id } })
    }

    await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
      userId: admin.id,
      ip: getClientIp(request),
      metadata: { adminAction: "beta_badge", targetUserId: userId, awarded: beta },
    })

    return NextResponse.json({ ok: true, isBeta: beta })
  }

  return NextResponse.json({ error: "Invalid request" }, { status: 400 })
}
