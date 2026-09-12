// Shared yield-unit conversions — used by the leaderboard, strain stats,
// harvest report, and the harvest API's validation.

export const VALID_YIELD_UNITS = ["g", "oz", "lb", "kg"] as const

export const TO_GRAMS: Record<string, number> = {
  g: 1,
  oz: 28.3495,
  lb: 453.592,
  kg: 1000,
}

export function toGrams(amount: number, unit?: string | null) {
  return amount * (TO_GRAMS[unit?.toLowerCase() || "g"] ?? 1)
}

export function toOz(grams: number) {
  return grams / TO_GRAMS.oz
}
