#!/usr/bin/env tsx
/**
 * Targeted backup of all progress-derived tables before the V3 reset.
 *
 * Usage:
 *   DATABASE_URL=<conn> npx tsx scripts/backup-progression.mts [outDir]
 *
 * Default outDir: backups/progression-pre-v3-<ts>/
 * Writes <table>.jsonl per table + manifest.json with row counts.
 * This is the restore point for the production rep/XP wipe — do not delete.
 */
import { writeFileSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { PrismaClient } from "@prisma/client"

const prisma = new PrismaClient()
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const outDir = resolve(process.argv[2] || join("backups", `progression-pre-v3-${stamp}`))
mkdirSync(outDir, { recursive: true })

// Every table the V3 reset touches — the complete progress state.
const TABLES = [
  ["progressionEvent", () => prisma.progressionEvent.findMany()],
  ["reputationEvent", () => prisma.reputationEvent.findMany()],
  ["masteryProgress", () => prisma.masteryProgress.findMany()],
  // Grants, not definitions — Badge/Achievement rows are the catalog.
  ["userBadge", () => prisma.userBadge.findMany()],
  ["userAchievement", () => prisma.userAchievement.findMany()],
  // Profile progress columns only — not the whole profile row.
  ["profile-progress", async () =>
    prisma.profile.findMany({
      select: { id: true, userId: true, username: true, xp: true, standing: true, reputation: true, legacyVerified: true },
    })],
] as const

async function main() {
  const manifest: Record<string, number> = {}
  for (const [name, fn] of TABLES) {
    const rows = await fn() as unknown[]
    writeFileSync(join(outDir, `${name}.jsonl`), rows.map((r) => JSON.stringify(r)).join("\n"))
    manifest[name] = rows.length
    console.log(`  ${name}: ${rows.length} rows`)
  }
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ exportedAt: new Date().toISOString(), tables: manifest }, null, 2))
  console.log(`\nBackup written to ${outDir}`)
}

main().finally(() => prisma.$disconnect())
