// Shared onboarding constants/types — pure module, no Prisma or server
// imports. Safe for client components (onboarding stepper) and for the
// server lib that fetches real suggestions.

export interface SuggestedUser {
  id: string
  username: string | null
  name: string | null
  image: string | null
  role: string
  bio: string | null
  reputation: number
  followers: number
}

// Interest groups presented during onboarding — category slugs only.
export const INTEREST_GROUPS: { label: string; slugs: string[] }[] = [
  { label: "Getting started", slugs: ["new-grower-questions"] },
  { label: "Grow environment", slugs: ["indoor-growing", "outdoor-growing", "greenhouse-growing"] },
  { label: "Medium & feeding", slugs: ["soil-living-soil", "hydroponics", "nutrients"] },
  {
    label: "Technique & lifecycle",
    slugs: [
      "seeds-starting-plants",
      "training-trellising",
      "flowering",
      "harvest-curing",
      "plant-problems",
      "advanced-growing",
      "genetics-breeding",
    ],
  },
  { label: "Gear", slugs: ["lighting", "ventilation", "diy-equipment"] },
  {
    label: "Community",
    slugs: ["smoke-reports", "general-cannabis-discussion", "cannabis-memes", "off-topic"],
  },
]
