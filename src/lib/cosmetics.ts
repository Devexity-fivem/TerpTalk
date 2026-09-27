// Cosmetic reward registry — Prisma-free so client components can render
// frames/titles/themes without pulling PrismaClient into the bundle.
//
// Every cosmetic is unlocked purely by progression XP (unlockedAt = a V2
// rank-rung XP threshold). The database stores only the equipped key on
// Profile — the registry owns the visuals. Equipping a locked cosmetic is
// rejected server-side in PATCH /api/profile.

import { rankDisplay } from "@/lib/progression-config"

export interface CosmeticDef {
  key: string
  name: string
  description: string
  unlockedAt: number // XP threshold (V2 rank rung)
}

// ─── Avatar frames ───────────────────────────────────────────────────
// `className` is applied as a ring/border wrapper around the Avatar.
export interface AvatarFrameDef extends CosmeticDef {
  className: string
}

export const AVATAR_FRAMES: AvatarFrameDef[] = [
  { key: "seed-shell", name: "Seed Shell", description: "Cracked open — your grow has begun.", unlockedAt: 60, className: "ring-2 ring-stone-400/70" },
  { key: "sprout-ring", name: "Sprout Ring", description: "A fresh green ring for a grow that's underway.", unlockedAt: 180, className: "ring-2 ring-green-500/70" },
  { key: "seedling-loop", name: "Seedling Loop", description: "Two leaves and a dream.", unlockedAt: 420, className: "ring-2 ring-lime-500/80" },
  { key: "rooted-band", name: "Rooted Band", description: "Earthy amber — roots take hold.", unlockedAt: 900, className: "ring-2 ring-amber-600/80" },
  { key: "canopy-weave", name: "Canopy Weave", description: "An even canopy, earned in veg.", unlockedAt: 1600, className: "ring-2 ring-emerald-600/80" },
  { key: "greenhouse-glow", name: "Greenhouse Glow", description: "Warm emerald light through the glass.", unlockedAt: 2600, className: "ring-2 ring-emerald-400/90 shadow-[0_0_10px_-2px_rgba(52,211,153,0.5)]" },
  { key: "photon-pulse", name: "Photon Pulse", description: "An animated grow-light heartbeat.", unlockedAt: 4000, className: "tt-frame-pulse ring-2 ring-fuchsia-400/80" },
  { key: "led-bloom", name: "LED Bloom", description: "That pink-purple grow-light glow.", unlockedAt: 5800, className: "ring-2 ring-fuchsia-400/80 shadow-[0_0_12px_-2px_rgba(232,121,249,0.45)]" },
  { key: "pistil-fire", name: "Pistil Fire", description: "Orange hairs in full flower.", unlockedAt: 7500, className: "ring-2 ring-orange-500/90 shadow-[0_0_12px_-2px_rgba(249,115,22,0.5)]" },
  { key: "amber-jar", name: "Amber Jar", description: "Deep cured amber, settled and rich.", unlockedAt: 12000, className: "ring-[3px] ring-amber-400/90 shadow-[0_0_14px_-2px_rgba(251,191,36,0.55)]" },
  { key: "rosin-ring", name: "Rosin Ring", description: "Pressed gold — a legendary finish.", unlockedAt: 17000, className: "ring-4 ring-yellow-300/90 shadow-[0_0_16px_-2px_rgba(253,224,71,0.6)]" },
  { key: "northern-lights", name: "Northern Lights", description: "An animated aurora only the garden's oldest hands ever see.", unlockedAt: 23000, className: "tt-frame-aurora ring-4 ring-sky-300/80" },
]

// ─── Custom titles ───────────────────────────────────────────────────
// Preset allowlist — members pick, never free-type.
export const PROFILE_TITLES: CosmeticDef[] = [
  { key: "first-timer", name: "First Timer", description: "Everyone starts with bagseed.", unlockedAt: 420 },
  { key: "window-sill", name: "Window Sill Warrior", description: "Sunlight is a strategy.", unlockedAt: 420 },
  { key: "home-grower", name: "Home Grower", description: "Roots down, tents up.", unlockedAt: 900 },
  { key: "tent-tender", name: "Tent Tender", description: "Keeps the girls happy.", unlockedAt: 900 },
  { key: "micro-grower", name: "Micro Grower", description: "Big results, small space.", unlockedAt: 900 },
  { key: "clone-keeper", name: "Clone Keeper", description: "Keeps the mothers happy.", unlockedAt: 1600 },
  { key: "pheno-hunter", name: "Pheno Hunter", description: "Always chasing the keeper cut.", unlockedAt: 2600 },
  { key: "trichome-farmer", name: "Trichome Farmer", description: "Farming frost, one cola at a time.", unlockedAt: 2600 },
  { key: "bud-tender", name: "Bud Tender", description: "Tends buds like a barkeep tends taps.", unlockedAt: 2600 },
  { key: "bud-whisperer", name: "Bud Whisperer", description: "The plants lean in when you talk.", unlockedAt: 4000 },
  { key: "terp-hunter", name: "Terp Hunter", description: "Follows the nose every time.", unlockedAt: 4000 },
  { key: "hydro-head", name: "Hydro Head", description: "Roots in water, head in the clouds.", unlockedAt: 5800 },
  { key: "living-soil-grower", name: "Living Soil Grower", description: "Feeds the soil, not the plant.", unlockedAt: 5800 },
  { key: "canopy-keeper", name: "Canopy Keeper", description: "An even canopy is a happy canopy.", unlockedAt: 5800 },
  { key: "pheno-whisperer", name: "Pheno Whisperer", description: "Knows the keeper before it flowers.", unlockedAt: 7500 },
  { key: "rosin-presser", name: "Rosin Presser", description: "Heat, pressure, patience.", unlockedAt: 7500 },
  { key: "garden-sage", name: "Garden Sage", description: "Answers before the question finishes.", unlockedAt: 12000 },
  { key: "head-cultivator", name: "Head Cultivator", description: "Runs the whole grow.", unlockedAt: 12000 },
  { key: "terp-sommelier", name: "Terp Sommelier", description: "Swirls the jar before the grind.", unlockedAt: 17000 },
  { key: "hash-craftsman", name: "Hash Craftsman", description: "From trichome to temple ball.", unlockedAt: 17000 },
  { key: "master-gardener", name: "Master Gardener", description: "The garden's oldest hand.", unlockedAt: 23000 },
]

// ─── Profile card themes ─────────────────────────────────────────────
// Accent treatment on the profile header card — never touches the global
// data-theme (site light/dark stays user-controlled).
export interface ProfileThemeDef extends CosmeticDef {
  className: string // extra classes on the header card
  borderClass: string // border/accent color
}

export const PROFILE_THEMES: ProfileThemeDef[] = [
  { key: "dawn-patrol", name: "Dawn Patrol", description: "First light over the garden.", unlockedAt: 1600, className: "", borderClass: "border-lime-400/60" },
  { key: "evergreen", name: "Evergreen", description: "Deep garden green.", unlockedAt: 2600, className: "", borderClass: "border-emerald-500/50" },
  { key: "ultraviolet", name: "Ultraviolet", description: "Full-spectrum bloom light.", unlockedAt: 4000, className: "", borderClass: "border-fuchsia-500/60" },
  { key: "golden-hour", name: "Golden Hour", description: "Late-day amber over the canopy.", unlockedAt: 5800, className: "", borderClass: "border-amber-500/60" },
  { key: "midnight-garden", name: "Midnight Garden", description: "Lights off, garden glowing violet.", unlockedAt: 7500, className: "", borderClass: "border-violet-500/60" },
  { key: "deep-water", name: "Deep Water", description: "Cool hydro blue.", unlockedAt: 12000, className: "", borderClass: "border-cyan-400/60" },
  { key: "amber-cure", name: "Amber Cure", description: "Cured-jar amber with a warm glow.", unlockedAt: 17000, className: "shadow-[0_0_24px_-6px_rgba(251,191,36,0.35)]", borderClass: "border-amber-400/70" },
  { key: "deity-glow", name: "Aurora Crown", description: "A soft aurora for a true master gardener.", unlockedAt: 23000, className: "shadow-[0_0_28px_-6px_rgba(125,211,252,0.45)]", borderClass: "border-sky-300/70" },
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

// Everything a member at this XP may equip.
export function unlockedCosmetics(xp: number): UnlockedCosmetics {
  return {
    frames: AVATAR_FRAMES.filter((f) => xp >= f.unlockedAt),
    titles: PROFILE_TITLES.filter((t) => xp >= t.unlockedAt),
    themes: PROFILE_THEMES.filter((t) => xp >= t.unlockedAt),
  }
}

// Validates an equip request: null clears, otherwise the key must be
// unlocked at the member's current XP.
export function canEquip(xp: number, kind: keyof UnlockedCosmetics, key: string | null): boolean {
  if (key === null) return true
  return unlockedCosmetics(xp)[kind].some((c) => c.key === key)
}

// The rank name a cosmetic first unlocks at — for "unlocks at X rank" copy.
export function unlockTierName(unlockedAt: number): string {
  return rankDisplay(unlockedAt).name
}

// Flat list helpers used by milestone metadata — a single ordered view
// across all three cosmetic kinds.
export interface FlatCosmetic extends CosmeticDef {
  kind: "frame" | "title" | "theme"
}

const ALL_COSMETICS: FlatCosmetic[] = [
  ...AVATAR_FRAMES.map((c) => ({ ...c, kind: "frame" as const })),
  ...PROFILE_TITLES.map((c) => ({ ...c, kind: "title" as const })),
  ...PROFILE_THEMES.map((c) => ({ ...c, kind: "theme" as const })),
].sort((a, b) => a.unlockedAt - b.unlockedAt)

// The first cosmetic still locked at this XP — "your next reward".
export function nextLockedCosmetic(xp: number): FlatCosmetic | null {
  return ALL_COSMETICS.find((c) => c.unlockedAt > xp) ?? null
}

// Everything an XP gain of (oldXp, newXp] just unlocked.
export function cosmeticsUnlockedBetween(oldXp: number, newXp: number): FlatCosmetic[] {
  return ALL_COSMETICS.filter((c) => c.unlockedAt > oldXp && c.unlockedAt <= newXp)
}
