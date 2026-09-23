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
 *  stage-transition rules; no new candidates or sources.
 *  2.3 → 2.4: Phase I — Grow Intelligence Snapshot, stage playbook
 *  checklist (all items cite the existing source registry), capability-
 *  aware next-step ranking (excluded steps never surface; proven/
 *  plausible capability is a bounded tie-break bonus), setup enums +
 *  capability ids on /status and /plan, post-harvest stages reachable.
 *  No new candidates, rules, or sources — the knowledge split is
 *  unchanged, the planning surface is new. */
/* v2.5 — Phase J: deterministic cultivation decision engine.
 *  CultivationDecisionSet derived from the snapshot (/next, /check,
 *  /plan, /status, /changes, BOT_ASSIST consume it); WAIT/MONITOR/HOLD
 *  become first-class decisions; the ADJUST gate is centralized
 *  (isAdjustSafe) and restricted to an explicit reversible-environmental
 *  allowlist — feeding/flush/chemical/structural actions no longer
 *  surface as automatic adjustments anywhere; pending-intervention and
 *  recent-change cooldown are one canonical contract; intervention
 *  states (pending/answered/lapsed/untracked) are recorded on the
 *  snapshot; ph-low-danger text aligned to its cited threshold (5.0);
 *  harv-dryspace cites the internal stage-tips convention its 60/60
 *  figure actually comes from. */
export const KNOWLEDGE_VERSION = "2.5"

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
