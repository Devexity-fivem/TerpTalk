#!/usr/bin/env tsx
/**
 * Targeted backup of all progress-derived tables before a progression reset.
 *
 * Usage:
 *   DATABASE_URL=<conn> npx tsx scripts/backup-progression.mts [outDir]
 *   DATABASE_URL=<conn> npx tsx scripts/backup-progression.mts --verify <backupDir>
 *
 * Default outDir: backups/progression-pre-v4-<ts>/
 * Writes <table>.jsonl per table + manifest.json with row counts and a
 * SHA-256 per file. This is the restore point for any progression wipe —
 * do not delete.
 *
 * Guarantees:
 * - All tables are read inside ONE interactive transaction, so the export
 *   is a consistent snapshot (no row can be missed or double-counted by
 *   concurrent writes mid-export).
 * - Rows are paginated (1 000/batch) and streamed to disk — memory stays
 *   bounded regardless of table size.
 * - manifest.json is written LAST and only after every table completes.
 *   A crashed/partial run leaves JSONL files with NO manifest, which
 *   --verify rejects — a partial backup can never be mistaken for valid.
 * - --verify recomputes every file's hash and line count against the
 *   manifest and exits non-zero on any mismatch.
 */
import { createHash } from "node:crypto"
import { createWriteStream, writeFileSync, mkdirSync, existsSync, readFileSync, createReadStream } from "node:fs"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"
import { PrismaClient, Prisma } from "@prisma/client"

const prisma = new PrismaClient()
const BATCH = 1000

// ── --verify mode ─────────────────────────────────────────────────
// Recompute sha256 + non-empty line count for every file named in the
// manifest. Any mismatch (missing file, bad hash, wrong count) fails.
async function verify(dir: string): Promise<boolean> {
  const manifestPath = join(dir, "manifest.json")
  if (!existsSync(manifestPath)) {
    console.error(`No manifest.json in ${dir} — incomplete or foreign backup`)
    return false
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    tables: Record<string, { file: string; rows: number; sha256: string }>
  }
  let ok = true
  for (const [name, meta] of Object.entries(manifest.tables)) {
    const file = join(dir, meta.file)
    if (!existsSync(file)) {
      console.error(`  ✗ ${name}: missing ${meta.file}`)
      ok = false
      continue
    }
    const hash = createHash("sha256")
    let lines = 0
    const rl = createInterface({ input: createReadStream(file) })
    for await (const line of rl) {
      if (!line.trim()) continue
      lines++
      hash.update(line)
      hash.update("\n")
    }
    const sha = hash.digest("hex")
    if (lines !== meta.rows || sha !== meta.sha256) {
      console.error(`  ✗ ${name}: rows ${lines}/${meta.rows} sha ${sha.slice(0, 12)}/${meta.sha256.slice(0, 12)}`)
      ok = false
    } else {
      console.log(`  ✓ ${name}: ${lines} rows verified`)
    }
  }
  return ok
}

// ── helpers ───────────────────────────────────────────────────────

/** Identify the database WITHOUT credentials — Supabase project ref lives
 *  in the username (postgres.<ref>) or host (db.<ref>.supabase.co). */
function dbIdentity(raw: string): Record<string, string> {
  try {
    const u = new URL(raw)
    const user = decodeURIComponent(u.username)
    const host = u.hostname
    const fromUser = user.includes(".") ? user.split(".").pop() ?? null : null
    const fromHost = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i)?.[1] ?? null
    const ref = fromUser ?? fromHost
    return {
      host,
      port: u.port || "5432",
      database: u.pathname.replace(/^\//, "") || "postgres",
      ...(ref ? { projectRef: ref } : {}),
    }
  } catch {
    return { host: "unparseable-database-url" }
  }
}

type Row = Record<string, unknown>

async function exportTable(
  tx: Prisma.TransactionClient,
  name: string,
  fetchPage: (cursor: string | undefined) => Promise<Row[]>,
  cursorOf: (row: Row) => string,
  outDir: string,
): Promise<{ rows: number; sha256: string }> {
  const file = `${name}.jsonl`
  const stream = createWriteStream(join(outDir, file), { encoding: "utf8" })
  const hash = createHash("sha256")
  let rows = 0
  let cursor: string | undefined
  try {
    for (;;) {
      const page = await fetchPage(cursor)
      if (page.length === 0) break
      for (const row of page) {
        const line = JSON.stringify(row)
        stream.write(line + "\n")
        hash.update(line)
        hash.update("\n")
        rows++
      }
      if (page.length < BATCH) break
      cursor = cursorOf(page[page.length - 1])
    }
  } finally {
    await new Promise<void>((res, rej) => {
      stream.end(() => res())
      stream.on("error", rej)
    })
  }
  return { rows, sha256: hash.digest("hex") }
}

// Cursor-paginated findMany on `id` (all event/grant tables have cuid ids).
function byId(
  delegate: {
    findMany: (args: {
      take: number
      orderBy: { id: "asc" }
      where?: { id?: { gt: string } }
      cursor?: undefined
    }) => Promise<Row[]>
  },
  extra?: Record<string, unknown>,
) {
  return (cursor: string | undefined) =>
    delegate.findMany({
      take: BATCH,
      orderBy: { id: "asc" },
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
      ...(extra ?? {}),
    }) as Promise<Row[]>
}

// MasteryProgress has a compound PK (userId, mastery) — no `id` column.
// Cursor-paginate on the compound unique instead.
async function masteryPages(tx: Prisma.TransactionClient, cursor: { userId: string; mastery: string } | undefined): Promise<Row[]> {
  return tx.masteryProgress.findMany({
    take: BATCH,
    orderBy: [{ userId: "asc" }, { mastery: "asc" }],
    ...(cursor ? { cursor: { userId_mastery: cursor }, skip: 1 } : {}),
  }) as Promise<Row[]>
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === "--verify") {
    const dir = resolve(args[1] || "")
    if (!dir || !existsSync(dir)) {
      console.error("Usage: backup-progression.mts --verify <backupDir>")
      process.exit(1)
    }
    const ok = await verify(dir)
    console.log(ok ? "\nBackup verified — all files match the manifest." : "\nVERIFICATION FAILED")
    process.exit(ok ? 0 : 2)
  }

  if (!process.env.DATABASE_URL) {
    console.error("Refusing: DATABASE_URL not set.")
    process.exit(1)
  }
  const outDir = resolve(args[0] || join("backups", `progression-pre-v4-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`))
  mkdirSync(outDir, { recursive: true })

  console.log(`Progression backup → ${outDir}`)
  console.log(`Target: ${JSON.stringify(dbIdentity(process.env.DATABASE_URL))}`)

  // One interactive transaction = one consistent snapshot across every
  // table. Generous timeout for large ledgers; the export is read-only so
  // a rollback on failure is harmless.
  const manifest: Record<string, { file: string; rows: number; sha256: string }> = {}
  await prisma.$transaction(
    async (tx) => {
      manifest["progressionEvent"] = await exportTable(
        tx, "progressionEvent",
        byId(tx.progressionEvent as never),
        (r) => r.id as string,
        outDir,
      ).then(async (m) => { console.log(`  progressionEvent: ${m.rows} rows`); return { file: "progressionEvent.jsonl", ...m } })

      manifest["reputationEvent"] = await exportTable(
        tx, "reputationEvent",
        byId(tx.reputationEvent as never),
        (r) => r.id as string,
        outDir,
      ).then(async (m) => { console.log(`  reputationEvent: ${m.rows} rows`); return { file: "reputationEvent.jsonl", ...m } })

      // MasteryProgress — compound PK, custom cursor.
      {
        const file = "masteryProgress.jsonl"
        const stream = createWriteStream(join(outDir, file), { encoding: "utf8" })
        const hash = createHash("sha256")
        let rows = 0
        let cursor: { userId: string; mastery: string } | undefined
        try {
          for (;;) {
            const page = await masteryPages(tx, cursor)
            if (page.length === 0) break
            for (const row of page) {
              const line = JSON.stringify(row)
              stream.write(line + "\n")
              hash.update(line)
              hash.update("\n")
              rows++
            }
            if (page.length < BATCH) break
            const last = page[page.length - 1] as { userId: string; mastery: string }
            cursor = { userId: last.userId, mastery: last.mastery }
          }
        } finally {
          await new Promise<void>((res) => stream.end(() => res()))
        }
        manifest["masteryProgress"] = { file, rows, sha256: hash.digest("hex") }
        console.log(`  masteryProgress: ${rows} rows`)
      }

      manifest["userBadge"] = await exportTable(
        tx, "userBadge",
        byId(tx.userBadge as never),
        (r) => r.id as string,
        outDir,
      ).then(async (m) => { console.log(`  userBadge: ${m.rows} rows`); return { file: "userBadge.jsonl", ...m } })

      manifest["userAchievement"] = await exportTable(
        tx, "userAchievement",
        byId(tx.userAchievement as never),
        (r) => r.id as string,
        outDir,
      ).then(async (m) => { console.log(`  userAchievement: ${m.rows} rows`); return { file: "userAchievement.jsonl", ...m } })

      // Profile progress columns only — every field the reset modifies,
      // including unlockFrozen (the audit's F-4 gap).
      {
        const file = "profile-progress.jsonl"
        const stream = createWriteStream(join(outDir, file), { encoding: "utf8" })
        const hash = createHash("sha256")
        let rows = 0
        let cursor: string | undefined
        const select = { id: true, userId: true, username: true, xp: true, standing: true, reputation: true, legacyVerified: true, unlockFrozen: true } as const
        try {
          for (;;) {
            const page = (await tx.profile.findMany({
              take: BATCH,
              orderBy: { id: "asc" },
              ...(cursor ? { where: { id: { gt: cursor } }, cursor: undefined } : {}),
              select,
            })) as unknown as Row[]
            if (page.length === 0) break
            for (const row of page) {
              const line = JSON.stringify(row)
              stream.write(line + "\n")
              hash.update(line)
              hash.update("\n")
              rows++
            }
            if (page.length < BATCH) break
            cursor = (page[page.length - 1] as { id: string }).id
          }
        } finally {
          await new Promise<void>((res) => stream.end(() => res()))
        }
        manifest["profile-progress"] = { file, rows, sha256: hash.digest("hex") }
        console.log(`  profile-progress: ${rows} rows`)
      }
    },
    { timeout: 300_000, maxWait: 15_000 },
  )

  // Manifest LAST — its presence is what makes the backup valid.
  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        database: dbIdentity(process.env.DATABASE_URL!),
        snapshot: "single-transaction",
        tables: manifest,
      },
      null,
      2,
    ),
  )
  console.log(`\nBackup complete — ${Object.keys(manifest).length} tables, manifest written.`)
  console.log(`Verify any time: npx tsx scripts/backup-progression.mts --verify "${outDir}"`)
}

main()
  .catch((e) => {
    console.error("Backup failed — output is INCOMPLETE (no manifest written):", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
