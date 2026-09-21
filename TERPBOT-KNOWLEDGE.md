# TerpBot Knowledge Base — sources, rules, evidence model

Reference documentation for the deterministic grow-intelligence engine
(`src/lib/terpbot-intel*.ts`, `terpbot-intel-knowledge.ts`). Everything here is
generated behavior — no LLM, no external calls. When rules or sources change,
update this file in the same commit.

## 1. Evidence model (prose)

- **Rules emit evidence, never conclusions.** Each `IntelRule` has `applies(ctx)`
  (a gate) and `evaluate(ctx)` (emits `IntelEvidence[]`). Evidence carries a
  `direction` (`for` | `risk` | `against` | `info`), a categorical `strength`
  (weak=1, moderate=2, strong=3), a `signal` identifying the underlying input it
  derives from, and an optional `candidate` it pools into.
- **Signal groups collapse correlated evidence.** Scoring groups pooled evidence
  by `(direction, signal)`; each group contributes the **maximum** weight in the
  group, never a sum. Four rules reading the same RH series are *one* humidity
  signal, not four independent supports.
- **States:** `insufficient` → `possible` → `strong` → `confirmed` → `conflicting`.
  STRONG requires support ≥3 **and** (≥2 independent supporting signal groups
  *or* one strong direct item). CONFIRMED is reserved for measured-fact findings.
  CONFLICTING: both sides carry ≥moderate evidence and support doesn't dominate —
  never masked, always ranked first.
- **Risk cap for conditions.** `risk`-direction evidence into a `kind:"condition"`
  candidate is capped at one weak group — a favorable environment is
  predisposition, never proof. Risk candidates (`kind:"risk"`) score it fully.
- **requiredInputs clamp.** A candidate missing a declared required metric caps
  at POSSIBLE regardless of score (CONFLICTING passes through).
- **Stale clamp.** `STALE_DAYS = 10`. When *every* supporting signal group rests
  on readings ≥10 days old (per `freshness`, or observation age for `symptom:*`),
  STRONG/CONFIRMED demotes to POSSIBLE and `CandidateResult.stale` is set. One
  fresh user-reported point lifts the clamp.
- **maxState.** Candidates declare a ceiling (`strong` or `possible`); thin-
  provenance knowledge (e.g. single-study micronutrient mapping) can never
  reach STRONG.
- **Snapshot rule.** `env.snapshot` scores the *latest* temperature/VPD only —
  weak by default, moderate only with a known stage AND a large excursion,
  never strong. It exists so a single fresh chat report isn't invisible to the
  engine.
- **Provenance.** `MetricPoint.provenance`: `undefined` = logged diary data,
  `"user-reported"` = chat report. Logged points are never modified; reported
  points are additive. `latest` is by time, so a fresh report supersedes a stale
  log for "current" purposes while history stays intact.

## 2. Source registry (`SOURCES` in terpbot-intel-knowledge.ts)

| id | Title | Author | Publication | Year | Tier | Cannabis-specific |
|---|---|---|---|---|---|---|
| `bc-cannabis-diseases` | Diseases of Cannabis in British Columbia | BC Ministry of Agriculture | BC plant health factsheet | 2021 | GOVERNMENT | yes |
| `bevan-2021-npk-dwc` | Optimisation of Nitrogen, Phosphorus, and Potassium for Soilless Production of Cannabis sativa Using Response Surface Analysis | Bevan, Jones, Zheng | Frontiers in Plant Science 12:764103 | 2021 | PEER_REVIEWED | yes |
| `canna-coco-ph` | Using CANNA COCO — substrate pH/EC targets | CANNA | Commercial cultivation guidance | 2024 | PROFESSIONAL | yes |
| `chandra-2008-photosynthesis` | Photosynthetic response of Cannabis sativa L. to variations in PPFD, temperature and CO2 | Chandra et al. | Journal of Industrial Hemp / PMC3550641 | 2008 | PEER_REVIEWED | yes |
| `cockson-2019-nutrient-disorders` | Characterization of Nutrient Disorders of Cannabis sativa | Cockson, Landis, Smith, Hicks, Whipker | Applied Sciences 9(20):4432 | 2019 | PEER_REVIEWED | yes |
| `cornell-cannabis-guidebook` | Cornell Hemp / Cannabis sativa Production Guidebook (NYS) | Cornell University College of Agriculture and Life Sciences | Cornell extension production manual | 2024 | EXTENSION | yes |
| `cs-vpd-ranges` | Understanding VPD and Transpiration Rates for Cannabis Cultivation Operations | Breit, Leavitt, Boyd | Cannabis Science and Technology 2(2) | 2019 | PROFESSIONAL | yes |
| `fao56-svp` | Crop evapotranspiration — guidelines for computing crop water requirements | Allen, Pereira, Raes, Smith | FAO Irrigation and Drainage Paper 56 | 1998 | GOVERNMENT | no |
| `hershkowitz-2025-ec` | Elevated root-zone P and nutrient concentration do not increase yield or cannabinoids in medical cannabis | Hershkowitz, Westmoreland, Bugbee | Frontiers in Plant Science 16:1433985 | 2025 | PEER_REVIEWED | yes |
| `ieee-greenhouse-survey` | A Survey of Modern Greenhouse Technologies and Practices for Commercial Cannabis Cultivation | IEEE Access | IEEE Access 11 | 2023 | PEER_REVIEWED | yes |
| `morad-bernstein-2023-mg` | Response of Medical Cannabis to Magnesium (Mg) Supply at the Vegetative Growth Phase | Morad, Bernstein et al. | Plants 12(14):2676 | 2023 | PEER_REVIEWED | yes |
| `ncsu-pourthru-2009` | The Pour-Through Extraction Procedure: A Nutrient Management Tool for Nursery Crops | LeBude, Bilderback | North Carolina Cooperative Extension AG-717-W | 2009 | EXTENSION | no |
| `postharvest-review-2022` | Postharvest Operations of Cannabis and Their Effect on Cannabinoid Content: A Review | Das, Vista, Tabil, Baik | Bioengineering 9(8):364 | 2022 | PEER_REVIEWED | yes |
| `punja-2022-botrytis` | Understanding bud rot development, caused by Botrytis cinerea, on cannabis grown under greenhouse conditions | Punja | Canadian Journal of Botany | 2022 | PEER_REVIEWED | yes |
| `punja-ni-2025-budrot` | The epidemiology and management of Botrytis cinerea causing bud rot on greenhouse cultivated cannabis | Punja, Ni | Canadian Journal of Plant Pathology | 2025 | PEER_REVIEWED | yes |
| `purdue-hydro-nutrition` | Fertilizer for Hydroponics — nutrient solution pH/EC management | Langenhoven | Purdue Extension CEA | 2018 | EXTENSION | no |
| `rodriguez-morrison-2021-light` | Cannabis yield, potency, and leaf photosynthesis respond differently to increasing light levels | Rodriguez-Morrison et al. | Frontiers in Plant Science 12:646020 | 2021 | PEER_REVIEWED | yes |
| `saloner-bernstein-2020-n` | Response of Medical Cannabis (Cannabis sativa L.) to Nitrogen Supply Under Long Photoperiod | Saloner, Bernstein | Frontiers in Plant Science 11:572293 | 2020 | PEER_REVIEWED | yes |
| `terptalk-stage-tips` | TerpTalk stage-tips targets (in-repo curated values) | TerpTalk | src/lib/stage-tips.ts | 2025 | INTERNAL_DATA | yes |
| `utia-pm-hemp` | Fungicide Recommendations for Controlling Hemp Powdery Mildew in the Greenhouse | University of Tennessee Extension | UTIA W1132 | 2023 | EXTENSION | yes |
| `whipker-ph-micro` | Impact of substrate pH and micronutrient fertility rates on Cannabis sativa | Whipker group (NCSU) | Agrosystems, Geosciences & Environment | 2025 | PEER_REVIEWED | yes |

## 3. Rule inventory (`INTEL_RULES`)

Signals: `humidity`, `temperature`, `env:temp-rh`, `ph`, `ec`, `chem:ph-ec`,
`height`, `runoff`, `stage`, `data`, plus per-evidence `symptom:<id>` for rules
that iterate observations. Rules emitting evidence without a `signal` fall back
to their rule id.

| Rule | Domain | Signal | Kind | Key thresholds | Sources | Cannabis-specific? | Limitation |
|---|---|---|---|---|---|---|---|
| `data.vpd-divergence` | data | env:temp-rh | observation | \|entered−computed VPD\| ≥ 0.3 kPa | fao56-svp | no | newest paired update only |
| `env.vpd-band` | environment | env:temp-rh | risk | VPD_BANDS per stage (veg 0.8–1.2, flower 1.0–1.5); n≥3; ≥60% out or run≥3 → moderate | cs-vpd-ranges, ieee-greenhouse-survey, fao56-svp, terptalk-stage-tips | mixed | air-temp VPD; leaf temp not logged |
| `env.rh-flower-high` | environment | humidity | risk | RH ≥ 65% in FLOWER, n≥3 | punja-2022-botrytis, utia-pm-hemp, bc-cannabis-diseases | yes | threshold approaching, not confirmed disease line |
| `env.rh-sustained-high` | environment | humidity | assessment | RH ≥ 70% sustained, n≥3 | bc-cannabis-diseases, cornell-cannabis-guidebook | yes | duration-weighted, not species-verified |
| `env.rh-trend` | environment | humidity | risk | RH trend rising | bc-cannabis-diseases | yes | trend classification needs n≥3 |
| `env.rh-trend-low` | environment | humidity | risk | RH trend falling | cs-vpd-ranges | yes | trend only; absolute level unchecked |
| `env.temp-high` | environment | temperature | assessment | TEMP_BANDS ceiling per stage (veg/flower 86°F), n≥3 | chandra-2008-photosynthesis, terptalk-stage-tips, cornell-cannabis-guidebook | yes | sustained-only; spikes invisible |
| `env.temp-low` | environment | temperature | assessment | TEMP_BANDS floor per stage, n≥3 | terptalk-stage-tips, cornell-cannabis-guidebook | yes | sustained-only |
| `env.instability` | environment | env:temp-rh | risk | temp + humidity volatility over window | ieee-greenhouse-survey | yes | heuristic volatility, no published band |
| `chem.ph-band` | chemistry | chem:ph-ec | assessment | PH_BANDS by medium (hydro/coco 5.5–6.2, soil 6.0–6.8) + EC trend | canna-coco-ph, cornell-cannabis-guidebook, terptalk-stage-tips, purdue-hydro-nutrition | mixed | medium inferred from diary vocab |
| `chem.ec-drift` | chemistry | ec | risk | EC trend ≠ stable | canna-coco-ph | yes | direction only, no magnitude target |
| `chem.ec-elevated` | chemistry | ec | risk | EC > 2.5 mS/cm in ≥60% of ≥3 readings | canna-coco-ph, hershkowitz-2025-ec, cornell-cannabis-guidebook | yes | single-study tolerance bound (4.0) is one dataset |
| `growth.stalled` | growth | height | assessment | height growth below expected rate | chandra-2008-photosynthesis, rodriguez-morrison-2021-light | yes | needs ≥2 height readings; many diaries lack them |
| `env.rh-low` | environment | humidity | assessment | RH below stage floor, n≥3 | cs-vpd-ranges, terptalk-stage-tips, fao56-svp | mixed | sustained-only |
| `env.rh-band-high` | environment | humidity | risk | RH above RH_BANDS stage ceiling (flower 55%, veg 70%) | terptalk-stage-tips, punja-2022-botrytis, bc-cannabis-diseases | yes | stage-relative, not a disease claim |
| `env.vpd-trend` | environment | env:temp-rh | risk | vpdComputed trend | cs-vpd-ranges, fao56-svp | mixed | computed VPD only |
| `env.disease-window` | disease | env:temp-rh | risk | botrytis 63–75°F + RH≥70% flower; PM 75–86°F | punja-2022-botrytis, punja-ni-2025-budrot, utia-pm-hemp, bc-cannabis-diseases | yes | risk window, never a diagnosis |
| `env.co-variation` | environment | env:temp-rh | risk | temp/RH co-movement | ieee-greenhouse-survey, fao56-svp | mixed | correlation heuristic |
| `env.diurnal-swing` | environment | temperature | risk | temp spread ≥15°F in window | ieee-greenhouse-survey, terptalk-stage-tips | yes | spread ≠ proven day/night cycle |
| `env.dry-band` | environment | env:temp-rh | risk | DRYING 57–68°F / 50–65% RH off-target | terptalk-stage-tips, postharvest-review-2022 | yes | drying-room telemetry often sparse |
| `chem.ph-drift` | chemistry | ph | assessment | pH trend / instability | canna-coco-ph, cornell-cannabis-guidebook, purdue-hydro-nutrition, terptalk-stage-tips | mixed | input pH only until runoff exists |
| `chem.lockout-signature` | chemistry | chem:ph-ec | assessment | pH out of band while EC shows feeding | canna-coco-ph, whipker-ph-micro, purdue-hydro-nutrition, cornell-cannabis-guidebook | mixed | signature, not confirmation — needs runoff pH |
| `chem.ph-low-danger` | chemistry | ph | assessment | pH below danger floor | whipker-ph-micro, canna-coco-ph | yes | rare; meter error looks identical |
| `chem.ec-stage-band` | nutrition | ec | assessment | EC floors VEG 0.8 / FLOWER 1.0 mS/cm | bevan-2021-npk-dwc, saloner-bernstein-2020-n, hershkowitz-2025-ec, canna-coco-ph | yes | optima are dose-response fits, not thresholds |
| `chem.ec-falling` | nutrition | ec | risk | EC trend falling | bevan-2021-npk-dwc, saloner-bernstein-2020-n | yes | trend only |
| `chem.seedling-ec` | nutrition | ec | assessment | EC ceiling at SEEDLING | canna-coco-ph, terptalk-stage-tips | yes | commercial-guidance tier |
| `chem.high-ec-antagonism` | nutrition | chem:ph-ec | risk | high EC + pH interaction (Mg→Ca/K antagonism) | morad-bernstein-2023-mg, hershkowitz-2025-ec | yes | mechanism from veg-phase Mg study |
| `symptom.reported` | data | per-evidence `symptom:*` | assessment | observations → vocab `feeds`; direct sighting strong / refined moderate / else weak | cockson-2019-nutrient-disorders | yes | symptom→candidate map is one study + extension vocab |
| `symptom.senescence` | stage | per-evidence `symptom:LEAF_YELLOWING` | assessment | late-flower day threshold | cockson-2019-nutrient-disorders, terptalk-stage-tips | yes | day-count senescence is approximate |
| `env.snapshot` | environment | env:temp-rh | assessment | latest temp vs TEMP_BANDS, VPD vs VPD_BANDS; moderate only stageKnown + large excursion (temp ≥ hi+4°F, VPD ≥ hi+0.5 / ≤ lo−0.3) | cs-vpd-ranges, chandra-2008-photosynthesis, terptalk-stage-tips, ieee-greenhouse-survey, fao56-svp, cornell-cannabis-guidebook | mixed | one reading is a lead, never a trend — capped moderate |
| `chem.runoff-ec-gap` | chemistry | runoff | assessment | runoffEC − feedEC ≥ 1.0 → moderate; ≥0.5 → weak; ≤−0.5 → info; paired within 3 days | ncsu-pourthru-2009 | no | general substrate guidance — cannabis runoff thresholds unpublished |
| `chem.runoff-ph-shift` | chemistry | runoff | assessment | \|runoffPh − feedPh\| ≥ 0.8 → moderate; ≥0.5 → weak; paired within 3 days | ncsu-pourthru-2009 | no | general substrate guidance |
| `data.sparse-env` | data | data | gap | envCoverage < 50% | — | — | logging-quality signal, no horticulture claim |
| `data.no-env` | data | data | gap | zero temp/RH/pH/EC readings | — | — | logging-quality signal |
| `data.stage-unknown` | data | data | gap | stage === "UNKNOWN" | — | — | asks, never guesses a stage |
| `data.stale` | data | data | gap | daysSinceUpdate ≥ 10 and no fresh user-reported point | — | — | freshness signal, no horticulture claim |

## 4. KNOWLEDGE_VERSION history

- `2.1` — F1–F5: signal-grouped scoring, deterministic ordering, knowledge
  validator, NL parser hardening, session continuity + `/why`, snapshot rule,
  stage capture, stale degradation, runoff channel.

## 5. Dead-field classification

| Field | Disposition |
|---|---|
| `setup.capabilities` | future-intent — kept, documented (heuristic keyword match, used to soften interpretations) |
| `daysSinceUpdate` | connected — drives `data.stale`, the stale clamp, `WhyTrail.basis.staleDays`, next-measurement freshness bonus |
| `stageStartCensored` | kept — rendered in `/why` basis as "stage timing estimated" (`WhyTrail.basis.stageEstimated`) |
| `medianUpdateIntervalDays` | **removed** — zero readers; computation and field deleted |
| `diary.techniques` | future-intent — kept |
| `diary.lightType` | future-intent — kept |
| `measurements[]` (parser) | connected — session `ReportedPoint`s (F3) + runoff channel (F5) |
