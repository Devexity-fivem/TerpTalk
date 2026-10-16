import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"
import { getSession } from "@/lib/session"
import { getSecurityUser, isAdmin, isModerator } from "@/lib/security"
import { NextResponse } from "next/server"

// Staff can still use the admin panel to disable maintenance mode. The
// role is re-read from the DB (same as require-staff) so a demoted or
// banned staff member doesn't keep bypassing on a stale JWT claim.
export async function isStaffBypass(): Promise<boolean> {
  const session = await getSession()
  if (!session?.user?.id) return false
  const user = await getSecurityUser(session.user.id)
  if (!user || user.banned || (!!user.suspendedUntil && user.suspendedUntil > new Date())) return false
  return isAdmin(user.role) || isModerator(user.role)
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
