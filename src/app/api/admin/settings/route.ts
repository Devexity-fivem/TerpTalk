import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, logSecurityEvent } from "@/lib/security"
import { SITE_SETTINGS } from "@/lib/settings"
import { rateLimit } from "@/lib/rate-limit"

const BOOLEAN_KEYS: Set<string> = new Set([
  SITE_SETTINGS.MAINTENANCE_MODE,
  SITE_SETTINGS.REGISTRATION_ENABLED,
  SITE_SETTINGS.NEW_THREADS_ENABLED,
  SITE_SETTINGS.IMAGE_UPLOADS_ENABLED,
  SITE_SETTINGS.CHAT_ENABLED,
  SITE_SETTINGS.CONTEST_ENABLED,
])

const ANNOUNCEMENT_MAX = 500

// GET — read current site settings (ADMINISTRATOR only)
export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const rows = await prisma.setting.findMany({
    where: { key: { in: Object.values(SITE_SETTINGS) } },
    select: { key: true, value: true, updatedAt: true },
  })

  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]))

  return NextResponse.json({
    settings,
    booleans: Object.fromEntries(
      Array.from(BOOLEAN_KEYS).map((k) => [k, (settings[k] ?? "true") === "true"])
    ),
    updatedAt: rows.length ? rows[0].updatedAt : null,
  })
}

// PATCH — update site settings (ADMINISTRATOR only)
export async function PATCH(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const rl = await rateLimit(`admin-settings:${admin.id}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const { settings } = body
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const allowed: Set<string> = new Set(Object.values(SITE_SETTINGS))
  const values: Record<string, string> = {}

  for (const [key, raw] of Object.entries(settings)) {
    if (!allowed.has(key)) {
      return NextResponse.json({ error: `Unknown setting: ${key}` }, { status: 400 })
    }
    const value = String(raw)
    if (BOOLEAN_KEYS.has(key)) {
      values[key] = value === "true" || value === "1" ? "true" : "false"
    } else if (key.startsWith("announcement_")) {
      values[key] = value.slice(0, ANNOUNCEMENT_MAX)
    } else {
      values[key] = value.slice(0, 200)
    }
  }

  await prisma.$transaction(
    Object.entries(values).map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    )
  )

  await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
    userId: admin.id,
    ip: getClientIp(request),
    metadata: { adminAction: "site_settings", keys: Object.keys(values) },
  })

  return NextResponse.json({ ok: true })
}
