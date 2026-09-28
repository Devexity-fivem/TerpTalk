// Profile V2 (P2) — appearance preset metadata.
//
// The finite preset lists live in profile-settings.ts; this module holds the
// editor-facing labels/descriptions and the swatch colors used to preview a
// preset. The actual visual effect is applied by scoped CSS rules in
// globals.css keyed on data-paccent / data-ptheme / data-pdensity attributes
// set on the profile canvas — members can never inject CSS.

import type { ProfileAccent, ProfileDensity, ProfileTheme } from "./profile-settings"

export interface AccentMeta {
  id: ProfileAccent
  name: string
  description: string
  /** Representative swatch (light-context) for the editor picker. */
  swatch: string
}

export const ACCENT_META: readonly AccentMeta[] = [
  { id: "pine", name: "Pine", description: "The TerpTalk green — calm and botanical.", swatch: "#166552" },
  { id: "amber", name: "Amber", description: "Warm copper — trichome-adjacent.", swatch: "#b45309" },
  { id: "violet", name: "Violet", description: "Muted iris — a cool counterpoint.", swatch: "#6d5dd0" },
  { id: "slate", name: "Slate", description: "Blue-gray — quiet and technical.", swatch: "#475569" },
  { id: "ember", name: "Ember", description: "Deep orange — warm and earthy.", swatch: "#c2410c" },
] as const

export interface ThemeMeta {
  id: ProfileTheme
  name: string
  description: string
  /** Two swatches: card surface + accent sample for the picker preview. */
  swatch: string
  swatchAccent: string
}

export const THEME_META: readonly ThemeMeta[] = [
  { id: "default", name: "Default", description: "The TerpTalk look.", swatch: "#fdfdfc", swatchAccent: "#166552" },
  { id: "journal", name: "Journal", description: "Warm paper surfaces — a grower's notebook.", swatch: "#faf6ee", swatchAccent: "#b45309" },
  { id: "botanical", name: "Botanical", description: "Soft green-tinted surfaces.", swatch: "#f4f8f4", swatchAccent: "#166552" },
  { id: "growroom", name: "Growroom", description: "Deeper, cooler surfaces — lights off.", swatch: "#eef1f2", swatchAccent: "#475569" },
  { id: "data", name: "Data", description: "Cool neutral surfaces — crisp and technical.", swatch: "#f5f7f9", swatchAccent: "#6d5dd0" },
] as const

export const DENSITY_META: readonly { id: ProfileDensity; name: string; description: string }[] = [
  { id: "cozy", name: "Cozy", description: "Standard spacing — room to breathe." },
  { id: "compact", name: "Compact", description: "Tighter spacing — more on screen." },
] as const
