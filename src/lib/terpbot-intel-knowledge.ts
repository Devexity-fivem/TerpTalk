// TerpBot intelligence — canonical knowledge registry.
// Candidates and sources live in per-domain modules under
// terpbot-knowledge/; this file is the single assembly point the
// engine, validator, and wizard bridge all import from.

/** bumped when candidates/rules/sources change materially — stamped
 *  on persisted sessions so a stale /why trail can't be misread.
 *  2.1 → 2.2: postharvest domain (3 candidates), lockout-shadow,
 *  dew-point, pest-pattern, droop-split, stretch/light-compound and
 *  harvest-window rules; CONTRA + refinement-intersection fixes.
 *  2.2 → 2.3: longitudinal rules (episode status, intervention
 *  follow-through, baseline-relative shift), recurring-excursion and
 *  stage-transition rules; no new candidates or sources. */
export const KNOWLEDGE_VERSION = "2.3"

export { SOURCES } from "@/lib/terpbot-knowledge/sources"
import { NUTRITION_CANDIDATES } from "@/lib/terpbot-knowledge/candidates-nutrition"
import { CHEMISTRY_CANDIDATES } from "@/lib/terpbot-knowledge/candidates-chemistry"
import { ENVIRONMENT_CANDIDATES } from "@/lib/terpbot-knowledge/candidates-environment"
import { GROWTH_CANDIDATES } from "@/lib/terpbot-knowledge/candidates-growth"
import { STAGE_CANDIDATES } from "@/lib/terpbot-knowledge/candidates-stage"
import { WATERING_CANDIDATES } from "@/lib/terpbot-knowledge/candidates-watering"
import { PEST_CANDIDATES } from "@/lib/terpbot-knowledge/candidates-pest"
import { DISEASE_CANDIDATES } from "@/lib/terpbot-knowledge/candidates-disease"
import { POSTHARVEST_CANDIDATES } from "@/lib/terpbot-knowledge/candidates-postharvest"
import type { CandidateDef } from "@/lib/terpbot-intel-types"

export const CANDIDATES: Record<string, CandidateDef> = {
  ...NUTRITION_CANDIDATES,
  ...CHEMISTRY_CANDIDATES,
  ...ENVIRONMENT_CANDIDATES,
  ...GROWTH_CANDIDATES,
  ...STAGE_CANDIDATES,
  ...WATERING_CANDIDATES,
  ...PEST_CANDIDATES,
  ...DISEASE_CANDIDATES,
  ...POSTHARVEST_CANDIDATES,
}
