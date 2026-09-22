// TerpBot intelligence — grow timeline.
// Derived-on-read chronology over GrowDiary + DiaryUpdate rows. Updates
// are editable (stage/metrics PATCH-able, rows hard-deletable), so the
// timeline is NEVER persisted — it is rebuilt from source rows each
// call, same contract as stageDurations()/computeGrowJourney().
//
// Events carry references and canonical scalars only — no update text,
// no titles. The windowed variant rides the intel fetch; the full
// variant is a separate bounded lean query.
//
// Honest gaps: no watering events exist (DiaryUpdate has no watering
// field — feeding text is the only irrigation-adjacent signal), and
// "env-reading" is a record of what was logged, not a continuous
// environment history.

import { prisma } from "@/lib/prisma"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { parseGrowText } from "@/lib/terpbot-nl-parse"
import type {
  GrowTimelineEvent,
  StageTransition,
} from "@/lib/terpbot-intel-types"

/** Full-history bound — matches the diary page's lean-query precedent.
 *  One indexed scan on @@index([diaryId, createdAt]). */
export const TIMELINE_MAX_ROWS = 200

/** Row shape the pure builder needs — the intel window's select plus
 *  training/images. Both fetch paths select exactly these fields. */
export interface TimelineRow {
  id: string
  createdAt: Date
  stage: string
  feeding: string | null
  training: string | null
  content: string | null
  temperature: number | null
  humidity: number | null
  vpd: number | null
  ph: number | null
  ec: number | null
  heightCm: number | null
  imageCount: number
}

export interface TimelineDiary {
  id: string
  stage: string
  startDate: Date
  harvested: boolean
  harvestedAt: Date | null
}

/** Detect stage boundaries across chronologically-ordered rows plus the
 *  known previous-stage boundary. Rows must be sorted (createdAt, id)
 *  ascending — the caller's total order. Pure. */
export function stageTransitions(
  rows: { createdAt: Date; stage: string }[],
  currentStage: string,
  prevStage: { createdAt: Date; stage: string } | null
): StageTransition[] {
  const out: StageTransition[] = []
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].stage !== rows[i - 1].stage) {
      out.push({ from: rows[i - 1].stage, to: rows[i].stage, t: rows[i].createdAt.getTime() })
    }
  }
  // Boundary into the current stage when it isn't inside the window:
  // prevStage is the newest update at a different stage — the transition
  // happened between it and the first current-stage row.
  const intoCurrent = out.length && out[out.length - 1].to === currentStage
  if (!intoCurrent && prevStage && prevStage.stage !== currentStage) {
    const firstCurrent = rows.find((r) => r.stage === currentStage)
    out.push({
      from: prevStage.stage,
      to: currentStage,
      // first current-stage row is the boundary's upper bound — the
      // transition happened in (prevStage.t, firstCurrent.t]. When no
      // current-stage row is in the fetched set the boundary predates
      // it entirely → censored, t = the prevStage probe only.
      t: (firstCurrent?.createdAt ?? prevStage.createdAt).getTime(),
      censored: !firstCurrent,
    })
  }
  return out
}

const TRAINING_TAGS = new Set([
  "lst", "hst", "topping", "topped", "fim", "fimming", "scrog", "sog",
  "defoliation", "defoliated", "mainlining", "mainline", "lollipopping",
  "supercropping", "supercrop", "transplant", "transplanted", "repotted",
])

/** Pure event builder over already-fetched rows. Rows must arrive in
 *  ascending (createdAt, id) order — the caller's total order. Emits at
 *  most ~3 events per row plus diary-level events; bounded by the row
 *  bound. */
export function timelineFromRows(
  rows: TimelineRow[],
  diary: TimelineDiary,
  transitions: StageTransition[]
): GrowTimelineEvent[] {
  const events: GrowTimelineEvent[] = []
  const diaryRef = { refId: diary.id, refModel: "GrowDiary" as const }

  events.push({
    id: `grow-start:diary:${diary.id}`,
    kind: "grow-start",
    t: diary.startDate.getTime(),
    ...diaryRef,
  })

  const transitionByRow = new Map<string, StageTransition>()
  // A transition's row = first row at the new stage
  let prev: string | null = null
  for (const r of rows) {
    if (prev !== null && r.stage !== prev) {
      const tr = transitions.find((t) => t.to === r.stage && t.t === r.createdAt.getTime())
      if (tr) transitionByRow.set(r.id, tr)
    }
    prev = r.stage
  }

  for (const u of rows) {
    const t = u.createdAt.getTime()
    const ref = { refId: u.id, refModel: "DiaryUpdate" as const }
    const tr = transitionByRow.get(u.id)
    if (tr) {
      events.push({
        id: `stage-change:${u.id}`,
        kind: tr.to === "COMPLETED" ? "completed" : "stage-change",
        t,
        ...ref,
        stage: tr.to,
        data: { from: tr.from, to: tr.to },
      })
    }

    const env: Record<string, number> = {}
    for (const k of ["temperature", "humidity", "vpd", "ph", "ec"] as const) {
      if (u[k] != null) env[k] = u[k]!
    }
    if (Object.keys(env).length) {
      events.push({ id: `env-reading:${u.id}`, kind: "env-reading", t, ...ref, stage: u.stage, data: env })
    }
    if (u.heightCm != null) {
      events.push({ id: `measurement:${u.id}`, kind: "measurement", t, ...ref, stage: u.stage, data: { height: u.heightCm } })
    }
    if (u.feeding) {
      // structured scalars only — runoff values if the text parses to
      // them; never the feeding text itself
      const parsed = parseGrowText(u.feeding)
      const data: Record<string, number> = {}
      for (const m of parsed.measurements) {
        if (m.metric === "runoffPh" && m.value != null && data.runoffPh == null) data.runoffPh = m.value
        if (m.metric === "runoffEc" && m.value != null && data.runoffEc == null) data.runoffEc = m.value
        if (m.metric === "ec" && m.value != null && data.ec == null) data.ec = m.value
        if (m.metric === "ph" && m.value != null && data.ph == null) data.ph = m.value
      }
      events.push({ id: `feeding:${u.id}`, kind: "feeding", t, ...ref, stage: u.stage, data })
    }
    if (u.training) {
      const tags = [...new Set(
        u.training.toLowerCase().split(/[,;\/\s]+/).filter((w) => TRAINING_TAGS.has(w))
      )]
      events.push({ id: `training:${u.id}`, kind: "training", t, ...ref, stage: u.stage, data: { tags: tags.join(",") } })
    }
    if (u.imageCount > 0) {
      events.push({ id: `photo:${u.id}`, kind: "photo", t, ...ref, stage: u.stage, data: { count: u.imageCount } })
    }
    if (u.content) {
      const parsed = parseGrowText(u.content)
      for (const o of parsed.observations) {
        events.push({
          id: `symptom:${u.id}:${o.symptom}`,
          kind: "symptom",
          t,
          ...ref,
          stage: o.stage ?? u.stage,
          data: { symptom: o.symptom, ...(o.location ? { location: o.location } : {}) },
        })
      }
    }
  }

  if (diary.harvested && diary.harvestedAt) {
    events.push({
      id: `harvest:diary:${diary.id}`,
      kind: "harvest",
      t: diary.harvestedAt.getTime(),
      ...diaryRef,
      stage: "HARVEST",
    })
  }

  events.sort((a, b) => a.t - b.t || a.id.localeCompare(b.id))
  return events
}

/** Bounded timeline fetch. Same scope contract as buildGrowContext:
 *  "public" requires visibility PUBLIC; "owner" is owner-bound only.
 *  Unlike the intel builder, harvested diaries ARE allowed — a
 *  timeline's whole point is covering harvest/dry/cure. */
export async function buildGrowTimeline(
  diaryId: string,
  opts: { ownerId: string; scope: "public" | "owner"; maxRows?: number }
): Promise<GrowTimelineEvent[] | null> {
  const scope = opts.scope === "public" ? publicDiaryWhere : {}
  const diary = await prisma.growDiary.findFirst({
    where: { id: diaryId, authorId: opts.ownerId, deleted: false, ...scope },
    select: { id: true, stage: true, startDate: true, harvested: true, harvestedAt: true },
  })
  if (!diary) return null

  const desc = await prisma.diaryUpdate.findMany({
    where: { diaryId: diary.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(opts.maxRows ?? TIMELINE_MAX_ROWS, TIMELINE_MAX_ROWS),
    select: {
      id: true, createdAt: true, stage: true, feeding: true, training: true,
      content: true, temperature: true, humidity: true, vpd: true, ph: true,
      ec: true, heightCm: true,
      _count: { select: { images: true } },
    },
  })

  const rows: TimelineRow[] = [...desc]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((u) => ({
      id: u.id, createdAt: u.createdAt, stage: u.stage,
      feeding: u.feeding, training: u.training, content: u.content,
      temperature: u.temperature, humidity: u.humidity, vpd: u.vpd,
      ph: u.ph, ec: u.ec, heightCm: u.heightCm, imageCount: u._count.images,
    }))

  const prevStage = await prisma.diaryUpdate.findFirst({
    where: { diaryId: diary.id, stage: { not: diary.stage } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { createdAt: true, stage: true },
  })
  const transitions = stageTransitions(rows, diary.stage, prevStage)
  return timelineFromRows(rows, diary, transitions)
}
