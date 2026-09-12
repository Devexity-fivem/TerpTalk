// Pure constants shared by the TerpBot modules. Kept separate so
// terpbot-events.ts can reference the bot identity without importing
// terpbot.ts (which itself imports the events module — a cycle).
export const TERPBOT_USERNAME = "terpbot"
