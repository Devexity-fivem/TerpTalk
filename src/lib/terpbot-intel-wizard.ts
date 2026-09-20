// TerpBot intelligence — problem-wizard adapter.
//
// The wizard is question-driven (user picks answers); the engine is
// data-driven (diary series). They converge on the SAME knowledge:
// a migrated wizard branch keeps its bare result id, and its
// WizardResult is generated from the shared CandidateDef — so the
// wizard UI, Thread.wizardResultId stats, and the diagnostic engine
// can never drift apart on that branch.
//
// Migration boundary (Phase E+): only candidates whose detection is
// expressible in GrowContextView fields get data-driven rules. Symptom-
// only results (pests, nutrient deficiencies, hermie, …) stay wizard-
// only until a reported-symptom channel exists.

import { CANDIDATES } from "@/lib/terpbot-intel-knowledge"
import type { CandidateDef } from "@/lib/terpbot-intel-types"
import type { WizardResult } from "@/lib/problem-wizard"

/** Generate a WizardResult from a migrated candidate. The returned
 *  object is byte-identical to the hand-written literal it replaced —
 *  `title` ← name, `cause` ← mechanism, `fixes` ← recommendedActions,
 *  `severity` ← severity. */
export function wizardResultFromCandidate(id: string): WizardResult {
  const def = CANDIDATES[id]
  if (!def) throw new Error(`unknown candidate ${id}`)
  if (def.wizardResultId !== id) throw new Error(`candidate ${id} is not a wizard-migrated result`)
  return {
    title: def.name,
    cause: def.mechanism,
    fixes: def.recommendedActions,
    severity: def.severity,
  }
}

export function candidateForWizardResult(resultId: string): CandidateDef | null {
  const def = CANDIDATES[resultId]
  return def?.wizardResultId === resultId ? def : null
}
