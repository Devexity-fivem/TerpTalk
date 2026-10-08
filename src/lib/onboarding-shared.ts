// Shared onboarding constants — pure module, no Prisma or server imports.
// Safe for client components (onboarding stepper).

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
