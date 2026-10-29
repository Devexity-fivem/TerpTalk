/**
 * Data-only export of every Prisma model to JSONL files.
 *
 * Used for the Neon -> Supabase migration. Exports DATA only — the target
 * schema is created by `prisma migrate deploy`, not by this dump.
 *
 * Usage:
 *   DATABASE_URL=<source> npx tsx scripts/db-export.mts [outDir]
 *
 * Default outDir: backups/export-YYYYMMDD-HHmmss/
 * Writes one <Model>.jsonl per model plus a manifest.json with row counts.
 */
import { existsSync, mkdirSync, createWriteStream, writeFileSync } from "fs"
import { join, resolve } from "path"
import { PrismaClient, Prisma } from "@prisma/client"

const BATCH = 5000
const prisma = new PrismaClient()

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
const outDir = resolve(process.argv[2] || join("backups", `export-${stamp}`))
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })

// Prisma delegate name: model name with lowercase first letter (User -> user)
const delegateName = (m: string) => m[0].toLowerCase() + m.slice(1)

// Pick a unique field for cursor pagination: the @id field, else first
// single-field unique. Composite PKs (primaryKey) return null -> offset paging.
const cursorField = (model: (typeof Prisma.dmmf.datamodel.models)[number]) => {
  if (model.primaryKey) return null
  const id = model.fields.find((f) => f.isId)
  if (id) return id.name
  const uniq = model.uniqueFields?.find((u) => u.length === 1)
  return uniq ? uniq[0] : null
}

const manifest: Record<string, number> = {}

type FindManyDelegate = {
  findMany?: (args: Record<string, unknown>) => Promise<Record<string, unknown>[]>
}
const delegates = prisma as unknown as Record<string, FindManyDelegate>

for (const model of Prisma.dmmf.datamodel.models) {
  const delegate = delegates[delegateName(model.name)]
  if (!delegate?.findMany) {
    console.warn(`skip ${model.name}: no delegate`)
    continue
  }
  const file = createWriteStream(join(outDir, `${model.name}.jsonl`))
  const cursor = cursorField(model)
  let count = 0
  let cursorVal: unknown = undefined

  for (;;) {
    const args: Record<string, unknown> = { take: BATCH }
    if (cursor) {
      args.orderBy = { [cursor]: "asc" }
      if (cursorVal !== undefined) {
        args.cursor = { [cursor]: cursorVal }
        args.skip = 1
      }
    } else {
      args.skip = count
    }
    const rows = await delegate.findMany(args)
    if (!rows.length) break
    for (const r of rows) file.write(JSON.stringify(r) + "\n")
    count += rows.length
    if (rows.length < BATCH) break
    if (cursor) cursorVal = rows[rows.length - 1][cursor]
  }
  await new Promise((r) => file.end(r))
  manifest[model.name] = count
  console.log(`${model.name}: ${count}`)
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ exportedAt: stamp, models: manifest }, null, 2))
console.log(`\nExport complete -> ${outDir}`)
await prisma.$disconnect()
