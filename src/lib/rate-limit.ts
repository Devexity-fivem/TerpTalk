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
export type RateLimitResult = {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  failOpen = false,
  sampleEvery = 1
): Promise<RateLimitResult> {
  const now = Date.now()
  const expiresAt = new Date(now + windowMs)

  // Sampled mode: only ~1/sampleEvery requests write, each contributing
  // sampleEvery to the counter, so `count` still approximates true request
  // volume. Every request still enforces — non-sampled calls do a cheap
  // primary-key read and deny when the counter is already over the limit.
  // Abuse bound: at most `limit + sampleEvery` requests pass per window.
  // Only for high-frequency low-risk reads — never for credential,
  // account, moderation, or enumeration-sensitive endpoints.
  if (sampleEvery > 1 && Math.random() * sampleEvery >= 1) {
    try {
      const row = await prisma.rateLimit.findUnique({
        where: { key },
        select: { count: true, expiresAt: true },
      })
      if (!row || row.expiresAt.getTime() < now) {
        return { allowed: true, remaining: limit, retryAfterSeconds: 0 }
      }
      const allowed = row.count <= limit
      return {
        allowed,
        remaining: Math.max(0, limit - row.count),
        retryAfterSeconds: allowed
          ? 0
          : Math.max(1, Math.ceil((row.expiresAt.getTime() - now) / 1000)),
      }
    } catch (error) {
      console.error("[rate-limit] read error:", error)
      return { allowed: failOpen, remaining: limit, retryAfterSeconds: 0 }
    }
  }

  try {
    // Atomically upsert + increment
    const record = await prisma.rateLimit.upsert({
      where: { key },
      create: { key, count: sampleEvery, expiresAt },
      update: { count: { increment: sampleEvery } },
    })

    // Window expired — reset, but only the first concurrent request wins
    // the reset; others keep their increment so a burst can't undercount.
    let count = record.count
    if (record.expiresAt.getTime() < now) {
      const reset = await prisma.rateLimit.updateMany({
        where: { key, expiresAt: { lt: new Date(now) } },
        data: { count: sampleEvery, expiresAt },
      })
      count = reset.count === 1 ? sampleEvery : record.count
    }

    const allowed = count <= limit
    scheduleCleanup()

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

export type RateLimitCheck = {
  key: string
  limit: number
  windowMs: number
  failOpen?: boolean
}

/**
 * Batch variant of rateLimit: all keys are incremented in a single INSERT
 * ... ON CONFLICT statement instead of one upsert per key. Distinct keys
 * keep independent counters, limits, and failure semantics — this only
 * removes per-key round trips and deduplicates a key that appears twice in
 * one batch. Still DB-authoritative, cross-instance, and fail-closed.
 */
export async function rateLimitMany(
  checks: RateLimitCheck[]
): Promise<RateLimitResult[]> {
  const now = Date.now()

  // Deduplicate identical keys: a repeated check in one request consumes
  // one count and shares one result. (Also required by ON CONFLICT, which
  // cannot update the same row twice in one statement.)
  const uniq: RateLimitCheck[] = []
  const indexByKey = new Map<string, number>()
  const order = checks.map((c) => {
    const existing = indexByKey.get(c.key)
    if (existing !== undefined) return existing
    indexByKey.set(c.key, uniq.length)
    uniq.push(c)
    return uniq.length - 1
  })

  if (uniq.length === 0) return []

  try {
    const params = uniq.flatMap((c) => [c.key, new Date(now + c.windowMs)])
    const values = uniq.map((_, i) => `($${i * 2 + 1}, 1, $${i * 2 + 2})`).join(",")
    const rows = await prisma.$queryRawUnsafe<
      { key: string; count: number; expiresAt: Date }[]
    >(
      `INSERT INTO "RateLimit" ("key", "count", "expiresAt") VALUES ${values}
       ON CONFLICT ("key") DO UPDATE SET "count" = "RateLimit"."count" + 1
       RETURNING "key", "count", "expiresAt"`,
      ...params
    )
    const byKey = new Map(rows.map((r) => [r.key, r]))

    // Reset expired windows — one conditional update per expired key (rare
    // path), preserving "only the first concurrent request wins the reset".
    const counts = await Promise.all(
      uniq.map(async (c) => {
        const r = byKey.get(c.key)
        if (!r) return 1
        if (r.expiresAt.getTime() >= now) return r.count
        const reset = await prisma.rateLimit.updateMany({
          where: { key: c.key, expiresAt: { lt: new Date(now) } },
          data: { count: 1, expiresAt: new Date(now + c.windowMs) },
        })
        return reset.count === 1 ? 1 : r.count
      })
    )

    scheduleCleanup()

    const results = uniq.map((c, i) => {
      const count = counts[i]
      const record = byKey.get(c.key)
      const allowed = count <= c.limit
      return {
        allowed,
        remaining: Math.max(0, c.limit - count),
        retryAfterSeconds: allowed || !record
          ? 0
          : Math.max(1, Math.ceil((record.expiresAt.getTime() - now) / 1000)),
      }
    })
    return order.map((i) => results[i])
  } catch (error) {
    console.error("[rate-limit] batch error:", error)
    return checks.map((c) => ({
      allowed: c.failOpen ?? false,
      remaining: c.limit,
      retryAfterSeconds: 0,
    }))
  }
}

// Opportunistically clean expired rows after the response so the table
// does not grow forever. 0.5% chance per call keeps overhead negligible.
// `after` throws when invoked outside a request scope (e.g. scripts or
// tests calling this lib directly) — the cleanup is optional, so skip it.
function scheduleCleanup() {
  if (Math.random() >= 0.005) return
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
