# TerpBot 2.0 — Deterministic Cannabis Grow Intelligence

Architecture & implementation specification. Baseline: `ca2f198` (production).
Status: **Phase A (calc engine + GrowContext + rule engine → `/checkin`) shipped at
`c381de9`. Phase D (candidate/diagnostic layer + wizard adapter) shipped next —
see §15 status note.**

---

## 1. Executive summary

TerpBot today is a deterministic retrieval/command bot: 36 public commands, a regex intent
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
`postToGeneral`), daily cron `0 14 * * *`.

**Safety contract (unchanged).** MEMBER-role bot account, no password; rooms public-only;
60/hr global + 10/min/room output caps; mention cap 1/min/room; assists 3/day/user + 7-day
cross-kind cushion; `sanitizeEcho`/`sanitizeField`/`sanitizeExcerpt` on all echoed user text;
`resolveMember`/`publicDiaryWhere`/`activeAuthor`/mutual-block gates; `claimBotEvent`
once-ever semantics; `publicMilestoneOptOut`, `hideOnlineStatus`, `notifyOnBotAssist`
honored; `purgeDiaryAnnouncements` on visibility loss; aggregate-only telemetry.

**Telemetry.** `BotEvent` (unique `key`, `type`, `command`, `entities` ≤2KB, indexed on
`userId`+`type`+`createdAt`) → `getBotStats` → admin health dashboard. Key patterns:
`cmd:*`, `mention:*`, `announce:<kind>:*`, `assist:<kind>:*`, `day:<date>`.

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
| problem-wizard | 16 nodes, ~35 results (cause/fixes/severity), SYMPTOM_TAGS | seed knowledge base + symptom vocabulary |

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

```ts
// src/lib/terpbot2/knowledge/types.ts (proposed)
type EvidenceTier =
  | "PEER_REVIEWED" | "EXTENSION" | "GOVERNMENT"
  | "PROFESSIONAL" | "COMMUNITY" | "INTERNAL_DATA";

type SourceRef = {
  id: string;              // "cockson-2019-nutrient-disorders"
  title: string; author: string; publication: string;
  url: string;             // DOI/extension URL — for provenance display only
  year: number; tier: EvidenceTier;
  cannabisSpecific: boolean;  // false → general plant science, labeled as such
  reviewedAt: string;      // ISO date this rule set was re-checked
};

type Condition =                            // evaluated against GrowState
  | { metric: MetricId; op: "lt"|"lte"|"gt"|"gte"|"eq"|"in"|"range"; value: number|number[]|string }
  | { trend: MetricId; dir: "rising"|"falling"|"unstable"|"stable"; window?: number }
  | { stage: StageId[] } | { medium: MediumId[] } | { light: LightId[] }
  | { capability: "dehumidifier"|"phMeter"|"ac"|"fans"; has: boolean }
  | { missing: MetricId }                       // missing-data is a first-class condition
  | { and: Condition[] } | { or: Condition[] } | { not: Condition };

type KnowledgeRule = {
  id: string;                 // "env.vpd.flower-high"
  version: number;
  domain: Domain;             // env | nutrition | pest | disease | ...
  status: "active" | "review" | "deprecated";
  appliesWhen: Condition;     // gate — stage/medium/context scoping
  observes?: MetricId[];      // inputs consumed (drives missing-data questions)
  emits: Evidence[];          // what this rule contributes when it fires
  source: SourceRef[];        // provenance, ≥1 required
};

type Evidence = {
  candidate: CandidateId;     // "bud-rot-risk" | "ph-lockout" | "n-deficiency" | ...
  direction: "for" | "against" | "risk";   // risk = raises hazard, not a diagnosis
  weight: 1|2|3;              // weak | moderate | strong — categorical, no fake precision
  explain: string;            // template string, slots filled from observation values
  discriminatesBy?: MetricId[];  // measurements that separate this candidate from rivals
};
```

This is deliberately NOT a generic production-rule language. Three primitives —
`Condition` tree, `Evidence` emission, `discriminatesBy` — cover every pattern found in the
audit. Rules that can't fit this shape are the exception worth a code review, not a bigger
DSL.

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
- A rule whose only source is COMMUNITY tier can never produce weight 3 evidence.
- Single-study findings (e.g., veg EC 4.0 optimum) are capped at weight 2 and tagged
  `"replication": "single-study"` in the source record.

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

## 8. Grow-context engine (`src/lib/terpbot2/engine/context.ts`)

`buildGrowContext(userId, {scope:"public"|"private"}) → GrowState` — computed on demand,
never persisted (Phase 1). One bounded query set: latest live diary + last ~50 updates +
linked setup + strain row.

```ts
type GrowState = {
  diary: { id, slug, stage, visibility, day, week, medium, growType, lightType,
           techniques: TechniqueId[], strainId, strainName, harvested };
  setup: { has: Capability[]; lightType?: string; medium?: string };  // vocab-parsed
  strain: { avgFlowerDays?: number; difficulty?: string; type?: string };
  env:    { tempF, rh, vpdEntered, vpdComputed, ph, ec }   // each: latest + Trend + n
  growth: { heightCm, rateCmPerDay?, day, week };
  cadence:{ lastUpdateDaysAgo, medianIntervalDays, updateCount };
  feeding:{ recentText: string[]; changed: boolean; nutrients?: string };
  missing: MetricId[];        // measurements never recorded — drives question selection
  conflicts: Conflict[];      // e.g., entered VPD ≠ computed
  stageDays: number;          // days in current stage
  public: boolean;            // scope pin — private fields can't leak to room text
};
```

The `scope` pin is structural: `buildGrowContext(uid, {scope:"public"})` filters
`visibility:"PUBLIC"` at the query layer, so private data **cannot** reach the response
path even if a later stage mishandles it — same defense-in-depth as `publicDiaryWhere`.
Persisting GrowState snapshots is a Phase-later decision (only justified if proactive
scans need cheap diffing; BotEvent `entities` already provides a ≤2KB audit stash).

---

## 9. Diagnostic engine (`engine/diagnose.ts`)

Pipeline per the brief, implemented as:

```
observations (GrowState + parsed NL entities)
  → collect candidates (every rule whose appliesWhen fires)
  → score: Σ weights, separately tracking for/against/risk
  → conflict detection (for≥2 AND against≥2 on same candidate → CONFLICTING)
  → rank → pick state:
        CONFIRMED   hard-bounds violation (measured pH>7 in coco — measurement IS the fact)
        STRONG      one candidate ≥2 strong-for, no strong-against
        POSSIBLE    top candidate moderate-only, or two candidates within 1 weight
        INSUFFICIENT no candidate reaches weak threshold
        CONFLICTING for and against both strong
  → if POSSIBLE/INSUFFICIENT: nextQuestion = argmax over discriminating power
  → explanation object always built
```

**Next-question selection — "the question that most reduces uncertainty," deterministically:**
for each missing `MetricId`, score = number of top-3 candidates whose rule conditions
reference it × tier weight; tie-break by measurement accessibility (a fixed order: pH →
EC → temp/RH → symptom detail → substrate moisture → runoff → equipment check). No ML, no
entropy math pretending to be Bayesian — a transparent ranking the tests can pin.

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

### 10.2 Explanation object (`engine/explain.ts`)
```ts
{ question, observationsUsed: Observation[], rulesMatched: RuleHit[],
  rulesRejected: RuleHit[], missingData: MetricId[], candidates: RankedCandidate[],
  conclusion: ConclusionState, nextMeasurement?: MetricId,
  actions: Action[], sources: SourceRef[] }
```
Built inside the engine on every diagnostic call; room output shows the condensed form
(top candidate + evidence count + one action), `/why` (future) exposes the full object by
looking up the user's last `BotEvent` entities stash. No conclusion without the trail.

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

### 10.4 Multi-turn workflow — the honest constraint
No conversation store exists and chat prunes at 3 days. Phase 1 therefore uses
**single-shot enriched diagnosis**: one mention produces candidates + *the* next-question
as its closing line ("tell me your runoff pH and I'll narrow this down"). A follow-up
mention containing `ph 5.2` + `replyToContent` threading can be matched to the prior bot
question — **poor-man's multi-turn via `replyToContent`, already in ctx**. A real
`DiagnosticSession` table (pending question, expires 72h) is the deferred upgrade; it's
the *only* schema addition proposed anywhere in this roadmap, and only if Phase-G proves
the demand.

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
- GrowState: ≤3 indexed queries/diagnostic call (diary + 50 updates + setup/strain) —
  on-demand only, never per-poll.
- Trend calc: O(n≤50) in memory.
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
- **knowledge regression**: a `validate:knowledge` script — every rule has ≥1 source, all
  `explain` slots resolve, no orphan CandidateIds, schema-version lint.

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

**Deliberately deferred (with reason):** `DiagnosticSession` table + true multi-turn (only
if F proves demand — replyTo threading covers v1); PPFD/photoperiod/watering/runoff fields
(real value, but that's a product schema decision — file separately); `KnowledgeRule` in DB
(admin UI cost > benefit); percentile-benchmark assists ("your VPD vs community") — needs
community-stats wiring, Phase-later; `/why` command (needs explanation persistence =
BotEvent.entities reuse, cheap but F-dependent); automated strain-specific VPD tuning
(evidence too thin — honest deferral).

---

## 15. Failure modes — designed responses

| Failure | Response |
|---|---|
| Contradictory inputs (pH fine + burn tips + high EC) | CONFLICTING state → "verify measurement X" |
| Stale diary (last reading 40d ago) | freshness gate: diagnosis degraded to "based on data from X days ago" or refusal |
| Missing measurements | `missing[]` drives next-question; never fill with assumed defaults |
| Garbage user values (pH 12, 200°F) | plausibility bands → "verify your meter" not a diagnosis |
| Unit confusion (°C entered as °F) | out-of-band detection + explicit "is that °F or °C?" |
| Stage mid-transition | rules gate on `stage` — a flipped-stage diary re-evaluates cleanly next read |
| Multiple simultaneous problems | ranked candidates, top-3 cap, explicit "multiple issues may overlap" |
| Source disagreement | both rules may fire; engine reports the disagreement, never silently picks |
| Stale rules | `reviewedAt` + `status:"review"` + validator lint |
| Entered VPD ≠ computed VPD | surfaced as a *finding*, not silently trusted |

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

**Remaining for 2.0-E/F/G:** full wizard migration (adapter proven on one branch),
NL symptom vocab, proactive assists, `/why` surface (every `CandidateResult`
already carries `ruleIds`, `supporting`/`opposing`/`info`, `requiredMissing`,
`sourceIds` — the explanation object exists, only the surface is missing),
knowledge validator command.
