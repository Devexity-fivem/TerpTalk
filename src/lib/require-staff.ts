import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { isAdmin, isModerator, isStaff, isSupport } from "@/lib/security"

// Fresh privilege check — verifies the role AND ban status from the
// database on every call instead of trusting the JWT claim, so demoted
// or banned staff lose access immediately (JWTs live up to 24h).
export async function requireAdmin(): Promise<{ id: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, banned: true, suspendedUntil: true },
  })
  if (!user || user.banned || (!!user.suspendedUntil && user.suspendedUntil > new Date()) || !isAdmin(user.role)) return null
  return { id: session.user.id, role: user.role }
}

export async function requireModerator(): Promise<{ id: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, banned: true, suspendedUntil: true },
  })
  if (!user || user.banned || (!!user.suspendedUntil && user.suspendedUntil > new Date()) || !isModerator(user.role)) return null
  return { id: session.user.id, role: user.role }
}

export async function requireStaff(): Promise<{ id: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, banned: true, suspendedUntil: true },
  })
  if (!user || user.banned || (!!user.suspendedUntil && user.suspendedUntil > new Date()) || !isStaff(user.role)) return null
  return { id: session.user.id, role: user.role }
}

export async function requireSupport(): Promise<{ id: string; role: string } | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return null
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true, banned: true, suspendedUntil: true },
  })
  if (!user || user.banned || (!!user.suspendedUntil && user.suspendedUntil > new Date()) || !isSupport(user.role)) return null
  return { id: session.user.id, role: user.role }
}
