import { prisma } from "@/lib/prisma"
import { createHash } from "crypto"
import { NextResponse } from "next/server"
import { REP_TIERS } from "@/lib/reputation"

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

// ─── Anti-spam: link restrictions for new/low-trust users ─────────────

const LINK_RE = /(?:https?:\/\/|www\.)|(?:\b[a-z0-9-]+\.[a-z]{2,}\b)/i

/** Returns true if text contains a likely external link. */
export function containsExternalLink(text: string): boolean {
  LINK_RE.lastIndex = 0
  return LINK_RE.test(text)
}

/** Moderators and users older than 24h who have reached the Sprout tier can post links. */
export async function isTrustedForLinks(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, createdAt: true, profile: { select: { reputation: true } } },
  })
  if (!user) return false
  if (isModerator(user.role)) return true
  const ageHours = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60)
  const sproutThreshold = REP_TIERS[1]?.threshold ?? 250
  return ageHours >= 24 && (user.profile?.reputation ?? 0) >= sproutThreshold
}

export type TrustLevel = "New Grower" | "Member" | "Established" | "Veteran" | "Expert"

export function getTrustLevel(createdAt: Date | string, reputation: number): TrustLevel {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24)
  if (ageDays >= 90 && reputation >= 1000) return "Expert"
  if (ageDays >= 30 && reputation >= 500) return "Veteran"
  if (ageDays >= 7 && reputation >= 100) return "Established"
  if (ageDays >= 1 && reputation >= 10) return "Member"
  return "New Grower"
}

// ─── Blocking helpers ───────────────────────────────────────────────

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
  role: true,
  profile: {
    select: {
      username: true,
    },
  },
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
  BIO_MAX: 150,
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

export function getClientIp(request: { headers: Headers | Record<string, string | undefined> }): string {
  const headers = request.headers
  const get = (name: string): string | undefined | null => {
    if (headers instanceof Headers) return headers.get(name)
    const value = (headers as Record<string, string | undefined>)[name.toLowerCase()] ?? (headers as Record<string, string | undefined>)[name]
    return value ?? null
  }
  // Trust platform-specific headers when available (Vercel, Cloudflare)
  const platformIp = get("x-vercel-forwarded-for") || get("cf-connecting-ip")
  if (platformIp) return platformIp.split(",")[0].trim()
  // Otherwise use the rightmost entry of X-Forwarded-For, which is the closest trusted proxy
  const forwarded = get("x-forwarded-for")
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean)
    return parts[parts.length - 1] || forwarded.split(",")[0].trim()
  }
  return get("x-real-ip") || "unknown"
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
  | "RECOVERY_PHRASE_GENERATED"
  | "RECOVERY_FAILED"
  | "RECOVERY_SUCCESS"
  | "NEWBIE_LINK_BLOCKED"

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
