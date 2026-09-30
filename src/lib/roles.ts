// Role & status helpers — the single source of truth for role predicates.
//
// Pure module: no Prisma, no next/server, no env. Safe to import from client
// components and pure modules (e.g. chat-commands) — the heavier server-only
// helpers in @/lib/security re-export these so every import path resolves to
// the same definitions.

export const MODERATOR_ROLES = new Set(["MODERATOR", "ADMINISTRATOR"])
export const STAFF_ROLES = new Set(["SUPPORT", "MODERATOR", "ADMINISTRATOR"])

export function isModerator(role?: string | null) {
  return !!role && MODERATOR_ROLES.has(role)
}

export function isSupport(role?: string | null) {
  return role === "SUPPORT"
}

export function isStaff(role?: string | null) {
  return !!role && STAFF_ROLES.has(role)
}

export function isAdmin(role?: string | null) {
  return role === "ADMINISTRATOR"
}
