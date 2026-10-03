import { cache } from "react"
import { prisma } from "@/lib/prisma"

export const SITE_SETTINGS = {
  MAINTENANCE_MODE: "maintenance_mode",
  REGISTRATION_ENABLED: "registration_enabled",
  NEW_THREADS_ENABLED: "new_threads_enabled",
  IMAGE_UPLOADS_ENABLED: "image_uploads_enabled",
  CHAT_ENABLED: "chat_enabled",
  CONTEST_ENABLED: "contest_enabled",
  ANNOUNCEMENT_TITLE: "announcement_title",
  ANNOUNCEMENT_CONTENT: "announcement_content",
  ANNOUNCEMENT_LINK: "announcement_link",
  // Reputation & Rewards 3.0 rollout flags (visibleStatus is env-gated —
  // NEXT_PUBLIC_VISIBLE_STATUS — because TierChip is client-rendered).
  GROW_JOURNEY_ENABLED: "grow_journey_enabled",
  JOURNEYS_ENABLED: "journeys_enabled",
  WEEKLY_RECOGNITION_ENABLED: "weekly_recognition_enabled",
  GROW_ROOM_ENABLED: "grow_room_enabled",
} as const

// Request-local memoization (React cache): repeated reads of the same key
// inside one request collapse to a single query. Outside a render scope
// (route handlers' cold paths, scripts) cache() is a passthrough, so
// feature flags and kill-switches stay freshly read across requests —
// no cross-request staleness, no invalidation surface.
export const getSetting = cache(async (key: string): Promise<string | null> => {
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } })
  return row?.value ?? null
})

export async function getBooleanSetting(key: string, defaultValue = false): Promise<boolean> {
  const value = await getSetting(key)
  if (value === null) return defaultValue
  return value === "true"
}
