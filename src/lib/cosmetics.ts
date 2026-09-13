// Cosmetic reward registry — Prisma-free so client components can render
// frames/titles/themes without pulling PrismaClient into the bundle.
//
// Every cosmetic is unlocked purely by reputation tier (unlockedAt = rep
// threshold). The database stores only the equipped key on Profile — the
// registry owns the visuals. Equipping a locked cosmetic is rejected
// server-side in PATCH /api/profile.

import { getReputationTier } from "@/lib/reputation-config"

export interface CosmeticDef {
  key: string
  name: string
  description: string
  unlockedAt: number // reputation threshold
}

// ─── Avatar frames ───────────────────────────────────────────────────
// `className` is applied as a ring/border wrapper around the Avatar.
export interface AvatarFrameDef extends CosmeticDef {
  className: string
}

export const AVATAR_FRAMES: AvatarFrameDef[] = [
  { key: "sprout-ring", name: "Sprout Ring", description: "A fresh green ring for a grow that's underway.", unlockedAt: 250, className: "ring-2 ring-green-500/70" },
  { key: "rooted-band", name: "Rooted Band", description: "Earthy amber — roots take hold.", unlockedAt: 750, className: "ring-2 ring-amber-600/80" },
  { key: "greenhouse-glow", name: "Greenhouse Glow", description: "Warm emerald light through the glass.", unlockedAt: 1500, className: "ring-2 ring-emerald-400/90 shadow-[0_0_10px_-2px_rgba(52,211,153,0.5)]" },
  { key: "led-bloom", name: "LED Bloom", description: "That pink-purple grow-light glow.", unlockedAt: 3500, className: "ring-2 ring-fuchsia-400/80 shadow-[0_0_12px_-2px_rgba(232,121,249,0.45)]" },
  { key: "pistil-fire", name: "Pistil Fire", description: "Orange hairs in full flower.", unlockedAt: 7000, className: "ring-2 ring-orange-500/90 shadow-[0_0_12px_-2px_rgba(249,115,22,0.5)]" },
  { key: "amber-jar", name: "Amber Jar", description: "Deep cured amber, settled and rich.", unlockedAt: 15000, className: "ring-[3px] ring-amber-400/90 shadow-[0_0_14px_-2px_rgba(251,191,36,0.55)]" },
  { key: "rosin-ring", name: "Rosin Ring", description: "Pressed gold — a legendary finish.", unlockedAt: 40000, className: "ring-4 ring-yellow-300/90 shadow-[0_0_16px_-2px_rgba(253,224,71,0.6)]" },
  { key: "northern-lights", name: "Northern Lights", description: "An aurora only the garden's oldest hands ever see.", unlockedAt: 100000, className: "ring-4 shadow-[0_0_18px_-2px_rgba(125,211,252,0.7)] ring-sky-300/80 [box-shadow:0_0_18px_-2px_rgba(125,211,252,0.7),0_0_10px_-4px_rgba(196,181,253,0.8)]" },
]

// ─── Custom titles ───────────────────────────────────────────────────
// Preset allowlist — members pick, never free-type.
export const PROFILE_TITLES: CosmeticDef[] = [
  { key: "home-grower", name: "Home Grower", description: "Roots down, tents up.", unlockedAt: 750 },
  { key: "tent-tender", name: "Tent Tender", description: "Keeps the girls happy.", unlockedAt: 750 },
  { key: "micro-grower", name: "Micro Grower", description: "Big results, small space.", unlockedAt: 750 },
  { key: "pheno-hunter", name: "Pheno Hunter", description: "Always chasing the keeper cut.", unlockedAt: 1500 },
  { key: "trichome-farmer", name: "Trichome Farmer", description: "Farming frost, one cola at a time.", unlockedAt: 1500 },
  { key: "bud-tender", name: "Bud Tender", description: "Tends buds like a barkeep tends taps.", unlockedAt: 1500 },
  { key: "hydro-head", name: "Hydro Head", description: "Roots in water, head in the clouds.", unlockedAt: 3500 },
  { key: "living-soil-grower", name: "Living Soil Grower", description: "Feeds the soil, not the plant.", unlockedAt: 3500 },
  { key: "canopy-keeper", name: "Canopy Keeper", description: "An even canopy is a happy canopy.", unlockedAt: 3500 },
  { key: "pheno-whisperer", name: "Pheno Whisperer", description: "Knows the keeper before it flowers.", unlockedAt: 7000 },
  { key: "rosin-presser", name: "Rosin Presser", description: "Heat, pressure, patience.", unlockedAt: 7000 },
  { key: "garden-sage", name: "Garden Sage", description: "Answers before the question finishes.", unlockedAt: 15000 },
  { key: "head-cultivator", name: "Head Cultivator", description: "Runs the whole grow.", unlockedAt: 15000 },
  { key: "terp-sommelier", name: "Terp Sommelier", description: "Swirls the jar before the grind.", unlockedAt: 40000 },
  { key: "hash-craftsman", name: "Hash Craftsman", description: "From trichome to temple ball.", unlockedAt: 40000 },
  { key: "garden-legend", name: "Garden Legend", description: "The garden's oldest hand.", unlockedAt: 100000 },
]

// ─── Profile card themes ─────────────────────────────────────────────
// Accent treatment on the profile header card — never touches the global
// data-theme (site light/dark stays user-controlled).
export interface ProfileThemeDef extends CosmeticDef {
  className: string // extra classes on the header card
  borderClass: string // border/accent color
}

export const PROFILE_THEMES: ProfileThemeDef[] = [
  { key: "evergreen", name: "Evergreen", description: "Deep garden green.", unlockedAt: 1500, className: "", borderClass: "border-emerald-500/50" },
  { key: "golden-hour", name: "Golden Hour", description: "Late-day amber over the canopy.", unlockedAt: 3500, className: "", borderClass: "border-amber-500/60" },
  { key: "midnight-garden", name: "Midnight Garden", description: "Lights off, garden glowing violet.", unlockedAt: 7000, className: "", borderClass: "border-violet-500/60" },
  { key: "deep-water", name: "Deep Water", description: "Cool hydro blue.", unlockedAt: 15000, className: "", borderClass: "border-cyan-400/60" },
  { key: "amber-cure", name: "Amber Cure", description: "Cured-jar amber with a warm glow.", unlockedAt: 40000, className: "shadow-[0_0_24px_-6px_rgba(251,191,36,0.35)]", borderClass: "border-amber-400/70" },
  { key: "deity-glow", name: "Deity Glow", description: "A soft aurora for a true cannabis deity.", unlockedAt: 100000, className: "shadow-[0_0_28px_-6px_rgba(125,211,252,0.45)]", borderClass: "border-sky-300/70" },
]

// ─── Lookup helpers ──────────────────────────────────────────────────

export function getAvatarFrame(key: string | null | undefined): AvatarFrameDef | null {
  return AVATAR_FRAMES.find((f) => f.key === key) ?? null
}

export function getProfileTitle(key: string | null | undefined): CosmeticDef | null {
  return PROFILE_TITLES.find((t) => t.key === key) ?? null
}

export function getProfileTheme(key: string | null | undefined): ProfileThemeDef | null {
  return PROFILE_THEMES.find((t) => t.key === key) ?? null
}

export interface UnlockedCosmetics {
  frames: AvatarFrameDef[]
  titles: CosmeticDef[]
  themes: ProfileThemeDef[]
}

// Everything a member at this reputation may equip.
export function unlockedCosmetics(reputation: number): UnlockedCosmetics {
  return {
    frames: AVATAR_FRAMES.filter((f) => reputation >= f.unlockedAt),
    titles: PROFILE_TITLES.filter((t) => reputation >= t.unlockedAt),
    themes: PROFILE_THEMES.filter((t) => reputation >= t.unlockedAt),
  }
}

// Validates an equip request: null clears, otherwise the key must be
// unlocked at the member's current reputation.
export function canEquip(reputation: number, kind: keyof UnlockedCosmetics, key: string | null): boolean {
  if (key === null) return true
  return unlockedCosmetics(reputation)[kind].some((c) => c.key === key)
}

// The tier name a cosmetic first unlocks at — for "unlocks at X tier" copy.
export function unlockTierName(unlockedAt: number): string {
  return getReputationTier(unlockedAt).name
}
