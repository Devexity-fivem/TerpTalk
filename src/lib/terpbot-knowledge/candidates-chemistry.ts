// TerpBot knowledge — chemistry candidates. Part of the shared
// candidate registry; assembled in terpbot-intel-knowledge.ts.

import type { CandidateDef } from "@/lib/terpbot-intel-types"

export const CHEMISTRY_CANDIDATES: Record<string, CandidateDef> = {
  ph_drift: {
    id: "ph_drift",
    domain: "chemistry",
    kind: "condition",
    name: "pH drift / instability",
    mechanism: "Runoff pH keeps moving — salt buildup, coco breakdown, or inconsistent water source.",
    severity: "moderate",
    maxState: "strong",
    requiredInputs: ["ph"],
    discriminatingInputs: ["runoffPh", "runoffEc"],
    recommendedActions: [
      "Flush with 2–3x pot volume of pH'd water",
      "Use a stable base water — RO + calmag if needed",
      "Test pH of nutrient mix and runoff every feed",
    ],
    sourceIds: ["canna-coco-ph", "purdue-hydro-nutrition"],
    wizardResultId: "ph_drift",
  },

  salt_buildup: {
    id: "salt_buildup",
    domain: "chemistry",
    kind: "condition",
    name: "Salt / nutrient buildup",
    mechanism: "Runoff is dark, sludgy, and high EC — salts are accumulating in the medium.",
    severity: "moderate",
    maxState: "strong",
    requiredInputs: ["ec"],
    discriminatingInputs: ["runoffEc", "watering", "substrateMoisture"],
    recommendedActions: [
      "Flush with plain pH'd water until runoff EC drops",
      "Feed at lower strength more often",
      "Check drainage — pots should not sit in runoff",
    ],
    sourceIds: ["canna-coco-ph", "hershkowitz-2025-ec"],
    wizardResultId: "salt_buildup",
  },

  ph_lockout: {
    id: "ph_lockout",
    domain: "chemistry",
    kind: "condition",
    name: "pH outside medium band / nutrient lockout",
    mechanism:
      "Root-zone pH outside the medium-appropriate band locks nutrients out — deficiencies appear even when feed is correct.",
    severity: "moderate",
    maxState: "strong",
    requiredInputs: ["ph"],
    discriminatingInputs: ["runoffPh", "runoffEc"],
    recommendedActions: [
      "Verify with runoff pH before changing feed — input pH can lie",
      "Correct gradually toward band; don't swing more than ~0.3 per feed",
    ],
    sourceIds: ["canna-coco-ph", "whipker-ph-micro", "cornell-cannabis-guidebook", "terptalk-stage-tips"],
  },
}
