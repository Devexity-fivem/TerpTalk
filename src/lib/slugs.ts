// Canonical entity slugs + URL builders.
//
// A slug is generated once when a diary/strain/setup is created (or by the
// entity_slugs migration backfill) and never regenerated on rename — the
// URL stays stable while the display title can change. The trailing
// id-derived suffix guarantees uniqueness without a lookup, and makes
// slugs self-distinguishing from legacy cuid URLs: cuids never contain
// "-", slugs always do.
import { slugify } from "@/lib/affiliate"

export function entitySlug(title: string, id: string, fallback: string): string {
  // slugify already trims edge dashes and caps at 60 chars, but the cap can
  // reintroduce a trailing dash — trim again so the suffix never lands on
  // a bare "-". Empty bases (all-punctuation/emoji titles) get a noun.
  const base = slugify(title).replace(/^-+|-+$/g, "") || fallback
  return `${base}-${id.slice(-6).toLowerCase()}`
}

export const diaryPath = (d: { id: string; slug?: string | null }) => `/diaries/${d.slug ?? d.id}`
export const strainPath = (s: { id: string; slug?: string | null }) => `/strains/${s.slug ?? s.id}`
export const setupPath = (s: { id: string; slug?: string | null }) => `/setups/${s.slug ?? s.id}`
