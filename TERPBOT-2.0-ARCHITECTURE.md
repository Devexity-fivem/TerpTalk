# TerpBot 2.0 — Deterministic Cannabis Grow Intelligence

Architecture & implementation specification. Baseline: `ca2f198` (production).
Status: **Phases A, D, E shipped (see §15b + Implementation status). Phase F
shipped after: mention→`/diagnose` routing, `/why` + `BotSession` continuity,
signal-grouped evidence scoring, snapshot rule, stale degradation, and the
runoff channel. See Implementation status at the bottom.**

---

## 1. Executive summary

TerpBot today is a deterministic retrieval/command bot: 41 public commands, a regex intent
parser, event-driven announcements, and private assists — all least-privilege, public-room
only, claim-first idempotent, PUBLIC-scoped for grow data.

TerpBot 2.0 layers an **expert engine** underneath those surfaces without changing the
contract: no LLM, no external APIs, no new permissions. The pipeline becomes:

```
Natural language / command
  → Intent + entity parser (deterministic)
  → GrowContext builder (existing data, on-demand)
  → Calculator suite (pure functions)
  → Rule engine (versioned, provenance-carrying rules)
  → Diagnostic engine (candidate ranking + discriminating-measurement selection)
  → Explanation builder (evidence trail, always available)
  → Room reply / private BOT_ASSIST
```

Three load-bearing findings from the audit shape this design:

1. **A deterministic expert system already exists.** `src/lib/problem-wizard.ts` contains
   13 decision nodes → 48 diagnoses with `cause`/`fixes`/`severity`, plus
   `symptom-tags.ts` and `Thread.wizardResultId` wired into community solve-rate stats.
   TerpBot 2.0 generalizes this into a rule engine rather than building a second one.
2. **The data ceiling is real.** DiaryUpdate carries temp(°F), RH%, user-entered VPD(kPa),
   pH, EC, heightCm, feeding/training text, stage. There is **no** PPFD, photoperiod,
   watering event, runoff pH/EC, substrate moisture, leaf temp, plant count, or CO₂. The
   engine must reason well on this footprint and explicitly identify what it can't know.
3. **All delivery primitives exist.** `botAssist` (cushion + daily cap + claim + pref gate),
   `claimBotEvent`, `rateLimit`, `after()`, and PUBLIC-scope enforcement are done. Phase 1
   needs **zero schema migrations**.

Evidence base: Cornell NYS Cannabis sativa L. Guidebook & Production Manual, UC IPM
six-component framework, BC Ministry of Agriculture cannabis IPM manual, and the peer-
reviewed cannabis horticulture literature (Cockson et al. 2019; Chandra et al. 2008/2011;
Rodriguez-Morrison et al. 2021; Saloner & Bernstein 2021/2022; Bevan et al. 2021; Punja
2022; postharvest reviews). Section 6 carries the full provenance model.

---

## 2. Current TerpBot architecture (baseline `ca2f198`)

**Surfaces.** Slash commands (`/api/chat/commands` → `runBotCommand`), `@terpbot` mentions
(`/api/chat/messages` → `parseTerpbotIntent` → same dispatch, in `after()`), private channel
(`BOT_ASSIST` notifications via `notify()`), public announcements (`postBotMessage` /
`postToGeneral`), daily cron `0 14 * * *`. Since Phase F, mentions that parse to
measurements/observations route to `/diagnose`, `why…` phrasing routes to `/why`,
and bare numbers route to `/diagnose` (resolved against session `pendingAsk`);
recommendation questions like "best tent for seedlings" still fall through to
the existing fallback.

**Safety contract (unchanged).** MEMBER-role bot account, no password; rooms public-only;
60/hr global + 10/min/room output caps; mention cap 1/min/room; assists 3/day/user + 7-day
cross-kind cushion; `sanitizeEcho`/`sanitizeField`/`sanitizeExcerpt` on all echoed user text;
`resolveMember`/`publicDiaryWhere`/`activeAuthor`/mutual-block gates; `claimBotEvent`
once-ever semantics; `publicMilestoneOptOut`, `hideOnlineStatus`, `notifyOnBotAssist`
honored; `purgeDiaryAnnouncements` on visibility loss; aggregate-only telemetry.

**Telemetry.** `BotEvent` (unique `key`, `type`, `command`, `entities` — an Int
counter of surfaced links, *not* a data stash) → `getBotStats` → admin health
dashboard. Key patterns: `cmd:*`, `mention:*`, `announce:<kind>:*`,
`assist:<kind>:*`, `day:<date>`. Per-user diagnostic state lives in `BotSession`
(§10.4), not BotEvent.

**Reusable-as-is for 2.0:** the entire assist pipeline, claim/release primitives, post-
marker pattern, rate limiting, sanitizers, `after()` deferral, `BotCommandCtx`
(`rawContent`, `replyToContent` give a threading hook), cron `claimTask`, and the
announcement gating model.

**Hard constraint discovered:** there is **no conversation-state store** and chat messages
hard-delete after 3 days. Multi-turn diagnostic Q&A must either ride `replyToContent`
threading or add a small state primitive (design in §10.4).

---

## 3. Data available today (no schema change)

Directly useful and realistically populated:

| Source | Fields | Use |
|---|---|---|
| DiaryUpdate | stage, temperature(°F), humidity(%), vpd(kPa, user-entered), ph, ec(mS/cm implied), heightCm, feeding, training, createdAt | env snapshot, trends, growth rate, cadence, chemistry drift |
| GrowDiary | stage, startDate, mediumType(vocab), lightType(vocab), growType(vocab), techniques[](vocab), strain/strainId, setupId, visibility, harvested*, yield* | context, stage timing vs strain `avgFlowerDays`, medium/stage-conditioned rules |
| GrowSetup | growType, tentSize, lightType, lightWattage, lightBrand, ventilation, circulation, filter, ac, humidifier, dehumidifier, medium, containers, nutrients, phMeter, sensors (all free text ≤500) | capability inference ("has dehumidifier", "has pH meter"), env risk adjustment |
| Strain | type, avgFlowerDays, difficulty | harvest-timing expectations, stage-duration anomaly detection |
| Profile/User | notifyOnBotAssist, publicMilestoneOptOut, hideOnlineStatus, banned/suspended | all existing gates |
| problem-wizard | 13 nodes, 48 results (cause/fixes/severity), SYMPTOM_TAGS | seed knowledge base + symptom vocabulary |

Already-computed helpers: `diaryDay/diaryWeek`, `groupUpdatesByWeek`, `stageDurations`,
`growthSummary`, `buildHarvestReport`, `getStrainGrowStats` (sample-floored medians),
`getGrowStreak`, `diaryCompleteness`, `median`, `toGrams/toOz`, quest/journey engines.
`stage-tips.ts` already hard-codes per-stage targets (pH 5.8–6.2 hydro / 6.0–6.8 soil;
RH 65–70% seedling → 40–50% flower; dry 60°F/60%RH; cure 62%) — the embryonic knowledge
base to be absorbed into rules.

**Classified not-yet-usable:** `vpd` (user-entered, unvalidated — treat as *claimed*, cross-
check against computed VPD from temp+RH; divergence is itself a finding). `feeding`/
`training` free text — parse into the existing techniques vocab + a nutrient-product alias
list; never echo raw. `dayNumber`/`weekNumber` — untrusted, always derive from createdAt.

**Missing entirely (Phase-later schema candidates, deferred by design):** `lightPpfd`,
`photoperiodHours`, `wateredAt`/`irrigationMl`, `runoffPh`/`runoffEc`, `substrateMoisture`,
`leafTempF`, `plantCount`, `vpdSource` (entered|computed), `readingTakenAt`. Each is listed
with justification in §14 — none blocks Phase 1.

---

## 4. Cannabis knowledge domain map

Per domain: what's known, evidence tier, and whether TerpTalk data can activate it.

| Domain | Core deterministic content | Evidence tier | Activatable now? |
|---|---|---|---|
| Environment (T/RH/VPD) | VPD = SVP(T)·(1−RH/100); SVP Magnus/FAO-56; targets ~0.8–1.1 kPa veg, 1.0–1.5 flower, ~0.8 propagation; Topt 25–30°C, >30°C adverse | Peer-reviewed (Chandra; Frontiers 2025; IEEE survey; industry VPD tables flagged PROFESSIONAL) | ✅ temp+RH stored |
| Lighting | DLI = PPFD·h·0.0036; yield ∝ PPFD to ~1800 (linear); PCE 0.22–0.36 g/mol; UV no yield effect; blue fraction ↓ yield ~12% | Peer-reviewed (Rodriguez-Morrison 2021; Westmoreland 2021; Collado 2025) | ⚠️ lightType/lightWattage free text only — qualitative guidance until PPFD field exists |
| Irrigation/root zone | wet substrate → fungus gnats + Pythium risk; dryback/irrigation-interval effects on WUE (cVPD scheduling, −45% water, yield-neutral); coir: keep "a bit dry" | Peer-reviewed (Guelph thesis) + extension | ⚠️ no watering data — rules keyed to symptoms/cadence only |
| Nutrition pH/EC | soilless pH ~5.5–6.2 / soil ~6.0–6.8 (existing stage-tips; PROFESSIONAL tier); N optimum ~160 mg/L (Saloner/Bernstein), DWC response-surface N≈194/P≈59 (Bevan); NH4 >30% harmful; EC tolerance to 4 mS/cm without yield loss (hydro, Frontiers 2025); veg-vs-flower EC preference single-study → WEAK | Mixed: PEER-REVIEWED + PROFESSIONAL | ✅ ph/ec fields |
| Deficiency ID | Cockson 2019: per-nutrient symptom progression (initial→advanced) + MRML tissue thresholds; mobile vs immobile → lower-vs-upper leaf location is the primary discriminator | Peer-reviewed (single study — flag monoculture caveat) | ⚠️ via symptom text, not measurements |
| Training/canopy | techniques vocab exists; dense canopy ↓ airflow → moisture persistence → disease interaction | General plant science (inferential — flagged) | ✅ techniques[] |
| Pests | TSSM: warm/dry favored, 5–7d generation, stipple→bronzing, P. persimilis/N. californicus; fungus gnats: moist substrate indicator, yellow cards + potato wedge, Bti/S. feltiae/Stratiolaelaps; thrips, cannabis aphid, russet/broad mites | Extension + government (BC manual, Cornell, UMD, PNW handbook) | ✅ env conditions + symptom text |
| Disease | PM (Golovinomyces): favored >70% RH & 24–30°C **but no leaf wetness required, progresses <50% RH** — corrects folk wisdom; 3–7d secondary cycle. Botrytis bud rot: >70% RH, 17–24°C, weeks 6–8 flower, dense inflorescences. Root rots: wet substrate. HLVd: stunting, no cure — roguing. | Peer-reviewed (Punja 2022; UTIA; BC gov factsheet; Plants 2024 review) | ✅ stage + RH + temp give real risk scoring |
| Harvest | strain `avgFlowerDays` (community-computed, floored); stage timing | Internal data + PROFESSIONAL | ✅ |
| Drying | 18–21°C / 50–55% RH, 5–14 d; endpoint ~aw 0.6 | Peer-reviewed postharvest review | ✅ when stage=HARVEST/drying updates exist |
| Curing | ~62% RH target; glass > plastic for VOC retention | Peer-reviewed (McGill thesis; volatilome study) | ⚠️ advice-only, no cure telemetry |
| Genetics | strain type/difficulty; clone-source variance documented | Peer-reviewed + internal | ✅ partial |

Domains deliberately weak: CO₂ enrichment (no data + sealed-room safety concerns),
automated climate control (no actuation — prohibited), medical claims (prohibited).

---

## 5. Knowledge representation

**Rules as versioned TypeScript data, not a DB table.** Deterministic, code-reviewed,
tree-shakeable into tests, zero migration, diffable provenance. A DB `KnowledgeRule` table
is *deferred* — it buys an admin-editor UI we don't need and costs a migration + cache
layer. `knowledge/*.ts` modules export typed rule arrays.

> **As-built note (Phase F):** the proposed `Condition`/`appliesWhen` DSL was
> *not* implemented — it could not express per-candidate evidence, signal
> attribution, or measurements-as-questions. The shipped shape is plain
> TypeScript functions in `terpbot-intel.ts` / `terpbot-intel-types.ts`:

```ts
// src/lib/terpbot-intel-types.ts (as built)
type IntelRule = {
  id: string;                 // "env.vpd-band"
  title: string;
  domain: "environment" | "chemistry" | "disease" | "pest" | "nutrition"
        | "growth" | "stage" | "data";
  kind: "assessment" | "risk" | "gap" | "observation";
  signal?: SignalId;          // input group this rule's evidence derives from;
                              // rules that iterate observations emit per-evidence
                              // "symptom:<id>" signals instead
  sourceIds: string[];        // ≥1 required except kind:"gap" (validator-enforced)
  applies(ctx: GrowContextView): boolean;       // gate
  evaluate(ctx: GrowContextView): IntelEvidence[];  // emissions when it fires
};

type IntelEvidence = {
  direction: "for" | "risk" | "against" | "info";   // required
  strength: "weak" | "moderate" | "strong";          // required — 1|2|3, categorical
  text: string;               // required — rendered-safe string, no raw user text
  confirmed?: boolean;        // directly measured fact → CONFIRMED findings
  measurement?: MeasurementHint;  // next-step hint attached to the evidence
  candidate?: CandidateId;    // pools into CANDIDATES; absent → standalone finding
  signal?: SignalId;          // overrides rule.signal for this item
};
```

`EvidenceTier`, `SourceRef`, and the `cannabisSpecific` flag shipped as designed
(`terpbot-intel-knowledge.ts` `SOURCES`; `reviewedAt` deferred — validator
coverage took priority). `observes`/`discriminatesBy` live on `CandidateDef`
(`requiredInputs`, `discriminatingInputs`) instead of per-rule, since the
next-measurement question is chosen across candidates, not rules.

**Rule interaction (the §"thousands of ifs" problem):** rules never fire conclusions
directly. They emit weighted evidence into **candidates**; the diagnostic engine ranks
candidates. Interaction emerges from shared candidates: PM-risk accumulates `for` evidence
from RH>70 + warm + dense-canopy + flower-weeks-6-8 — four independent rules, one
candidate, explainable sum. `direction:"risk"` lets hazard rules (e.g., "RH climbing at
night") feed risk candidates that surface as *warnings*, not diagnoses.

---

## 6. Evidence & provenance model

Every rule carries `SourceRef[]` with `tier` and `cannabisSpecific`. Tiers in rank order:
`PEER_REVIEWED > EXTENSION > GOVERNMENT > PROFESSIONAL > COMMUNITY > INTERNAL_DATA`.
Provenance is shown on demand (`/why`), never spammed — a response footer like
`(2 sources: peer-reviewed, extension)`; full refs in the explanation object.

**Honesty rules baked into the evaluator:**
- `cannabisSpecific:false` sources produce explanation text saying "general horticulture,
  not cannabis-specific research."
- ~~A rule whose only source is COMMUNITY tier can never produce weight 3 evidence~~ —
  **not implemented (deferred).** The tier exists in the taxonomy but no evidence-weight
  cap reads it yet.
- ~~Single-study findings are capped at weight 2 and tagged `"replication": "single-study"`~~ —
  **not implemented (deferred).** No `replication` field exists on `KnowledgeSource`; thin-
  provenance knowledge instead uses the per-candidate `maxState` ceiling.

Seed source registry (~15 entries): Cockson 2019 (Appl Sci 9:4432); Chandra 2008/2011
(PMC3550641/3550580); Rodriguez-Morrison 2021 (Front Plant Sci 12:646020); Westmoreland
2021 (PLOS ONE 16:e0248988); Saloner & Bernstein 2021/2022; Bevan 2021 (Front Plant Sci
12:764103); Punja 2022 (Can J Bot, cjb-2022-0139); Frontiers 2025 RH study; postharvest
review (PMC9404914); McGill postharvest thesis; Cornell NYS Guidebook + Production Manual +
biocontrol factsheets; UC IPM "IPM in Practice"; BC cannabis IPM manual; BC cannabis
diseases factsheet; UTIA PM fungicide guide; UMD biocontrol FS-2025-0749; PNW handbook;
KSU MF2937.

---

## 7. Calculator suite (`src/lib/terpbot2/calc/`)

Pure functions, no I/O, every one with known-vector + boundary + invalid-input tests.

| Calculator | Inputs | Formula/logic | Validity & honesty notes |
|---|---|---|---|
| `vpdFromTempRh(tempF, rh)` | °F, % | SVP = 0.6108·exp(17.27T/(T+237.3)); VPD = SVP·(1−RH/100) | Air-temp VPD (no leaf temp stored). Doc: true leaf VPD ≈ this when canopy ≈ ambient; flag ±10–20% under strong light. Rejects T<−40/°F-bounds, RH∉[0,100]. |
| `dli(ppfd, hours)` | μmol/m²/s, h | PPFD·h·3600/1e6 → mol/m²/d | Only usable when PPFD known (future field or user-supplied in chat). |
| `ppfdToLux`/`luxToPpfd` | number | ×0.0185 (white LED), ×0.013 (HPS) — per-spectrum factors table | Factors labeled approximate; spectrum-dependent by nature. |
| `fToC`/`cToF` | number | exact | — |
| `ecToPpm(ec, scale)` | mS/cm, "500"|"700" | ×500 or ×700 | Never guess scale — ask or show both. |
| `seriesStats(values[])` | number[] | min/max/mean/median/last/n | n<2 → returns `{insufficient:true}` not fabricated stats. |
| `trend(points[], window)` | {t,v}[] | windowed least-squares slope + per-point step median; classifies rising/falling/stable/unstable | n<3 → "insufficient"; gaps >2× median interval → split segments. |
| `excursions(points[], lo, hi)` | {t,v}[], bounds | count + longest-run outside bounds | feeds "persistent high VPD" assists. |
| `growthRate(heights[])` | {t,cm}[] | Δcm/Δd on last two + slope over window | requires ≥2 non-equal timestamps. |
| `daysBetween(updates)` | Date[] | median interval | staleness already uses updatedAt. |
| `stageEta(stage, dayInStage, strainId)` | — | expected flower days from `Strain.avgFlowerDays` else type-typical range (floored) | labeled "community average" when internal. |
| `vpdCheck(claimed, tempF, rh)` | 3 inputs | |claimed − computed| > 0.3 kPa → flag | turns the untrusted vpd field into a finding: "your entered VPD doesn't match your temp/RH." |

No hidden constants: every threshold lives in a `KnowledgeRule`, not inside calculators.

---

## 8. Grow-context engine (`src/lib/terpbot-intel-context.ts`)

`buildGrowContext(diaryId, {scope:"public"|"owner", ownerId, now}) → GrowContextView`
— computed on demand, never persisted. Bounded query set: the diary row + its
last `INTEL_WINDOW = 12` updates + linked setup (soft-delete treated as absent).
Runoff pH/EC are parsed from `feeding`/`content` text (`mS/cm` only — ppm runoff
values never enter the series).

```ts
// src/lib/terpbot-intel-types.ts (as built)
type GrowContextView = {
  scope: "public" | "owner";
  diary: { id; slug; title; stage; visibility; startDate; harvested;
           mediumType; lightType; growType; techniques: string[] };
  setup: { present: boolean; medium: string | null; capabilities: string[] };
  now: number; day: number; week: number;
  stageDays: number; stageStartCensored: boolean;   // top-level, not on diary
  updateCount: number; daysSinceUpdate: number | null; envCoverage: number;
  series: {                          // IntelSeries each: points + stats + trend
    temperature; humidity; ph; ec; height;
    vpdEntered;                      // user-entered VPD, unvalidated
    vpdComputed;                     // computed from temp/RH pairs
    runoffPh; runoffEc };            // parsed from feeding/content text
  vpdDivergence: number | null;      // top-level: newest entered−computed diff
  missing: MetricId[];               // schema metrics with zero readings
  freshness: Partial<Record<MetricId, number>>;  // age in days of latest point
  unresolved?: ReportedPoint[];      // ambiguous chat values awaiting a unit
  observations: StructuredObservation[];  // canonical, refId-linked, no raw text
};
```

The `scope` pin is structural: `scope:"public"` applies `publicDiaryWhere` at
the query layer, so private data **cannot** reach the response path even if a
later stage mishandles it — same defense-in-depth as `publicDiaryWhere`.
`emptyContext(now, stage?)` synthesizes a diary-free view (stage `"UNKNOWN"`)
for `/diagnose` sessions with no eligible public diary.

---

## 9. Diagnostic engine (`terpbot-intel.ts` `evaluateContext`)

As-built pipeline:

```
GrowContextView (+ merged session reports/observations)
  → collect evidence: every rule whose applies(ctx) fires → IntelEvidence[]
  → pool per candidate → group by (direction, signal)
      correlated evidence sharing a signal contributes its MAX weight, not a sum
      (four rules reading the same RH series = ONE humidity signal)
      risk→kind:"condition" is capped at one weak group; info never scores
  → conflict detection: both sides ≥ moderate and support doesn't dominate
      → CONFLICTING, ranked first, never masked (confirmed counts as strong support)
  → rank → pick state:
        CONFIRMED     measured-fact findings only; clamped per-candidate by maxState
        STRONG        support ≥3 AND (≥2 independent signals OR one strong direct item)
        POSSIBLE      below that; also the ceiling for missing requiredInputs and
                      stale-only support (STALE_DAYS = 10 — see below)
        INSUFFICIENT  no support
        CONFLICTING   see above
  → nextUsefulMeasurement(ctx, diagnosis) → deterministic next-step pick
  → WhyTrail built and persisted to BotSession (see §10.2)
```

**Stale degradation (Phase F):** after scoring, if *every* supporting signal group
rests on readings ≥ `STALE_DAYS` old (per `GrowContextView.freshness`, or
observation `t` for `symptom:*`), STRONG/CONFIRMED demotes to POSSIBLE and
`CandidateResult.stale` is set — one fresh user-reported point lifts it.
`data.stale` (gap rule) fires when the diary is ≥10 days idle with no fresh report.

**Next-question selection — "the question that most reduces uncertainty," deterministically:**
score = highest-weighted non-insufficient candidate's state weight that lists the
step in `requiredMissing`/`discriminatingInputs` (+4 required-unblock bonus, +1
conflict bonus, +1 per stale metric it would refresh); tie-break by the fixed
`measurementPriority` list, then id. Inspection steps (`inspect:*`) are
first-class and resolve against `INSPECTION_INFO[].resolvedBy`. No ML, no entropy
math pretending to be Bayesian — a transparent ranking the tests can pin.

**UC IPM mapping** (the pest/disease branch follows the six-component framework):
identify (symptom vocab → candidate pests) → monitor (suggest sticky-card/scouting cadence)
→ action criteria (honest note: cannabis thresholds largely unestablished — UC IPM itself
says floriculture thresholds are scarce; we say so) → prevention (cultural/environmental
first) → integrated options (biological before chemical; biocontrol specifics from Cornell/
UMD temp-RH tables) → re-assessment (follow-up question next check-in).

---

## 10. Remaining engine pieces

### 10.1 Uncertainty model (`engine/uncertainty.ts`)
Five states above. Hard rules:
- Never emit a single-cause verdict below STRONG; POSSIBLE lists ≤3 ranked candidates.
- Intervention recommendations require STRONG or CONFIRMED; below that the output is a
  *measurement recommendation* ("check runoff pH before changing feed").
- CONFLICTING produces "These measurements conflict — verify X first."
- Every non-CONFIRMED response ends with what would upgrade the confidence.

### 10.2 Explanation object — `WhyTrail` + `BotSession` (shipped, Phase F)

Every `CandidateResult` already carries `ruleIds`, `supporting`/`opposing`/`info`,
`requiredMissing`, `sourceIds`, `signals`, and `independentSignals`. Phase F
persists a bounded projection — `WhyTrail` (`terpbot-intel-why.ts`,
`buildWhyTrail(ctx, diagnosis, now)`) — onto the `BotSession` row:

```ts
WhyTrail = { knowledgeVersion, at, diaryTitle: string | null,
  basis: { logged, reported, observations, staleDays, stageEstimated },
  candidates: ≤4 × { id, name, kind, state, independentSignals,
                     signals: ≤3 × { signal, direction, weight, text },
                     opposing: ≤2, requiredMissing, next?, sourceIds },
  findings: ≤3, next?: { id, label, why } }
```

`renderWhy(trail, question?)` renders it deterministically: candidate name +
state + independent-signal count, ≤3 top signals with safe labels ("RH
readings", "temp/RH together", "reported <symptom label>"), opposing/missing
lines, a "Not more certain because…" line (conflict / single-signal / missing
input / stale data / risk-only), the next step, and up to 3 source citations
each marked `cannabis-specific` or `general horticulture, applied cautiously`.
Optional question text filters to a matching candidate/signal first.

**Privacy contract:** the trail stores only already-safe rendered strings —
no diary id, update id, refId, room id, or raw user text (`"curling"` never
persists; only canonical `LEAF_CURL_UP`). `/why` output is verified against
`/c[a-z0-9]{24}/` in pipeline tests. Chat replies pack to ≤2 × 1000 chars.

### 10.3 Natural-language layer (`nl/vocab.ts` + `nl/parse.ts`)
Controlled vocabulary tables — the existing `SYMPTOM_TAGS` + wizard vocabulary is the seed:
- **Symptoms**: yellowing(yellow leaves, chlorosis, fading), spots, curling/cupping(claw),
  burn(tips, nute burn), wilt(droopy), stretch, white powder, bud rot(brown bud), stippling,
  slow growth — each with synonym + misspelling lists.
- **Metrics**: ph (pH, acidity), ec (EC, ppm, tds, feed strength), temp, rh (humidity),
  vpd, height — with unit extraction (`72f`, `5.8`, `1.4ec`, `55%`, `400ppm`).
- **Entities**: stage names, mediums, light types, @user, "my grow"/"my plant".
- Grammar stays slot-filling: `symptom + location? + stage?`, `metric + value + trend?`.
  "humidity keeps climbing at night" → `{metric:rh, trend:rising, period:night}` → trend
  rule. Everything unparseable keeps today's `/ask` → fallback path. STAFF_WORDS refusal
  stays upstream, unchanged.

### 10.4 Multi-turn workflow — `BotSession` (shipped, Phase F)

The missing-conversation-store constraint is now solved by one row per user:
`BotSession { userId @id, diaryId?, knowledgeVersion, state: Json, pendingAsk?,
expiresAt }`, 24h TTL, `sweepExpiredSessions` in the daily cron.

- **What it stores** (`SessionState` Json): `reported: ReportedPoint[]`
  (`{metric, value, unit?, t}` — newest 24), `observations: SessionObservation[]`
  (canonical `{symptom, location?, stage?, period?, t}` — newest 24), optional
  `stage` (utterance-claimed, canonical id only), and the `WhyTrail`.
- **What it never stores:** message text, room ids, other users' ids, refIds,
  private diary content. `diaryId` may only reference a diary that passed
  `publicDiaryWhere` + `authorId = userId`, re-verified on every use; it is
  never rendered.
- **Continuity flow:** `/diagnose` (or a `@terpbot` mention that parses to
  measurements/observations — routing in `terpbot-intents.ts`) merges the
  utterance into the session, rebuilds the context (`buildGrowContext` when a
  public diary exists, `emptyContext(now, session.stage)` otherwise), evaluates,
  renders, and re-persists state + trail + `pendingAsk`. A bare follow-up number
  resolves against `pendingAsk` (ambiguous units stay in `ctx.unresolved` and
  get asked: "84 — °F or °C?"). `/checkin` writes the same trail so `/why`
  works after a check-in too.
- **Expiry is read-time, not write-time:** `loadSession` returns null on
  `expiresAt <= now`; `/why` then answers "I haven't reasoned about your grow
  in the last 24h…". Per-user rate limit `bot-diagnose:<userId>` 6/min on top
  of the existing room limiter.

### 10.5 Proactive assists (`assists/env-watch.ts`, cron)
All private `BOT_ASSIST` through the existing pipeline (cushion, 3/day cap, claim-first,
`notifyOnBotAssist` pref). Bounded scan: live public+private diaries of *active* members,
`take:100`, max 20 sends — identical to `scanStaleDiaries`. Triggers (each its own claim
key + cooldown, e.g. `assist:env:<diaryId>:<metric>:<YYYY-WW>` weekly):
persistent out-of-range VPD (>3 excursions in last 5 readings), pH/EC drift beyond medium-
appropriate band, persistent high RH + flower stage (bud-rot risk window), entered-VPD↔
computed-VPD divergence, harvest-window checklist when `stageDays ≥ avgFlowerDays`.
**No new public chatter.** Every assist states its evidence ("your last 4 readings averaged
RH 74% while in flower week 6").

---

## 11. Privacy & security model

Unchanged contract, plus: (a) `scope` pin in GrowState — private diaries physically absent
from public-scope context; (b) assists about private diaries deliver to the **owner only**,
never rooms — identical to today's stale-diary assist; (c) explanations echo only sanitized
observations (numbers, stage — never feeding text verbatim); (d) `resolveMember` gates any
`@user` grow queries — opted-out/blocked users' grow state resolves as "unknown"; (e) bot
remains MEMBER, no DM access, no moderation powers, no credential surface; (f) knowledge
files contain zero user data. New attack surface: unit-confusion (°F-entered-as-°C) and
outlandish values — calc layer rejects beyond existing validation bounds *and* sanity
bands (temp 32–130°F plausible-range warning; pH<4 or >9 flagged "verify your meter").

---

## 12. Cost & scale (Vercel Hobby + Neon)

- Rules and vocab: static TS modules — zero DB cost, bundled.
- GrowState: ≤3 indexed queries/diagnostic call (diary + INTEL_WINDOW=12 updates +
  setup/strain) — on-demand only, never per-poll.
- Trend calc: O(n≤12) in memory.
- Cron: one additional bounded job reusing `claimTask` (`terpbot:env-watch:<day>`),
  ≤100 candidate diaries, ≤20 sends — same envelope as existing scans. If the member base
  outgrows a 60s daily scan, split by weekday bucket (`diaryId hash % 7`) before reaching
  for persistence.
- Growth risk: diagnostic mentions in busy rooms share the 1/min/room mention cap — by
  design; quality over throughput.
- No external calls, no inference, no persistent state in Phase 1. Premature optimization
  explicitly declined; the existing `after()` + claim architecture absorbs retry storms.

---

## 13. Testing architecture

Existing suites extended, no parallel harness:
- **calc/**: known vectors (VPD 75°F/50% ≈ 1.22 kPa; DLI 800×18h = 51.8 mol/m²/d),
  unit conversions, invalid inputs, n<3 trends → insufficient.
- **rules**: every rule gets positive/negative/boundary/missing-data/contradiction cases in
  `terpbot2-tests.mts` — a table-driven `evalRule(rule, state)` harness.
- **engine**: fixture GrowStates — known-good (clean env → no candidates), ambiguous
  (yellowing + no chemistry → INSUFFICIENT + asks pH), misleading (yellow lower leaves in
  late flower = normal senescence → must NOT diagnose deficiency), conflicting (pH fine +
  EC high + burn tips → CONFLICTING on deficiency, STRONG on excess).
- **pipeline**: extend `terpbot-pipeline-tests.mts` — real Prisma fixtures through
  `buildGrowContext` → `diagnose` → rendered text; privacy scope test (PRIVATE diary +
  public scope → empty context); assist claim/cushion/cap tests cloned from stale-diary
  patterns.
- **e2e**: `bot-verify.mjs` — real mention `"@terpbot why are my leaves yellow"` over HTTP.
- **knowledge regression (shipped):** `npm run validate:knowledge`
  (`scripts/validate-knowledge.mts` + `validateKnowledge()` in
  `terpbot-intel-validate.ts`) — candidate key↔id, enum/domain/kind checks,
  `requiredInputs` ⊆ MetricIds, `discriminatingInputs` ⊆ metrics ∪ inspections,
  sourceIds non-empty + resolvable (empty allowed only for `kind:"gap"`),
  `wizardResultId === id` + every wizard result covered, CONTRA↔symptom↔candidate
  resolution, stage/location refinements resolve, vocab `feeds` resolve,
  inspection `resolvedBy` ∈ SymptomIds, `measurementLabels` cover all MetricIds,
  unique rule ids, every rule signal ∈ SIGNAL_IDS.

"Smart-looking but wrong" is defeated by: fixture diaries whose *expected answer* is known
(e.g., senescence fixture must rank "normal senescence" over "N deficiency" when stage =
late flower), plus the rulesRejected trail asserting *why* the tempting wrong answer lost.

---

## 14. Implementation roadmap

| Phase | Objective | Files/modules | Schema | Tests | Complexity | Risk | Value |
|---|---|---|---|---|---|---|---|
| **2.0-A** Knowledge + evidence foundation | types, source registry, first ~40 rules (env/disease/nutrition), `validate:knowledge` | `terpbot2/knowledge/*` | none | rule harness + validator | M | low — pure data | foundation |
| **2.0-B** Calculator suite | vpd, dli, units, trends, excursions, growthRate, vpdCheck | `terpbot2/calc/*` | none | vectors/bounds | S-M | low | every later phase |
| **2.0-C** Grow-context engine | `buildGrowContext`, capability parser for setup text, missing-data inventory | `terpbot2/engine/context.ts` | none | pipeline fixtures | M | low | personalization core |
| **2.0-D** Rule engine | condition evaluator, evidence accumulator, conflict detection | `engine/rules.ts` | none | eval harness | M | low | reasoning core |
| **2.0-E** Diagnostic engine | candidate ranking, next-question selection, explanation object; **migrate problem-wizard into shared rules** | `engine/diagnose.ts`, refactor `problem-wizard.ts` to consume engine | none | fixture diaries incl. adversarial | **L** | med — wizard regression | the payoff |
| **2.0-F** NL expansion | symptom/metric vocab, entity extraction, expert intents | `nl/*`, `terpbot-intents.ts` additions | none | parser matrix + ambiguity pins | M | med — false-capture risk | the UX payoff |
| **2.0-G** Proactive assists | env-watch cron job, assist kinds, cooldown keys | `assists/*`, cron route | none | claim/cap/pref tests | M | med — noise risk | proactivity |
| **2.0-H** Knowledge ops | review cadence, source registry updates, `/why` surface | — | none | validator in CI | S | low | trust |

**Suggested first slice:** **B + C + a thin E** — calculators + context + a *read-only*
diagnostic evaluation exposed only in tests and (optionally) folded into the existing
`/checkin` output as a private "things worth watching" line. Zero new user-facing surface,
full engine exercised end-to-end, ships behind the existing suite.

**Deliberately deferred (with reason):** PPFD/photoperiod/watering/runoff *columns*
(real value, but that's a product schema decision — runoff is parsed from text
for now); `KnowledgeRule` in DB (admin UI cost > benefit); percentile-benchmark
assists ("your VPD vs community") — needs community-stats wiring, Phase-later;
automated strain-specific VPD tuning (evidence too thin — honest deferral).
*Shipped since this table was written:* `BotSession` + true multi-turn
(`/diagnose` + `/why` + `pendingAsk`, Phase F — the demand was proven by the
mention-routing gap), and the `/why` surface (persisted `WhyTrail`, not
`BotEvent.entities` — entities stays an Int counter for aggregate telemetry).

---

## 15. Failure modes — designed responses

| Failure | Response |
|---|---|
| Contradictory inputs (pH fine + burn tips + high EC) | CONFLICTING state → "verify measurement X" |
| Stale diary (last reading 40d ago) | **implemented** — `data.stale` gap + STRONG→POSSIBLE stale clamp when all supporting signals are ≥`STALE_DAYS` (10d) old; `/why` shows "data is N days old" |
| Missing measurements | `missing[]` drives next-question; never fill with assumed defaults |
| Garbage user values (pH 12, 200°F) | plausibility bands → "verify your meter" not a diagnosis |
| Unit confusion (°C entered as °F) | out-of-band detection + explicit "is that °F or °C?" |
| Stage mid-transition | rules gate on `stage` — a flipped-stage diary re-evaluates cleanly next read |
| Multiple simultaneous problems | ranked candidates, top-3 cap, explicit "multiple issues may overlap" |
| Source disagreement | both rules may fire; engine reports the disagreement, never silently picks |
| Stale rules | `reviewedAt` + `status:"review"` + validator lint |
| Entered VPD ≠ computed VPD | surfaced as a *finding*, not silently trusted |

---

## 15b. Phase E implementation notes (shipped)

**Full wizard migration.** All 48 wizard results are generated from `CANDIDATES`
(`wizardResultFromCandidate`), byte-identical to the pre-migration literals —
pinned by `scripts/fixtures/wizard-results.snapshot.json` and the snapshot
equivalence test in `terpbot2-tests.mts`. Migrated candidates carry bare wizard
ids (`heat_stress`, `stunt`, `ph_drift`, …) so the adapter contract
`candidate.id === wizardResultId` holds unchanged; `Thread.wizardResultId`,
`SYMPTOM_TAGS`, and solve-rate stats are untouched. Engine-native candidates keep
namespaced ids (`env.moisture-disease-risk`, `env.cold-stress`, `env.instability`,
`env.dry-quality-risk`, `ph_lockout`, `nutrition.excess`, `nutrition.undersupply`).

**Reported-symptom channel (no schema change).** `DiaryUpdate.content` — already
in the bounded 12-update window query — is parsed by `terpbot-nl-parse.ts` into
`StructuredObservation[]` (symptom, location, stage, trend, period, provenance
refId). Observations age out after 21 days and carry canonical ids only; raw
text never enters the context or the render. Parsing is pure, bounded (200-char
cap), deterministic, and never diagnoses.

**NL layer.** `terpbot-nl-vocab.ts` holds controlled vocabulary: ~45 symptom
entries with synonyms/grower slang, 14 locations, 7 stages (plus numeric
`STAGE_PATTERNS` for "week 6 flower"/"f6"), metrics/units/trends/periods, guard
phrases ("yellow sticky traps" can't mint yellowing), negation, and
stage×location refinement tables encoding mobile-vs-immobile nutrient
discrimination. Question-led and comparison text (`what pm level`,
`light burn vs nutrient burn`) produces no observations. Metric+trend clauses
("humidity keeps climbing at night") synthesize the matching observation.

**New rule families.** Stage-conditioned temp/RH bands, RH/VPD trend rules,
temperature–humidity disease windows (botrytis 63–75°F + RH≥70% in flower; PM
75–86°F — PM needs no leaf wetness), environmental co-variation/instability,
day/night spread detection, drying-room risk, pH drift/edge-proximity, the
fed-but-locked-out signature, dangerously-low pH, EC stage floors, seedling EC
ceiling, high-EC antagonism (Mg→Ca/K), late-flower senescence (yellowing →
`bud_nutrient` support + honest opposition to deficiencies), and the aggregated
`symptom.reported` rule (no self-stacking; direct sightings = strong, refined =
moderate, else weak; negation dropped at parse).

**Engine mechanics.** `requiredInputs` now gates: missing required metrics cap
STRONG/CONFIRMED at POSSIBLE (CONFLICTING passes through). CONFLICTING extended:
both sides ≥ moderate AND support doesn't dominate → conflicting. `risk`
evidence binds `kind:"risk"` candidates; risk candidates render `Risk:` never
`Assessment:`. Inspection asks (`inspect:leaf-undersides`, `inspect:roots`, …)
are first-class next steps resolvable by matching observations. STRONG renders
one proportional `Suggested:` action; weaker states get a measurement instead.
`Reported:` renders canonical labels — never raw text.

**Semantic changes vs the old wizard (documented per Phase 3):** symptom-only
reports can no longer assert a diagnosis — they surface candidates capped by
missing data; the wizard's question path keeps its literal result text (a user
who answered the wizard *is* the evidence), while the engine's data path applies
the uncertainty model. Two paths, one knowledge record.

---

## 16. Explicitly prohibited

LLM/generative fallback of any kind · fake confidence percentages · hallucinated or
implied citations (provenance is a stored object or it doesn't render) · scraped grow-forum
"truth" as primary sources · external strain/weather APIs · automated moderation · DM
reading · credential access · private-diary content in any public surface · medical/health
advice · pesticide *application* instructions beyond label-directed "consult label/local
regs" guidance · autonomous grow-control actuation · presenting general plant science as
cannabis-established fact · fake engagement.

## 17. Open questions

1. Wizard migration politics: problem-wizard results are referenced by `Thread.
   wizardResultId` and solve-rate stats — rule IDs must preserve the mapping or stats break.
2. Should `/checkin` absorb the diagnostic summary, or a new `/check` command? Recommendation:
   extend `/checkin` — "more intelligence, not more commands."
3. Cannabis-specific action thresholds for pests are genuinely unpublished — do we surface
   "no established threshold" (recommended, honest) or adopt UC IPM ornamental analogs
   (flagged PROFESSIONAL)? Recommend surfacing the gap.
4. `vpd` entered-vs-computed divergence: how much divergence warrants an assist? Proposed
   0.3 kPa — needs fixture tuning.
5. Whether assist cushion (7-day) should exempt *safety-class* assists (persistent high-RH
   in late flower = bud-rot risk). Recommend a `severity:"high"` bypass flag, used sparingly.

---

*Prepared from full codebase audit (subagent reports: data-model/calc inventory, bot
architecture deep-map) and literature review. All cited sources are in §6's registry;
cannabis-specific vs general-science provenance is preserved per rule.*

---

## Implementation status (as built)

The implementation landed flat `src/lib/terpbot-intel-*` modules rather than the
`terpbot2/` tree sketched above — same architecture, repo-conventional paths.

**Shipped — Phase A (`c381de9`):** calc suite (`terpbot-intel-calc.ts`),
`GrowContext` builder (`terpbot-intel-context.ts`, 3 bounded queries, public/owner
scope), source registry + thin rule engine (`terpbot-intel-knowledge.ts`,
`terpbot-intel.ts`), `/checkin` integration, 1000-char-capped epistemic rendering.

**Shipped — Phase D (diagnostic layer):** `CandidateDef` registry with
`requiredInputs`/`discriminatingInputs`/`recommendedActions`/`severity`/`wizardResultId`
/`maxState`; evidence carries `candidate` and pools per-candidate; deterministic
5-state assessment (INSUFFICIENT/POSSIBLE/STRONG/CONFLICTING/CONFIRMED — CONFIRMED
reserved for measured-fact findings and clamped per-candidate by `maxState`, never
reachable by condition candidates); CONFLICTING preserved, never masked —
`confirmed` counts as strong support for conflict detection; `info` evidence is
neutral (never scored). Cross-candidate next-measurement scoring is documented
deterministic ranking (state weight + conflict bonus + required-unblock bonus,
priority-list + id tie-break), with per-candidate picks following declared
`discriminatingInputs` order. First wizard branch migrated: `WIZARD_RESULTS
.humidity_high` is *generated from* `CANDIDATES.humidity_high` via
`terpbot-intel-wizard.ts` — identical output, `Thread.wizardResultId` and
symptom-tag contracts unchanged. Combination rules land as `risk`-direction
evidence into `env.moisture-disease-risk` — rendered as hazard language, never a
disease diagnosis.

**Known audit fixes folded into Phase D:** `info` no longer inflates `forScore`;
missing-priority `indexOf(-1)` tie-break corrected; soft-deleted `GrowSetup` rows
are treated as absent in `buildGrowContext` (privacy); dead `feeding`/`training`
selects dropped.

**Shipped — Phase F (correctness + continuity):** signal-grouped evidence
scoring (correlated items collapse by `signal`; STRONG needs ≥2 independent
signals or one strong direct item; `risk`→condition capped at one weak group;
`requiredInputs`/`maxState`/stale clamps); deterministic ordering and knowledge
validation (`validate:knowledge`); hardened NL parser (negation, questions,
unit-vs-phrase precedence, bare "curling"); `BotSession` (24h TTL, reported
points + canonical observations + `WhyTrail`, no raw text — §10.4); `/diagnose`
+ `/why` commands and mention routing; `(you)` provenance marks;
`env.snapshot` single-reading rule; `data.stage-unknown`/`inspect:stage`;
`data.stale` + the stale clamp; runoff pH/EC channel (`chem.runoff-ec-gap`,
`chem.runoff-ph-shift`, sourced to LeBude & Bilderback 2009 NCSU AG-717-W —
general horticulture, labeled as such); `stageEstimated` surfaced in `/why`
basis; dead `medianUpdateIntervalDays` removed. Rule/source inventory with
per-rule thresholds and honest limitations: `TERPBOT-KNOWLEDGE.md`.

**Shipped — Phase H (longitudinal + private assists):** metric baselines and
change detection, symptom episodes, intervention tracking, next-best-action
engine, `/status` `/changes` `/check` `/measurements` `/why` longitudinal
surfaces, and six deterministic evidence-triggered BOT_ASSIST notifications
(owner-scope, once-ever dedupe keys, 3/day + 7-day-cushion delivery, private
diaries persist no trail/snapshot). Session evidence records carry a `diaryId`
stamp so observations/interventions merge only onto the diary they were
recorded against.

**Shipped — Phase I (setup intelligence + planning):**

- **Capability model** (`terpbot-intel-capability.ts`) — per-step feasibility:
  `proven` (a series with data, or an instrument-free observation),
  `plausible` (setup keyword heuristic or declared soilless medium implies a
  meter), `unknown` (no evidence either way — missing data is never "no
  meter"), `excluded` (structurally impossible: DWC has no runoff, outdoors
  has no environmental adjustment), `unreportable` (no series path, e.g.
  PPFD/leafTemp — recommendable as an inspection, never persisted as a
  `pendingAsk`). VPD is proven when temperature+RH data exists even without
  an entered series. Setup free text only produces `(setup text)`-labeled
  heuristics; the raw string never renders.
- **Grow Intelligence Snapshot** (`terpbot-intel-snapshot.ts`) — one shared
  pure derivation over `GrowContextView`: effective stage (harvested diary +
  growth stage → HARVEST), stage-conditioned bands (exported VPD/pH/temp/RH
  tables), current readings with provenance + staleness, baseline-relative
  changes, capability inventory, missing-vs-not-applicable reportable metrics,
  diagnosis + ranked actions. `/status`, `/changes`, `/check`, `/plan`, and
  the assist path all consume it — one source of truth, different renderers.
- **Checklist engine** (`terpbot-intel-checklist.ts`) — stage playbooks
  (GERMINATION through CURING) produce items with deterministic states
  `done` / `due` / `watch` / `unknown` / `concern` / `not_applicable`, each
  carrying a source id for provenance. Items evaluate from the snapshot:
  band conformance, series freshness, capability exclusions, stage gates.
  No scores, no fertilizer recipes — monitoring intelligence only.
- **`/plan`** — room command rendering the active checklist in bounded
  sections (Watch / Measure / Observe / Upcoming / Unknown). Adapts to stage,
  declared setup enums, and live evidence: two growers at the same stage get
  different plans when their readings differ. Registered in `CHAT_COMMANDS`,
  matched before broad `grow`/`check` intents.
- **Setup-aware `/check`** — action ranking adds a bounded feasibility bonus
  (proven +2, plausible +1, unknown/inspect 0) and structurally-excluded or
  unreportable steps never surface as asks or `pendingAsk`s, so the bot can
  never loop on an impossible measurement (e.g. runoff EC on DWC).
- **Post-harvest reachability** — `buildGrowContext` no longer filters
  `harvested`; `intelContextFor` falls back active-first-then-harvested so a
  user whose only grow is drying still gets real plans instead of an empty
  context.
- **H7 debt** — session evidence diary attribution (above); `checkBotBadges`
  now loads the bot + earned badge names first and returns early when nothing
  is pending, so the steady state no longer runs the full aggregate bundle.

Knowledge version `2.4` — new renderable surfaces (`/plan`, setup section in
`/status`) and the capability-aware `/check` ordering materially change output.

**Remaining:** `DiagnosticSession` beyond the 24h window if needed,
PPFD/photoperiod schema fields (today they are `unreportable` capabilities).
