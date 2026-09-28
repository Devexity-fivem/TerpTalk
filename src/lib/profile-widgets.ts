// Profile V2 (P2) — the declarative profile widget registry.
//
// Members select a widgetId from this finite registry only — never arbitrary
// components, serialized functions, dynamic imports, or iframed content.
// Each spec declares its progression gate (unlockId) and where it renders.
// Widget ids double as section ids: they can appear in sectionOrder and
// hiddenSections (profile-settings.ts PROFILE_WIDGET_IDS).
//
// Invariant (locked plan): no profile UI advertises a progression feature
// whose capability doesn't exist — gating is enforced server-side via
// hasUnlock, and the renderer skips gated widgets entirely.

export interface ProfileWidgetSpec {
  /** Stable id — also a valid PROFILE_SECTION_IDS entry. */
  id: string
  /** Plain-language name shown in the editor. */
  name: string
  /** What the widget shows — used in the editor and locked-state copy. */
  description: string
  /** Progression unlock required for the widget to render (progression-config). */
  unlockId: string
  /** When true the widget renders for the profile owner only. */
  ownerOnly: boolean
  /** Which tab the widget block lives on. */
  section: "overview" | "about"
}

export const PROFILE_WIDGETS: readonly ProfileWidgetSpec[] = [
  {
    id: "records",
    name: "Records",
    description:
      "Personal records across your grows — longest grow, biggest harvest, earliest start.",
    unlockId: "records-widget",
    ownerOnly: false,
    section: "overview",
  },
  {
    id: "owner-insights",
    name: "Profile insights",
    description:
      "Your last 30 days — new followers, updates logged, grows started. Only you see this.",
    unlockId: "owner-analytics",
    ownerOnly: true,
    section: "about",
  },
] as const

export const PROFILE_WIDGET_BY_ID = new Map(PROFILE_WIDGETS.map((w) => [w.id, w]))
export const isProfileWidgetId = (id: string): boolean => PROFILE_WIDGET_BY_ID.has(id)
