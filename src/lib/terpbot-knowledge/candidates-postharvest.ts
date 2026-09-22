// TerpBot knowledge — post-harvest candidates. Part of the shared
// candidate registry; assembled in terpbot-intel-knowledge.ts.
//
// Evidence base: Das et al. 2022 (Bioengineering 9(8):364) — a cannabis-
// specific peer-reviewed review of drying/curing operations and their
// effect on cannabinoid content. Exact commercial thresholds vary by
// bud density and room control, so these candidates stay risk/assessment
// graded and never claim a universal spec.

import type { CandidateDef } from "@/lib/terpbot-intel-types"

export const POSTHARVEST_CANDIDATES: Record<string, CandidateDef> = {
  "post.dry-mold-risk": {
    id: "post.dry-mold-risk",
    domain: "postharvest",
    kind: "risk",
    name: "Slow-dry mold risk",
    mechanism:
      "Drying space humidity above ~65% slows moisture migration enough for botrytis and storage molds to develop inside dense buds — the same pathogen that caused problems in flower can finish the job hanging.",
    severity: "urgent",
    maxState: "strong",
    requiredInputs: ["humidity"],
    discriminatingInputs: ["temperature", "inspect:bud-interior"],
    recommendedActions: [
      "Bring the dry space toward ~50–60% RH (dehumidify or raise gentle airflow)",
      "Keep air moving through the room, not directly on buds",
      "Inspect dense cola interiors — post-harvest botrytis starts inside",
    ],
    sourceIds: ["postharvest-review-2022", "bc-cannabis-diseases"],
  },

  "post.dry-too-fast": {
    id: "post.dry-too-fast",
    domain: "postharvest",
    kind: "risk",
    name: "Drying too fast",
    mechanism:
      "Hot or dry air crusts the bud exterior while cores stay wet — the outer shell seals, chlorophyll breakdown stalls, and the review literature associates rushed drying with harsher, greener-tasting product.",
    severity: "watch",
    maxState: "strong",
    requiredInputs: ["humidity"],
    discriminatingInputs: ["temperature"],
    recommendedActions: [
      "Raise RH toward ~55–60% or lower temperature toward ~60°F",
      "Target a slow ~10–14 day dry — stems should snap, not bend",
      "Avoid fans pointed directly at hanging buds",
    ],
    sourceIds: ["postharvest-review-2022"],
  },

  "post.cure-moisture": {
    id: "post.cure-moisture",
    domain: "postharvest",
    kind: "condition",
    name: "Cure moisture out of band",
    mechanism:
      "Jar/cure humidity above ~65% keeps buds wet enough for mold to grow in sealed containers; below ~55% the cure stalls — moisture can no longer migrate from core to surface.",
    severity: "moderate",
    maxState: "strong",
    requiredInputs: ["humidity"],
    discriminatingInputs: ["temperature"],
    recommendedActions: [
      "Above ~65%: burp more often and check for clumping or ammonia smell",
      "Below ~55%: buds are likely over-dried — rehydrate gently or accept the cure is done",
      "Keep jars in the dark at stable cool temperatures",
    ],
    sourceIds: ["postharvest-review-2022"],
  },
}
