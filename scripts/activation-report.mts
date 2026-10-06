// activation-report — read-only aggregate activation funnel.
//
//   npx tsx scripts/activation-report.mts [days=30]
//
// Prints counts/percentages only (no ids, usernames, or content). Reads
// the database configured in DATABASE_URL; it never writes. For
// production numbers without DB access, staff can call
// GET /api/admin/activation?days=30 — the same activationReport().
// Associations reported here are observational, never causal.
import { prisma } from "@/lib/prisma"
import { activationReport } from "@/lib/activation"

const days = Number(process.argv[2] ?? 30)
const r = await activationReport([7, 30, 90].includes(days) ? days : 30)

console.log(`Activation — members who joined in the last ${r.windowDays}d (cohort ${r.cohort}${r.truncated ? ", truncated" : ""})\n`)
for (const s of r.steps) console.log(`  ${s.label.padEnd(30)} ${String(s.count).padStart(5)}  ${s.pctOfSignups}%`)
console.log("\nStep conversions")
for (const c of r.conversions) console.log(`  ${`${c.from} → ${c.to}`.padEnd(44)} ${c.numerator}/${c.denominator}  ${c.pct ?? "—"}%`)
console.log("\nReturn rate by first contribution (association only)")
for (const k of r.returnByFirstAction) console.log(`  ${k.kind.padEnd(10)} ${k.returned}/${k.members}  ${k.pct ?? "—"}%`)
console.log("\nReturn rate by push (association only)")
for (const p of r.returnByPush) console.log(`  push ${p.pushEnabled ? "on " : "off"}  ${p.returned}/${p.members}  ${p.pct ?? "—"}%`)
console.log("\nPush lifecycle", JSON.stringify(r.push))
await prisma.$disconnect()
