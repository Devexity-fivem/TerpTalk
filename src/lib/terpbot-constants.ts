// Pure constants shared by the TerpBot modules. Kept separate so
// terpbot-events.ts can reference the bot identity without importing
// terpbot.ts (which itself imports the events module — a cycle).
export const TERPBOT_USERNAME = "terpbot"

// GrowDiary.stage values → display labels. Shared by command output and
// announcements so neither terpbot.ts nor terpbot-data.ts owns the map.
export const STAGE_LABELS: Record<string, string> = {
  GERMINATION: "Germination",
  SEEDLING: "Seedling",
  VEGETATIVE: "Vegetative",
  FLOWER: "Flower",
  HARVEST: "Harvest",
  DRYING: "Drying",
  CURING: "Curing",
  COMPLETED: "Completed",
}
export const stageLabel = (s: string) => STAGE_LABELS[s] ?? s.charAt(0) + s.slice(1).toLowerCase()
