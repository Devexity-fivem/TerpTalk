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
} as const

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.setting.findUnique({ where: { key }, select: { value: true } })
  return row?.value ?? null
}

export async function getBooleanSetting(key: string, defaultValue = false): Promise<boolean> {
  const value = await getSetting(key)
  if (value === null) return defaultValue
  return value === "true"
}
