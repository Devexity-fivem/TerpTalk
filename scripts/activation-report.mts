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

const s = r.social
const srcRow = (rows: { source: string; count: number }[]) =>
  rows.length ? rows.map((x) => `${x.source} ${x.count}`).join("  ") : "—"
console.log(`\nSocial loop — product events in the last ${s.windowDays}d${s.truncated ? " (truncated)" : ""}`)
console.log(`  follows                    ${s.follows}   by surface: ${srcRow(s.followsBySource)}`)
console.log(`  first follows              ${s.firstFollows}   by surface: ${srcRow(s.firstFollowBySource)}`)
console.log(`  followed-content viewers   ${s.followedContentViewers}   by surface: ${srcRow(s.followedContentViewsBySource)}`)
console.log(`  digest viewers             ${s.digestViewers}`)
console.log(`  interactions               ${s.interactions}   by surface: ${srcRow(s.interactionsBySource)}`)
console.log(`  followed-content interactors ${s.followedInteractors}   interaction rate: ${s.interactionRate ?? "—"}%`)
console.log(`  medians (h)  signup→1st-follow ${s.medianHoursSignupToFirstFollow ?? "—"}   1st-follow→interaction ${s.medianHoursFirstFollowToInteraction ?? "—"}   encounter→interaction ${s.medianHoursEncounterToInteraction ?? "—"}`)
await prisma.$disconnect()
