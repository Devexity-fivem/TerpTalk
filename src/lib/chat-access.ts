/**
 * Central chat-room authorization. Two independent gates:
 *
 * - `isPrivate`  — staff-only rooms (existing semantic, unchanged).
 * - `requiredXp` — member-tier rooms (the Grow Room, the Vault). V2:
 *   the stored threshold is evaluated against profile.xp, and gated rooms
 *   whose slug matches an unlock-registry entry also require that spec's
 *   standing floor (Layer C: rank + standing). Staff pass for moderation.
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
import { REP_RANKS, UNLOCK_BY_ID } from "@/lib/progression-config"

// The Grow Room opens at Cultivator — the canonical rank threshold, not a
// magic number. Referenced here once so rooms, UI, and benefit text agree.
export const GROW_ROOM_XP = REP_RANKS.find((r) => r.name === "Cultivator")?.threshold ?? 17000

export const GROW_ROOM_SLUG = "grow-room"

// The Vault — the head table. Opens at Master Cultivator.
export const VAULT_ROOM_XP = REP_RANKS.find((r) => r.name === "Master Cultivator")?.threshold ?? 23000
export const VAULT_ROOM_SLUG = "the-vault"

export interface RoomGate {
  isPrivate: boolean
  requiredXp: number | null
  slug?: string | null
}

export type RoomAccess = "open" | "staff" | "gated" | "denied"

export interface RoomGateSubject {
  role: string
  profile: { xp: number; standing: number; unlockFrozen: boolean } | null
}

// Standing floor for a gated room — comes from the unlock registry when the
// room slug is a registered unlock (grow-room 100, the-vault 300).
function roomStandingReq(room: RoomGate): number {
  const spec = room.slug ? UNLOCK_BY_ID.get(room.slug) : undefined
  return spec?.standing ?? 0
}

/**
 * THE room-access predicate. Pure evaluation of a room gate against an
 * already-fetched subject — every caller (canAccessRoom, roomAccessInfo,
 * the room-listing route, chat-activity visibility) evaluates through this
 * one function so the rule can never drift between paths.
 */
export function roomAccessDecision(
  subject: RoomGateSubject | null | undefined,
  room: RoomGate,
  growRoomEnabled: boolean
): { allowed: boolean; reason: RoomAccess } {
  if (!subject) return { allowed: false, reason: "denied" }
  if (room.isPrivate) {
    const ok = isModerator(subject.role)
    return { allowed: ok, reason: "staff" }
  }
  if (room.requiredXp != null) {
    if (isStaff(subject.role)) return { allowed: true, reason: "staff" }
    if (!growRoomEnabled) return { allowed: false, reason: "denied" }
    const p = subject.profile
    const allowed =
      !!p && !p.unlockFrozen && p.xp >= room.requiredXp && p.standing >= roomStandingReq(room)
    return { allowed, reason: "gated" }
  }
  return { allowed: true, reason: "open" }
}

// Human-readable gate for deny copy — e.g. "Cultivator rank + 100 standing"
// when the slug is a registered unlock, else a plain XP threshold.
export function roomRequirementText(room: RoomGate): string {
  const spec = room.slug ? UNLOCK_BY_ID.get(room.slug) : undefined
  const parts: string[] = []
  if (spec?.rank) parts.push(`${spec.rank} rank`)
  else if (room.requiredXp != null) parts.push(`${room.requiredXp.toLocaleString()} XP`)
  if (spec?.standing) parts.push(`${spec.standing} standing`)
  return parts.join(" + ") || "a higher rank"
}

/** Cheapest possible access check — one indexed user read. */
export async function canAccessRoom(
  userId: string,
  room: RoomGate
): Promise<boolean> {
  const [user, growRoomEnabled] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, profile: { select: { xp: true, standing: true, unlockFrozen: true } } },
    }),
    getBooleanSetting(SITE_SETTINGS.GROW_ROOM_ENABLED, false),
  ])
  return roomAccessDecision(user, room, growRoomEnabled).allowed
}

/** Why access was denied — lets the API say "earn X XP" vs a flat 403. */
export async function roomAccessInfo(
  userId: string,
  room: RoomGate
): Promise<{ allowed: boolean; reason: RoomAccess }> {
  const [user, growRoomEnabled] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, profile: { select: { xp: true, standing: true, unlockFrozen: true } } },
    }),
    getBooleanSetting(SITE_SETTINGS.GROW_ROOM_ENABLED, false),
  ])
  return roomAccessDecision(user, room, growRoomEnabled)
}
