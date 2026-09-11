import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { isAdmin, isModerator } from "@/lib/security"
import { NextResponse } from "next/server"

// Staff can still use the admin panel to disable maintenance mode.
export async function isStaffBypass(): Promise<boolean> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return false
  return isAdmin(session.user.role) || isModerator(session.user.role)
}

export async function isMaintenanceMode(): Promise<boolean> {
  return getBooleanSetting(SITE_SETTINGS.MAINTENANCE_MODE, false)
}

// API helper: call at the start of public mutation endpoints
export async function checkMaintenance(): Promise<NextResponse | null> {
  if (!(await isMaintenanceMode())) return null
  if (await isStaffBypass()) return null
  return NextResponse.json({ error: "TerpTalk is temporarily down for maintenance" }, { status: 503 })
}

// Layout helper: returns true if public users should see the maintenance gate
export async function shouldGatePublic(): Promise<boolean> {
  return (await isMaintenanceMode()) && !(await isStaffBypass())
}
