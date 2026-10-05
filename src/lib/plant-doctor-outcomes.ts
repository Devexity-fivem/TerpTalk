// Client-safe outcome vocabulary for the Plant Doctor loop. Kept free of
// server-only imports (prisma, notify, rate-limit) so UI components can
// consume the labels without pulling the server module into the browser
// bundle.

export const PD_OUTCOMES = ["IMPROVED", "NO_CHANGE", "WORSE", "UNSURE"] as const
export type PlantDoctorOutcomeValue = (typeof PD_OUTCOMES)[number]

export const PD_OUTCOME_LABELS: Record<PlantDoctorOutcomeValue, string> = {
  IMPROVED: "It helped",
  NO_CHANGE: "No change",
  WORSE: "Got worse",
  UNSURE: "Not sure yet",
}
export function isPdOutcome(v: unknown): v is PlantDoctorOutcomeValue {
  return typeof v === "string" && (PD_OUTCOMES as readonly string[]).includes(v)
}
