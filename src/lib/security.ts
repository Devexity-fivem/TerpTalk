import { prisma } from "@/lib/prisma"
import { createHash } from "crypto"
import { NextResponse } from "next/server"

// ─── Role & status helpers ──────────────────────────────────────────

export const MODERATOR_ROLES = new Set(["MODERATOR", "ADMINISTRATOR"])

export function isModerator(role?: string | null) {
  return !!role && MODERATOR_ROLES.has(role)
}

export function isAdmin(role?: string | null) {
  return role === "ADMINISTRATOR"
}

export function forbidden(message = "Forbidden") {
  return NextResponse.json({ error: message }, { status: 403 })
}

export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
}

/** Returns true if the user is banned — enforce on mutation endpoints. */
export async function isBanned(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { banned: true },
  })
  return !user || user.banned
}

// ─── Blocking helpers ───────────────────────────────────────────────

/** IDs of users that `userId` has blocked AND users who blocked `userId`. */
export async function getBlockRelatedIds(userId: string): Promise<string[]> {
  const rows = await prisma.block.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  })
  const ids = new Set<string>()
  for (const r of rows) {
    if (r.blockerId !== userId) ids.add(r.blockerId)
    if (r.blockedId !== userId) ids.add(r.blockedId)
  }
  return [...ids]
}

/** True if a block exists in either direction between two users. */
export async function blockExistsBetween(a: string, b: string): Promise<boolean> {
  const row = await prisma.block.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { id: true },
  })
  return !!row
}

// ─── Safe serialization ─────────────────────────────────────────────
// NEVER include the full User object in API responses — it contains
// password hash, email, status, lastSeenAt, and role internals.
// Always use this select for public-facing author/user references.

export const publicUserSelect = {
  id: true,
  name: true,
  image: true,
  profile: {
    select: {
      username: true,
    },
  },
} as const

export const publicUserSelectWithRole = {
  ...publicUserSelect,
  role: true,
} as const

// ─── Input limits (server-side enforcement) ─────────────────────────

export const LIMITS = {
  USERNAME_MIN: 3,
  USERNAME_MAX: 20,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,
  TITLE_MAX: 200,
  POST_CONTENT_MAX: 10_000,
  CHAT_MESSAGE_MAX: 1_000,
  BIO_MAX: 500,
  COMMENT_MAX: 5_000,
  THREAD_TITLE_MAX: 150,
  DIARY_TITLE_MAX: 100,
  DESCRIPTION_MAX: 2_000,
  STRAIN_NAME_MAX: 100,
  URL_MAX: 500,
} as const

export const USERNAME_REGEX = /^[a-zA-Z0-9_]+$/

export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "moderator", "mod", "system", "support",
  "root", "terptalk", "staff", "help", "api", "www", "null", "undefined",
])

// ─── Client IP (privacy-conscious: hashed, never stored raw) ────────

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return request.headers.get("x-real-ip") || "unknown"
}

export function hashIp(ip: string): string {
  const salt = process.env.IP_HASH_SALT || process.env.NEXTAUTH_SECRET || "ip-salt"
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex").slice(0, 32)
}

// ─── Security event logging ─────────────────────────────────────────
// Logs security-relevant events WITHOUT sensitive content.
// Never log passwords, tokens, message contents, or full request bodies.

export type SecurityEventType =
  | "LOGIN_SUCCESS"
  | "LOGIN_FAILURE"
  | "REGISTRATION"
  | "REGISTRATION_FAILED"
  | "ACCOUNT_DELETED"
  | "RATE_LIMIT_EXCEEDED"
  | "AUTHORIZATION_FAILURE"
  | "SUSPICIOUS_ACTIVITY"

export async function logSecurityEvent(
  type: SecurityEventType,
  options: {
    userId?: string | null
    ip?: string
    userAgent?: string | null
    metadata?: Record<string, unknown>
  } = {}
) {
  try {
    await prisma.securityEvent.create({
      data: {
        type,
        userId: options.userId ?? null,
        ipHash: options.ip ? hashIp(options.ip) : null,
        userAgent: options.userAgent?.slice(0, 256) ?? null,
        metadata: options.metadata ? JSON.stringify(options.metadata) : null,
      },
    })
  } catch (error) {
    // Never let logging failures break the request path
    console.error("[security-log] failed:", error)
  }
}
