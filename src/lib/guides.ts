// Guide topics — staff-authored articles. Kept in one place so the create
// route, edit route, and related-guide surfaces share the same vocabulary.
export const GUIDE_TOPICS = new Set([
  "BASICS",
  "NUTRIENTS",
  "HARVEST",
  "PESTS",
  "ENVIRONMENT",
  "GENETICS",
  "TRAINING",
  "LAW",
])

// Map guide topics onto forum category slugs (seeded in prisma/seed.ts) so a
// category page can surface related guides without a schema relation.
export const TOPIC_TO_CATEGORY_SLUGS: Record<string, string[]> = {
  BASICS: ["new-grower-questions", "seeds-starting-plants"],
  NUTRIENTS: ["nutrients", "hydroponics", "soil-living-soil"],
  HARVEST: ["harvest-curing"],
  PESTS: ["plant-problems"],
  ENVIRONMENT: ["lighting", "ventilation", "indoor-growing", "outdoor-growing", "greenhouse-growing"],
  GENETICS: ["genetics-breeding"],
  TRAINING: ["training-trellising"],
  LAW: [],
}

// Reverse lookup: category slug → guide topics that belong there.
export const CATEGORY_TO_TOPICS: Record<string, string[]> = Object.entries(TOPIC_TO_CATEGORY_SLUGS)
  .flatMap(([topic, slugs]) => slugs.map((slug) => [slug, topic] as const))
  .reduce<Record<string, string[]>>((acc, [slug, topic]) => {
    ;(acc[slug] ??= []).push(topic)
    return acc
  }, {})
