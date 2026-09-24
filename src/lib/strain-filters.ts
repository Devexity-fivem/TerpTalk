// Server-side strain catalog filtering — the where-builder the /strains
// index uses, extracted so the filter semantics are testable against real
// rows (scripts/discovery-integration-tests.mts) instead of living inside
// a page component.
//
// Every facet is optional and bounded; unknown values are dropped by the
// page before this is called, and vocab filters only ever match reported
// data — a strain with no THC data never matches a THC band.

import { STRAIN_TYPES, STRAIN_EFFECTS, STRAIN_FLAVORS, type StrainDifficulty } from "@/lib/strain-fields"
import { escapeLike } from "@/lib/strain-stats"

export interface StrainFilters {
  q: string
  type: string
  effect: string
  flavor: string
  difficulty: StrainDifficulty | null
  /** THC band key: low | mid | high | ultra */
  thc: string
  /** Flowering band key: fast | mid | long */
  flower: string
  breeder: string
  page: number
}

// THC bands — a strain matches when its reported [thcMin, thcMax] range
// overlaps the band. One-sided reports count as a point range.
export const THC_BANDS = [
  { key: "low", label: "Under 15%", lo: 0, hi: 15 },
  { key: "mid", label: "15–20%", lo: 15, hi: 20 },
  { key: "high", label: "20–25%", lo: 20, hi: 25 },
  { key: "ultra", label: "25%+", lo: 25, hi: 45 },
] as const

export const FLOWER_BANDS = [
  { key: "fast", label: "≤ 8 weeks", max: 8 },
  { key: "mid", label: "9–10 weeks", min: 9, max: 10 },
  { key: "long", label: "11+ weeks", min: 11 },
] as const

export function strainWhere(f: StrainFilters) {
  const and: Record<string, unknown>[] = []
  if (f.q) {
    const contains = { contains: escapeLike(f.q), mode: "insensitive" as const }
    and.push({ OR: [{ name: contains }, { genetics: contains }, { breeder: contains }] })
  }
  if ((STRAIN_TYPES as readonly string[]).includes(f.type)) and.push({ type: { equals: f.type } })
  if ((STRAIN_EFFECTS as readonly string[]).includes(f.effect)) and.push({ effects: { has: f.effect } })
  if ((STRAIN_FLAVORS as readonly string[]).includes(f.flavor)) and.push({ flavors: { has: f.flavor } })
  if (f.difficulty) and.push({ difficulty: f.difficulty })
  if (f.breeder) and.push({ breeder: { equals: f.breeder, mode: "insensitive" } })

  const thc = THC_BANDS.find((b) => b.key === f.thc)
  if (thc) {
    // Range overlap: [min,max] vs [lo,hi]. A one-sided value acts as a point.
    and.push({ OR: [{ thcMin: { lte: thc.hi } }, { AND: [{ thcMin: null }, { thcMax: { lte: thc.hi } }] }] })
    and.push({ OR: [{ thcMax: { gte: thc.lo } }, { AND: [{ thcMax: null }, { thcMin: { gte: thc.lo } }] }] })
  }

  const flower = FLOWER_BANDS.find((b) => b.key === f.flower)
  if (flower) {
    const cond: Record<string, unknown> = {}
    if ("min" in flower) cond.gte = flower.min
    if ("max" in flower) cond.lte = flower.max
    and.push({ floweringWeeks: cond })
  }

  return and.length ? { AND: and } : {}
}
