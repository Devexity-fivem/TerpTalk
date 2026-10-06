// backfill-diary-strain — Knowledge Compounding legacy mapping.
//
// Links GrowDiary.strain (free text) → GrowDiary.strainId (canonical
// Strain) using ONLY normalized-exact unique matching: the diary's text,
// normalized (lowercase, punctuation stripped), must equal exactly one
// catalog strain's normalized name. Anything else is left untouched —
// no fuzzy, no guessing, no prefix rules.
//
// Deterministic and idempotent: only rows with strainId = NULL are
// examined, so re-runs never re-touch already-linked diaries. Free-text
// `strain` is always preserved (it remains the display/fallback value).
//
//   npx tsx scripts/backfill-diary-strain.mts          # apply
//   npx tsx scripts/backfill-diary-strain.mts --dry    # report only
import "./db-guard.mjs"
import { prisma } from "@/lib/prisma"
import { normalizeStrain } from "@/lib/strain-stats"

const DRY = process.argv.includes("--dry")

async function main() {
  const [diaries, strains] = await Promise.all([
    prisma.growDiary.findMany({
      where: { strainId: null, strain: { not: null } },
      select: { id: true, strain: true },
    }),
    prisma.strain.findMany({ select: { id: true, name: true } }),
  ])

  // Unique normalized catalog names — a name shared by two catalog rows
  // can never be a safe link target.
  const byNorm = new Map<string, { id: string; name: string }[]>()
  for (const s of strains) {
    const n = normalizeStrain(s.name)
    if (!n) continue
    const arr = byNorm.get(n) ?? []
    arr.push(s)
    byNorm.set(n, arr)
  }

  let mapped = 0
  let unmatched = 0
  let ambiguous = 0
  let blank = 0
  const applied: { id: string; strain: string; to: string }[] = []

  for (const d of diaries) {
    const n = normalizeStrain(d.strain ?? "")
    if (!n) {
      blank++
      continue
    }
    const hits = byNorm.get(n) ?? []
    if (hits.length === 0) {
      unmatched++
      continue
    }
    if (hits.length > 1) {
      ambiguous++
      continue
    }
    mapped++
    applied.push({ id: d.id, strain: d.strain!, to: hits[0].name })
    if (!DRY) {
      await prisma.growDiary.update({ where: { id: d.id }, data: { strainId: hits[0].id } })
    }
  }

  console.log(`mode=${DRY ? "DRY" : "APPLY"}`)
  console.log(`examined=${diaries.length} mapped=${mapped} unmatched=${unmatched} ambiguous=${ambiguous} blank=${blank}`)
  for (const a of applied.slice(0, 25)) console.log(`  ${a.id}: "${a.strain}" -> ${a.to}`)
  if (applied.length > 25) console.log(`  ... +${applied.length - 25} more`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
