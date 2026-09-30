import { getSession } from "@/lib/session"
import { getSecurityUser, isAdmin, isModerator, isStaff } from "@/lib/security"

// Moderation action types that only ADMINISTRATOR may perform — ban state
// changes and suspension removal can silently unban users, so moderators
// must not be able to run them.
export const ADMIN_ONLY_MOD_ACTIONS = new Set([
  "TEMPORARY_BAN",
  "PERMANENT_BAN",
  "UNBAN",
  "REMOVE_SUSPENSION",
])

// Fresh privilege check — verifies the role AND ban status from the
// database on every call instead of trusting the JWT claim, so demoted
// or banned staff lose access immediately (JWTs live up to 24h).
// getSession/getSecurityUser are request-render memoized — freshness is
// unchanged; repeated guards in layout+page share one read.
export async function requireAdmin(): Promise<{ id: string; role: string } | null> {
  const session = await getSession()
  if (!session?.user?.id) return null
  const user = await getSecurityUser(session.user.id)
  if (!user || user.banned || (!!user.suspendedUntil && user.suspendedUntil > new Date()) || !isAdmin(user.role)) return null
  return { id: session.user.id, role: user.role }
}

export async function requireModerator(): Promise<{ id: string; role: string } | null> {
  const session = await getSession()
  if (!session?.user?.id) return null
  const user = await getSecurityUser(session.user.id)
  if (!user || user.banned || (!!user.suspendedUntil && user.suspendedUntil > new Date()) || !isModerator(user.role)) return null
  return { id: session.user.id, role: user.role }
}

export async function requireStaff(): Promise<{ id: string; role: string } | null> {
  const session = await getSession()
  if (!session?.user?.id) return null
  const user = await getSecurityUser(session.user.id)
  if (!user || user.banned || (!!user.suspendedUntil && user.suspendedUntil > new Date()) || !isStaff(user.role)) return null
  return { id: session.user.id, role: user.role }
}
