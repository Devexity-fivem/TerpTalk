// Profile V2 — settings + custom-section contracts (P0 foundation).
// Deliberately preset-based: accent/theme/density are enumerated tokens, never
// arbitrary CSS. Custom sections store markdown SOURCE only — rendering goes
// through MarkdownRenderer (src/lib/markdown.tsx), which emits no raw HTML.
// See docs/audit/profile-v2-implementation-plan.md for the locked design.

export const PROFILE_SECTION_TITLE_MAX = 60
export const PROFILE_SECTION_BODY_MAX = 2000
// Hard storage cap. The free-tier count (2) and unlock tiers
// (Rooted 4 / Harvested 6 / Cured 8) are enforced by customSectionLimit —
// wired to hasUnlock in Profile P2 when the section editor ships.
export const PROFILE_SECTION_BASE_LIMIT = 2
export const PROFILE_SECTION_HARD_MAX = 8

export const SECTION_VISIBILITIES = ["PUBLIC", "MEMBERS", "HIDDEN"] as const
export type SectionVisibility = (typeof SECTION_VISIBILITIES)[number]
export const isSectionVisibility = (v: unknown): v is SectionVisibility =>
  typeof v === "string" && (SECTION_VISIBILITIES as readonly string[]).includes(v)

export const PROFILE_ACCENTS = ["pine", "amber", "violet", "slate", "ember"] as const
export type ProfileAccent = (typeof PROFILE_ACCENTS)[number]

export const PROFILE_THEMES = ["default", "journal", "botanical", "growroom", "data"] as const
export type ProfileTheme = (typeof PROFILE_THEMES)[number]

export const PROFILE_DENSITIES = ["cozy", "compact"] as const
export type ProfileDensity = (typeof PROFILE_DENSITIES)[number]

// Orderable profile sections — the hero is always first and is NOT in this
// list. These ids map to the locked IA blocks (plan §2); widgets land in P1/P2.
export const PROFILE_SECTION_IDS = [
  "stats",
  "featured",
  "grows",
  "harvests",
  "contributions",
  "badges",
  "history",
] as const
export type ProfileSectionId = (typeof PROFILE_SECTION_IDS)[number]

// Selectable notable-stat ids (P1 renders them; P0 stores the selection).
export const NOTABLE_STAT_IDS = [
  "grows",
  "harvests",
  "updates",
  "detailedUpdates",
  "documentedWeeks",
  "longestGrow",
  "growingSince",
  "acceptedAnswers",
  "experiments",
  "strains",
  "activeGrows",
  "streak",
  "setups",
  "contestWins",
] as const
export type NotableStatId = (typeof NOTABLE_STAT_IDS)[number]
export const SHOWN_STATS_MAX = 8

export const PROFILE_MEDIUMS = [
  "soil",
  "coco",
  "hydro",
  "dwc",
  "living_soil",
  "rockwool",
  "outdoor",
] as const
export const PROFILE_STYLES = [
  "lst",
  "hst",
  "scrog",
  "sog",
  "topping",
  "mainline",
  "organic",
  "autoflower",
] as const
export const PROFILE_GOALS_MAX = 280

export interface ProfileIdentitySettings {
  mediums: string[]
  styles: string[]
  goals: string
}

export interface ProfileSettings {
  bannerImage: string | null
  accent: ProfileAccent
  theme: ProfileTheme
  density: ProfileDensity
  sectionOrder: ProfileSectionId[]
  hiddenSections: ProfileSectionId[]
  shownStats: NotableStatId[]
  pinnedSection: string | null
  identity: ProfileIdentitySettings
}

export const DEFAULT_PROFILE_SETTINGS: ProfileSettings = {
  bannerImage: null,
  accent: "pine",
  theme: "default",
  density: "cozy",
  sectionOrder: [...PROFILE_SECTION_IDS],
  hiddenSections: [],
  shownStats: ["grows", "harvests", "updates", "acceptedAnswers"],
  pinnedSection: null,
  identity: { mediums: [], styles: [], goals: "" },
}

const SECTION_ID_SET = new Set<string>(PROFILE_SECTION_IDS)
const STAT_ID_SET = new Set<string>(NOTABLE_STAT_IDS)
const MEDIUM_SET = new Set<string>(PROFILE_MEDIUMS)
const STYLE_SET = new Set<string>(PROFILE_STYLES)

const pickEnum = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

const pickIdList = <T extends string>(v: unknown, allowed: Set<string>, max: number): T[] =>
  Array.isArray(v)
    ? ([...new Set(v.filter((x): x is T => typeof x === "string" && allowed.has(x)))].slice(0, max) as T[])
    : []

const pickString = (v: unknown, max: number): string =>
  typeof v === "string" ? v.slice(0, max) : ""

const isHttpsUrl = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 500 && /^https:\/\//i.test(v)

/**
 * Normalize stored profileSettings JSON into the contract shape. Unknown keys
 * are dropped, invalid enum values fall back to defaults, and lists are
 * capped — malformed or stale blobs always yield a valid settings object.
 */
export function parseProfileSettings(raw: unknown): ProfileSettings {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PROFILE_SETTINGS }
  const s = raw as Record<string, unknown>
  const order = pickIdList<ProfileSectionId>(s.sectionOrder, SECTION_ID_SET, PROFILE_SECTION_IDS.length)
  return {
    bannerImage: isHttpsUrl(s.bannerImage) ? s.bannerImage : null,
    accent: pickEnum(s.accent, PROFILE_ACCENTS, "pine"),
    theme: pickEnum(s.theme, PROFILE_THEMES, "default"),
    density: pickEnum(s.density, PROFILE_DENSITIES, "cozy"),
    // Any section id missing from a stored order gets appended — forward-safe
    // when new sections ship in later phases.
    sectionOrder: [
      ...order,
      ...PROFILE_SECTION_IDS.filter((id) => !order.includes(id)),
    ],
    hiddenSections: pickIdList<ProfileSectionId>(s.hiddenSections, SECTION_ID_SET, PROFILE_SECTION_IDS.length),
    shownStats: pickIdList<NotableStatId>(s.shownStats, STAT_ID_SET, SHOWN_STATS_MAX),
    pinnedSection: typeof s.pinnedSection === "string" && s.pinnedSection.length <= 40 ? s.pinnedSection : null,
    identity: normalizeIdentity(s.identity),
  }
}

function normalizeIdentity(raw: unknown): ProfileIdentitySettings {
  const i = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  return {
    mediums: pickIdList(i.mediums, MEDIUM_SET, PROFILE_MEDIUMS.length),
    styles: pickIdList(i.styles, STYLE_SET, PROFILE_STYLES.length),
    goals: pickString(i.goals, PROFILE_GOALS_MAX).trim(),
  }
}

export interface ProfileSettingsPatch {
  bannerImage?: string | null
  accent?: ProfileAccent
  theme?: ProfileTheme
  density?: ProfileDensity
  sectionOrder?: ProfileSectionId[]
  hiddenSections?: ProfileSectionId[]
  shownStats?: NotableStatId[]
  pinnedSection?: string | null
  identity?: Partial<ProfileIdentitySettings>
}

/**
 * Validate a PATCH input for profileSettings. Returns a merged settings blob
 * (partial updates merge onto existing), or { error } on anything unusable.
 * Strictly additive to the existing blob — callers never write raw JSON.
 */
export function validateProfileSettingsPatch(
  input: unknown,
  existing: unknown
): { settings?: ProfileSettings; error?: string } {
  if (input === undefined) return {}
  if (input === null) return { settings: { ...DEFAULT_PROFILE_SETTINGS } }
  if (typeof input !== "object" || Array.isArray(input)) {
    return { error: "profileSettings must be an object" }
  }
  const patch = input as Record<string, unknown>
  const current = parseProfileSettings(existing)
  const merged: ProfileSettings = {
    bannerImage:
      patch.bannerImage === undefined
        ? current.bannerImage
        : patch.bannerImage === null
          ? null
          : isHttpsUrl(patch.bannerImage)
            ? patch.bannerImage
            : current.bannerImage,
    accent:
      patch.accent === undefined
        ? current.accent
        : pickEnum(patch.accent, PROFILE_ACCENTS, current.accent),
    theme:
      patch.theme === undefined
        ? current.theme
        : pickEnum(patch.theme, PROFILE_THEMES, current.theme),
    density:
      patch.density === undefined
        ? current.density
        : pickEnum(patch.density, PROFILE_DENSITIES, current.density),
    sectionOrder:
      patch.sectionOrder === undefined
        ? current.sectionOrder
        : [
            ...pickIdList<ProfileSectionId>(patch.sectionOrder, SECTION_ID_SET, PROFILE_SECTION_IDS.length),
            ...PROFILE_SECTION_IDS.filter(
              (id) => !pickIdList<ProfileSectionId>(patch.sectionOrder, SECTION_ID_SET, PROFILE_SECTION_IDS.length).includes(id)
            ),
          ],
    hiddenSections:
      patch.hiddenSections === undefined
        ? current.hiddenSections
        : pickIdList<ProfileSectionId>(patch.hiddenSections, SECTION_ID_SET, PROFILE_SECTION_IDS.length),
    shownStats:
      patch.shownStats === undefined
        ? current.shownStats
        : pickIdList<NotableStatId>(patch.shownStats, STAT_ID_SET, SHOWN_STATS_MAX),
    pinnedSection:
      patch.pinnedSection === undefined
        ? current.pinnedSection
        : patch.pinnedSection === null
          ? null
          : typeof patch.pinnedSection === "string" && patch.pinnedSection.length <= 40
            ? patch.pinnedSection
            : current.pinnedSection,
    identity:
      patch.identity === undefined
        ? current.identity
        : {
            mediums:
              patch.identity && typeof patch.identity === "object"
                ? pickIdList(
                    (patch.identity as Record<string, unknown>).mediums ?? current.identity.mediums,
                    MEDIUM_SET,
                    PROFILE_MEDIUMS.length
                  )
                : current.identity.mediums,
            styles:
              patch.identity && typeof patch.identity === "object"
                ? pickIdList(
                    (patch.identity as Record<string, unknown>).styles ?? current.identity.styles,
                    STYLE_SET,
                    PROFILE_STYLES.length
                  )
                : current.identity.styles,
            goals:
              patch.identity && typeof patch.identity === "object"
                ? pickString(
                    (patch.identity as Record<string, unknown>).goals ?? current.identity.goals,
                    PROFILE_GOALS_MAX
                  ).trim()
                : current.identity.goals,
          },
  }
  return { settings: merged }
}

/** Validate one custom-section write. Returns normalized fields or an error. */
export function validateSectionInput(input: unknown): {
  title?: string
  body?: string
  visibility?: SectionVisibility
  order?: number
  error?: string
} {
  if (!input || typeof input !== "object") return { error: "Invalid body" }
  const s = input as Record<string, unknown>
  const out: { title?: string; body?: string; visibility?: SectionVisibility; order?: number } = {}

  if (s.title !== undefined) {
    if (typeof s.title !== "string" || !s.title.trim() || s.title.trim().length > PROFILE_SECTION_TITLE_MAX) {
      return { error: `Title must be 1–${PROFILE_SECTION_TITLE_MAX} characters` }
    }
    out.title = s.title.trim()
  }
  if (s.body !== undefined) {
    if (typeof s.body !== "string" || s.body.length > PROFILE_SECTION_BODY_MAX) {
      return { error: `Body must be under ${PROFILE_SECTION_BODY_MAX} characters` }
    }
    out.body = s.body
  }
  if (s.visibility !== undefined) {
    if (!isSectionVisibility(s.visibility)) {
      return { error: "visibility must be PUBLIC, MEMBERS, or HIDDEN" }
    }
    out.visibility = s.visibility
  }
  if (s.order !== undefined) {
    if (typeof s.order !== "number" || !Number.isInteger(s.order) || s.order < 0 || s.order > 100) {
      return { error: "order must be an integer 0–100" }
    }
    out.order = s.order
  }
  return out
}
