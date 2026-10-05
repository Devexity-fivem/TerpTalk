// Plant Doctor outcome loop — closes the gap between "deterministic
// recommendation" and "what actually happened".
//
// Lifecycle:
//   wizard result (member clicks "Track this fix")
//     → PlantDoctorCase (diagnosis + structured grow context snapshot)
//     → grower reports outcome later (append-only PlantDoctorOutcome)
//     → latest row is current state; history is never erased
//
// Absence of an outcome is NEVER success — a case with no outcomes is
// simply unresolved. Any outcome report (even "not sure yet") counts as
// engagement and stops the once-per-case follow-up reminder.
//
// Privacy: cases and outcomes are owner-scoped records. Nothing here is
// rendered publicly; future aggregation (Initiative #10) would consume
// the structured fields, not private text.
import { prisma } from "@/lib/prisma"
import { botAssist, loadAssistPrelude } from "@/lib/terpbot-assist"
import { isValidWizardResultId, wizardResultToTag } from "@/lib/symptom-tags"
import { WIZARD_RESULTS } from "@/lib/problem-wizard"
import { activeAuthor } from "@/lib/security"
import { diaryPath } from "@/lib/slugs"
import { isPdOutcome, type PlantDoctorOutcomeValue } from "@/lib/plant-doctor-outcomes"
export { PD_OUTCOMES, PD_OUTCOME_LABELS, isPdOutcome, type PlantDoctorOutcomeValue } from "@/lib/plant-doctor-outcomes"

// A reported outcome settles a case. UNSURE is still a report — the
// reminder stays quiet, and the member can report again later (the
// append-only model keeps the earlier report).
const RESOLVED_OUTCOMES: PlantDoctorOutcomeValue[] = ["IMPROVED", "NO_CHANGE", "WORSE"]

export interface PlantDoctorCaseView {
  id: string
  resultId: string
  title: string
  severity: string | null
  tagSlug: string | null
  diaryId: string | null
  diaryHref: string | null
  diaryTitle: string | null
  createdAt: Date
  /** Latest report, or null while unresolved. */
  outcome: PlantDoctorOutcomeValue | null
  outcomeCount: number
  /** Still wants a report — never reported, or last report was UNSURE. */
  open: boolean
}

const CASE_SELECT = {
  id: true,
  resultId: true,
  tagSlug: true,
  diaryId: true,
  createdAt: true,
  diary: { select: { id: true, slug: true, title: true } },
  outcomes: { orderBy: { createdAt: "desc" as const }, take: 1, select: { outcome: true } },
  _count: { select: { outcomes: true } },
} as const

function toCaseView(c: {
  id: string
  resultId: string
  tagSlug: string | null
  diaryId: string | null
  createdAt: Date
  diary: { id: string; slug: string | null; title: string } | null
  outcomes: { outcome: string }[]
  _count: { outcomes: number }
}): PlantDoctorCaseView {
  const latest = (c.outcomes[0]?.outcome ?? null) as PlantDoctorOutcomeValue | null
  return {
    id: c.id,
    resultId: c.resultId,
    title: WIZARD_RESULTS[c.resultId]?.title ?? c.resultId.replace(/_/g, " "),
    severity: WIZARD_RESULTS[c.resultId]?.severity ?? null,
    tagSlug: c.tagSlug,
    diaryId: c.diaryId,
    diaryHref: c.diary ? diaryPath(c.diary) : null,
    diaryTitle: c.diary?.title ?? null,
    createdAt: c.createdAt,
    outcome: latest,
    outcomeCount: c._count.outcomes,
    open: !latest || latest === "UNSURE",
  }
}

/**
 * Track a diagnosis. Reuses the member's existing open case for the same
 * (resultId, diaryId) pair — re-running the wizard never multiplies open
 * cases. When the member passes a diary they own, its structured context
 * is snapshotted onto the case (privacy: any visibility — the case itself
 * is never public).
 */
export async function createPlantDoctorCase(opts: {
  userId: string
  resultId: string
  diaryId?: string | null
}): Promise<{ caseId: string; reused: boolean } | { error: string }> {
  const { userId, resultId } = opts
  if (!isValidWizardResultId(resultId)) return { error: "unknown result" }

  const diaryId = opts.diaryId ?? null
  let ctx: { strainId: string | null; stage: string; mediumType: string | null; lightType: string | null; growType: string } | null = null
  if (diaryId) {
    const diary = await prisma.growDiary.findFirst({
      where: { id: diaryId, authorId: userId, deleted: false },
      select: { strainId: true, stage: true, mediumType: true, lightType: true, growType: true },
    })
    if (!diary) return { error: "diary not found" }
    ctx = diary
  }

  const existing = await prisma.plantDoctorCase.findFirst({
    where: { userId, resultId, diaryId, outcomes: { none: {} } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  })
  if (existing) return { caseId: existing.id, reused: true }

  const created = await prisma.plantDoctorCase.create({
    data: {
      userId,
      resultId,
      tagSlug: wizardResultToTag(resultId)?.slug ?? null,
      diaryId,
      strainId: ctx?.strainId ?? null,
      stage: ctx?.stage ?? null,
      mediumType: ctx?.mediumType ?? null,
      lightType: ctx?.lightType ?? null,
      growType: ctx?.growType ?? null,
    },
    select: { id: true },
  })
  return { caseId: created.id, reused: false }
}

/**
 * Append a grower-reported outcome. Owner-only; the case's diary link is
 * intentionally NOT re-validated — a diary deleted after case creation
 * leaves a still-valid outcome history.
 */
export async function reportPlantDoctorOutcome(opts: {
  caseId: string
  userId: string
  outcome: PlantDoctorOutcomeValue
  note?: string | null
}): Promise<{ ok: true } | { error: string }> {
  if (!isPdOutcome(opts.outcome)) return { error: "invalid outcome" }
  const note = typeof opts.note === "string" ? opts.note.trim().slice(0, 280) || null : null

  const kase = await prisma.plantDoctorCase.findUnique({
    where: { id: opts.caseId },
    select: { userId: true },
  })
  if (!kase || kase.userId !== opts.userId) return { error: "not found" }

  await prisma.plantDoctorOutcome.create({
    data: { caseId: opts.caseId, outcome: opts.outcome, note },
  })
  return { ok: true }
}

/** Owner's recent cases — newest first, latest outcome inlined. */
export async function plantDoctorCasesFor(userId: string, take = 5): Promise<PlantDoctorCaseView[]> {
  const rows = await prisma.plantDoctorCase.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: CASE_SELECT,
  })
  return rows.map(toCaseView)
}

/** Cases still waiting on a report — member-home/digest signal. */
export async function openPlantDoctorCases(userId: string, take = 3): Promise<PlantDoctorCaseView[]> {
  const rows = await prisma.plantDoctorCase.findMany({
    where: {
      userId,
      OR: [{ outcomes: { none: {} } }, { outcomes: { some: { outcome: "UNSURE" }, none: { outcome: { in: RESOLVED_OUTCOMES } } } }],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take,
    select: CASE_SELECT,
  })
  return rows.map(toCaseView)
}

// ── Follow-up reminder (daily cron) ─────────────────────────────────
// One notification per case ever, only while completely unreported, for
// cases 5–30 days old. Claim: `assist:pd-followup:<caseId>` — once ever;
// any outcome report removes eligibility, so a reported case can never
// nag again.
const FOLLOWUP_MIN_AGE_MS = 5 * 86400000
const FOLLOWUP_MAX_AGE_MS = 30 * 86400000
const FOLLOWUP_SCAN_CAP = 50
const FOLLOWUP_SEND_CAP = 20

export async function scanPlantDoctorFollowups(
  opts: { caseIds?: string[] } = {}
): Promise<{ scanned: number; sent: number }> {
  const now = Date.now()
  const cases = await prisma.plantDoctorCase.findMany({
    where: {
      createdAt: { gte: new Date(now - FOLLOWUP_MAX_AGE_MS), lte: new Date(now - FOLLOWUP_MIN_AGE_MS) },
      outcomes: { none: {} },
      user: activeAuthor(),
      ...(opts.caseIds ? { id: { in: opts.caseIds } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: FOLLOWUP_SCAN_CAP,
    select: { id: true, userId: true, resultId: true },
  })
  if (!cases.length) return { scanned: 0, sent: 0 }

  const pre = await loadAssistPrelude(
    cases.map((c) => c.userId),
    cases.map((c) => `assist:pd-followup:${c.id}`)
  )

  let sent = 0
  for (const c of cases) {
    if (sent >= FOLLOWUP_SEND_CAP) break
    const title = WIZARD_RESULTS[c.resultId]?.title ?? c.resultId.replace(/_/g, " ")
    const r = await botAssist({
      key: `assist:pd-followup:${c.id}`,
      kind: "pd-followup",
      userId: c.userId,
      title: "How did that fix work out?",
      content: `You tracked "${title}" on Plant Doctor a few days ago. Report what happened — it helps the next grower with the same problem.`,
      link: "/plant-doctor",
      pre,
    })
    if (r === "sent") sent++
  }
  return { scanned: cases.length, sent }
}
