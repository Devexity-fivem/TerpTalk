/**
 * Central chat-room authorization. Two independent gates:
 *
 * - `isPrivate`  — staff-only rooms (existing semantic, unchanged).
 * - `requiredRep` — member-tier rooms (the Grow Room). Non-staff need
 *   profile.reputation >= requiredRep; staff pass for moderation.
 *
 * Gated rooms also require the `grow_room_enabled` rollout flag — when off,
 * they behave as staff-only so a premature room never opens early.
 *
 * Every room access path (listing, message read/write, commands, Pusher
 * channel auth) must go through here — never re-implement per-route.
 */
import { prisma } from "@/lib/prisma"
import { isModerator, isStaff } from "@/lib/security"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"
import { REP_TIERS } from "@/lib/reputation-config"

// The Grow Room opens at Cultivator — the canonical tier threshold, not a
// magic number. Referenced here once so rooms, UI, and benefit text agree.
export const GROW_ROOM_REP = REP_TIERS.find((t) => t.name === "Cultivator")?.threshold ?? 3500

export const GROW_ROOM_SLUG = "grow-room"

export interface RoomGate {
  isPrivate: boolean
  requiredRep: number | null
}

export type RoomAccess = "open" | "staff" | "rep" | "denied"

/** Cheapest possible access check — one indexed user read. */
export async function canAccessRoom(
  userId: string,
  room: RoomGate
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, profile: { select: { reputation: true } } },
  })
  if (!user) return false
  if (room.isPrivate) return isModerator(user.role)
  if (room.requiredRep != null) {
    if (isStaff(user.role)) return true
    if (!(await getBooleanSetting(SITE_SETTINGS.GROW_ROOM_ENABLED, false))) return false
    return (user.profile?.reputation ?? 0) >= room.requiredRep
  }
  return true
}

/** Why access was denied — lets the API say "earn X rep" vs a flat 403. */
export async function roomAccessInfo(
  userId: string,
  room: RoomGate
): Promise<{ allowed: boolean; reason: RoomAccess }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, profile: { select: { reputation: true } } },
  })
  if (!user) return { allowed: false, reason: "denied" }
  if (room.isPrivate) {
    return isModerator(user.role)
      ? { allowed: true, reason: "staff" }
      : { allowed: false, reason: "staff" }
  }
  if (room.requiredRep != null) {
    if (isStaff(user.role)) return { allowed: true, reason: "staff" }
    if (!(await getBooleanSetting(SITE_SETTINGS.GROW_ROOM_ENABLED, false))) {
      return { allowed: false, reason: "denied" }
    }
    const rep = user.profile?.reputation ?? 0
    return rep >= room.requiredRep
      ? { allowed: true, reason: "rep" }
      : { allowed: false, reason: "rep" }
  }
  return { allowed: true, reason: "open" }
}
