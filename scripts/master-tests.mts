#!/usr/bin/env tsx
// Master test orchestrator — the single authoritative answer to
// "Do TerpTalk's automated regression/security tests currently pass?"
//
//   npm run test:master
//
// Orchestrates the existing verified suites as child processes. Every suite
// keeps its own assertions; this runner owns sequencing, the dev-server
// lifecycle, exit-code propagation, and the final aggregate verdict.
//
// Debug env overrides (never silent — filtered suites are reported as SKIP):
//   MASTER_ONLY="velocity,drift"   run only suites whose id matches
//   MASTER_BASE_URL=http://…       default http://localhost:3000
//   MASTER_DEV_COMMAND="…"         override the dev-server spawn command

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const TSX_CLI = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs")
const IS_WIN = process.platform === "win32"

const BASE_URL = (process.env.MASTER_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")
const BASE_PORT = Number(new URL(BASE_URL).port || 80)
const ONLY = (process.env.MASTER_ONLY ?? "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)

// ---------------------------------------------------------------------------
// Suite manifest — every test/verify file in scripts/, classified per the
// completed integrity audit. All suites are REQUIRED: a failure fails the run.
// ---------------------------------------------------------------------------

type SuiteClass = "A" | "B" | "C" | "D"
type Runner = "node" | "tsx"

interface Suite {
  id: string
  file: string
  runner: Runner
  cls: SuiteClass // A strong behavioral · B behavioral w/ limits · C structural · D static
  label: string
  timeoutMs?: number
}

const STATIC_PHASE: Suite[] = [
  { id: "verify-security", file: "scripts/verify-security.cjs", runner: "node", cls: "C", label: "Security source invariants" },
  { id: "chat-panel", file: "scripts/chat-panel-tests.mts", runner: "tsx", cls: "C", label: "Chat Panel structural invariants" },
  { id: "info-pages", file: "scripts/info-pages-tests.mts", runner: "tsx", cls: "D", label: "Info pages static/config checks" },
]

// Requires a healthy dev server at BASE_URL. Serial: suites share the dev DB
// and bot-verify toggles global settings / rate-limit rows.
const HTTP_PHASE: Suite[] = [
  { id: "onboarding", file: "scripts/onboarding-verify.mjs", runner: "node", cls: "A", label: "Onboarding / auth HTTP flow" },
  { id: "forum", file: "scripts/forum-verify.mjs", runner: "node", cls: "A", label: "Forum HTTP behavior" },
  { id: "search", file: "scripts/search-verify.mjs", runner: "node", cls: "A", label: "Search HTTP behavior" },
  { id: "diary", file: "scripts/diary-verify.mjs", runner: "node", cls: "A", label: "Grow diary HTTP behavior" },
  { id: "bot", file: "scripts/bot-verify.mjs", runner: "node", cls: "A", label: "TerpBot HTTP end-to-end", timeoutMs: 12 * 60_000 },
  { id: "trust-safety", file: "scripts/trust-safety-verify.mjs", runner: "node", cls: "A", label: "Trust & safety HTTP behavior" },
  { id: "feedback", file: "scripts/feedback-tests.mjs", runner: "node", cls: "A", label: "Feedback auth/privacy/rate-limit" },
]

// STRICTLY SERIAL — all create DB fixtures; several mutate shared global
// settings (chat_enabled, GROW_ROOM_ENABLED) and rate-limit rows.
const DB_PHASE: Suite[] = [
  { id: "security", file: "scripts/security-tests.mts", runner: "tsx", cls: "A", label: "Security lib-level (uploads, callback URLs, link trust)" },
  { id: "notifications", file: "scripts/notification-2-tests.mts", runner: "tsx", cls: "A", label: "Notification persistence + delivery" },
  { id: "reputation", file: "scripts/reputation-tests.mts", runner: "tsx", cls: "A", label: "Reputation award/reverse ledger" },
  { id: "reputation-referral", file: "scripts/reputation-referral-integrity-tests.mts", runner: "tsx", cls: "A", label: "Reputation referral integrity" },
  { id: "stabilization", file: "scripts/stabilization-tests.mts", runner: "tsx", cls: "A", label: "Stabilization regressions" },
  { id: "terpbot-pipeline", file: "scripts/terpbot-pipeline-tests.mts", runner: "tsx", cls: "A", label: "TerpBot pipeline (DB)" },
  { id: "progression", file: "scripts/progression-tests.mts", runner: "tsx", cls: "A", label: "Progression / trust thresholds" },
  { id: "privacy", file: "scripts/privacy-controls-tests.mts", runner: "tsx", cls: "B", label: "Privacy controls (mirror limits documented)" },
  { id: "self-service", file: "scripts/self-service-tests.mts", runner: "tsx", cls: "B", label: "Self-service account flows" },
  { id: "terpbot", file: "scripts/terpbot-tests.mts", runner: "tsx", cls: "A", label: "TerpBot command parse + permission boundaries" },
  { id: "terpbot2", file: "scripts/terpbot2-tests.mts", runner: "tsx", cls: "A", label: "TerpBot 2.0 diagnostic engine (pure)" },
  { id: "terpbot-nl", file: "scripts/terpbot-nl-tests.mts", runner: "tsx", cls: "A", label: "TerpBot NL observation parser" },
  { id: "terpbot-intel", file: "scripts/terpbot-intel-tests.mts", runner: "tsx", cls: "A", label: "TerpBot 2.0 intelligence scoring (pure)" },
  { id: "validate-knowledge", file: "scripts/validate-knowledge.mts", runner: "tsx", cls: "C", label: "TerpBot knowledge validator" },
  { id: "chat", file: "scripts/chat-ux-tests.mts", runner: "tsx", cls: "A", label: "Chat UX helpers + room visibility (DB)" },
  { id: "community-analytics", file: "scripts/community-analytics-tests.mts", runner: "tsx", cls: "B", label: "Community analytics" },
  { id: "growth-analytics", file: "scripts/growth-analytics-tests.mts", runner: "tsx", cls: "B", label: "Growth analytics" },
  { id: "knowledge-compounding", file: "scripts/knowledge-compounding-tests.mts", runner: "tsx", cls: "B", label: "Knowledge compounding" },
  { id: "p1-bugfix", file: "scripts/p1-bugfix-tests.mts", runner: "tsx", cls: "B", label: "P1 bugfix regressions" },
  { id: "setup-edit", file: "scripts/setup-edit-tests.mts", runner: "tsx", cls: "B", label: "Setup edit (route-query mirror)" },
  { id: "strain-lifecycle", file: "scripts/strain-lifecycle-tests.mts", runner: "tsx", cls: "B", label: "Strain lifecycle" },
  { id: "velocity-detector", file: "scripts/velocity-detector-tests.mts", runner: "tsx", cls: "B", label: "Reputation velocity detector" },
  { id: "diary-edit", file: "scripts/diary-edit-tests.mts", runner: "tsx", cls: "B", label: "Diary edit (mirror + source contract)" },
  { id: "diary-update-edit", file: "scripts/diary-update-edit-tests.mts", runner: "tsx", cls: "B", label: "Diary update edit (mirror + source contract)" },
  { id: "rewards3", file: "scripts/rewards3-tests.mts", runner: "tsx", cls: "A", label: "Rewards 3.0 anti-farming + weekly board" },
  { id: "launch-hardening", file: "scripts/launch-hardening-tests.mts", runner: "tsx", cls: "A", label: "P1 launch-hardening regressions" },
  { id: "discovery-integration", file: "scripts/discovery-integration-tests.mts", runner: "tsx", cls: "B", label: "Discovery integration (DB + source)" },
]

// Whole-DB scan — runs alone, after every fixture suite has cleaned up.
const DRIFT_PHASE: Suite[] = [
  { id: "check-drift", file: "scripts/check-drift.mts", runner: "tsx", cls: "B", label: "Reputation ledger drift scan" },
]

// Remaining verification. verify-affiliates asserts ops seed data, so its
// idempotent seeder runs as a setup step first.
const FINAL_PHASE: Suite[] = [
  { id: "verify-affiliates", file: "scripts/verify-affiliates.cjs", runner: "node", cls: "B", label: "Affiliate integrity (seeded data)" },
]

const ALL_SUITES = [...STATIC_PHASE, ...HTTP_PHASE, ...DB_PHASE, ...DRIFT_PHASE, ...FINAL_PHASE]

const MANUAL_COVERAGE = [
  "Chat Panel desktop behavior (open/close, resize, unread dot)",
  "Mobile chat sheet behavior + touch interactions",
  "Real two-client Pusher messaging in a browser",
  "Keyboard navigation / browser-level accessibility",
  "Visual layout, overlap, responsive breakpoints",
  "Actual React mount/unmount + live subscription counts",
]

// ---------------------------------------------------------------------------
// Child-process runner — exit code is authoritative; printed PASS strings are
// never trusted. Crashes, signals, and timeouts all count as failures.
// ---------------------------------------------------------------------------

interface ChildResult {
  code: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  output: string
  ms: number
}

const LOG_FILE = path.join(os.tmpdir(), "terptalk-master-tests.log")
const logChunks: string[] = []
function log(line: string) {
  console.log(line)
  logChunks.push(line)
}

function commandFor(s: Suite): { cmd: string; args: string[] } {
  if (s.runner === "tsx") return { cmd: process.execPath, args: [TSX_CLI, s.file] }
  return { cmd: process.execPath, args: [s.file] }
}

function killTree(child: ChildProcess) {
  if (child.pid == null) return
  if (IS_WIN) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" })
  } else {
    try { process.kill(-child.pid, "SIGKILL") } catch { try { child.kill("SIGKILL") } catch { /* gone */ } }
  }
}

function runChild(s: Suite, extraEnv: Record<string, string> = {}): Promise<ChildResult> {
  return new Promise((resolve) => {
    const { cmd, args } = commandFor(s)
    const started = Date.now()
    let output = ""
    let settled = false
    const child = spawn(cmd, args, {
      cwd: ROOT,
      env: { ...process.env, ...extraEnv },
      stdio: ["ignore", "pipe", "pipe"],
      detached: !IS_WIN,
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      killTree(child)
      resolve({ code: null, signal: null, timedOut: true, output, ms: Date.now() - started })
    }, s.timeoutMs ?? 8 * 60_000)
    child.stdout?.on("data", (d) => { output += d })
    child.stderr?.on("data", (d) => { output += d })
    child.on("error", (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code: null, signal: null, timedOut: false, output: output + `\nspawn error: ${err.message}`, ms: Date.now() - started })
    })
    child.on("close", (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, signal, timedOut: false, output, ms: Date.now() - started })
    })
  })
}

// ---------------------------------------------------------------------------
// Dev-server lifecycle — adopt a healthy server, spawn one when the port is
// free, fail when the port is busy-but-unhealthy. Kill only what we spawned.
// ---------------------------------------------------------------------------

interface ServerHandle { child: ChildProcess | null; external: boolean }

async function probe(url: string, timeoutMs = 4000): Promise<number | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" })
    return res.status
  } catch {
    return null
  }
}

async function serverHealthy(): Promise<boolean> {
  const csrf = await probe(`${BASE_URL}/api/auth/csrf`)
  if (csrf !== 200) return false
  const stats = await probe(`${BASE_URL}/api/stats`)
  return stats === 200
}

async function startServer(): Promise<ServerHandle> {
  const healthy = await serverHealthy()
  if (healthy) {
    log(`  dev server already healthy at ${BASE_URL} (external — will not be killed)`)
    return { child: null, external: true }
  }

  const csrf = await probe(`${BASE_URL}/api/auth/csrf`)
  if (csrf !== null) {
    throw new Error(
      `port ${BASE_PORT} answers HTTP but is not a healthy TerpTalk dev server ` +
      `(/api/auth/csrf=${csrf}, /api/stats=${await probe(`${BASE_URL}/api/stats`)}). ` +
      `Free the port or point MASTER_BASE_URL elsewhere.`
    )
  }

  const devCmd = process.env.MASTER_DEV_COMMAND ?? `npm run dev -- -p ${BASE_PORT}`
  log(`  starting dev server: ${devCmd}`)
  const child = IS_WIN
    ? spawn("cmd.exe", ["/d", "/s", "/c", devCmd], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    : spawn("sh", ["-c", devCmd], { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true })

  let serverLog = ""
  child.stdout?.on("data", (d) => { serverLog += d })
  child.stderr?.on("data", (d) => { serverLog += d })

  const deadline = Date.now() + 150_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dev server exited during startup (code ${child.exitCode})\n${tail(serverLog)}`)
    }
    if (await serverHealthy()) {
      log(`  dev server ready at ${BASE_URL} (pid ${child.pid}, spawned by master)`)
      return { child, external: false }
    }
    await new Promise((r) => setTimeout(r, 1500))
  }
  killTree(child)
  throw new Error(`dev server did not become healthy within 150s\n${tail(serverLog)}`)
}

function stopServer(handle: ServerHandle) {
  if (handle.external || !handle.child) return
  log(`  stopping master-spawned dev server (pid ${handle.child.pid})`)
  killTree(handle.child)
}

let activeServer: ServerHandle | null = null
function cleanupOnExit() {
  if (activeServer && !activeServer.external && activeServer.child) killTree(activeServer.child)
}
process.on("exit", cleanupOnExit)
process.on("SIGINT", () => { cleanupOnExit(); process.exit(130) })
process.on("SIGTERM", () => { cleanupOnExit(); process.exit(143) })

// ---------------------------------------------------------------------------
// Environment validation — fail fast with clear errors, never silently skip.
// ---------------------------------------------------------------------------

function tail(s: string, n = 30): string {
  const lines = s.trimEnd().split("\n")
  return lines.slice(-n).map((l) => `      | ${l}`).join("\n")
}

async function validateEnvironment(): Promise<string[]> {
  const problems: string[] = []

  if (process.cwd() !== ROOT) process.chdir(ROOT)
  if (!existsSync(path.join(ROOT, "node_modules"))) problems.push("node_modules missing — run npm install")
  if (!existsSync(TSX_CLI)) problems.push("tsx CLI missing — run npm install")
  if (!existsSync(path.join(ROOT, ".env"))) problems.push(".env missing — DATABASE_URL et al. required")

  for (const s of ALL_SUITES) {
    if (!existsSync(path.join(ROOT, s.file))) problems.push(`suite file missing: ${s.file}`)
  }

  const envText = existsSync(path.join(ROOT, ".env")) ? readFileSync(path.join(ROOT, ".env"), "utf8") : ""
  const dbUrl = process.env.DATABASE_URL ?? envText.match(/^DATABASE_URL=["']?(.+?)["']?\s*$/m)?.[1]
  if (!dbUrl) {
    problems.push("DATABASE_URL not set (env or .env)")
  } else if (dbUrl.includes("ep-billowing-dew") && process.env.ALLOW_PRODUCTION_DB_TESTS !== "1") {
    problems.push("DATABASE_URL points at the production Neon endpoint — tests refused (db-guard rule)")
  }

  if (problems.length === 0) {
    try {
      const { prisma } = await import("../src/lib/prisma")
      await prisma.$queryRawUnsafe("SELECT 1")
      const cats = await prisma.category.findMany({
        where: { slug: { in: ["plant-problems", "general-cannabis-discussion"] } },
        select: { slug: true },
      })
      if (cats.length < 2) problems.push("seeded categories missing (plant-problems, general-cannabis-discussion) — run npm run seed")
      await prisma.$disconnect()
    } catch (e) {
      problems.push(`database unreachable: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`)
    }
  }

  return problems
}

// ---------------------------------------------------------------------------
// Phase runner + summary
// ---------------------------------------------------------------------------

interface SuiteResult { suite: Suite; res: ChildResult; ok: boolean; skipped: boolean }
const results: SuiteResult[] = []

function selected(s: Suite): boolean {
  return ONLY.length === 0 || ONLY.some((f) => s.id.toLowerCase().includes(f))
}

async function runSuites(suites: Suite[], extraEnv: Record<string, string> = {}) {
  for (const s of suites) {
    if (!selected(s)) {
      results.push({ suite: s, res: { code: null, signal: null, timedOut: false, output: "", ms: 0 }, ok: false, skipped: true })
      log(`  - ${s.label} [${s.cls}] SKIP (filtered by MASTER_ONLY)`)
      continue
    }
    const res = await runChild(s, extraEnv)
    const ok = res.code === 0 && !res.timedOut && res.signal === null
    results.push({ suite: s, res, ok, skipped: false })
    const status = res.timedOut ? "TIMEOUT" : res.signal ? `SIG ${res.signal}` : res.code === null ? "CRASH" : res.code === 0 ? "PASS" : `FAIL exit ${res.code}`
    log(`  ${ok ? "✓" : "✗"} ${s.label} [${s.cls}] ${status} (${(res.ms / 1000).toFixed(1)}s) — ${s.file}`)
    logChunks.push(`----- output: ${s.file} -----\n${res.output}\n----- end ${s.file} -----`)
    if (!ok) log(tail(res.output))
  }
}

async function runPhase(title: string, suites: Suite[], extraEnv: Record<string, string> = {}) {
  log(`\n[${title}]`)
  await runSuites(suites, extraEnv)
}

async function runSetupStep(label: string, cmd: string, args: string[]): Promise<boolean> {
  const child = spawn(cmd, args, { cwd: ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: !IS_WIN, windowsHide: true })
  let output = ""
  child.stdout?.on("data", (d) => { output += d })
  child.stderr?.on("data", (d) => { output += d })
  const code: number | null = await new Promise((r) => child.on("close", r))
  log(`  ${code === 0 ? "✓" : "✗"} setup: ${label}`)
  if (code !== 0) log(tail(output))
  return code === 0
}

async function main() {
  log("╔══════════════════════════════════════════════════════════╗")
  log("║            TerpTalk Master Test Suite                    ║")
  log("║   authoritative automated regression/security answer     ║")
  log("╚══════════════════════════════════════════════════════════╝")
  log(`  root: ${ROOT}`)
  log(`  base: ${BASE_URL}   node: ${process.version}   log: ${LOG_FILE}`)
  if (ONLY.length) log(`  filter: MASTER_ONLY=${ONLY.join(",")} (unlisted suites reported as SKIP)`)

  // Phase 1 — environment
  log(`\n[1/7] Environment`)
  const problems = await validateEnvironment()
  for (const p of problems) log(`  ✗ ${p}`)
  if (problems.length) return finish(1)

  // prerequisites: idempotent seeders so required suites run for real
  if (!(await runSetupStep("terpbot account", process.execPath, ["scripts/terpbot-setup.cjs"]))) return finish(1)
  if (!(await runSetupStep("affiliate partner seed", process.execPath, ["scripts/seed-affiliates.cjs"]))) return finish(1)
  log(`  ✓ environment validated`)

  // Phase 2 — static / structural (no server, no DB writes)
  await runPhase("2/7 Static / Structural", STATIC_PHASE)

  // Phase 3 — HTTP (requires healthy dev server; failure = master failure)
  log(`\n[3/7] HTTP`)
  let server: ServerHandle | null = null
  try {
    server = await startServer()
    activeServer = server
  } catch (e) {
    log(`  ✗ dev server unavailable: ${e instanceof Error ? e.message : String(e)}`)
    for (const s of HTTP_PHASE) {
      results.push({ suite: s, res: { code: null, signal: null, timedOut: false, output: "dev server unavailable", ms: 0 }, ok: false, skipped: false })
      log(`  ✗ ${s.label} [${s.cls}] FAIL (no server — not skipped)`)
    }
  }
  if (server) {
    await runSuites(HTTP_PHASE, { VERIFY_URL: BASE_URL })
    stopServer(server)
    activeServer = null
  }

  // Phase 4 — database-backed behavioral suites, strictly serial
  await runPhase("4/7 Database (serial)", DB_PHASE)

  // Phase 5 — drift, alone, after all fixtures cleaned up
  await runPhase("5/7 Drift", DRIFT_PHASE)

  // Phase 6 — remaining verification
  await runPhase("6/7 Final verification", FINAL_PHASE)

  return finish(results.some((r) => !r.ok && !r.skipped) ? 1 : 0)
}

function finish(code: number) {
  log(`\n[7/7] Summary`)
  const passed = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok && !r.skipped)
  const skipped = results.filter((r) => r.skipped)
  for (const r of failed) log(`  FAIL ${r.suite.id} (${r.suite.file})`)
  log(`\n  PASS: ${passed.length}   FAIL: ${failed.length}   SKIP: ${skipped.length}   total automated suites: ${ALL_SUITES.length}`)
  if (skipped.length) log(`  skipped were filtered by MASTER_ONLY — none were silently dropped`)
  log(`\n  Manual verification still required (no browser/runtime coverage exists):`)
  for (const m of MANUAL_COVERAGE) log(`    · ${m}`)
  log(`\n  Overall: ${code === 0 ? "PASS" : "FAIL"}`)
  try { writeFileSync(LOG_FILE, logChunks.join("\n")) } catch { /* non-fatal */ }
  process.exit(code)
}

main().catch((e) => {
  console.error("master runner crashed:", e)
  cleanupOnExit()
  process.exit(1)
})
