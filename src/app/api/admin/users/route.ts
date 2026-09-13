import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, logSecurityEvent } from "@/lib/security"
import { requireAdmin } from "@/lib/require-staff"
import { getBadgeByName, STAFF_AWARDED_BADGES } from "@/lib/badge-registry"
import { grantBadge } from "@/lib/reputation"
import { rateLimit } from "@/lib/rate-limit"
import { emitNotificationPush } from "@/lib/notify"

const ASSIGNABLE_ROLES = new Set(["MEMBER", "VERIFIED_MEMBER", "SUPPORT", "MODERATOR", "ADMINISTRATOR"])

function escapeLike(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
}

// GET — list/search users (ADMINISTRATOR only)
const MAX_PAGE_SIZE = 100

// GET — list/search users (ADMINISTRATOR only)
export async function GET(request: Request) {
  try {
    const admin = await requireAdmin()
    if (!admin) return forbidden()

    const rl = await rateLimit(`admin-users:${admin.id}`, 30, 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const { searchParams } = new URL(request.url)
    const q = (searchParams.get("q") || "").trim().slice(0, 60)
    const filter = searchParams.get("filter") || "all"

    if (!["all", "banned", "staff"].includes(filter)) {
      return NextResponse.json({ error: "Invalid filter" }, { status: 400 })
    }

    const page = Math.max(1, Number(searchParams.get("page")) || 1)
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(searchParams.get("limit")) || 50))
    const skip = (page - 1) * limit

    const contains = q ? { contains: escapeLike(q), mode: "insensitive" as const } : undefined

    const users = await prisma.user.findMany({
      where: {
        ...(contains && {
          OR: [
            { name: contains },
            { profile: { username: contains } },
          ],
        }),
        ...(filter === "banned" && { banned: true }),
        ...(filter === "staff" && { role: { in: ["SUPPORT", "MODERATOR", "ADMINISTRATOR"] } }),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
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
  } catch (error) {
    console.error("Admin users GET error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

// PATCH — change a user's role or beta badge (ADMINISTRATOR only)
// { userId, role } or { userId, beta: boolean }
export async function PATCH(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  try {
    const rl = await rateLimit(`admin-user-patch:${admin.id}`, 60, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { userId, role, beta, badge, grant } = body

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

      await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { role, sessionVersion: { increment: 1 } } })
        await tx.moderationAction.create({
          data: {
            type: "ROLE_CHANGE",
            reason: `Role changed: ${target.role} → ${role}`,
            targetUserId: userId,
            moderatorId: admin.id,
          },
        })
      })

      // Role badges track live roles — grant on promotion, revoke on demotion.
      const staffRole = role === "MODERATOR" || role === "ADMINISTRATOR" || role === "SUPPORT"
      if (staffRole) {
        if (role === "MODERATOR" || role === "ADMINISTRATOR") {
          await grantBadge(userId, "Moderator", { notifyUser: false })
        }
        if (role === "ADMINISTRATOR" || role === "SUPPORT") {
          await grantBadge(userId, "Staff", { notifyUser: false })
        }
      } else {
        const staffBadges = await prisma.badge.findMany({
          where: { name: { in: ["Moderator", "Staff"] } },
          select: { id: true },
        })
        if (staffBadges.length > 0) {
          await prisma.userBadge.deleteMany({
            where: { userId, badgeId: { in: staffBadges.map((b) => b.id) } },
          })
        }
      }

      const roleNotification = await prisma.notification.create({
        data: {
          userId,
          type: "MODERATOR_ANNOUNCEMENT",
          title: "Role updated",
          content:
            role === "SUPPORT"
              ? "You've been added to the support team. You can now access support tools."
              : role === "MODERATOR"
                ? "You've been promoted to Moderator. You can now access the moderation queue."
                : role === "ADMINISTRATOR"
                  ? "You've been promoted to Administrator. You now have full admin access."
                  : role === "VERIFIED_MEMBER"
                    ? "Your account has been verified by the team."
                    : "Your staff role has been removed.",
        },
      }).catch(() => null)
      if (roleNotification) emitNotificationPush(userId, roleNotification)

      await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
        userId: admin.id,
        ip: getClientIp(request),
        metadata: { adminAction: "role_change", targetUserId: userId, newRole: role },
      })

      return NextResponse.json({ ok: true })
    }

    // Beta badge toggle path
    if (typeof beta === "boolean") {
      const def = getBadgeByName("Beta Tester")
      const badge = await prisma.badge.upsert({
        where: { name: "Beta Tester" },
        create: {
          name: "Beta Tester",
          description: def?.description ?? "Joined TerpTalk during the beta.",
          icon: def?.icon ?? "Rocket",
          color: def?.rarity ?? "rare",
          requirement: def?.requirement ?? "Early access member",
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

    // Staff-awarded badge path — { badge: "Trusted Member", grant: boolean }.
    // Whitelisted so admins can't hand out stat/contest badges by fiat.
    if (typeof badge === "string" && typeof grant === "boolean") {
      if (!STAFF_AWARDED_BADGES.has(badge)) {
        return NextResponse.json({ error: "Badge is not staff-awardable" }, { status: 400 })
      }
      const def = getBadgeByName(badge)
      const row = await prisma.badge.upsert({
        where: { name: badge },
        create: {
          name: badge,
          description: def?.description ?? badge,
          icon: def?.icon ?? "Award",
          color: def?.rarity ?? "rare",
          requirement: def?.requirement ?? "Awarded by staff",
        },
        update: {},
      })

      if (grant) {
        await grantBadge(userId, badge, {
          content: `Staff awarded you the "${badge}" badge — ${def?.description ?? ""}`,
        })
      } else {
        await prisma.userBadge.deleteMany({ where: { userId, badgeId: row.id } })
      }

      await prisma.moderationAction.create({
        data: {
          type: "BADGE_ADJUSTMENT",
          reason: `${grant ? "Granted" : "Revoked"} badge "${badge}"`,
          targetUserId: userId,
          moderatorId: admin.id,
        },
      })
      await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
        userId: admin.id,
        ip: getClientIp(request),
        metadata: { adminAction: "badge_adjustment", badge, grant, targetUserId: userId },
      })

      return NextResponse.json({ ok: true, badge, granted: grant })
    }

    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  } catch (error) {
    console.error("Admin user PATCH error:", error)
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
