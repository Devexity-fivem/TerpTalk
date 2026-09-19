// Production deploy gate — applies pending Prisma migrations BEFORE the
// application builds, so a release can never serve new application code
// against a schema it doesn't match.
//
// Runs only on Vercel production builds (VERCEL_ENV=production):
//   - Preview builds skip it — their DATABASE_URL may point at the dev
//     branch or be absent, and a preview must never migrate prod.
//   - Local `npm run build` skips it — local schema work should run
//     `prisma migrate dev`, not deploy.
//   - To force a run elsewhere, set MIGRATE_ON_BUILD=1.
//
// Failure semantics: any non-zero `prisma migrate deploy` exits non-zero,
// which fails the Vercel build — the deployment never promotes, the
// previous deployment keeps serving, and no code/schema mismatch ships.
// `migrate deploy` only applies pending migrations; it never resets,
// seeds, or touches data.
import { spawnSync } from "node:child_process"
import { PrismaClient } from "@prisma/client"

const isProdDeploy = process.env.VERCEL_ENV === "production"
const forced = process.env.MIGRATE_ON_BUILD === "1"

if (!isProdDeploy && !forced) {
  console.log(
    `[prebuild-migrate] skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`
  )
  process.exit(0)
}

// Prisma migrations take a postgres advisory lock, which fails through
// transaction-mode poolers (PgBouncer). Prefer a direct/unpooled URL when
// the deployment provides one; all are secrets already in the environment
// and are never printed.
const dbUrl =
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL

if (!dbUrl) {
  // Fail closed on a production deploy — the database is unverifiable, so
  // shipping the build would be shipping blind.
  console.error("[prebuild-migrate] no database URL set — cannot verify schema state")
  process.exit(1)
}

console.log("[prebuild-migrate] applying pending migrations (prisma migrate deploy)...")
const env = { ...process.env, DATABASE_URL: dbUrl }

// Prisma's migrate lock is a *session* advisory lock — if a migrator
// process dies without disconnecting, its session can linger and hold the
// lock forever, failing every later deploy with P1002. Sweep sessions that
// have sat IDLE holding the lock for >60s. A live migration is never plain
// "idle" (it is active or idle-in-transaction), so this cannot kill real
// work — only leaked holders.
try {
  const sweeper = new PrismaClient({ datasources: { db: { url: dbUrl } } })
  const killed = await sweeper.$queryRawUnsafe(
    `SELECT pg_terminate_backend(l.pid)
       FROM pg_locks l
       JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype = 'advisory'
        AND l.objid = 72707369
        AND l.granted
        AND a.state = 'idle'
        AND a.query_start < now() - interval '60 seconds'`
  )
  if (Array.isArray(killed) && killed.length > 0) {
    console.log(`[prebuild-migrate] cleared ${killed.length} stale migrate lock holder(s)`)
  }
  await sweeper.$disconnect()
} catch (e) {
  // Sweep is best-effort — a denied terminate must not block the deploy;
  // migrate deploy will simply contend with the lock itself.
  console.warn("[prebuild-migrate] stale-lock sweep skipped:", e?.message ?? e)
}

// One retry covers cold computes and advisory-lock contention on
// serverless databases — the second attempt almost always lands on a warm
// endpoint. A real failure still exits non-zero and fails the deploy.
let res = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
})
if (res.status !== 0) {
  console.error("[prebuild-migrate] first attempt failed — retrying once on a warm connection")
  res = spawnSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "inherit",
    env,
    shell: process.platform === "win32",
  })
}
if (res.status !== 0) {
  console.error(`[prebuild-migrate] migrate deploy failed (exit ${res.status}) — aborting build`)
  process.exit(res.status ?? 1)
}
console.log("[prebuild-migrate] schema verified — proceeding to build")
