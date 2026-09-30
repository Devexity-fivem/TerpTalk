/**
 * Experimentation progression wiring — the deterministic award callsites
 * for the experiment lifecycle (design §6.4 + anti-fabrication §6.4a).
 *
 * Every award is keyed once-ever per experiment, carries
 * sourceType=DIARY/sourceId=<diaryId> so deleting the diary claws all of
 * it back through the existing source reversal, and is reversed durably
 * when the experiment itself is deleted.
 *
 * Honors the module contract: outcomes are grower-stated only — nothing
 * here infers success from data.
 */
import { Prisma } from "@prisma/client"
import { awardProgression, experimentSimilarity } from "@/lib/progression"
import { prisma } from "@/lib/prisma"
import { enqueueXpReversals, drainXpMany } from "@/lib/progression-outbox"
import { DUP_WITHHOLD_PCT } from "@/lib/progression-config"

const expKey = (expId: string, suffix: string) => `experiment:${expId}:${suffix}`

const EXPECTED_MIN = 20
const CONCLUSION_MIN = 40
/** §6.4a — a real attempt must have run ≥24h before the failure lands. */
const FAILURE_MIN_AGE_MS = 24 * 3600_000

/** The experiment fields every award decision reads. */
export interface ExperimentProgressionState {
  id: string
  diaryId: string
  authorId: string
  title: string
  change: string
  expected: string | null
  category: string
  status: string
  outcome: string | null
  conclusion: string | null
  createdAt: Date
  /** Linked observation count (`_count.updates`). */
  updateCount: number
}

const reason = (exp: { title: string }) => `Experiment "${exp.title.slice(0, 60)}"`

/** POST create — +5 EXPERIMENT_CREATED (weeklyCap 2 lives in XP_TABLE). */
export async function awardExperimentCreated(exp: ExperimentProgressionState): Promise<void> {
  await awardProgression(exp.authorId, "EXPERIMENT_CREATED", reason(exp), {
    key: expKey(exp.id, "created"),
    sourceType: "DIARY",
    sourceId: exp.diaryId,
    meta: { experimentId: exp.id },
  }).catch(() => {})
}

/** Hypothesis documented — `expected` ≥20 chars, once per experiment.
 *  Called on create AND on PATCH (a hypothesis can be written late). */
export async function awardHypothesisIfMet(exp: ExperimentProgressionState): Promise<void> {
  if ((exp.expected ?? "").trim().length < EXPECTED_MIN) return
  await awardProgression(exp.authorId, "HYPOTHESIS_DOC", reason(exp), {
    key: expKey(exp.id, "hypothesis"),
    sourceType: "DIARY",
    sourceId: exp.diaryId,
    meta: { experimentId: exp.id },
  }).catch(() => {})
}

/** Updates POST — a linked observation was just created. +10 once per
 *  experiment at ≥3 linked follow-ups. */
export async function awardExperimentFollowups(exp: ExperimentProgressionState): Promise<void> {
  if (exp.updateCount < 3) return
  await awardProgression(exp.authorId, "FOLLOWUPS_3", reason(exp), {
    key: expKey(exp.id, "followups"),
    sourceType: "DIARY",
    sourceId: exp.diaryId,
    meta: { experimentId: exp.id },
  }).catch(() => {})
}

/**
 * PATCH lifecycle evaluation — run against the post-patch state.
 * beforeStatus is needed for the §6.4a "reached ACTIVE" gate (the member
 * must have actually run the change, not created a PLANNED→fail pipeline).
 */
export async function evaluateExperimentAwards(
  beforeStatus: string,
  after: ExperimentProgressionState
): Promise<void> {
  await awardHypothesisIfMet(after)

  const ended = after.status === "COMPLETED" || after.status === "ABANDONED"
  const conclusionLen = (after.conclusion ?? "").trim().length

  // +25 — completed with a grower-stated outcome and a real conclusion.
  if (after.status === "COMPLETED" && after.outcome && conclusionLen >= CONCLUSION_MIN) {
    await awardProgression(after.authorId, "EXPERIMENT_COMPLETED", reason(after), {
      key: expKey(after.id, "completed"),
      sourceType: "DIARY",
      sourceId: after.diaryId,
      meta: { experimentId: after.id, outcome: after.outcome },
    }).catch(() => {})
  }

  // +20 Knowledge — an ISSUE_RESPONSE experiment that actually fixed it
  // and got written up. Stacked on EXPERIMENT_COMPLETED, not a substitute.
  if (
    after.category === "ISSUE_RESPONSE" &&
    after.status === "COMPLETED" &&
    after.outcome === "WORKED" &&
    conclusionLen >= CONCLUSION_MIN
  ) {
    await awardProgression(after.authorId, "PROBLEM_RESOLVED", reason(after), {
      key: expKey(after.id, "problem"),
      sourceType: "DIARY",
      sourceId: after.diaryId,
      meta: { experimentId: after.id },
    }).catch(() => {})
  }

  // §6.4a documented-failure bonus (+8). Rewards the honest write-up of a
  // real failed attempt — never failure itself. All gates verified here;
  // a withheld decision is recorded once in meta with the reason.
  const failingOutcome = after.outcome === "DID_NOT_WORK" || after.status === "ABANDONED"
  if (!ended || !failingOutcome) return

  const gateFailures: string[] = []
  // Reached ACTIVE ≥24h before the outcome: proxy = server-stamped
  // createdAt ≥24h ago AND the experiment had left PLANNED before this
  // patch (status history isn't tracked; createdAt is unforgeable).
  const ranLongEnough = Date.now() - after.createdAt.getTime() >= FAILURE_MIN_AGE_MS
  const leftPlanned = beforeStatus === "ACTIVE" || beforeStatus === "OBSERVING" || beforeStatus === "COMPLETED"
  if (!ranLongEnough || !leftPlanned) gateFailures.push("under-24h-or-never-active")
  if (after.updateCount < 1 && (after.expected ?? "").trim().length < EXPECTED_MIN) {
    gateFailures.push("no-linked-update-or-hypothesis")
  }
  if (conclusionLen < CONCLUSION_MIN) gateFailures.push("conclusion-too-short")

  let similarity = 0
  if (gateFailures.length === 0) {
    similarity = await experimentSimilarity(
      after.authorId,
      after.id,
      [after.title, after.change, after.expected ?? ""].join("\n")
    )
    if (similarity >= DUP_WITHHOLD_PCT) gateFailures.push("duplicate-experiment")
  }

  if (gateFailures.length > 0) {
    // Audit marker — first withheld decision is recorded, never pays,
    // and never blocks a later legitimate qualification.
    await awardProgression(after.authorId, "FAILURE_DOCUMENTED", reason(after), {
      key: expKey(after.id, "failure:w"),
      sourceType: "DIARY",
      sourceId: after.diaryId,
      xp: 0,
      marker: true,
      meta: { experimentId: after.id, withheld: gateFailures, similarity },
    }).catch(() => {})
    return
  }

  await awardProgression(after.authorId, "FAILURE_DOCUMENTED", reason(after), {
    key: expKey(after.id, "failure"),
    sourceType: "DIARY",
    sourceId: after.diaryId,
    meta: { experimentId: after.id, outcome: after.outcome ?? "ABANDONED", similarity },
  }).catch(() => {})
}

const EXP_SUFFIXES = ["created", "hypothesis", "completed", "failure", "failure:w", "followups", "problem"] as const

/**
 * Enqueue durable reversal intents for every award an experiment produced.
 * Call inside the deleting transaction so the intents commit atomically
 * with the delete — a crash can't strand awarded XP on removed content.
 * Returns the intent ids for post-commit draining.
 */
export async function enqueueExperimentReversals(
  tx: Prisma.TransactionClient,
  experimentId: string,
  why = "Experiment deleted"
): Promise<string[]> {
  return enqueueXpReversals(tx, EXP_SUFFIXES.map((suffix) => ({
    kind: "KEY" as const, eventKey: expKey(experimentId, suffix), reason: why,
  })))
}

/**
 * Post-commit convenience wrapper — enqueue all intents in one tx, then
 * drain. Prefer enqueueExperimentReversals inside the delete tx.
 */
export async function reverseExperimentAwards(experimentId: string, why = "Experiment deleted"): Promise<void> {
  const ids = await prisma.$transaction(async (tx) => enqueueExperimentReversals(tx, experimentId, why))
  await drainXpMany(ids)
}
