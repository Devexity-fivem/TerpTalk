// TerpBot profile intelligence (Profile V2 / P5) — the owner-only
// member-level cultivation summary shown on the About tab.
//
// Contract (locked):
//   recorded      — facts directly stored in TerpTalk (counts, dates)
//   derived       — deterministic calculations over stored rows
//   recommendation — ONE deterministic suggestion: the live decision
//                    engine on the member's primary active grow when one
//                    exists, otherwise a coverage rule over their own
//                    logging history. Never LLM text, never fabricated.
//
// Privacy: the caller is always the session owner — this module counts
// the owner's PRIVATE rows too (allowed: it is their own data). It must
// never be invoked for a public-profile render or another viewer.
//
// Cost: bounded aggregate queries + at most one grow snapshot (the
// most recently updated unharvested diary). No N+1, no per-grow loops.

import { prisma } from "@/lib/prisma"
import { getGrowIntel } from "@/lib/grow-intel"

export interface ProfileIntelDTO {
  generatedAt: string
  recorded: {
    growsDocumented: number
    updatesLogged: number
    harvestsCompleted: number
    experimentsRun: number
    activeExperiments: number
    strainsGrown: number
    documentedWeeks: number
  }
  derived: {
    /** Share of logged updates carrying each signal, 0..1 (null = no updates). */
    environmentCoverage: number | null
    phCoverage: number | null
    ecCoverage: number | null
    avgUpdatesPerGrow: number | null
    /** Coverage labels — which signal the member logs best/worst. */
    strongestSignal: string | null
    weakestSignal: string | null
    mostGrownStrain: string | null
  }
  recommendation: {
    text: string
    why: string | null
    posture: string | null
    growTitle: string | null
    source: "decision-engine" | "coverage"
  } | null
}

const SIGNAL_LABELS = {
  environment: "environment readings (temp / RH / VPD)",
  ph: "pH readings",
  ec: "EC readings",
} as const

export async function buildProfileIntel(ownerId: string): Promise<ProfileIntelDTO> {
  const ownerScope = { authorId: ownerId }
  const alive = { authorId: ownerId, deleted: false as const }

  const [
    growCount,
    harvestCount,
    updateCount,
    experimentCount,
    activeExperimentCount,
    strainGroups,
    docWeeks,
    envUpdates,
    phUpdates,
    ecUpdates,
    primaryGrow,
  ] = await Promise.all([
    prisma.growDiary.count({ where: alive }),
    prisma.growDiary.count({ where: { ...alive, harvested: true } }),
    prisma.diaryUpdate.count({ where: { ...ownerScope, diary: { deleted: false } } }),
    prisma.growExperiment.count({ where: { ...ownerScope, diary: { deleted: false } } }),
    prisma.growExperiment.count({ where: { ...ownerScope, status: { in: ["ACTIVE", "OBSERVING"] }, diary: { deleted: false } } }),
    // All strain groups — count doubles as strainsGrown, the top row
    // (by documented grows) as mostGrownStrain. Bounded by the member's
    // own strain count.
    prisma.growDiary.groupBy({
      by: ["strainId"],
      where: { ...alive, strainId: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { strainId: "desc" } },
    }),
    prisma.diaryUpdate.groupBy({
      by: ["diaryId", "weekNumber"],
      where: { ...ownerScope, weekNumber: { not: null }, diary: { deleted: false } },
    }),
    prisma.diaryUpdate.count({
      where: {
        ...ownerScope,
        diary: { deleted: false },
        OR: [{ temperature: { not: null } }, { humidity: { not: null } }, { vpd: { not: null } }],
      },
    }),
    prisma.diaryUpdate.count({ where: { ...ownerScope, diary: { deleted: false }, ph: { not: null } } }),
    prisma.diaryUpdate.count({ where: { ...ownerScope, diary: { deleted: false }, ec: { not: null } } }),
    // The member's primary grow — most recent activity wins, same rule
    // the cockpit/assist selection uses. Bounded: a single row.
    prisma.growDiary.findFirst({
      where: { ...alive, harvested: false },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
    }),
  ])

  // ── Recorded ─────────────────────────────────────────────────────
  const recorded = {
    growsDocumented: growCount,
    updatesLogged: updateCount,
    harvestsCompleted: harvestCount,
    experimentsRun: experimentCount,
    activeExperiments: activeExperimentCount,
    strainsGrown: strainGroups.length,
    documentedWeeks: docWeeks.length,
  }

  // ── Derived ──────────────────────────────────────────────────────
  const coverageOf = (n: number) => (updateCount > 0 ? n / updateCount : null)
  const coverage: [keyof typeof SIGNAL_LABELS, number | null][] = [
    ["environment", coverageOf(envUpdates)],
    ["ph", coverageOf(phUpdates)],
    ["ec", coverageOf(ecUpdates)],
  ]
  const ranked = updateCount > 0 ? [...coverage].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) : []
  const mostGrownStrain = strainGroups[0]?.strainId
    ? (await prisma.strain.findUnique({ where: { id: strainGroups[0].strainId }, select: { name: true } }))?.name ?? null
    : null

  const derived = {
    environmentCoverage: coverageOf(envUpdates),
    phCoverage: coverageOf(phUpdates),
    ecCoverage: coverageOf(ecUpdates),
    avgUpdatesPerGrow: growCount > 0 ? Math.round((updateCount / growCount) * 10) / 10 : null,
    strongestSignal: ranked.length ? SIGNAL_LABELS[ranked[0][0]] : null,
    weakestSignal: ranked.length ? SIGNAL_LABELS[ranked[ranked.length - 1][0]] : null,
    mostGrownStrain,
  }

  // ── Recommendation ───────────────────────────────────────────────
  // Live grow → the real decision engine (same pipeline as /next and
  // the diary cockpit). No active grow → a coverage rule over the
  // member's own history; zero grows → point at the first diary.
  let recommendation: ProfileIntelDTO["recommendation"] = null
  if (primaryGrow) {
    const bundle = await getGrowIntel(primaryGrow.id, ownerId)
    if (bundle) {
      recommendation = {
        text: bundle.decisions.top.title,
        why: bundle.decisions.top.whyFirst ?? bundle.decisions.top.reason,
        posture: bundle.decisions.posture,
        growTitle: primaryGrow.title,
        source: "decision-engine",
      }
    }
  }
  if (!recommendation) {
    if (growCount === 0) {
      recommendation = {
        text: "Start your first grow diary — TerpBot reads your logged updates and builds guidance from them.",
        why: "No grows documented yet",
        posture: null,
        growTitle: null,
        source: "coverage",
      }
    } else if (ranked.length && (ranked[ranked.length - 1][1] ?? 0) < 0.5) {
      const weakest = ranked[ranked.length - 1][0]
      recommendation = {
        text: `Log ${SIGNAL_LABELS[weakest]} on your next update — only ${Math.round((ranked[ranked.length - 1][1] ?? 0) * 100)}% of your updates include them.`,
        why: "Determined from your logging coverage across all grows",
        posture: null,
        growTitle: null,
        source: "coverage",
      }
    } else if (updateCount === 0) {
      recommendation = {
        text: "Log the first update on your grow — TerpBot needs recorded data before it can guide.",
        why: "No updates logged yet",
        posture: null,
        growTitle: null,
        source: "coverage",
      }
    } else if (primaryGrow) {
      recommendation = {
        text: "Keep logging updates on your active grow — TerpBot builds guidance from what you record.",
        why: "Active grow found, but not enough recorded data yet",
        posture: null,
        growTitle: primaryGrow.title,
        source: "coverage",
      }
    } else {
      recommendation = {
        text: "No active grow — harvest or start your next diary and TerpBot tracks it from the first update.",
        why: "All documented grows are harvested",
        posture: null,
        growTitle: null,
        source: "coverage",
      }
    }
  }

  return { generatedAt: new Date().toISOString(), recorded, derived, recommendation }
}
