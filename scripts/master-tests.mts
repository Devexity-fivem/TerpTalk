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
//   MASTER_TIER=fast|full|slow|all tier selection (or --tier=<t>; CLI wins)
//     fast — pure/static suites only; no dev server, no DB seeders/checks
//     full — fast + full tiers; the release gate (default)
//     slow — the heavy analytics suites only (DB, no server)
//     all  — everything

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
type Tier = "fast" | "full" | "slow"

interface Suite {
  id: string
  file: string
  runner: Runner
  cls: SuiteClass // A strong behavioral · B behavioral w/ limits · C structural · D static
  label: string
  tier: Tier
  timeoutMs?: number
}

const STATIC_PHASE: Suite[] = [
  { id: "verify-security", file: "scripts/verify-security.cjs", runner: "node", cls: "C", label: "Security source invariants", tier: "fast" },
  { id: "ui-contracts", file: "scripts/ui-contracts-tests.mts", runner: "tsx", cls: "C", label: "UI structural + accessibility contracts", tier: "fast" },
  { id: "info-pages", file: "scripts/info-pages-tests.mts", runner: "tsx", cls: "D", label: "Info pages static/config checks", tier: "fast" },
]

// Pure suites — no server, no DB. TerpBot layers plus structural checks.
const PURE_PHASE: Suite[] = [
  { id: "terpbot-parser", file: "scripts/terpbot-parser-tests.mts", runner: "tsx", cls: "A", label: "TerpBot NL parser", tier: "fast" },
  { id: "terpbot-commands", file: "scripts/terpbot-commands-tests.mts", runner: "tsx", cls: "A", label: "TerpBot command registry + intent routing", tier: "fast" },
  { id: "terpbot-intelligence", file: "scripts/terpbot-intelligence-tests.mts", runner: "tsx", cls: "A", label: "TerpBot evidence engine (candidates, scoring, classifier, wizard)", tier: "fast" },
  { id: "terpbot-longitudinal", file: "scripts/terpbot-longitudinal-tests.mts", runner: "tsx", cls: "A", label: "TerpBot longitudinal context (timeline, baselines, interventions)", tier: "fast" },
  { id: "terpbot-decisions", file: "scripts/terpbot-decisions-tests.mts", runner: "tsx", cls: "A", label: "TerpBot decisions (snapshot, capabilities, plan, decision engine)", tier: "fast" },
  { id: "terpbot-assist", file: "scripts/terpbot-assist-tests.mts", runner: "tsx", cls: "A", label: "TerpBot BOT_ASSIST triggers", tier: "fast" },
  { id: "validate-knowledge", file: "scripts/validate-knowledge.mts", runner: "tsx", cls: "C", label: "TerpBot knowledge validator", tier: "fast" },
]

// Requires a healthy dev server at BASE_URL. Serial: suites share the dev DB
// and bot-verify toggles global settings / rate-limit rows.
const HTTP_PHASE: Suite[] = [
  { id: "account", file: "scripts/account-verify.mjs", runner: "node", cls: "A", label: "Account lifecycle HTTP (auth, onboarding, DMs, deletion, captcha)", tier: "full" },
  { id: "forum", file: "scripts/forum-verify.mjs", runner: "node", cls: "A", label: "Forum HTTP behavior", tier: "full" },
  { id: "search", file: "scripts/search-verify.mjs", runner: "node", cls: "A", label: "Search HTTP behavior", tier: "full" },
  { id: "diary", file: "scripts/diary-verify.mjs", runner: "node", cls: "A", label: "Grow diary HTTP behavior", tier: "full" },
  { id: "bot", file: "scripts/bot-verify.mjs", runner: "node", cls: "A", label: "TerpBot HTTP end-to-end", tier: "full", timeoutMs: 12 * 60_000 },
  { id: "trust-safety", file: "scripts/trust-safety-verify.mjs", runner: "node", cls: "A", label: "Trust & safety HTTP behavior", tier: "full" },
  { id: "feedback", file: "scripts/feedback-tests.mjs", runner: "node", cls: "A", label: "Feedback auth/privacy/rate-limit", tier: "full" },
  { id: "ops", file: "scripts/ops-tests.mts", runner: "tsx", cls: "A", label: "Ops surface gate + metrics shape + feedback deviceType", tier: "full" },
  { id: "runtime-verify", file: "scripts/runtime-verify.mjs", runner: "node", cls: "A", label: "Runtime security black-box (sessions, authz, privacy, Pusher, uploads, rate limits, staff, TerpBot)", tier: "full", timeoutMs: 12 * 60_000 },
]

// STRICTLY SERIAL — all create DB fixtures; several mutate shared global
// settings (chat_enabled, GROW_ROOM_ENABLED) and rate-limit rows.
const DB_PHASE: Suite[] = [
  { id: "security", file: "scripts/security-tests.mts", runner: "tsx", cls: "A", label: "Security + platform lib-level (sessions, roles, uploads, links, cron, captcha, markdown)", tier: "full" },
  { id: "notifications", file: "scripts/notification-2-tests.mts", runner: "tsx", cls: "A", label: "Notification persistence + delivery", tier: "full" },
  { id: "reputation", file: "scripts/reputation-tests.mts", runner: "tsx", cls: "A", label: "Reputation award/reverse ledger", tier: "full" },
  { id: "reputation-referral", file: "scripts/reputation-referral-integrity-tests.mts", runner: "tsx", cls: "A", label: "Reputation referral integrity", tier: "full" },
  { id: "terpbot-pipeline", file: "scripts/terpbot-pipeline-tests.mts", runner: "tsx", cls: "A", label: "TerpBot pipeline (DB)", tier: "full" },
  { id: "progression", file: "scripts/progression-tests.mts", runner: "tsx", cls: "A", label: "Progression / trust thresholds", tier: "full" },
  { id: "privacy", file: "scripts/privacy-controls-tests.mts", runner: "tsx", cls: "B", label: "Privacy controls (block, hide, DM policy)", tier: "full" },
  { id: "self-service", file: "scripts/self-service-tests.mts", runner: "tsx", cls: "B", label: "Self-service account flows", tier: "full" },
  { id: "chat", file: "scripts/chat-ux-tests.mts", runner: "tsx", cls: "A", label: "Chat UX helpers + room visibility (DB)", tier: "full" },
  { id: "community-analytics", file: "scripts/community-analytics-tests.mts", runner: "tsx", cls: "B", label: "Community analytics", tier: "slow" },
  { id: "growth-analytics", file: "scripts/growth-analytics-tests.mts", runner: "tsx", cls: "B", label: "Growth analytics", tier: "slow" },
  { id: "knowledge-compounding", file: "scripts/knowledge-compounding-tests.mts", runner: "tsx", cls: "B", label: "Knowledge compounding", tier: "slow" },
  { id: "content-edit", file: "scripts/content-edit-tests.mts", runner: "tsx", cls: "B", label: "Content edit parsers + strain linkage", tier: "full" },
  { id: "strain-lifecycle", file: "scripts/strain-lifecycle-tests.mts", runner: "tsx", cls: "B", label: "Strain lifecycle + staff deletion", tier: "full" },
  { id: "velocity-detector", file: "scripts/velocity-detector-tests.mts", runner: "tsx", cls: "B", label: "Reputation velocity detector", tier: "full" },
  { id: "rewards3", file: "scripts/rewards3-tests.mts", runner: "tsx", cls: "A", label: "Grow journey, weekly recognition, streaks, room gates", tier: "full" },
  { id: "discovery-integration", file: "scripts/discovery-integration-tests.mts", runner: "tsx", cls: "B", label: "Discovery filters + sitemap (DB)", tier: "full" },
]

// Whole-DB scan — runs alone, after every fixture suite has cleaned up.
const DRIFT_PHASE: Suite[] = [
  { id: "check-drift", file: "scripts/check-drift.mts", runner: "tsx", cls: "B", label: "Reputation ledger drift scan", tier: "full" },
]

// Remaining verification. verify-affiliates asserts ops seed data, so its
// idempotent seeder runs as a setup step first.
const FINAL_PHASE: Suite[] = [
  { id: "verify-affiliates", file: "scripts/verify-affiliates.cjs", runner: "node", cls: "B", label: "Affiliate integrity (seeded data)", tier: "full" },
  // Prod-mode verification builds .next — must run after the HTTP phase has
  // stopped a master-spawned dev server (an adopted external dev server on
  // the same .next dir may be disrupted by the build).
  { id: "runtime-prod", file: "scripts/runtime-prod-verify.mjs", runner: "node", cls: "A", label: "Production-mode verification (build, headers, CSP, cookies, fail-closed)", tier: "full", timeoutMs: 20 * 60_000 },
]

const ALL_SUITES = [...STATIC_PHASE, ...PURE_PHASE, ...HTTP_PHASE, ...DB_PHASE, ...DRIFT_PHASE, ...FINAL_PHASE]

// ---------------------------------------------------------------------------
// Tier selection — --tier=<t> wins over MASTER_TIER; default "full" (release
// gate). Tier-excluded suites are not run, not counted, and not listed.
// ---------------------------------------------------------------------------

type TierSelection = "fast" | "full" | "slow" | "all"

const cliTier = process.argv.find((a) => a.startsWith("--tier="))?.slice("--tier=".length)
const rawTier = (cliTier ?? process.env.MASTER_TIER ?? "full").trim().toLowerCase()
if (!["fast", "full", "slow", "all"].includes(rawTier)) {
  console.error(`unknown tier "${rawTier}" — expected fast|full|slow|all (MASTER_TIER or --tier=)`)
  process.exit(1)
}
const TIER = rawTier as TierSelection

const TIER_OK: Record<TierSelection, (t: Tier) => boolean> = {
  fast: (t) => t === "fast",
  full: (t) => t !== "slow",
  slow: (t) => t === "slow",
  all: () => true,
}
const tierOk = TIER_OK[TIER]
const STATIC_S = STATIC_PHASE.filter((s) => tierOk(s.tier))
const PURE_S = PURE_PHASE.filter((s) => tierOk(s.tier))
const HTTP_S = HTTP_PHASE.filter((s) => tierOk(s.tier))
const DB_S = DB_PHASE.filter((s) => tierOk(s.tier))
const DRIFT_S = DRIFT_PHASE.filter((s) => tierOk(s.tier))
const FINAL_S = FINAL_PHASE.filter((s) => tierOk(s.tier))
const SELECTED_SUITES = [...STATIC_S, ...PURE_S, ...HTTP_S, ...DB_S, ...DRIFT_S, ...FINAL_S]
const needsServer = HTTP_S.length > 0
const needsDb = TIER !== "fast" // fast tier runs no DB prerequisites

const MANUAL_COVERAGE = [
  "Chat Panel desktop behavior (open/close, resize, unread dot)",
  "Mobile chat sheet behavior + touch interactions",
  "Pusher messaging inside the browser chat UI (transport-level two-client delivery is covered by runtime-verify)",
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

async function validateEnvironment(checkDb: boolean): Promise<string[]> {
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

  if (checkDb && problems.length === 0) {
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
const phaseTimes: { title: string; ms: number }[] = []

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
  if (suites.length === 0) return
  log(`\n[${title}]`)
  const before = results.length
  await runSuites(suites, extraEnv)
  phaseTimes.push({ title, ms: results.slice(before).reduce((a, r) => a + r.res.ms, 0) })
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
  const excluded = ALL_SUITES.length - SELECTED_SUITES.length
  log(`  tier: ${TIER}${TIER === "all"
    ? ` (${SELECTED_SUITES.length} suites)`
    : ` (${SELECTED_SUITES.length} suites; ${excluded} ${TIER === "full" ? "slow-tier" : "other-tier"} suites excluded — run MASTER_TIER=${TIER === "full" ? "slow or all" : "all"})`}`)
  if (ONLY.length) log(`  filter: MASTER_ONLY=${ONLY.join(",")} (unlisted suites reported as SKIP)`)

  // MASTER_ONLY that matches nothing in the selected tier is a config
  // error — fail loudly rather than report a green empty run.
  if (ONLY.length && !SELECTED_SUITES.some(selected)) {
    log(`\n  ✗ MASTER_ONLY matched zero suites in tier "${TIER}". Valid ids:`)
    for (const s of SELECTED_SUITES) log(`    - ${s.id}`)
    return finish(1)
  }

  // Phase 1 — environment (fast tier skips DB prerequisites entirely)
  log(`\n[1/8] Environment`)
  const problems = await validateEnvironment(needsDb)
  for (const p of problems) log(`  ✗ ${p}`)
  if (problems.length) return finish(1)

  if (needsDb) {
    // prerequisites: idempotent seeders so required suites run for real
    if (!(await runSetupStep("terpbot account", process.execPath, ["scripts/terpbot-setup.cjs"]))) return finish(1)
    if (!(await runSetupStep("affiliate partner seed", process.execPath, ["scripts/seed-affiliates.cjs"]))) return finish(1)
  }
  log(`  ✓ environment validated`)

  // Phase 2 — static / structural (no server, no DB writes)
  await runPhase("2/8 Static / Structural", STATIC_S)

  // Phase 3 — pure suites (no server, no DB)
  await runPhase("3/8 Pure", PURE_S)

  // Phase 4 — HTTP (requires healthy dev server; failure = master failure)
  if (needsServer) {
    log(`\n[4/8] HTTP`)
    let server: ServerHandle | null = null
    try {
      server = await startServer()
      activeServer = server
    } catch (e) {
      log(`  ✗ dev server unavailable: ${e instanceof Error ? e.message : String(e)}`)
      for (const s of HTTP_S) {
        results.push({ suite: s, res: { code: null, signal: null, timedOut: false, output: "dev server unavailable", ms: 0 }, ok: false, skipped: false })
        log(`  ✗ ${s.label} [${s.cls}] FAIL (no server — not skipped)`)
      }
    }
    if (server) {
      const before = results.length
      await runSuites(HTTP_S, { VERIFY_URL: BASE_URL })
      phaseTimes.push({ title: "4/8 HTTP", ms: results.slice(before).reduce((a, r) => a + r.res.ms, 0) })
      stopServer(server)
      activeServer = null
    }
  }

  // Phase 5 — database-backed behavioral suites, strictly serial
  await runPhase("5/8 Database (serial)", DB_S)

  // Phase 6 — drift, alone, after all fixtures cleaned up
  await runPhase("6/8 Drift", DRIFT_S)

  // Phase 7 — remaining verification
  await runPhase("7/8 Final verification", FINAL_S)

  return finish(results.some((r) => !r.ok && !r.skipped) ? 1 : 0)
}

function finish(code: number) {
  log(`\n[8/8] Summary`)
  const passed = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok && !r.skipped)
  const skipped = results.filter((r) => r.skipped)
  for (const r of failed) log(`  FAIL ${r.suite.id} (${r.suite.file})`)
  if (phaseTimes.length) {
    log(`\n  phase elapsed (sum of suite times):`)
    for (const p of phaseTimes) log(`    ${p.title}: ${(p.ms / 1000).toFixed(1)}s`)
  }
  log(`\n  PASS: ${passed.length}   FAIL: ${failed.length}   SKIP: ${skipped.length}   total automated suites: ${SELECTED_SUITES.length}`)
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
