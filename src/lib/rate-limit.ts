import { after } from "next/server"
import { prisma } from "@/lib/prisma"

/**
 * Database-backed rate limiter.
 * Works correctly across serverless instances (unlike in-memory maps).
 *
 * Usage:
 *   const allowed = await rateLimit(`register:${ip}`, 5, 15 * 60 * 1000)
 *   if (!allowed) return 429
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  failOpen = false
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  const now = Date.now()
  const expiresAt = new Date(now + windowMs)

  try {
    // Atomically upsert + increment
    const record = await prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, expiresAt },
      update: { count: { increment: 1 } },
    })

    // Window expired — reset, but only the first concurrent request wins
    // the reset; others keep their increment so a burst can't undercount.
    let count = record.count
    if (record.expiresAt.getTime() < now) {
      const reset = await prisma.rateLimit.updateMany({
        where: { key, expiresAt: { lt: new Date(now) } },
        data: { count: 1, expiresAt },
      })
      count = reset.count === 1 ? 1 : record.count
    }

    const allowed = count <= limit

    // Opportunistically clean expired rows after the response so the table
    // does not grow forever. 0.5% chance per call keeps overhead negligible.
    // `after` throws when invoked outside a request scope (e.g. scripts or
    // tests calling this lib directly) — the cleanup is optional, so skip it.
    if (Math.random() < 0.005) {
      try {
        after(async () => {
          try {
            await cleanupRateLimits()
          } catch {
            // non-fatal
          }
        })
      } catch {
        // non-request context — no response to defer work after
      }
    }

    return {
      allowed,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: allowed
        ? 0
        : Math.max(1, Math.ceil((record.expiresAt.getTime() - now) / 1000)),
    }
  } catch (error) {
    // Mutations should fail closed by default; reads can opt into fail-open
    // if they explicitly pass failOpen = true.
    console.error("[rate-limit] error:", error)
    return { allowed: failOpen, remaining: limit, retryAfterSeconds: 0 }
  }
}

/** Periodic cleanup of expired rows (call from a cron or opportunistically) */
export async function cleanupRateLimits() {
  try {
    await prisma.rateLimit.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    })
  } catch {
    // non-fatal
  }
}
