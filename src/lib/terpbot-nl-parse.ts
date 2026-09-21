// ── TerpBot deterministic symptom/entity parser ─────────────────────
// Normalized grower text → structured observations + measurements.
// PURE: no Prisma, no I/O, no Date, no randomness. Same input → same
// output, always. The parser NEVER diagnoses — it produces
// observations; the rule engine does the reasoning.

import type {
  LocationId,
  MetricId,
  SymptomId,
} from "./terpbot-intel-types"
import {
  COMPARISON_RE,
  GUARD_PHRASES,
  LOCATION_REFINEMENTS,
  METRIC_TREND_OBSERVATIONS,
  NEGATION_PHRASES,
  NEGATION_TOKENS,
  PLANT_NOUNS,
  QUESTION_LEAD,
  STAGE_PATTERNS,
  STAGE_REFINEMENTS,
  VOCAB,
  type VocabEntry,
} from "./terpbot-nl-vocab"

export interface ParsedObservation {
  symptom: SymptomId
  location?: LocationId
  stage?: string
  period?: string
  clause: number
  /** offsets into the normalized text — provenance, never rendered */
  span: [number, number]
  feeds: string[]
  refined: boolean
}

export interface ParsedMeasurement {
  metric: MetricId
  value?: number
  unit?: string
  trend?: string
  period?: string
  clause: number
  span: [number, number]
}

export interface ParsedUtterance {
  observations: ParsedObservation[]
  measurements: ParsedMeasurement[]
  /** utterance-level stage claim ("i'm in week 5 flower") */
  stage?: string
  /** question-led text that is not a comparison — a lookup, not a report */
  question: boolean
  /** comparison/lookup text — "vs", "worse than", "greener than last week" */
  comparison: boolean
  /** unmatched text — remains eligible for /ask fallback */
  residual: string
}

const CLAUSE_SEP = "¶"

const VOCAB_BY_ID = new Map(VOCAB.map((e) => [e.id, e]))

/** The feeds a symptom observation pools into — same stage/location
 *  refinement rules the parser applies per-clause. Exported so
 *  session-merged observations get identical resolution without
 *  re-parsing text. */
export function feedsForSymptom(
  symptom: SymptomId,
  location?: LocationId,
  stage?: string
): { feeds: string[]; refined: boolean } {
  const feeds = VOCAB_BY_ID.get(symptom)?.feeds ?? []
  const stageRef = stage ? STAGE_REFINEMENTS[symptom]?.[stage] : undefined
  const locRef = location ? LOCATION_REFINEMENTS[symptom]?.[location] : undefined
  if (stageRef && locRef) {
    const inter = stageRef.filter((f) => locRef.includes(f))
    return { feeds: inter.length ? inter : stageRef, refined: true }
  }
  if (stageRef) return { feeds: stageRef, refined: true }
  if (locRef) return { feeds: locRef, refined: true }
  return { feeds, refined: false }
}

export function normalizeGrowText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[?!";:]+/g, " ")
    .replace(/[,;&|]+/g, ` ${CLAUSE_SEP} `)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200)
}

// ── phrase index ────────────────────────────────────────────────────
// Built once at module load. Longest phrase wins at a position; equal
// lengths resolve lexicographically so output never depends on the
// order entries appear in the vocab tables.

interface PhraseRow {
  phrase: string
  entry: VocabEntry
}

const PHRASE_INDEX: PhraseRow[] = VOCAB.flatMap((entry) =>
  entry.phrases.map((phrase) => ({ phrase, entry }))
).sort((a, b) => b.phrase.length - a.phrase.length || a.phrase.localeCompare(b.phrase) || a.entry.id.localeCompare(b.entry.id))

interface Hit {
  entry: VocabEntry
  start: number
  len: number
}

function isWordChar(ch: string | undefined): boolean {
  return ch != null && /[a-z0-9']/.test(ch)
}

function bounded(text: string, start: number, len: number): boolean {
  return !isWordChar(text[start - 1]) && !isWordChar(text[start + len])
}

function matchClause(
  clause: string,
  base: number,
  consumed: boolean[]
): Hit[] {
  const hits: Hit[] = []
  let i = 0
  while (i < clause.length) {
    if (consumed[base + i]) {
      i++
      continue
    }
    let matched = false
    for (const { phrase, entry } of PHRASE_INDEX) {
      if (
        clause.startsWith(phrase, i) &&
        bounded(clause, i, phrase.length)
      ) {
        let free = true
        for (let k = 0; k < phrase.length; k++) {
          if (consumed[base + i + k]) {
            free = false
            break
          }
        }
        if (!free) continue
        for (let k = 0; k < phrase.length; k++) consumed[base + i + k] = true
        hits.push({ entry, start: base + i, len: phrase.length })
        i += phrase.length
        matched = true
        break
      }
    }
    if (!matched) i++
  }
  return hits
}

function clauseHasSignal(clause: string, base: number, consumed: boolean[]): boolean {
  const copy = consumed.slice()
  return matchClause(clause, base, copy).some((h) => {
    if (h.entry.family !== "symptom" && h.entry.family !== "metric") return false
    // a negated hit carries no signal — "not yellow but pale" stays one
    // clause so "pale" keeps the strong-sibling context
    if (h.entry.family === "symptom" && isNegated(clause, h.start - base)) return false
    return true
  })
}

const CONJUNCTION_RE = /\b(and|also|plus|but then|but|then)\b/g

function segmentClauses(
  text: string,
  consumed: boolean[]
): { text: string; base: number }[] {
  // hard split on the clause sentinel
  const hard: { text: string; base: number }[] = []
  let cursor = 0
  for (const part of text.split(CLAUSE_SEP)) {
    const idx = text.indexOf(part, cursor)
    hard.push({ text: part, base: idx })
    cursor = idx + part.length
  }

  // soft split on conjunctions — committed only when BOTH halves carry
  // a signal, so "black and blue spots" stays one clause
  const out: { text: string; base: number }[] = []
  for (const seg of hard) {
    let last = 0
    const parts: { text: string; base: number }[] = []
    CONJUNCTION_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = CONJUNCTION_RE.exec(seg.text))) {
      parts.push({ text: seg.text.slice(last, m.index), base: seg.base + last })
      last = m.index + m[0].length
    }
    parts.push({ text: seg.text.slice(last), base: seg.base + last })

    if (parts.length <= 1) {
      out.push(seg)
      continue
    }
    // decide per boundary whether to commit — both sides must carry a
    // signal, otherwise the conjunction is literal text
    let cur = parts[0]
    for (let i = 1; i < parts.length; i++) {
      const next = parts[i]
      if (
        clauseHasSignal(cur.text, cur.base, consumed) &&
        clauseHasSignal(next.text, next.base, consumed)
      ) {
        out.push(cur)
        cur = next
      } else {
        cur = {
          text: seg.text.slice(
            cur.base - seg.base,
            next.base - seg.base + next.text.length
          ),
          base: cur.base,
        }
      }
    }
    out.push(cur)
  }
  return out.filter((s) => s.text.trim().length > 0)
}

const NUMBER_RE =
  /\d+(?:\.\d+)?\s*(°f|°c|f\b|c\b|%|ppm|ms\/cm|kpa|cm\b|in\b|ml\/l)?/g

/** a % in a clause about light intensity is dimmer output, never RH */
const LIGHT_INTENSITY_RE = /\b(lights?|dimmer|dimmed|intensity)\b/

const UNIT_TO_METRIC: Record<string, MetricId> = {
  "°f": "temperature",
  f: "temperature",
  "°c": "temperature",
  c: "temperature",
  celsius: "temperature",
  fahrenheit: "temperature",
  "%": "humidity",
  ppm: "ec",
  "ms/cm": "ec",
  kpa: "vpd",
  cm: "height",
  in: "height",
}

const UNIT_NORMALIZE: Record<string, string> = {
  "°f": "degF",
  f: "degF",
  fahrenheit: "degF",
  "°c": "degC",
  c: "degC",
  celsius: "degC",
  "%": "percent",
  ppm: "ppm",
  "ms/cm": "mscm",
  kpa: "kpa",
  cm: "cm",
  in: "inch",
  "ml/l": "mll",
}

function wordsBefore(text: string, start: number, count: number): string[] {
  const before = text.slice(0, start).trimEnd()
  if (!before) return []
  return before.split(/\s+/).slice(-count)
}

/** negated when any of the last two words is a negation token, or a
 *  multi-word negation phrase appears within the last four tokens */
function isNegated(clause: string, offset: number): boolean {
  const words = wordsBefore(clause, offset, 4)
  if (!words.length) return false
  if (words.slice(-2).some((w) => NEGATION_TOKENS.has(w))) return true
  const window = words.join(" ")
  return NEGATION_PHRASES.some((p) => window.includes(p))
}

const RUNOFF_PREFIX_RE = /\b(run[\s-]?off)\s*$/
const BARE_CHEM_RE = /^(e\.?c\.?|p\.?h\.?)$/

export function parseGrowText(raw: string): ParsedUtterance {
  const text = normalizeGrowText(raw)
  const consumed: boolean[] = new Array(text.length).fill(false)

  // guard pass — protected spans can never match
  for (const guard of GUARD_PHRASES) {
    let idx = 0
    while ((idx = text.indexOf(guard, idx)) !== -1) {
      if (bounded(text, idx, guard.length)) {
        for (let k = 0; k < guard.length; k++) consumed[idx + k] = true
      }
      idx += guard.length
    }
  }

  const clauses = segmentClauses(text, consumed)

  const observations: ParsedObservation[] = []
  const measurements: ParsedMeasurement[] = []
  let utteranceStage: string | undefined

  // collect stage hits across the whole utterance first — a single
  // stage claim applies to observations whose clause has none
  const stageHits: { id: string; clause: number }[] = []
  const clauseHits: Hit[][] = []
  const clausePlantNoun: boolean[] = []

  clauses.forEach((seg, ci) => {
    const hits = matchClause(seg.text, seg.base, consumed)
    clauseHits[ci] = hits
    clausePlantNoun[ci] = seg.text
      .split(/\s+/)
      .some((w) => PLANT_NOUNS.has(w))
    for (const h of hits) {
      if (h.entry.family === "stage") stageHits.push({ id: h.entry.id, clause: ci })
    }
    // numeric stage claims — "week 6 flower", "f6" — can't be phrases
    for (const { re, stage } of STAGE_PATTERNS) {
      if (re.test(seg.text)) stageHits.push({ id: stage, clause: ci })
    }
  })

  const distinctStages = [...new Set(stageHits.map((h) => h.id))]
  if (distinctStages.length === 1) utteranceStage = distinctStages[0]

  // Question-led or comparison text is a lookup, not a report —
  // "what pm level", "light burn vs nutrient burn" must not mint
  // symptom observations. Measurements still extract (numbers are data
  // either way).
  const comparison = COMPARISON_RE.test(text)
  const question = QUESTION_LEAD.test(text) && !comparison
  const questionish = question || comparison

  clauses.forEach((seg, ci) => {
    const hits = clauseHits[ci]
    const clauseStage = stageHits.find((h) => h.clause === ci)?.id

    const surviving = hits.filter((h) => {
      if (h.entry.family !== "symptom") return true
      if (questionish) return false
      if (h.entry.confidence === "weak") {
        const hasStrongSibling = hits.some(
          (o) => o !== h && o.entry.family === "symptom" && o.entry.confidence !== "weak"
        )
        if (!clausePlantNoun[ci] && !hasStrongSibling) return false
      }
      // negation — "no yellowing", "not clawing", "no longer yellowing"
      if (isNegated(seg.text, h.start - seg.base)) return false
      return true
    })

    const locations = surviving.filter((h) => h.entry.family === "location")
    const stages = surviving.filter((h) => h.entry.family === "stage")
    const trends = surviving.filter((h) => h.entry.family === "trend")
    const periods = surviving.filter((h) => h.entry.family === "period")
    const metrics = surviving.filter((h) => h.entry.family === "metric")
    const units = surviving.filter((h) => h.entry.family === "unit")

    for (const h of surviving) {
      if (h.entry.family !== "symptom") continue
      const symptom = h.entry.id as SymptomId

      // nearest location in the same clause, either direction
      let location: LocationId | undefined
      let best = Infinity
      for (const l of locations) {
        const d = Math.abs(l.start - h.start)
        if (d < best) {
          best = d
          location = l.entry.id as LocationId
        }
      }

      const stage = clauseStage ?? (stages.length === 1 ? stages[0].entry.id : undefined) ?? utteranceStage

      // feeds: stage refines first, location second — when BOTH apply,
      // the intersection wins ("sugar leaves yellowing" in flower is
      // senescence, not the whole deficiency family). Disjoint tables
      // fall back to stage.
      let feeds = h.entry.feeds ?? []
      let refined = false
      const stageRef = stage ? STAGE_REFINEMENTS[symptom]?.[stage] : undefined
      const locRef = location ? LOCATION_REFINEMENTS[symptom]?.[location] : undefined
      if (stageRef && locRef) {
        const inter = stageRef.filter((f) => locRef.includes(f))
        feeds = inter.length ? inter : stageRef
        refined = true
      } else if (stageRef) {
        feeds = stageRef
        refined = true
      } else if (locRef) {
        feeds = locRef
        refined = true
      }

      const period = periods.length === 1 ? periods[0].entry.id : undefined

      observations.push({
        symptom,
        location,
        stage,
        period,
        clause: ci,
        span: [h.start, h.start + h.len],
        feeds,
        refined,
      })
    }

    // metric + trend without a symptom → synthesize the matching
    // observation ("humidity keeps climbing" → reported rising-RH)
    if (!questionish && !surviving.some((h) => h.entry.family === "symptom") && metrics.length > 0 && trends.length > 0) {
      for (const mh of metrics) {
        const byMetric = METRIC_TREND_OBSERVATIONS[mh.entry.id]
        if (!byMetric) continue
        for (const th of trends) {
          const synth = byMetric[th.entry.id]
          if (!synth) continue
          observations.push({
            symptom: synth.symptom,
            stage: clauseStage ?? utteranceStage,
            period: periods.length === 1 ? periods[0].entry.id : undefined,
            clause: ci,
            span: [mh.start, mh.start + mh.len],
            feeds: synth.feeds,
            refined: false,
          })
          break // one trend per clause is enough
        }
      }
    }

    // measurements — numbers on unconsumed spans bound to metrics/units
    NUMBER_RE.lastIndex = 0
    let nm: RegExpExecArray | null
    while ((nm = NUMBER_RE.exec(seg.text))) {
      const start = seg.base + nm.index
      const end = start + nm[0].length
      let free = true
      for (let k = nm.index; k < nm.index + nm[0].length; k++) {
        if (consumed[seg.base + k]) {
          free = false
          break
        }
      }
      if (!free) continue

      // "i don't know my runoff EC" — negated mentions aren't data
      if (isNegated(seg.text, nm.index)) continue

      const rawUnit = nm[1]?.trim()
      const unit = rawUnit ? UNIT_NORMALIZE[rawUnit] : undefined

      // an explicit unit suffix on the number beats a nearby metric
      // phrase ("84f and 40% rh" → temperature, not humidity); else
      // nearest metric phrase; else a consumed unit hit implies it
      let metric: MetricId | undefined = rawUnit
        ? UNIT_TO_METRIC[rawUnit]
        : undefined
      let unitPhrase: string | undefined
      if (!metric) {
        let best = Infinity
        for (const mh of metrics) {
          const d = Math.abs(mh.start - start)
          if (d < best) {
            best = d
            metric = mh.entry.id as MetricId
          }
        }
      }
      if (!metric) {
        // a unit hit consumed as a phrase (e.g. "%", "celsius") can
        // imply both metric and unit
        for (const uh of units) {
          const text2 = seg.text.slice(uh.start - seg.base, uh.start - seg.base + uh.len)
          const implied = UNIT_TO_METRIC[text2]
          if (implied) {
            metric = implied
            unitPhrase = text2
            break
          }
        }
      }
      if (!metric) continue // bare number → residual, never guessed

      // unit implied by the metric phrase itself ("ppm" → ppm)
      let metricPhrase = metrics.find((mh) => mh.entry.id === metric)

      // bare "ec"/"ph" with a runoff prefix nearby is the runoff metric
      if ((metric === "ec" || metric === "ph") && metricPhrase) {
        const pText = seg.text.slice(
          metricPhrase.start - seg.base,
          metricPhrase.start - seg.base + metricPhrase.len
        )
        if (BARE_CHEM_RE.test(pText)) {
          const before = wordsBefore(seg.text, metricPhrase.start - seg.base, 2).join(" ")
          if (RUNOFF_PREFIX_RE.test(before)) {
            metric = metric === "ec" ? "runoffEc" : "runoffPh"
            metricPhrase = undefined
          }
        }
      }

      // "lights are at 70%" — a % in a light-intensity clause with no
      // humidity phrase is dimmer output, never an RH measurement
      if (
        metric === "humidity" &&
        LIGHT_INTENSITY_RE.test(seg.text) &&
        !metrics.some((mh) => mh.entry.id === "humidity")
      ) continue
      const phraseText = metricPhrase
        ? seg.text.slice(metricPhrase.start - seg.base, metricPhrase.start - seg.base + metricPhrase.len)
        : undefined
      const impliedUnit =
        unit ??
        (unitPhrase ? UNIT_NORMALIZE[unitPhrase] : undefined) ??
        (phraseText === "ppm" || phraseText === "tds"
          ? "ppm"
          : phraseText === "rh" || phraseText === "humidity"
            ? "percent"
            : phraseText === "ms/cm"
              ? "mscm"
              : phraseText === "vpd"
                ? "kpa"
                : undefined)

      const value = parseFloat(nm[0])
      measurements.push({
        metric,
        value: Number.isFinite(value) ? value : undefined,
        unit: impliedUnit,
        trend: trends.length === 1 ? trends[0].entry.id : undefined,
        period: periods.length === 1 ? periods[0].entry.id : undefined,
        clause: ci,
        span: [start, end],
      })
    }
  })

  // dedupe observations on (symptom, location, stage, period) keeping
  // earliest span; then total ordering — output never depends on
  // vocab array order
  const seen = new Set<string>()
  const deduped = observations.filter((o) => {
    const key = `${o.symptom}|${o.location ?? ""}|${o.stage ?? ""}|${o.period ?? ""}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  deduped.sort(
    (a, b) => a.clause - b.clause || a.span[0] - b.span[0] || a.symptom.localeCompare(b.symptom)
  )

  // blank every consumed span for the residual
  let residual = ""
  for (let i = 0; i < text.length; i++) {
    residual += consumed[i] ? " " : text[i]
  }
  residual = residual.replace(new RegExp(CLAUSE_SEP, "g"), " ").replace(/\s+/g, " ").trim()

  return {
    observations: deduped,
    measurements,
    stage: utteranceStage,
    question,
    comparison,
    residual,
  }
}
