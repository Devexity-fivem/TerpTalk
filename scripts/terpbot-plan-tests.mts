// TerpBot 2.0 Phase I — Grow Intelligence Snapshot, capability model,
// checklist engine, /plan renderer tests (pure, no DB).
//
// Behavioral coverage:
//   snapshot determinism + effective stage (harvested → HARVEST)
//   capability ladder — proven / plausible / unknown / excluded /
//     unreportable; missing data never means missing equipment
//   /check — structurally-excluded steps never surface (DWC runoff)
//   checklist — stage applicability, evidence-driven states, lifecycle
//   /plan renderer — sections, privacy (raw setup text never renders),
//     bounded output
//   session evidence diaryId attribution — records merge only onto
//     the diary they were reported against
//   knowledge version pin
//
// Run: tsx scripts/terpbot-plan-tests.mts

import { strict as assert } from "node:assert"
import { detectTrend, seriesStats } from "@/lib/terpbot-intel-calc"
import { evaluateContext, nextActions, nextUsefulMeasurement } from "@/lib/terpbot-intel"
import { stepCapability, adjustCapabilities, feasibilityBonus } from "@/lib/terpbot-intel-capability"
import { buildSnapshot, capabilityOf, readingOf } from "@/lib/terpbot-intel-snapshot"
import { buildChecklist, activeChecklist } from "@/lib/terpbot-intel-checklist"
import { renderPlan, renderStatus } from "@/lib/terpbot-intel-status"
import { buildCultivationDecisions } from "@/lib/terpbot-intel-decisions"
import { mergeReported, mergeObservations, mergeInterventions, mergeResolutions, REPORTABLE_METRICS } from "@/lib/terpbot-intel-merge"
import { KNOWLEDGE_VERSION } from "@/lib/terpbot-intel-knowledge"
import { getChatCommand } from "@/lib/chat-commands"
import { parseTerpbotIntent } from "@/lib/terpbot-intents"
import type { GrowContextView, IntelSeries } from "@/lib/terpbot-intel-types"

const DAY = 86400000
const t0 = Date.UTC(2025, 0, 1)
const NOW = t0 + 40 * DAY

const pts = (vals: number[], stepMs = DAY) => vals.map((v, i) => ({ t: t0 + i * stepMs, v }))
const mkSeries = (vals: number[], eps: number): IntelSeries => {
  const points = pts(vals)
  return { ...seriesStats(points), points, trend: detectTrend(points, eps) }
}
// fresh series — newest point lands 1d before NOW so readings are current
const freshPts = (vals: number[], stepMs = DAY) =>
  vals.map((v, i) => ({ t: NOW - (vals.length - i) * stepMs, v }))
const freshSeries = (vals: number[], eps: number): IntelSeries => {
  const points = freshPts(vals)
  return { ...seriesStats(points), points, trend: detectTrend(points, eps) }
}
const emptySeries: IntelSeries = {
  n: 0, latest: null, mean: null, min: null, max: null,
  medianIntervalDays: null, points: [], trend: "insufficient",
}
const mkCtx = (over: Partial<GrowContextView> = {}): GrowContextView => ({
  scope: "public",
  diary: {
    id: "d1", slug: "d1-slug", title: "Test", stage: "FLOWER", visibility: "PUBLIC",
    startDate: new Date(t0), harvested: false,
    mediumType: "COCO", lightType: "LED", growType: "INDOOR", techniques: [],
  },
  setup: { present: false, medium: null, capabilities: [] },
  now: NOW,
  day: 41, week: 6,
  stageDays: 20, stageStartCensored: false,
  stageTransitions: [],
  updateCount: 4, daysSinceUpdate: 1,
  envCoverage: 1,
  series: {
    temperature: emptySeries, humidity: emptySeries, ph: emptySeries,
    ec: emptySeries, height: emptySeries, vpdEntered: emptySeries, vpdComputed: emptySeries,
    runoffPh: emptySeries, runoffEc: emptySeries,
  },
  vpdDivergence: null,
  missing: [],
  freshness: {},
  ...over,
  observations: over.observations ?? [],
  baselines: over.baselines ?? {},
})
const withSeries = (
  over: Partial<GrowContextView["series"]>,
  ctxOver: Partial<GrowContextView> = {}
) => mkCtx({ series: { ...mkCtx().series, ...over }, ...ctxOver })

let passed = 0
const ok = (name: string) => { passed++; console.log(`  ✓ ${name}`) }

function run() {
  // ── 1. Snapshot determinism ──────────────────────────────────────
  {
    const ctx = withSeries({
      temperature: mkSeries([74, 76, 78, 79], 2),
      humidity: mkSeries([55, 57, 59, 61], 3),
      ph: mkSeries([5.8, 5.9], 0.15),
    })
    const a = buildSnapshot(structuredClone(ctx))
    const b = buildSnapshot(structuredClone(ctx))
    assert.equal(JSON.stringify(a), JSON.stringify(b), "identical context → identical snapshot")
    ok("snapshot determinism")
  }

  // ── 2. Effective stage — harvested diary resolves to post-harvest ─
  {
    const live = buildSnapshot(mkCtx())
    assert.equal(live.stage, "FLOWER")
    assert.equal(live.harvested, false)

    const harvestedFlower = buildSnapshot(mkCtx({
      diary: { ...mkCtx().diary, harvested: true, stage: "FLOWER" },
    }))
    assert.equal(harvestedFlower.stage, "HARVEST", "harvested growth-stage → HARVEST")
    assert.equal(harvestedFlower.declaredStage, "FLOWER")

    const drying = buildSnapshot(mkCtx({
      diary: { ...mkCtx().diary, harvested: true, stage: "DRYING" },
    }))
    assert.equal(drying.stage, "DRYING", "declared post-harvest stage passes through")
    ok("effective stage (harvested → post-harvest)")
  }

  // ── 3. Readings rows — order, provenance, band, staleness ────────
  {
    const snap = buildSnapshot(withSeries({
      temperature: freshSeries([70, 72, 95], 2), // 95°F — outside flower band
      humidity: freshSeries([50, 52, 51], 3),
      ph: freshSeries([5.9, 6.0], 0.15),
    }))
    const order = snap.readings.map((r) => r.metric)
    assert.deepEqual(order, ["temperature", "humidity", "ph"], "fixed canonical order")
    const temp = readingOf(snap, "temperature")!
    assert.equal(temp.value, 95)
    assert.equal(temp.inBand, false, "95°F outside flower band")
    assert.equal(temp.stale, false)
    assert.equal(temp.provenance, "logged")
    const ph = readingOf(snap, "ph")!
    assert.deepEqual(ph.band, [5.5, 6.2], "coco pH band")
    assert.equal(ph.inBand, true)
    ok("reading rows — order/band/provenance")
  }

  // ── 4. Targets — medium-resolved pH, stage bands, honest unknown ──
  {
    const snap = buildSnapshot(mkCtx())
    assert.deepEqual(snap.targets.ph, [5.5, 6.2])
    assert.equal(snap.targets.phBandKnown, true)
    assert.deepEqual(snap.targets.vpd, [1.0, 1.5])
    assert.equal(snap.targets.ecFloor, 1.0)

    const noMedium = buildSnapshot(mkCtx({ diary: { ...mkCtx().diary, mediumType: null } }))
    assert.equal(noMedium.targets.ph, null)
    assert.equal(noMedium.targets.phBandKnown, false)
    ok("targets — medium/stage resolved, honest unknowns")
  }

  // ── 5. Capability ladder ─────────────────────────────────────────
  {
    const ctx = withSeries({ ec: mkSeries([1.2, 1.4], 0.2) })
    assert.equal(stepCapability(ctx, "ec").feasibility, "proven", "series data proves it")
    assert.equal(stepCapability(ctx, "runoffEc").feasibility, "unknown", "no evidence either way")
    assert.equal(stepCapability(ctx, "ppfd").feasibility, "unreportable", "no series path")
    assert.equal(stepCapability(ctx, "leafTemp").feasibility, "unreportable")
    assert.equal(stepCapability(ctx, "inspect:leaf-undersides").feasibility, "proven", "observation is intrinsic")
    assert.equal(stepCapability(ctx, "height").feasibility, "proven", "height needs no instrument")
    // coco → declared soilless → ph plausible
    assert.equal(stepCapability(ctx, "ph").feasibility, "plausible")
    assert.equal(stepCapability(ctx, "ph").basis, "declared")
    // soil medium → ph unknown (no declared reason to assume a meter)
    const soil = mkCtx({ diary: { ...mkCtx().diary, mediumType: "SOIL" } })
    assert.equal(stepCapability(soil, "ph").feasibility, "unknown")
    // setup keyword → plausible
    const kws = mkCtx({ diary: { ...mkCtx().diary, mediumType: "SOIL" }, setup: { present: true, medium: null, capabilities: ["ph-meter"] } })
    assert.equal(stepCapability(kws, "ph").feasibility, "plausible")
    assert.equal(stepCapability(kws, "ph").basis, "setup-text")
    // DWC → runoff excluded
    const dwc = mkCtx({ diary: { ...mkCtx().diary, mediumType: "DWC" } })
    assert.equal(stepCapability(dwc, "runoffEc").feasibility, "excluded")
    assert.equal(stepCapability(dwc, "runoffPh").feasibility, "excluded")
    assert.equal(stepCapability(dwc, "ph").feasibility, "plausible", "DWC still implies pH management")
    // VPD derivable — temp+RH data proves it without an entered series
    const deriv = withSeries({ temperature: mkSeries([74, 76], 2), humidity: mkSeries([55, 57], 3) })
    assert.equal(stepCapability(deriv, "vpd").feasibility, "proven")
    // feasibility bonus is bounded
    assert.equal(feasibilityBonus(stepCapability(ctx, "ec")), 2)
    assert.equal(feasibilityBonus(stepCapability(ctx, "runoffEc")), 0)
    ok("capability ladder — proven/plausible/unknown/excluded/unreportable")
  }

  // ── 6. Adjust capabilities — heuristic + structural ──────────────
  {
    const indoor = mkCtx({ setup: { present: true, medium: null, capabilities: ["dehumidifier", "ac"] } })
    const ids = adjustCapabilities(indoor).map((c) => c.id)
    assert.ok(ids.includes("humidity-down") && ids.includes("temperature-down"))
    const outdoor = mkCtx({
      diary: { ...mkCtx().diary, growType: "OUTDOOR" },
      setup: { present: true, medium: null, capabilities: ["dehumidifier", "ac", "auto-irrigation"] },
    })
    const outIds = adjustCapabilities(outdoor).map((c) => c.id)
    assert.deepEqual(outIds, ["irrigation-timing"], "outdoor can't adjust weather")
    ok("adjust capabilities — setup-text heuristic + outdoor exclusion")
  }

  // ── 7. /check never asks the impossible ──────────────────────────
  {
    // DWC diary with drifting pH → ph_drift/ph_lockout discriminate on
    // runoff, which is structurally absent on DWC
    const dwc = withSeries(
      { ph: mkSeries([6.8, 6.9, 7.0, 7.1], 0.15), ec: mkSeries([1.8, 1.9], 0.2) },
      { diary: { ...mkCtx().diary, mediumType: "DWC" } }
    )
    const diag = evaluateContext(dwc)
    const actions = nextActions(dwc, diag)
    const stepIds = actions.map((a) => a.stepId).filter(Boolean) as string[]
    assert.ok(!stepIds.includes("runoffEc") && !stepIds.includes("runoffPh"),
      `DWC runoff must never be asked — got ${stepIds.join(",")}`)
    const next = nextUsefulMeasurement(dwc, diag)
    assert.ok(!next || (next.id !== "runoffEc" && next.id !== "runoffPh"),
      "nextUsefulMeasurement excludes structural impossibilities")

    // Every action step is answerable — no unreportable leaks
    const ctx = withSeries({ ph: mkSeries([7.0, 7.1, 7.2], 0.15) })
    for (const a of nextActions(ctx, evaluateContext(ctx))) {
      if (!a.stepId) continue
      const cap = stepCapability(ctx, a.stepId)
      assert.ok(cap.feasibility !== "excluded" && cap.feasibility !== "unreportable",
        `unanswerable step surfaced: ${a.stepId}`)
    }
    ok("/check capability-aware — excluded/unreportable never surface")
  }

  // ── 8. Checklist — stage applicability + evidence states ─────────
  {
    const flower = buildChecklist(buildSnapshot(mkCtx()))
    const byId = new Map(flower.map((i) => [i.id, i]))
    assert.equal(byId.get("env-temperature")!.state, "unknown", "no temp data → unknown")
    assert.equal(byId.get("dry-environment")!.state, "not_applicable", "drying items N/A in flower")
    assert.equal(byId.get("flower-maturity")!.state, "watch", "early flower — not yet due")
    assert.equal(byId.get("rz-runoff")!.state, "unknown", "coco has runoff; none logged → unknown")

    // out-of-band RH in flower → concern
    const humid = buildChecklist(buildSnapshot(withSeries({ humidity: freshSeries([66, 68, 70], 3) })))
    assert.equal(new Map(humid.map((i) => [i.id, i])).get("env-humidity")!.state, "concern")
    // in-band RH → satisfied
    const goodRh = buildChecklist(buildSnapshot(withSeries({ humidity: freshSeries([48, 50, 52], 3) })))
    assert.equal(new Map(goodRh.map((i) => [i.id, i])).get("env-humidity")!.state, "satisfied")
    ok("checklist — stage applicability + band states")
  }

  // ── 9. Checklist — lifecycle: drying/curing reachable ────────────
  {
    const drying = buildChecklist(buildSnapshot(mkCtx({
      diary: { ...mkCtx().diary, stage: "DRYING", harvested: true },
    })))
    const d = new Map(drying.map((i) => [i.id, i]))
    assert.equal(d.get("dry-environment")!.state, "due", "dry room numbers essential")
    assert.equal(d.get("dry-stemsnap")!.state, "due", "day-20 fixture → stem-snap check due")
    assert.equal(d.get("cure-rh")!.state, "not_applicable", "curing items N/A while drying")
    // env items still apply post-harvest (LIVING stages)
    assert.notEqual(d.get("env-humidity")!.state, "not_applicable")

    const curing = buildChecklist(buildSnapshot(mkCtx({
      diary: { ...mkCtx().diary, stage: "CURING", harvested: true },
    })))
    const c = new Map(curing.map((i) => [i.id, i]))
    assert.equal(c.get("cure-rh")!.state, "due", "jar RH is the cure's one number")
    assert.equal(c.get("dry-stemsnap")!.state, "not_applicable")
    ok("checklist — drying/curing playbooks reachable")
  }

  // ── 10. Same stage, different evidence → different plan ──────────
  {
    const growA = activeChecklist(buildSnapshot(withSeries({
      humidity: freshSeries([66, 68, 70], 3), // high RH in flower
    })))
    const growB = activeChecklist(buildSnapshot(withSeries({
      humidity: freshSeries([48, 50, 52], 3), // stable env, EC missing
    })))
    const aStates = growA.filter((i) => i.state === "concern").map((i) => i.id)
    const bStates = growB.filter((i) => i.state === "concern").map((i) => i.id)
    assert.ok(aStates.includes("env-humidity"), "high RH grow flags humidity")
    assert.ok(!bStates.includes("env-humidity"), "stable grow does not")
    assert.ok(
      growB.some((i) => i.id === "rz-ec" && i.state === "unknown"),
      "EC-missing grow surfaces root-zone gap"
    )
    ok("evidence-adaptive plans")
  }

  // ── 11. Checklist determinism ────────────────────────────────────
  {
    const snap = buildSnapshot(withSeries({ ph: mkSeries([5.9, 6.0], 0.15) }))
    const a = buildChecklist(structuredClone(snap)).map((i) => `${i.id}:${i.state}`)
    const b = buildChecklist(structuredClone(snap)).map((i) => `${i.id}:${i.state}`)
    assert.deepEqual(a, b)
    ok("checklist determinism")
  }

  // ── 12. renderPlan — sections, privacy, bounded ──────────────────
  {
    const rawSecret = "my-secret-setup-notes-xyz"
    const ctx = mkCtx({
      diary: { ...mkCtx().diary, mediumType: "COCO", lightType: "LED" },
      setup: { present: true, medium: rawSecret, capabilities: ["ph-meter", "dehumidifier"] },
    })
    const snap = buildSnapshot(ctx)
    const lines = renderPlan(snap, activeChecklist(snap))
    const text = lines.join("\n")
    assert.ok(text.includes("🗺 Plan — Flower"), "stage header")
    assert.ok(text.includes("Setup:"), "setup section")
    assert.ok(text.includes("coco"), "declared medium renders as label")
    assert.ok(!text.includes(rawSecret), "raw setup free text NEVER renders")
    assert.ok(text.includes("(setup text)"), "keyword capabilities marked heuristic")
    assert.ok(text.includes("Watch:") || text.includes("Unknown:"), "sections render")
    assert.ok(text.length < 2000, "plan bounded — fits the ≤2×1000 message cap")
    ok("renderPlan — sections, privacy, bounded")
  }

  // ── 13. renderStatus — setup section is canonical ────────────────
  {
    const ctx = mkCtx({
      diary: { ...mkCtx().diary, mediumType: "COCO" },
      setup: { present: true, medium: "raw free text", capabilities: ["ph-meter"] },
    })
    const snap = buildSnapshot(ctx)
    const lines = renderStatus(ctx, snap.diagnosis, buildCultivationDecisions(snap))
    const setupLine = lines.find((l) => l.startsWith("Setup:"))
    assert.ok(setupLine, "setup section renders")
    assert.ok(setupLine!.includes("coco") && setupLine!.includes("LED"))
    assert.ok(setupLine!.includes("pH meter (setup text)"))
    assert.ok(!setupLine!.includes("raw free text"))
    ok("/status setup section — canonical labels only")
  }

  // ── 14. /plan registered — command + mention intent ──────────────
  {
    const meta = getChatCommand("plan")
    assert.ok(meta, "/plan registered")
    assert.ok(meta!.surfaces.includes("mention"), "mention surface enabled")
    assert.equal(meta!.category, "grow")
    for (const [text, want] of [
      ["@terpbot what's the plan for my grow", "plan"],
      ["@terpbot my grow plan", "plan"],
      ["@terpbot stage checklist", "plan"],
      ["@terpbot my grow", "grow"],
      ["@terpbot what should I check", "check"],
    ] as const) {
      const r = parseTerpbotIntent(text)
      assert.equal(r.kind, "command", `"${text}" → command`)
      assert.equal((r as { name: string }).name, want, `"${text}" → ${want}`)
    }
    ok("/plan dispatch + intent ordering")
  }

  // ── 15. Session evidence diaryId attribution ─────────────────────
  {
    const ctx = mkCtx() // diary.id = "d1"
    const reported = [
      { metric: "ph" as const, value: 6.1, unit: undefined, t: NOW, diaryId: "d1" },
      { metric: "ec" as const, value: 1.5, unit: "mscm", t: NOW, diaryId: "d2" },
      { metric: "humidity" as const, value: 55, unit: "percent", t: NOW }, // legacy un-attributed
    ]
    const merged = mergeReported(ctx, reported, NOW)
    assert.equal(merged.series.ph.n, 1, "own-diary report merges")
    assert.equal(merged.series.ec.n, 0, "other-diary report does NOT merge")
    assert.equal(merged.series.humidity.n, 1, "legacy un-attributed still merges")

    // the no-diary context must NOT accept stamped records — evidence
    // from diary d2 would render as unattributed on an empty grow
    const noDiary = mkCtx({ diary: { ...mkCtx().diary, id: "" } })
    const mergedAll = mergeReported(noDiary, reported, NOW)
    assert.equal(mergedAll.series.ec.n, 0, "stamped records never merge onto a no-diary context")
    assert.equal(mergedAll.series.humidity.n, 1, "un-stamped legacy records still merge")

    // observations + interventions follow the same rule
    const obs = mergeObservations(ctx, [
      { symptom: "LEAF_YELLOWING", t: NOW, diaryId: "d2" },
      { symptom: "SPOTS", t: NOW, diaryId: "d1" },
    ])
    assert.equal(obs.observations.length, 1)
    assert.equal(obs.observations[0].symptom, "SPOTS")

    const ivs = mergeInterventions(ctx, [
      { type: "RH_DOWN", at: NOW, targetMetric: "humidity", diaryId: "d2" },
      { type: "PH_UP", at: NOW, targetMetric: "ph", diaryId: "d1" },
    ])
    assert.equal(ivs.interventions!.length, 1)
    assert.equal(ivs.interventions![0].type, "PH_UP")

    const res = mergeResolutions(ctx, [
      { symptom: "LEAF_YELLOWING", kind: "resolved", t: NOW, diaryId: "d2" },
      { symptom: "SPOTS", kind: "resolved", t: NOW, diaryId: "d1" },
    ])
    assert.equal(res.resolutions!.length, 1)
    assert.equal(res.resolutions![0].symptom, "SPOTS")
    ok("session evidence diaryId attribution")
  }

  // ── 16. Snapshot capabilities list — bounded, canonical ──────────
  {
    const snap = buildSnapshot(withSeries({ ec: mkSeries([1.2, 1.4], 0.2) }))
    assert.ok(snap.capabilities.length <= 20, "capability list bounded")
    assert.equal(capabilityOf(snap, "ec")!.feasibility, "proven")
    assert.ok(snap.capabilityUnknown.includes("runoffEc"), "unproven reportable metric listed")
    assert.ok(!snap.capabilityUnknown.includes("ec"), "proven metric not listed as unknown")
    ok("snapshot capability inventory")
  }

  // ── 17. Missing vs unknown honesty ───────────────────────────────
  {
    const dwc = buildSnapshot(mkCtx({ diary: { ...mkCtx().diary, mediumType: "DWC" } }))
    assert.ok(!dwc.missingReportable.includes("runoffEc"), "DWC runoff is N/A, not missing")
    const soil = buildSnapshot(mkCtx({ diary: { ...mkCtx().diary, mediumType: "SOIL" } }))
    // soil ctx.missing only carries schema metrics — runoff isn't schema
    assert.ok(soil.missingReportable.every((m) => REPORTABLE_METRICS.has(m)))
    ok("missing vs not-applicable honesty")
  }

  // ── 18. Knowledge version pin ────────────────────────────────────
  {
    assert.equal(KNOWLEDGE_VERSION, "2.6", "Phase J stabilization knowledge version")
    ok("knowledge version 2.6")
  }

  // ── 19. Audit pins — honesty under weak/absent evidence ──────────
  {
    // approximate-only series (a vague "was about 4.5 a while back")
    // must render stale + user-reported, never a fresh "logged" reading
    const approx: IntelSeries = {
      ...mkSeries([4.5], 0.15),
      points: [{ t: NOW - 30 * DAY, v: 4.5, tApproximate: true, provenance: "user-reported" }],
    }
    const snapA = buildSnapshot(withSeries({ ph: approx }))
    const phRow = readingOf(snapA, "ph")!
    assert.equal(phRow.stale, true, "approximate-only reading is stale")
    assert.equal(phRow.provenance, "user-reported")
    const clA = new Map(buildChecklist(snapA).map((i) => [i.id, i.state]))
    assert.equal(clA.get("rz-ph"), "due", "approximate pH is a re-check, not an alarm")

    // a stage with no resolved band can't claim "satisfied"
    const harv = buildChecklist(buildSnapshot(mkCtx({
      diary: { ...mkCtx().diary, stage: "HARVEST", harvested: true },
      series: { ...mkCtx().series, humidity: freshSeries([60, 61], 3) },
    })))
    assert.equal(new Map(harv.map((i) => [i.id, i])).get("env-humidity")!.state, "watch",
      "no RH band at HARVEST → watch, never satisfied")

    // no data at all → env-stability is unknown, not satisfied
    const bare = buildChecklist(buildSnapshot(mkCtx()))
    assert.equal(new Map(bare.map((i) => [i.id, i])).get("env-stability")!.state, "unknown")

    // one stale runoff series (other never logged) → due, not satisfied
    const staleRunoff = buildChecklist(buildSnapshot(mkCtx({
      series: { ...mkCtx().series, runoffPh: mkSeries([6.1], 0.15) }, // 40d old → stale
    })))
    assert.equal(new Map(staleRunoff.map((i) => [i.id, i])).get("rz-runoff")!.state, "due")

    // setup keyword can't prove airflow — harv-airflow is always watch
    const harvAir = buildChecklist(buildSnapshot(mkCtx({
      diary: { ...mkCtx().diary, stage: "HARVEST", harvested: true },
      setup: { present: true, medium: null, capabilities: ["airflow"] },
    })))
    assert.equal(new Map(harvAir.map((i) => [i.id, i])).get("harv-airflow")!.state, "watch")
    ok("audit pins — honest states under weak/absent evidence")
  }
}

run()
console.log(`\nterpbot-plan: ${passed} checks passed`)
