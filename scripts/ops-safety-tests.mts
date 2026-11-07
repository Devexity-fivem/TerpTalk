// Ops-safety contracts — destructive-target classification and backup
// integrity helpers. Pure: no server, no DB. The reset utility itself
// was removed; evaluateDestructiveDbTarget remains the mandatory gate
// for any future destructive ops script.
import { strict as assert } from "node:assert"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { evaluateDestructiveDbTarget } from "./db-guard.mjs"
import { createJsonlWriter, verifyBackupDir, isSafeBackupRelPath, parseBackupManifest } from "./lib/backup-utils"

let passed = 0
let failed = 0
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn()
    passed++
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : e}`)
  }
}

const DEV_SUPABASE = "postgresql://postgres.ovztvfbvylcdpsuchvps:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
const PROD_SUPABASE = "postgresql://postgres.dtlksgtsvdfhgsiuktbt:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
const PROD_SUPABASE_DIRECT = "postgresql://postgres:pw@db.dtlksgtsvdfhgsiuktbt.supabase.co:5432/postgres"
const RETIRED_PROD_NEON = "postgresql://u:pw@ep-billowing-dew-123456.us-east-2.aws.neon.tech/db"
const RETIRED_DEV_NEON = "postgresql://u:pw@ep-old-breeze-123456.us-east-2.aws.neon.tech/db"
const LOCAL_PG = "postgresql://postgres:pw@localhost:5432/terptalk"
const UNKNOWN_HOST = "postgresql://u:pw@db.unknown-provider.example.com:5432/app"

// ── evaluateDestructiveDbTarget ────────────────────────────────────
await check("dev Supabase project is authorized", () => {
  const v = evaluateDestructiveDbTarget(DEV_SUPABASE)
  assert.equal(v.allowed, true, v.reason)
})
await check("local Postgres is authorized", () => {
  assert.equal(evaluateDestructiveDbTarget(LOCAL_PG).allowed, true)
  assert.equal(evaluateDestructiveDbTarget("postgresql://u:p@127.0.0.1:5432/db").allowed, true)
})
await check("production Supabase (pooled) is refused", () => {
  assert.equal(evaluateDestructiveDbTarget(PROD_SUPABASE).allowed, false)
})
await check("production Supabase (direct host) is refused", () => {
  assert.equal(evaluateDestructiveDbTarget(PROD_SUPABASE_DIRECT).allowed, false)
})
await check("retired production Neon endpoint is refused", () => {
  assert.equal(evaluateDestructiveDbTarget(RETIRED_PROD_NEON).allowed, false)
})
await check("unknown database hosts fail closed", () => {
  assert.equal(evaluateDestructiveDbTarget(UNKNOWN_HOST).allowed, false)
  assert.equal(evaluateDestructiveDbTarget("").allowed, false)
  assert.equal(evaluateDestructiveDbTarget(undefined).allowed, false)
  assert.equal(evaluateDestructiveDbTarget("not a url").allowed, false)
})
await check("retired dev Neon branch is authorized (stale .env compat)", () => {
  assert.equal(evaluateDestructiveDbTarget(RETIRED_DEV_NEON).allowed, true)
})
await check("production refusal is unconditional — no env input exists", () => {
  // The evaluator takes ONLY the URL: ALLOW_PRODUCTION_DB_TESTS,
  // ALLOW_UNRECOGNIZED_DB_TESTS, DB_GUARD_EXTRA_HOSTS and any future
  // RESET_TARGET-style variable cannot reach it by construction.
  // Re-assert the prod verdict under every hostile spelling.
  for (const url of [PROD_SUPABASE, PROD_SUPABASE_DIRECT, RETIRED_PROD_NEON]) {
    assert.equal(evaluateDestructiveDbTarget(url).allowed, false, url)
  }
})

// ── isSafeBackupRelPath ────────────────────────────────────────────
await check("manifest paths must stay inside the backup dir", () => {
  const dir = "/tmp/backup"
  assert.equal(isSafeBackupRelPath(dir, "table.jsonl"), true)
  assert.equal(isSafeBackupRelPath(dir, "../escape.jsonl"), false)
  assert.equal(isSafeBackupRelPath(dir, "sub/../../escape.jsonl"), false)
  assert.equal(isSafeBackupRelPath(dir, "/abs/path.jsonl"), false)
  assert.equal(isSafeBackupRelPath(dir, "C:\\win\\path.jsonl"), false)
  assert.equal(isSafeBackupRelPath(dir, ""), false)
})

// ── createJsonlWriter ──────────────────────────────────────────────
await check("jsonl writer: rows, hash, and close are consistent", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"))
  try {
    const w = createJsonlWriter(join(dir, "t.jsonl"))
    const rows = Array.from({ length: 5000 }, (_, i) => ({ id: `r${i}`, v: "x".repeat(50) }))
    for (const r of rows) await w.writeLine(r)
    const meta = await w.close()
    assert.equal(meta.rows, 5000)
    const expected = createHash("sha256")
    for (const r of rows) { expected.update(JSON.stringify(r)); expected.update("\n") }
    assert.equal(meta.sha256, expected.digest("hex"))
    // close() is single-shot
    await assert.rejects(() => w.close())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
await check("jsonl writer: write after close rejects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"))
  try {
    const w = createJsonlWriter(join(dir, "t.jsonl"))
    await w.close()
    await assert.rejects(() => w.writeLine({ a: 1 }))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
await check("jsonl writer: stream error surfaces as rejection", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"))
  try {
    // Directory-as-file path forces an immediate stream error. Give the
    // 'error' event a tick to land, then close() must reject.
    const w = createJsonlWriter(join(dir, "no-such-dir", "t.jsonl"))
    await w.writeLine({ a: 1 }).catch(() => {})
    await new Promise((r) => setTimeout(r, 20))
    await assert.rejects(() => w.close())
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── verifyBackupDir ────────────────────────────────────────────────
function seedBackup(dir: string, tables: Record<string, unknown[]>) {
  const manifestTables: Record<string, { file: string; rows: number; sha256: string }> = {}
  for (const [name, rows] of Object.entries(tables)) {
    const file = `${name}.jsonl`
    const hash = createHash("sha256")
    const lines = rows.map((r) => JSON.stringify(r))
    for (const l of lines) { hash.update(l); hash.update("\n") }
    writeFileSync(join(dir, file), lines.map((l) => l + "\n").join(""))
    manifestTables[name] = { file, rows: rows.length, sha256: hash.digest("hex") }
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ exportedAt: new Date().toISOString(), tables: manifestTables }, null, 2))
  return manifestTables
}

await check("verify: a complete backup passes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"))
  try {
    seedBackup(dir, { t1: [{ id: "a" }], t2: [] })
    const v = await verifyBackupDir(dir, ["t1", "t2"])
    assert.equal(v.ok, true, v.errors.join(";"))
    assert.equal(v.checked, 2)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
await check("verify: missing manifest rejects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"))
  try {
    writeFileSync(join(dir, "t1.jsonl"), "{}\n")
    const v = await verifyBackupDir(dir)
    assert.equal(v.ok, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
await check("verify: malformed manifest rejects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"))
  try {
    writeFileSync(join(dir, "manifest.json"), "{not json")
    assert.equal((await verifyBackupDir(dir)).ok, false)
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ tables: "nope" }))
    assert.equal((await verifyBackupDir(dir)).ok, false)
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ tables: { t: { file: "t.jsonl", rows: -1, sha256: "x" } } }))
    assert.equal((await verifyBackupDir(dir)).ok, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
await check("verify: corrupted file (row count) rejects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"))
  try {
    seedBackup(dir, { t1: [{ id: "a" }, { id: "b" }] })
    writeFileSync(join(dir, "t1.jsonl"), '{"id":"a"}\n') // dropped a row
    const v = await verifyBackupDir(dir)
    assert.equal(v.ok, false)
    assert.ok(v.errors.some((e) => e.includes("t1")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
await check("verify: corrupted file (hash) rejects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"))
  try {
    seedBackup(dir, { t1: [{ id: "a" }] })
    writeFileSync(join(dir, "t1.jsonl"), '{"id":"tampered"}\n')
    const v = await verifyBackupDir(dir)
    assert.equal(v.ok, false)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
await check("verify: missing expected table entry rejects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"))
  try {
    seedBackup(dir, { t1: [{ id: "a" }] })
    const v = await verifyBackupDir(dir, ["t1", "t2", "t3"])
    assert.equal(v.ok, false)
    assert.ok(v.errors.some((e) => e.includes("t2")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
await check("verify: path-escaping manifest entry rejects", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bk-"))
  try {
    const good = createHash("sha256").update('{"id":"a"}\n').digest("hex")
    // A ".."-bearing filename passes basename() but is rejected by the
    // safe-path check — exercises that branch specifically. (True "../"
    // escapes fail earlier at manifest parse via the basename rule.)
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      tables: { evil: { file: "..evil.jsonl", rows: 1, sha256: good } },
    }))
    const v = await verifyBackupDir(dir)
    assert.equal(v.ok, false)
    assert.ok(v.errors.some((e) => e.includes("unsafe")))
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
await check("parseBackupManifest rejects non-object tables", () => {
  assert.equal(parseBackupManifest('{"tables":[]}'), null)
  assert.equal(parseBackupManifest('{"tables":{"a":{"file":"f","rows":1.5,"sha256":"' + "0".repeat(64) + '"}}}'), null)
  assert.equal(parseBackupManifest('{"tables":{"a":{"file":"f","rows":1,"sha256":"short"}}}'), null)
})

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
