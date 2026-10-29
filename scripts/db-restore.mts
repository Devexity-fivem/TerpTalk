/**
 * Restore a JSONL export (from scripts/db-export.mts) into a target database.
 *
 * Expects the target schema to already exist (`prisma migrate deploy` first).
 * Foreign keys are bypassed during load via session_replication_role=replica
 * so row order doesn't matter; conflicts on unique keys are skipped so an
 * already-live target can be merged into safely.
 *
 * Usage:
 *   TARGET_DATABASE_URL=<dest> npx tsx scripts/db-restore.mts <exportDir>
 */
import { existsSync, readdirSync, createReadStream, readFileSync } from "fs"
import { join, resolve } from "path"
import { createInterface } from "readline"
import { PrismaClient } from "@prisma/client"

const dir = resolve(process.argv[2] || "")
if (!dir || !existsSync(dir)) {
  console.error("Usage: TARGET_DATABASE_URL=<dest> npx tsx scripts/db-restore.mts <exportDir>")
  process.exit(1)
}

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.TARGET_DATABASE_URL } },
})

const delegateName = (m: string) => m[0].toLowerCase() + m.slice(1)

type CreateManyDelegate = {
  createMany?: (args: { data: unknown[]; skipDuplicates?: boolean }) => Promise<{ count: number }>
}
const delegates = prisma as unknown as Record<string, CreateManyDelegate>

const manifestPath = join(dir, "manifest.json")
const manifest = existsSync(manifestPath)
  ? (JSON.parse(readFileSync(manifestPath, "utf8")).models as Record<string, number>)
  : {}

const files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
if (!files.length) {
  console.error(`No .jsonl files in ${dir}`)
  process.exit(1)
}

// Disable FK + trigger checks for the bulk load (Supabase postgres role supports this)
await prisma.$executeRawUnsafe("SET session_replication_role = 'replica'")

const results: Record<string, { loaded: number; expected?: number }> = {}

try {
  for (const file of files) {
    const model = file.replace(/\.jsonl$/, "")
    const delegate = delegates[delegateName(model)]
    if (!delegate?.createMany) {
      console.warn(`skip ${model}: no delegate`)
      continue
    }
    const createMany = delegate.createMany
    const rl = createInterface({ input: createReadStream(join(dir, file)) })
    let batch: unknown[] = []
    let loaded = 0
    const flush = async () => {
      if (!batch.length) return
      const res = await createMany({ data: batch, skipDuplicates: true })
      loaded += res.count
      batch = []
    }
    for await (const line of rl) {
      if (!line.trim()) continue
      batch.push(JSON.parse(line))
      if (batch.length >= 1000) await flush()
    }
    await flush()
    results[model] = { loaded, expected: manifest[model] }
    const flag = manifest[model] !== undefined && loaded < manifest[model] ? "  <-- fewer than export (dupes skipped?)" : ""
    console.log(`${model}: ${loaded} rows${flag}`)
  }
} finally {
  await prisma.$executeRawUnsafe("SET session_replication_role = 'origin'")
}

console.log("\nRestore complete.")
await prisma.$disconnect()
