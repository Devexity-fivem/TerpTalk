// db-guard.mjs — fail-safe for mutation-capable test/verification scripts.
//
// Production lives on Supabase project `dtlksgtsvdfhgsiuktbt` (resource
// terptalk-db). Local dev/tests must use the dev Supabase project
// `ovztvfbvylcdpsuchvps` (terptalk-dev) or a local Postgres. Import this
// module for its side effect at the top of any script that writes to the
// database:
//
//   import "./db-guard.mjs"
//
// Authorization is positive, not substring-denial:
//   1. A recognized production marker always refuses (independent
//      fail-closed barrier — endpoint renames can't weaken it).
//   2. A recognized safe target (the documented dev database, local
//      Postgres) is authorized.
//   3. Anything else fails closed — an unknown host is never silently
//      treated as a dev database. Declare a nonstandard safe target
//      explicitly via DB_GUARD_EXTRA_HOSTS (comma-separated host
//      substrings) or ALLOW_UNRECOGNIZED_DB_TESTS=1.
//
// To intentionally run against production, set ALLOW_PRODUCTION_DB_TESTS=1.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

// Independent production barrier — always refuses, override only via
// ALLOW_PRODUCTION_DB_TESTS. Never extended with test-workflow entries.
// Matched against the raw URL, not just the hostname: on Supabase the
// pooled host (aws-N-<region>.pooler.supabase.com) is shared by every
// project — the project ref only appears in the username
// (postgres.<ref>@) for pooled DSNs and in the hostname for direct ones.
// Retired Neon prod endpoint kept so stale .envs still fail with a clear
// reason instead of "unrecognized".
const PROD_URL_MARKERS = ["dtlksgtsvdfhgsiuktbt", "ep-billowing-dew"]

// Positively authorized non-production URL substrings — the documented
// dev database (Supabase ref + retired Neon dev branch for stale .envs).
const SAFE_URL_MARKERS = ["ovztvfbvylcdpsuchvps", "ep-old-breeze"]

// Positively authorized non-production hosts. Add team-shared targets by
// editing this list; ad-hoc targets via DB_GUARD_EXTRA_HOSTS.
const SAFE_HOST_MARKERS = ["localhost", "127.0.0.1", "::1", "[::1]"]

/**
 * Classify a DATABASE_URL for mutation-capable script use.
 * Returns { allowed, reason } — pure, exported for tests, never exits.
 *
 * @param {string|undefined|null} rawUrl
 * @param {Record<string,string|undefined>} [env]
 */
export function evaluateDbTarget(rawUrl, env = process.env) {
  if (env.ALLOW_PRODUCTION_DB_TESTS === "1") {
    return { allowed: true, reason: "explicit production override" }
  }
  if (!rawUrl) return { allowed: false, reason: "no DATABASE_URL resolved" }

  let host
  try {
    host = new URL(rawUrl).hostname
  } catch {
    // Unparseable — nothing reachable, so nothing to protect; the script
    // surfaces its own connection error downstream.
    return { allowed: true, reason: "unparseable URL (fails downstream)" }
  }
  if (!host) return { allowed: false, reason: "URL has no host" }

  if (PROD_URL_MARKERS.some((m) => rawUrl.includes(m))) {
    return { allowed: false, reason: "production database endpoint" }
  }
  const extra = (env.DB_GUARD_EXTRA_HOSTS || "")
    .split(",").map((s) => s.trim()).filter(Boolean)
  if (
    SAFE_URL_MARKERS.some((m) => rawUrl.includes(m)) ||
    [...SAFE_HOST_MARKERS, ...extra].some((m) => host === m || host.startsWith(m) || host.endsWith(`.${m}`))
  ) {
    return { allowed: true, reason: "authorized non-production target" }
  }
  if (env.ALLOW_UNRECOGNIZED_DB_TESTS === "1") {
    return { allowed: true, reason: "explicit unrecognized-target override" }
  }
  return { allowed: false, reason: `unrecognized database host "${host.split(".")[0]}…"` }
}

// Descriptive-only development connection shapes — evaluated on PARSED
// URL components, never raw substrings. An attacker-controlled username,
// password, path, or lookalike hostname must never satisfy these.
const DEV_SUPABASE_REF = "ovztvfbvylcdpsuchvps"
const DEV_SUPABASE_DIRECT_HOST = `db.${DEV_SUPABASE_REF}.supabase.co`
const DEV_SUPABASE_POOLER_USER = `postgres.${DEV_SUPABASE_REF}`
const DEV_NEON_HOST_RE = /^ep-old-breeze-[a-z0-9-]+(\.[a-z0-9-]+)*\.neon\.tech$/i
const LOCAL_DESTRUCTIVE_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"])

const refuseDestructive = (reason) => ({ allowed: false, reason })

/**
 * Destructive-utility target check — strictly stronger than
 * evaluateDbTarget. For ops scripts that can wipe or rewrite data
 * (progression resets, restores, truncations).
 *
 * Differences from evaluateDbTarget:
 *   - NEVER honors environment overrides. ALLOW_PRODUCTION_DB_TESTS,
 *     ALLOW_UNRECOGNIZED_DB_TESTS and DB_GUARD_EXTRA_HOSTS are ignored —
 *     an operator cannot type their way into a destructive run.
 *   - Production markers refuse unconditionally (raw-URL scan, so the
 *     marker cannot hide in username, password, host, or path).
 *   - Authorization is structural: the PARSED hostname and decoded
 *     username must match an explicitly documented development
 *     connection shape. Substring matches elsewhere in the URL do not
 *     count, and no hostname prefix/suffix matching is used.
 *   - Anything else — including unparseable URLs — fails closed.
 *
 * @param {string|undefined|null} rawUrl
 * @returns {{ allowed: boolean, reason: string }}
 */
export function evaluateDestructiveDbTarget(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return refuseDestructive("no DATABASE_URL resolved")
  }
  let u
  try {
    u = new URL(rawUrl)
  } catch {
    return refuseDestructive("unparseable DATABASE_URL — cannot verify target")
  }
  const scheme = u.protocol.toLowerCase()
  if (scheme !== "postgres:" && scheme !== "postgresql:") {
    return refuseDestructive(`non-postgres scheme "${scheme}"`)
  }
  let host
  let user
  try {
    host = u.hostname.toLowerCase()
    user = decodeURIComponent(u.username).toLowerCase()
  } catch {
    return refuseDestructive("malformed URL credentials — cannot verify target")
  }
  if (!host) return refuseDestructive("URL has no host")

  // Production barrier — unconditional, scanned across the whole raw URL
  // so the marker cannot be relocated into credentials, host, or path.
  if (PROD_URL_MARKERS.some((m) => rawUrl.toLowerCase().includes(m))) {
    return refuseDestructive("production database endpoint — destructive utilities are development-only")
  }

  // Documented dev Supabase DIRECT connection — the hostname itself names
  // the exact dev project.
  if (host === DEV_SUPABASE_DIRECT_HOST) {
    return { allowed: true, reason: "authorized development target (dev Supabase direct)" }
  }

  // Documented dev Supabase POOLED connection — shared pooler hostname is
  // only authorized when the decoded PostgreSQL username carries the
  // exact dev project tenant.
  if (
    (host === "pooler.supabase.com" || host.endsWith(".pooler.supabase.com")) &&
    user === DEV_SUPABASE_POOLER_USER
  ) {
    return { allowed: true, reason: "authorized development target (dev Supabase pooler)" }
  }

  // Retired dev Neon endpoint — bounded hostname pattern only.
  if (DEV_NEON_HOST_RE.test(host)) {
    return { allowed: true, reason: "authorized development target (retired dev Neon)" }
  }

  // Exact local PostgreSQL hosts only — no prefixes, suffixes, or tricks.
  if (LOCAL_DESTRUCTIVE_HOSTS.has(host)) {
    return { allowed: true, reason: "authorized development target (local PostgreSQL)" }
  }

  return refuseDestructive(`unrecognized database host "${host.split(".")[0]}…"`)
}

// Side effect — refuse early on import when the resolved target is not
// positively authorized.
const url = process.env.DATABASE_URL ?? (() => {
  try {
    const envPath = fileURLToPath(new URL("../.env", import.meta.url))
    const match = readFileSync(envPath, "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"'\n]+)"?\s*$/m)
    return match?.[1]
  } catch {
    return undefined // no .env — let the script surface its own missing-config error
  }
})()

if (url) {
  const verdict = evaluateDbTarget(url)
  if (!verdict.allowed) {
    console.error(`[db-guard] REFUSING TO RUN: ${verdict.reason}.`)
    console.error("[db-guard] Point DATABASE_URL at the documented dev database, declare the target via DB_GUARD_EXTRA_HOSTS,")
    console.error("[db-guard] or set ALLOW_UNRECOGNIZED_DB_TESTS=1 / ALLOW_PRODUCTION_DB_TESTS=1 to override.")
    process.exit(1)
  }
}
