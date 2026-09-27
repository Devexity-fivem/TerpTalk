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

// Standing floor for a gated room — comes from the unlock registry when the
// room slug is a registered unlock (grow-room 100, the-vault 300).
function roomStandingReq(room: RoomGate): number {
  const spec = room.slug ? UNLOCK_BY_ID.get(room.slug) : undefined
  return spec?.standing ?? 0
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
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, profile: { select: { xp: true, standing: true, unlockFrozen: true } } },
  })
  if (!user) return false
  if (room.isPrivate) return isModerator(user.role)
  if (room.requiredXp != null) {
    if (isStaff(user.role)) return true
    if (!(await getBooleanSetting(SITE_SETTINGS.GROW_ROOM_ENABLED, false))) return false
    if (!user.profile || user.profile.unlockFrozen) return false
    return user.profile.xp >= room.requiredXp && user.profile.standing >= roomStandingReq(room)
  }
  return true
}

/** Why access was denied — lets the API say "earn X XP" vs a flat 403. */
export async function roomAccessInfo(
  userId: string,
  room: RoomGate
): Promise<{ allowed: boolean; reason: RoomAccess }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, profile: { select: { xp: true, standing: true, unlockFrozen: true } } },
  })
  if (!user) return { allowed: false, reason: "denied" }
  if (room.isPrivate) {
    return isModerator(user.role)
      ? { allowed: true, reason: "staff" }
      : { allowed: false, reason: "staff" }
  }
  if (room.requiredXp != null) {
    if (isStaff(user.role)) return { allowed: true, reason: "staff" }
    if (!(await getBooleanSetting(SITE_SETTINGS.GROW_ROOM_ENABLED, false))) {
      return { allowed: false, reason: "denied" }
    }
    const p = user.profile
    const ok = !!p && !p.unlockFrozen && p.xp >= room.requiredXp && p.standing >= roomStandingReq(room)
    return ok ? { allowed: true, reason: "gated" } : { allowed: false, reason: "gated" }
  }
  return { allowed: true, reason: "open" }
}
