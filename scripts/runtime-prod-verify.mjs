#!/usr/bin/env node
// runtime-prod-verify.mjs — production-mode black-box verification.
//
// Runs `npm run build` (plain next build — NOT vercel-build, so no migration
// gate), boots `next start` on a spare port, and asserts the security
// properties that only exist in a real production build:
//
//   - effective security headers (HSTS, CSP, nosniff, frame, referrer, permissions)
//   - production CSP: no 'unsafe-eval', no dev websocket exceptions
//   - cookie attributes on auth responses (HttpOnly, SameSite)
//   - fail-closed surfaces: register (Turnstile), cron (CRON_SECRET), uploads
//   - debug/probe endpoints absent
//   - no source maps served, no stack traces in error bodies
//   - env-var PRESENCE matrix (names only — values are never read or printed)
//   - login smoke test against the prod build (fixture user, cleaned up)
//
// Runs standalone (node scripts/runtime-prod-verify.mjs) or under
// master-tests in the final phase. Requires .env to point at a NON-production
// database (db-guard enforced) — the prod-mode server shares the dev DB for
// the login smoke test only; everything else is anonymous.
//
// Env overrides: PROD_PORT (default 3101), PROD_SKIP_BUILD=1 to reuse an
// existing .next build.

import "./db-guard.mjs"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const IS_WIN = process.platform === "win32"
const PORT = Number(process.env.PROD_PORT || 3101)
const BASE = `http://localhost:${PORT}`
const SKIP_BUILD = process.env.PROD_SKIP_BUILD === "1"

const results = []
const pass = (n) => { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
const fail = (n, i) => { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }
const info = (n, v) => console.log(`  · ${n}: ${v}`)

// ---------------------------------------------------------------------------
// Build + server lifecycle
// ---------------------------------------------------------------------------

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = IS_WIN
      ? spawn("cmd.exe", ["/d", "/s", "/c", [cmd, ...args].join(" ")], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
      : spawn(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true })
    let out = ""
    child.stdout?.on("data", (d) => { out += d })
    child.stderr?.on("data", (d) => { out += d })
    const timer = setTimeout(() => { killTree(child); resolve({ code: null, out: out + "\n[timeout]" }) }, timeoutMs)
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, out }) })
    child.on("error", (e) => { clearTimeout(timer); resolve({ code: null, out: out + `\n[spawn ${e.message}]` }) })
  })
}

function killTree(child) {
  if (!child?.pid) return
  if (IS_WIN) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
  else { try { process.kill(-child.pid, "SIGKILL") } catch { try { child.kill("SIGKILL") } catch { /* gone */ } } }
}

async function probe(pathname, init = {}) {
  try {
    const res = await fetch(`${BASE}${pathname}`, { redirect: "manual", signal: AbortSignal.timeout(8000), ...init })
    return res
  } catch {
    return null
  }
}

async function waitHealthy(deadlineMs = 120_000) {
  const deadline = Date.now() + deadlineMs
  while (Date.now() < deadline) {
    const r = await probe("/api/auth/csrf")
    if (r?.status === 200) return true
    await new Promise((r) => setTimeout(r, 1500))
  }
  return false
}

// ---------------------------------------------------------------------------
// Env presence matrix — names only, never values
// ---------------------------------------------------------------------------

const ENV_REQUIRED = ["DATABASE_URL", "NEXTAUTH_SECRET", "NEXTAUTH_URL", "IP_HASH_SALT",
  "PUSHER_APP_ID", "PUSHER_KEY", "PUSHER_SECRET", "NEXT_PUBLIC_PUSHER_KEY", "NEXT_PUBLIC_PUSHER_CLUSTER"]
const ENV_CONDITIONAL = ["TURNSTILE_SECRET_KEY", "NEXT_PUBLIC_TURNSTILE_SITE_KEY", "CRON_SECRET", "BLOB_READ_WRITE_TOKEN"]

function envPresence() {
  const envKeys = new Set(Object.keys(process.env))
  try {
    const envText = readFileSync(path.join(ROOT, ".env"), "utf8")
    for (const line of envText.split("\n")) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=/)
      if (m) envKeys.add(m[1])
    }
  } catch { /* no .env — presence reflects process.env only */ }
  console.log("\n  env presence (names only — values never read/printed):")
  for (const k of ENV_REQUIRED) info(k, envKeys.has(k) ? "present" : "ABSENT")
  for (const k of ENV_CONDITIONAL) info(k, envKeys.has(k) ? "present" : "absent (fail-closed behavior asserted below)")
  return envKeys
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("TerpTalk prod-mode runtime verification")
  console.log(`  root: ${ROOT}`)
  console.log(`  target: ${BASE}`)

  const envKeys = envPresence()

  // ── Build ────────────────────────────────────────────────────────────────
  if (SKIP_BUILD && existsSync(path.join(ROOT, ".next", "BUILD_ID"))) {
    info("build", "skipped — reusing existing .next build (PROD_SKIP_BUILD=1)")
  } else {
    console.log("\n  building production bundle (npm run build)…")
    const t = Date.now()
    const b = await run("npm", ["run", "build"], 12 * 60_000)
    if (b.code !== 0) {
      fail("prod build", `exit ${b.code}\n${b.out.slice(-2000)}`)
      return finish()
    }
    pass(`prod build succeeds (${((Date.now() - t) / 1000).toFixed(0)}s)`)
  }

  // ── Start ────────────────────────────────────────────────────────────────
  const existing = await probe("/api/auth/csrf")
  if (existing !== null) {
    fail("prod start", `port ${PORT} already answers HTTP — free it or set PROD_PORT`)
    return finish()
  }

  const server = IS_WIN
    ? spawn("cmd.exe", ["/d", "/s", "/c", `npm run start -- -p ${PORT}`], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    : spawn("npm", ["run", "start", "--", "-p", String(PORT)], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true })
  let serverLog = ""
  server.stdout?.on("data", (d) => { serverLog += d })
  server.stderr?.on("data", (d) => { serverLog += d })

  try {
    if (!(await waitHealthy())) {
      fail("prod start", `server not healthy in 120s\n${serverLog.slice(-1500)}`)
      return finish()
    }
    pass("prod server starts and serves /api/auth/csrf")

    const j = async (r) => r.json().catch(() => null)

    // ── Security headers ───────────────────────────────────────────────────
    const home = await probe("/")
    const h = home.headers
    const expectHeaders = {
      "strict-transport-security": /max-age=\d+/,
      "content-security-policy": /default-src 'self'/,
      "x-content-type-options": /nosniff/,
      "x-frame-options": /DENY/,
      "referrer-policy": /strict-origin-when-cross-origin/,
      "permissions-policy": /geolocation=\(\)/,
    }
    for (const [k, re] of Object.entries(expectHeaders)) {
      const v = h.get(k)
      v && re.test(v) ? pass(`headers: ${k} effective`) : fail(`header ${k}`, v ?? "absent")
    }
    !h.get("x-powered-by") ? pass("headers: x-powered-by absent") : fail("x-powered-by", h.get("x-powered-by"))

    // ── Production CSP assertions ──────────────────────────────────────────
    const csp = h.get("content-security-policy") || ""
    csp.includes("object-src 'none'") ? pass("csp: object-src 'none'") : fail("csp object-src", csp)
    csp.includes("frame-ancestors 'none'") ? pass("csp: frame-ancestors 'none'") : fail("csp frame-ancestors", csp)
    !csp.includes("unsafe-eval") ? pass("csp: no 'unsafe-eval' in production") : fail("csp unsafe-eval", csp)
    const connectSrc = csp.split(";").find((d) => d.trim().startsWith("connect-src")) || ""
    // Bare `ws:`/`wss:` scheme tokens (dev-only) — `wss://host` is legitimate.
    const devWs = /(^|\s)wss?:(?!\/\/)/.test(connectSrc)
    !devWs ? pass("csp: no dev websocket exceptions in production connect-src") : fail("csp dev ws", connectSrc)
    csp.includes("unsafe-inline")
      ? info("csp", "script-src keeps 'unsafe-inline' — known H-1 hardening item (needs nonce middleware)")
      : null

    // ── Cookie attributes ──────────────────────────────────────────────────
    const csrfRes = await probe("/api/auth/csrf")
    const setCookies = csrfRes.headers.getSetCookie?.() ?? []
    const cookieStr = setCookies.join("; ")
    const hasHttpOnly = /HttpOnly/i.test(cookieStr)
    const hasSameSite = /SameSite/i.test(cookieStr)
    hasHttpOnly ? pass("cookies: HttpOnly set on auth cookie") : fail("cookie httponly", cookieStr || "no Set-Cookie")
    hasSameSite ? pass("cookies: SameSite set on auth cookie") : fail("cookie samesite", cookieStr || "no SameSite")

    // ── Fail-closed surfaces ───────────────────────────────────────────────
    const reg = await probe("/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: `pvp_${Date.now().toString(36)}`, password: "Whatever123!", ageVerified: true }),
    })
    const regBody = await j(reg)
    if (envKeys.has("TURNSTILE_SECRET_KEY")) {
      reg.status === 400
        ? pass("register: prod demands Turnstile token (secret configured)")
        : fail("register turnstile", { s: reg.status, b: regBody })
    } else {
      reg.status === 503
        ? pass("register: refuses registration when Turnstile unconfigured (fail-closed)")
        : fail("register fail-closed", { s: reg.status, b: regBody })
    }

    const cron = await probe("/api/cron/terpbot")
    cron.status === 401 || cron.status === 403
      ? pass("cron: refuses unauthenticated invocation (CRON_SECRET gate)")
      : fail("cron gate", cron.status)

    // Upload surface in prod: no BLOB token → profile avatar upload must
    // refuse, never silently persist. Unauthenticated → 401 is also a refusal.
    const av = await probe("/api/profile", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ avatarUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }),
    })
    av.status !== 200 && av.status !== 201
      ? pass(`upload: anonymous avatar upload refused (${av.status})`)
      : fail("upload anon", av.status)

    // ── Debug / probe endpoints ────────────────────────────────────────────
    for (const p of ["/api/debug", "/debug", "/api/_debug", "/api/test", "/api/admin", "/_next/data/../api/auth/session"]) {
      const r = await probe(p)
      !r || r.status === 404 || r.status === 401 || r.status === 403
        ? pass(`probes: ${p} not exposed (${r?.status ?? "unreachable"})`)
        : fail(`probe ${p}`, r.status)
    }

    // ── No stack traces in error bodies ────────────────────────────────────
    const bad = await probe("/api/auth/recover", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    })
    const badText = await bad.text()
    const leaks = /node_modules|\.ts:\d+|at \w+ \(|PrismaClient|stack/i.test(badText)
    !leaks && bad.status < 500
      ? pass("errors: malformed JSON → clean 4xx, no internals")
      : fail("error surface", { s: bad.status, body: badText.slice(0, 200) })

    // ── Source maps not served ─────────────────────────────────────────────
    const html = await home.text()
    const chunk = html.match(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/)?.[1]
    if (chunk) {
      const map = await probe(`${chunk}.map`)
      map?.status === 404 ? pass("sourcemaps: production chunk maps 404") : fail("sourcemap served", map?.status)
    } else {
      info("sourcemaps", "no chunk URL found on / — skipped")
    }

    // ── Login smoke test (fixture user, cleaned up) ────────────────────────
    const { makeHarness } = await import("./lib/http-harness.mjs")
    const harness = makeHarness({
      name: (t) => `pv-${t}-${Date.now().toString(36)}`,
      username: (t) => `pv-${t}-${Date.now().toString(36)}`,
      password: "Pv!Pass123",
      base: BASE,
      summary: "none",
    })
    const u = await harness.createUser("x")
    try {
      const { cookie } = await harness.login(u.username, "Pv!Pass123")
      const prof = await probe("/api/profile", { headers: { cookie } })
      prof.status === 200
        ? pass("prod login: fixture user authenticates and reads own profile")
        : fail("prod login", prof.status)
      // Session cookie attributes on the login response itself — fresh CSRF
      // jar so the credentials callback has a matching cookie+token pair.
      const csrf2 = await probe("/api/auth/csrf")
      const csrfBody = await j(csrf2)
      const csrfJar = (csrf2.headers.getSetCookie?.() ?? []).map((sc) => sc.split(";")[0]).join("; ")
      const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", cookie: csrfJar },
        body: new URLSearchParams({ csrfToken: csrfBody.csrfToken, username: u.username, password: "Pv!Pass123" }).toString(),
        redirect: "manual",
      })
      const sessionCookies = (loginRes.headers.getSetCookie?.() ?? []).join("; ")
      const sessCookieSafe = /HttpOnly/i.test(sessionCookies) && /SameSite/i.test(sessionCookies)
      sessCookieSafe
        ? pass("cookies: session token HttpOnly + SameSite on login response")
        : fail("session cookie attrs", sessionCookies || "none")
    } finally {
      await harness.prisma.user.delete({ where: { id: u.id } }).catch(() => {})
      await harness.prisma.$disconnect().catch(() => {})
    }
  } finally {
    killTree(server)
  }

  return finish()
}

function finish() {
  const failed = results.filter(([s]) => s === "FAIL").length
  console.log(`\n${results.length - failed}/${results.length} passed`)
  process.exitCode = failed ? 1 : 0
}

main().catch((e) => { console.error("prod-verify crashed:", e); process.exit(1) })
