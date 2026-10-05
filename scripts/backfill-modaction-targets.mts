// One-time guarded repair for pre-S ModerationAction rows whose
// targetId/targetType are NULL because the action predates direct target
// identity (batch S). The same deletion was also recorded as a
// SUSPICIOUS_ACTIVITY SecurityEvent carrying
// { moderationAction, targetType, targetId, ... } in metadata, so an
// action row is repairable ONLY when exactly one matching SecurityEvent
// exists for the same actor, same action type, and adjacent timestamp.
// Logic lives in scripts/lib/backfill-modaction-targets.ts.
//
// --dry-run is the default; writing requires --apply.
//
// Usage:
//   tsx scripts/backfill-modaction-targets.mts            # dry run (dev DB)
//   tsx scripts/backfill-modaction-targets.mts --apply    # write (dev DB)
//   BACKFILL_DATABASE_URL=... ALLOW_PRODUCTION_DB_TESTS=1 \
//     tsx scripts/backfill-modaction-targets.mts --apply  # prod
import "./db-guard.mjs"
import { PrismaClient } from "@prisma/client"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { collectBackfillRows, applyBackfill, CONTENT_ACTION_TYPES } from "./lib/backfill-modaction-targets"

function resolveUrl(): string | undefined {
  if (process.env.BACKFILL_DATABASE_URL) return process.env.BACKFILL_DATABASE_URL
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  try {
    const envPath = fileURLToPath(new URL("../.env", import.meta.url))
    return readFileSync(envPath, "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"'\n]+)"?\s*$/m)?.[1]
  } catch {
    return undefined
  }
}

const apply = process.argv.includes("--apply")
const db = new PrismaClient({ datasources: { db: { url: resolveUrl() } } })
const before = await db.moderationAction.count({ where: { targetId: null, type: { in: [...CONTENT_ACTION_TYPES] } } })
const rows = await collectBackfillRows(db)
console.log(`mode=${apply ? "APPLY" : "DRY-RUN"} before(null targetId, content actions)=${before}`)
for (const r of rows) {
  console.log(
    `${r.status.padEnd(24)} action=${r.actionId} type=${r.actionType}` +
      (r.candidate ? ` -> targetType=${r.candidate.targetType} targetId=${r.candidate.targetId} via se=${r.candidate.securityEventId} Δ${r.candidate.deltaMs}ms` : "")
  )
}
const eligible = rows.filter((r) => r.status === "eligible")
console.log(`eligible=${eligible.length} skipped=${rows.length - eligible.length}`)
if (apply && eligible.length > 0) {
  const { written } = await applyBackfill(db, rows)
  const after = await db.moderationAction.count({ where: { targetId: null, type: { in: [...CONTENT_ACTION_TYPES] } } })
  console.log(`written=${written.length} after(null targetId)=${after}`)
}
await db.$disconnect()
