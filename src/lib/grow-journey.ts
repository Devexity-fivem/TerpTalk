/**
 * Grow Journey — derived grow-milestone progression.
 *
 * No persistence model: the journey is recomputed from GrowDiary +
 * DiaryUpdate rows, and milestone payouts are keyed rows in the existing
 * reputation ledger (`growstage:<diaryId>:<stage>:<userId>`). Diary deletion
 * claws every milestone back automatically because awards carry
 * sourceType=DIARY / sourceId=diaryId, which `reverseReputationBySource`
 * already unwinds in the DELETE route.
 *
 * Anti-farm: milestones require *meaningful update days* — distinct UTC
 * dates with at least one update carrying real content (≥10 chars, a
 * photo, or environmental readings) — plus elapsed-day gates, so a burst
 * of same-day filler can never unlock a stage.
 */
import { prisma } from "@/lib/prisma"
import { awardReputation } from "@/lib/reputation"
import { reverseKeyDurable } from "@/lib/reputation-outbox"
import { getBooleanSetting, SITE_SETTINGS } from "@/lib/settings"
import { isMeaningfulUpdate } from "@/lib/meaningful-update"

export const GROW_STAGES = [
  { key: "PLANTED", name: "Planted", icon: "🌱", rep: 0 },
  { key: "ESTABLISHED", name: "Established", icon: "🌿", rep: 10 },
  { key: "VEGGING", name: "Vegging", icon: "🪴", rep: 20 },
  { key: "FLOWERING", name: "Flowering", icon: "🌸", rep: 25 },
  // Harvested keeps the existing HARVEST_LOGGED payout (≥4 updates).
  { key: "HARVESTED", name: "Harvested", icon: "🌾", rep: 0 },
  { key: "COMPLETE", name: "Complete", icon: "🏆", rep: 50 },
] as const

export type GrowStageKey = (typeof GROW_STAGES)[number]["key"]

// Ordered requirements. `rep: 0` stages pay through their own existing
// awards (DIARY_CREATED for PLANTED, HARVEST_LOGGED for HARVESTED).
const REQUIREMENTS = {
  ESTABLISHED: { meaningfulDays: 3, elapsedDays: 7 },
  VEGGING: { meaningfulDays: 10, elapsedDays: 21 },
  FLOWERING: { flowerDays: 5 },
  COMPLETE: { elapsedDays: 30 },
} as const

const FLOWER_AND_BEYOND = new Set(["FLOWER", "HARVEST", "DRYING", "CURING", "COMPLETED"])

export interface GrowJourneyState {
  stage: GrowStageKey
  stageIndex: number
  /** Distinct UTC days with a meaningful update. */
  meaningfulDays: number
  flowerDays: number
  elapsedDays: number
  /** Human-readable next requirement, or null at COMPLETE. */
  next: { stage: GrowStageKey; name: string; icon: string; summary: string } | null
}

interface JourneyDiary {
  id: string
  authorId: string
  stage: string
  // startDate is user-supplied (back-dating a real grow is legitimate), so
  // elapsed-day gates run on the immutable server-set createdAt instead.
  startDate: Date
  createdAt: Date
  harvested: boolean
  harvestedAt: Date | null
  yieldAmount: number | null
  deleted: boolean
  /** catalog strain type — only the transition wording reads this
   *  (autoflowers never get "flip to flower" phrasing) */
  strainRef?: { type: string | null } | null
}

// isMeaningfulUpdate now lives in @/lib/meaningful-update — one canonical
// predicate shared with the streak SQL so the two can never drift.

const utcDay = (d: Date) => d.toISOString().slice(0, 10)

async function loadJourneyInputs(diaryId: string) {
  const diary = await prisma.growDiary.findUnique({
    where: { id: diaryId },
    select: {
      id: true,
      authorId: true,
      stage: true,
      startDate: true,
      createdAt: true,
      harvested: true,
      harvestedAt: true,
      yieldAmount: true,
      deleted: true,
      strainRef: { select: { type: true } },
    },
  })
  if (!diary) return null
  const updates = await prisma.diaryUpdate.findMany({
    where: { diaryId },
    select: {
      createdAt: true,
      stage: true,
      content: true,
      temperature: true,
      humidity: true,
      vpd: true,
      ph: true,
      ec: true,
      feeding: true,
      training: true,
      images: { select: { id: true } },
      nutrients: { select: { id: true }, take: 1 },
    },
  })
  return { diary, updates }
}

/** Derive the current journey stage from raw diary + update rows. */
export function computeGrowJourney(
  diary: JourneyDiary,
  updates: {
    createdAt: Date
    stage: string | null
    content: string
    temperature: number | null
    humidity: number | null
    vpd: number | null
    ph: number | null
    ec: number | null
    feeding: string | null
    training: string | null
    images: { id: string }[]
    nutrients: { id: string }[]
  }[],
  now = new Date()
): GrowJourneyState {
  const meaningfulDays = new Set<string>()
  const flowerDays = new Set<string>()
  for (const u of updates) {
    if (!isMeaningfulUpdate(u)) continue
    const day = utcDay(u.createdAt)
    meaningfulDays.add(day)
    if (u.stage === "FLOWER") flowerDays.add(day)
  }
  const elapsedDays = (now.getTime() - new Date(diary.createdAt).getTime()) / 86400000
  const mDays = meaningfulDays.size
  const fDays = flowerDays.size

  let stage: GrowStageKey = "PLANTED"
  if (diary.harvested) stage = "HARVESTED"
  if (
    diary.harvested &&
    diary.yieldAmount != null &&
    elapsedDays >= REQUIREMENTS.COMPLETE.elapsedDays
  ) {
    stage = "COMPLETE"
  }
  if (stage === "PLANTED" && FLOWER_AND_BEYOND.has(diary.stage) && fDays >= REQUIREMENTS.FLOWERING.flowerDays) {
    stage = "FLOWERING"
  }
  if (
    (stage === "PLANTED" || stage === "FLOWERING") &&
    mDays >= REQUIREMENTS.VEGGING.meaningfulDays &&
    elapsedDays >= REQUIREMENTS.VEGGING.elapsedDays
  ) {
    // Vegging precedes flowering in display order but flowering is the
    // higher achievement — keep whichever is further along.
    stage = stage === "FLOWERING" ? "FLOWERING" : "VEGGING"
  }
  if (
    stage === "PLANTED" &&
    mDays >= REQUIREMENTS.ESTABLISHED.meaningfulDays &&
    elapsedDays >= REQUIREMENTS.ESTABLISHED.elapsedDays
  ) {
    stage = "ESTABLISHED"
  }

  const next = nextRequirement(stage, mDays, fDays, elapsedDays, diary.strainRef?.type)
  return {
    stage,
    stageIndex: GROW_STAGES.findIndex((s) => s.key === stage),
    meaningfulDays: mDays,
    flowerDays: fDays,
    elapsedDays: Math.max(0, Math.floor(elapsedDays)),
    next,
  }
}

function nextRequirement(
  stage: GrowStageKey,
  mDays: number,
  fDays: number,
  elapsedDays: number,
  strainType?: string | null
): GrowJourneyState["next"] {
  const meta = (key: GrowStageKey) => GROW_STAGES.find((s) => s.key === key)!
  switch (stage) {
    case "PLANTED":
      return {
        stage: "ESTABLISHED",
        name: meta("ESTABLISHED").name,
        icon: meta("ESTABLISHED").icon,
        summary: `${Math.min(mDays, REQUIREMENTS.ESTABLISHED.meaningfulDays)}/${REQUIREMENTS.ESTABLISHED.meaningfulDays} update days · day ${Math.max(0, Math.floor(elapsedDays))}/${REQUIREMENTS.ESTABLISHED.elapsedDays}`,
      }
    case "ESTABLISHED":
      return {
        stage: "VEGGING",
        name: meta("VEGGING").name,
        icon: meta("VEGGING").icon,
        summary: `${Math.min(mDays, REQUIREMENTS.VEGGING.meaningfulDays)}/${REQUIREMENTS.VEGGING.meaningfulDays} update days · day ${Math.max(0, Math.floor(elapsedDays))}/${REQUIREMENTS.VEGGING.elapsedDays}`,
      }
    case "VEGGING":
      return {
        stage: "FLOWERING",
        name: meta("FLOWERING").name,
        icon: meta("FLOWERING").icon,
        // Autoflowers flower on their own schedule — telling the grower
        // to "flip" assumes a photoperiod cultivar, so the wording drops
        // the light-cycle verb entirely.
        summary:
          strainType === "AUTO_FLOWER"
            ? `Autos flower on their own — mark the stage and log ${Math.max(0, REQUIREMENTS.FLOWERING.flowerDays - fDays)} more flower update${REQUIREMENTS.FLOWERING.flowerDays - fDays === 1 ? "" : "s"}`
            : `Flip to flower and log ${Math.max(0, REQUIREMENTS.FLOWERING.flowerDays - fDays)} more flower update${REQUIREMENTS.FLOWERING.flowerDays - fDays === 1 ? "" : "s"}`,
      }
    case "FLOWERING":
      return {
        stage: "HARVESTED",
        name: meta("HARVESTED").name,
        icon: meta("HARVESTED").icon,
        summary: "Log your harvest (requires 4+ diary updates)",
      }
    case "HARVESTED":
      return {
        stage: "COMPLETE",
        name: meta("COMPLETE").name,
        icon: meta("COMPLETE").icon,
        summary: "Record your yield to finish the grow",
      }
    default:
      return null
  }
}

/** Derived journey state for display — read-only, no awarding. */
export async function getGrowJourney(diaryId: string): Promise<GrowJourneyState | null> {
  const loaded = await loadJourneyInputs(diaryId)
  if (!loaded || loaded.diary.deleted) return null
  return computeGrowJourney(loaded.diary, loaded.updates)
}

const milestoneKey = (diaryId: string, stage: string, userId: string) =>
  `growstage:${diaryId}:${stage}:${userId}`

/**
 * Reconcile milestone awards with the diary's current derived stage.
 * Awards stages now met (keyed, idempotent) and reverses stages no longer
 * met — deleting updates or un-harvesting claws the milestone back.
 * Called from the diary-update, harvest, and update-delete routes.
 */
export async function evaluateGrowJourney(diaryId: string): Promise<void> {
  if (!(await getBooleanSetting(SITE_SETTINGS.GROW_JOURNEY_ENABLED, true))) return

  const loaded = await loadJourneyInputs(diaryId)
  if (!loaded || loaded.diary.deleted) return
  const { diary, updates } = loaded
  const state = computeGrowJourney(diary, updates)

  const met = new Set<GrowStageKey>(["PLANTED"])
  if (state.stage === "COMPLETE") {
    met.add("ESTABLISHED"); met.add("VEGGING"); met.add("FLOWERING"); met.add("HARVESTED"); met.add("COMPLETE")
  } else if (state.stage === "HARVESTED") {
    met.add("ESTABLISHED"); met.add("VEGGING"); met.add("FLOWERING"); met.add("HARVESTED")
  } else if (state.stage === "FLOWERING") {
    // Flowering without veg gates still implies the earlier grow work
    // happened — but only award stages whose own requirements were met.
    if (state.meaningfulDays >= REQUIREMENTS.ESTABLISHED.meaningfulDays && state.elapsedDays >= REQUIREMENTS.ESTABLISHED.elapsedDays) met.add("ESTABLISHED")
    if (state.meaningfulDays >= REQUIREMENTS.VEGGING.meaningfulDays && state.elapsedDays >= REQUIREMENTS.VEGGING.elapsedDays) met.add("VEGGING")
    met.add("FLOWERING")
  } else if (state.stage === "VEGGING") {
    met.add("ESTABLISHED"); met.add("VEGGING")
  } else if (state.stage === "ESTABLISHED") {
    met.add("ESTABLISHED")
  }
  // HARVESTED implies the update-days for earlier stages happened too —
  // harvest requires ≥4 updates and you can't reach harvest without veg.
  if (diary.harvested) {
    if (state.meaningfulDays >= REQUIREMENTS.ESTABLISHED.meaningfulDays && state.elapsedDays >= REQUIREMENTS.ESTABLISHED.elapsedDays) met.add("ESTABLISHED")
    if (state.meaningfulDays >= REQUIREMENTS.VEGGING.meaningfulDays && state.elapsedDays >= REQUIREMENTS.VEGGING.elapsedDays) met.add("VEGGING")
    if (state.flowerDays >= REQUIREMENTS.FLOWERING.flowerDays) met.add("FLOWERING")
    met.add("HARVESTED")
    if (state.stage === "COMPLETE") met.add("COMPLETE")
  }

  for (const s of GROW_STAGES) {
    if (s.rep === 0) continue // PLANTED/HARVESTED pay via their own awards
    const key = milestoneKey(diary.id, s.key, diary.authorId)
    if (met.has(s.key)) {
      await awardReputation(
        diary.authorId,
        "GROW_MILESTONE",
        s.rep,
        `Grow milestone: ${s.name}`,
        { key, sourceType: "DIARY", sourceId: diary.id }
      ).catch(() => {})
    } else {
      // Regressed (updates deleted, harvest undone) — claw the milestone
      // back. Durable intent: a failed reversal retries via ping/cron
      // instead of leaving phantom milestone rep. No-op when no award exists.
      await reverseKeyDurable(key, "Grow milestone no longer met").catch(() => null)
    }
  }
}
