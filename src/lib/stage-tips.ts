// Stage-specific grower tips — shown when logging a diary update
export const STAGE_TIPS: Record<string, string[]> = {
  GERMINATION: [
    "Keep the medium moist but not soaked — a sprayed paper towel or dome works.",
    "Darkness and warmth (22–25°C) speed up sprouting.",
    "Don't touch the taproot — handle by the seed shell only.",
  ],
  SEEDLING: [
    "Gentle light only — seedlings stretch and burn easily.",
    "Keep humidity high (65–70%); small root zones dry fast.",
    "Don't feed yet — the seed carries its own nutrients for ~2 weeks.",
  ],
  VEGETATIVE: [
    "Now's the time for training — top, LST, or SCROG before flower.",
    "pH 5.8–6.2 (hydro) / 6.0–6.8 (soil); watch for clawing or tip burn.",
    "Increase airflow as the canopy thickens — weak airflow invites mold.",
  ],
  FLOWER: [
    "Drop RH to 40–50% — dense buds + humidity = bud rot.",
    "No more heavy defoliation — the plant needs those solar panels now.",
    "Check trichomes with a loupe as you approach harvest, not the calendar.",
  ],
  HARVEST: [
    "Chop when trichomes are mostly milky with ~10–20% amber.",
    "Flush or taper nutrients in the final week for a cleaner burn.",
    "Harvest in the dark period — light degrades terpenes.",
  ],
  DRYING: [
    "60°F / 60% RH is the classic target — slow dry = better smoke.",
    "Hang whole or in branches; aim for 7–14 days, stems snap when ready.",
    "Total darkness and gentle airflow — never point fans at the buds.",
  ],
  CURING: [
    "Jar at ~62% RH; burp daily for the first 2 weeks.",
    "Cure 4+ weeks for the smoothest result — terps keep developing.",
    "If jars smell like ammonia, open them — that's too wet.",
  ],
  COMPLETED: [
    "Log your final yield — future you (and the community) will thank you.",
    "Write a smoke report — your notes help the next grower pick this strain.",
  ],
}
