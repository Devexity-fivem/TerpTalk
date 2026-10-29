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
