/**
 * Database backup script.
 * - SQLite: copies dev.db to backups/dev-YYYYMMDD-HHmmss.db
 * - PostgreSQL: runs pg_dump if available (requires pg_dump on PATH and DATABASE_URL set)
 * Usage: npm run backup
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync, unlinkSync, readFileSync } from "fs"
import { join, resolve } from "path"
import { execSync } from "child_process"

// Load .env manually (no dotenv dependency)
const envPath = resolve(__dirname, "..", ".env")
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/i)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

const ROOT = resolve(__dirname, "..")
const BACKUP_DIR = join(ROOT, "backups")
const RETENTION_DAYS = 30

const dbUrl = process.env.DATABASE_URL || ""
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)

if (!existsSync(BACKUP_DIR)) mkdirSync(BACKUP_DIR, { recursive: true })

if (dbUrl.startsWith("file:")) {
  // SQLite file backup
  const rel = dbUrl.replace("file:", "")
  const dbPath = join(ROOT, "prisma", rel)
  if (!existsSync(dbPath)) {
    console.error(`Database file not found: ${dbPath}`)
    process.exit(1)
  }
  const dest = join(BACKUP_DIR, `dev-${stamp}.db`)
  copyFileSync(dbPath, dest)
  console.log(`Backup created: ${dest}`)
} else if (dbUrl.startsWith("postgres")) {
  // PostgreSQL backup via pg_dump
  const dest = join(BACKUP_DIR, `pg-${stamp}.dump`)
  try {
    execSync(`pg_dump "${dbUrl}" -F c -f "${dest}"`, { stdio: "inherit" })
    console.log(`Backup created: ${dest}`)
  } catch {
    console.error("pg_dump failed. Ensure pg_dump is installed and on PATH.")
    process.exit(1)
  }
} else {
  console.error("Unsupported DATABASE_URL scheme for backup.")
  process.exit(1)
}

// Retention: delete backups older than RETENTION_DAYS
const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
for (const f of readdirSync(BACKUP_DIR)) {
  const p = join(BACKUP_DIR, f)
  if (statSync(p).mtimeMs < cutoff) {
    unlinkSync(p)
    console.log(`Pruned old backup: ${f}`)
  }
}
