#!/usr/bin/env tsx
/**
 * Targeted backup of all progress-derived tables.
 *
 * Usage:
 *   DATABASE_URL=<conn> npx tsx scripts/backup-progression.mts [outDir]
 *   npx tsx scripts/backup-progression.mts --verify <backupDir>
 *
 * Default outDir: backups/progression-pre-v4-<ts>/ — must be empty or
 * nonexistent (a stale manifest.json in a reused dir could otherwise
 * make an incomplete rerun look valid).
 *
 * Guarantees:
 * - All tables are read inside ONE interactive transaction at explicit
 *   REPEATABLE READ isolation — PostgreSQL takes the snapshot at the
 *   first query, so every page of every table sees the same committed
 *   state. (Limitation: this is a consistent *snapshot*, not a lock —
 *   writers are not blocked; rows committed after the snapshot simply
 *   aren't included, which is correct backup semantics.)
 * - Rows are keyset-paginated (1 000/batch) and streamed through a
 *   backpressure-safe writer — memory stays bounded at any table size.
 * - manifest.json (row counts + SHA-256 per file) is written LAST and
 *   only after every table completes and every stream has closed.
 *   A crashed run leaves JSONL files with NO manifest → --verify
 *   rejects it; a partial backup can never be mistaken for valid.
 * - --verify recomputes hashes/row counts, rejects malformed manifests,
 *   unsafe paths, missing files, and omitted required tables.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { PrismaClient, Prisma } from "@prisma/client"
import { createJsonlWriter, verifyBackupDir } from "./lib/backup-utils"

const prisma = new PrismaClient()
const BATCH = 1000

export const BACKUP_TABLES = [
  "progressionEvent",
  "reputationEvent",
  "masteryProgress",
  "userBadge",
  "userAchievement",
  "profile-progress",
] as const

type Row = Record<string, unknown>

/** Identify the database WITHOUT credentials — Supabase project ref
 *  lives in the username (postgres.<ref>) or host (db.<ref>.supabase.co). */
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

/** Stream one table to <name>.jsonl inside the snapshot transaction.
 *  fetchPage(cursor) returns up to BATCH rows; cursorOf maps the last
 *  row to the next cursor. Generic cursor type covers both `id` keyset
 *  and MasteryProgress's compound (userId, mastery) key. */
async function exportTable<C>(
  name: string,
  fetchPage: (cursor: C | undefined) => Promise<Row[]>,
  cursorOf: (row: Row) => C,
  outDir: string,
): Promise<{ file: string; rows: number; sha256: string }> {
  const writer = createJsonlWriter(join(outDir, `${name}.jsonl`))
  let cursor: C | undefined
  try {
    for (;;) {
      const page = await fetchPage(cursor)
      if (page.length === 0) break
      for (const row of page) await writer.writeLine(row)
      if (page.length < BATCH) break
      cursor = cursorOf(page[page.length - 1])
    }
    return { file: `${name}.jsonl`, ...(await writer.close()) }
  } catch (e) {
    await writer.close().catch(() => {})
    throw e
  }
}

// Keyset pagination on `id` for the cuid-keyed tables.
function byId(delegate: { findMany: (args: never) => Promise<Row[]> }) {
  return (cursor: string | undefined) =>
    delegate.findMany({
      take: BATCH,
      orderBy: { id: "asc" },
      ...(cursor ? { where: { id: { gt: cursor } } } : {}),
    } as never) as Promise<Row[]>
}

// MasteryProgress has a compound PK (userId, mastery) — no `id` column.
function masteryPage(tx: Prisma.TransactionClient, cursor: { userId: string; mastery: string } | undefined) {
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
    const result = await verifyBackupDir(dir, [...BACKUP_TABLES])
    for (const e of result.errors) console.error(`  ✗ ${e}`)
    if (result.ok) {
      console.log(`Backup verified — ${result.checked} tables match the manifest.`)
      process.exit(0)
    }
    console.error("VERIFICATION FAILED")
    process.exit(2)
  }

  if (!process.env.DATABASE_URL) {
    console.error("Refusing: DATABASE_URL not set.")
    process.exit(1)
  }
  const outDir = resolve(args[0] || join("backups", `progression-pre-v4-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`))
  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    console.error(`Refusing: ${outDir} is not empty — a stale manifest.json could mask an incomplete rerun. Choose a fresh directory.`)
    process.exit(1)
  }
  mkdirSync(outDir, { recursive: true })

  console.log(`Progression backup → ${outDir}`)
  console.log(`Target: ${JSON.stringify(dbIdentity(process.env.DATABASE_URL))}`)
  console.log("Snapshot: single REPEATABLE READ transaction")

  const manifest: Record<string, { file: string; rows: number; sha256: string }> = {}
  await prisma.$transaction(
    async (tx) => {
      const run = async (name: string, meta: { file: string; rows: number; sha256: string }) => {
        manifest[name] = meta
        console.log(`  ${name}: ${meta.rows} rows`)
      }

      await run("progressionEvent", await exportTable(
        "progressionEvent", byId(tx.progressionEvent as never), (r) => r.id as string, outDir,
      ))
      await run("reputationEvent", await exportTable(
        "reputationEvent", byId(tx.reputationEvent as never), (r) => r.id as string, outDir,
      ))
      await run("masteryProgress", await exportTable(
        "masteryProgress",
        (c: { userId: string; mastery: string } | undefined) => masteryPage(tx, c),
        (r) => ({ userId: r.userId as string, mastery: r.mastery as string }),
        outDir,
      ))
      await run("userBadge", await exportTable(
        "userBadge", byId(tx.userBadge as never), (r) => r.id as string, outDir,
      ))
      await run("userAchievement", await exportTable(
        "userAchievement", byId(tx.userAchievement as never), (r) => r.id as string, outDir,
      ))

      // Profile progress columns only — every field a reset would touch,
      // including unlockFrozen.
      const profileSelect = { id: true, userId: true, username: true, xp: true, standing: true, reputation: true, legacyVerified: true, unlockFrozen: true } as const
      await run("profile-progress", await exportTable(
        "profile-progress",
        (c: string | undefined) =>
          tx.profile.findMany({
            take: BATCH,
            orderBy: { id: "asc" },
            ...(c ? { where: { id: { gt: c } } } : {}),
            select: profileSelect,
          }) as Promise<Row[]>,
        (r) => r.id as string,
        outDir,
      ))
    },
    {
      timeout: 300_000,
      maxWait: 15_000,
      // Explicit snapshot isolation — READ COMMITTED would let each page
      // see a different committed state mid-export.
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    },
  )

  // Manifest LAST — its presence is what makes the backup valid.
  writeFileSync(
    join(outDir, "manifest.json"),
    JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        database: dbIdentity(process.env.DATABASE_URL!),
        snapshot: "repeatable-read-single-transaction",
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
