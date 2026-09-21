// TerpBot intelligence — knowledge validator.
// Structural lint over the shared registries: candidate defs, rules,
// sources, contra/refinement tables, vocab feeds, and the wizard
// bridge. Returns human-readable error strings ([] = valid). Pure —
// no Prisma, no I/O; safe to run in tests and the validate:knowledge
// script.

import {
  CONTRA,
  INSPECTION_INFO,
  INTEL_RULES,
  MEASUREMENT_INFO,
  MEASUREMENT_PRIORITY,
} from "@/lib/terpbot-intel"
import { CANDIDATES, SOURCES } from "@/lib/terpbot-intel-knowledge"
import {
  LOCATION_REFINEMENTS,
  STAGE_REFINEMENTS,
  VOCAB,
} from "@/lib/terpbot-nl-vocab"
import { WIZARD_RESULTS } from "@/lib/problem-wizard"
import {
  METRIC_IDS,
  SIGNAL_IDS,
  SYMPTOM_IDS,
  type CandidateDef,
  type IntelRule,
  type KnowledgeSource,
  type NextStepId,
  type SymptomId,
} from "@/lib/terpbot-intel-types"
import type { WizardResult } from "@/lib/problem-wizard"

export interface KnowledgeRegistry {
  candidates: Record<string, CandidateDef>
  rules: IntelRule[]
  sources: Record<string, KnowledgeSource>
  contra: Partial<Record<SymptomId, string[]>>
  stageRefinements: Partial<Record<SymptomId, Partial<Record<string, string[]>>>>
  locationRefinements: Partial<Record<SymptomId, Partial<Record<string, string[]>>>>
  inspectionInfo: Record<string, { label: string; why: string; resolvedBy?: SymptomId[] }>
  measurementPriority: NextStepId[]
  measurementLabels: Record<string, unknown>
  wizardResults: Record<string, WizardResult>
  vocabFeeds: { id: string; feeds: string[] }[]
}

const RULE_DOMAINS = new Set([
  "environment", "chemistry", "growth", "stage", "data",
  "nutrition", "pest", "disease", "watering",
])
const CANDIDATE_KINDS = new Set(["condition", "risk"])
const SEVERITIES = new Set(["urgent", "moderate", "watch"])
const MAX_STATES = new Set(["strong", "possible"])
const FINDING_KINDS = new Set(["observation", "assessment", "risk", "gap"])

function defaults(): KnowledgeRegistry {
  return {
    candidates: CANDIDATES,
    rules: INTEL_RULES,
    sources: SOURCES,
    contra: CONTRA,
    stageRefinements: STAGE_REFINEMENTS,
    locationRefinements: LOCATION_REFINEMENTS,
    inspectionInfo: INSPECTION_INFO,
    measurementPriority: MEASUREMENT_PRIORITY,
    measurementLabels: MEASUREMENT_INFO,
    wizardResults: WIZARD_RESULTS,
    vocabFeeds: VOCAB.filter((e) => e.family === "symptom").map((e) => ({
      id: e.id,
      feeds: e.feeds ?? [],
    })),
  }
}

const metricIds = new Set<string>(METRIC_IDS)
const symptomIds = new Set<string>(SYMPTOM_IDS)
const signalIds = new Set<string>(SIGNAL_IDS)

export function validateKnowledge(reg?: Partial<KnowledgeRegistry>): string[] {
  const r: KnowledgeRegistry = { ...defaults(), ...reg }
  const errors: string[] = []

  const isMetricOrInspect = (id: string) =>
    metricIds.has(id) || id in r.inspectionInfo

  // ── candidates ──────────────────────────────────────────────────
  const seenWizardIds = new Map<string, string>()
  for (const [key, def] of Object.entries(r.candidates)) {
    if (def.id !== key) errors.push(`candidate:${key}: key does not match def.id "${def.id}"`)
    if (!RULE_DOMAINS.has(def.domain)) errors.push(`candidate:${key}: unknown domain "${def.domain}"`)
    if (!CANDIDATE_KINDS.has(def.kind)) errors.push(`candidate:${key}: unknown kind "${def.kind}"`)
    if (!SEVERITIES.has(def.severity)) errors.push(`candidate:${key}: unknown severity "${def.severity}"`)
    if (!MAX_STATES.has(def.maxState)) errors.push(`candidate:${key}: unknown maxState "${def.maxState}"`)
    for (const m of def.requiredInputs) {
      if (!metricIds.has(m)) errors.push(`candidate:${key}: requiredInput "${m}" is not a MetricId`)
    }
    for (const m of def.discriminatingInputs) {
      if (!isMetricOrInspect(m)) errors.push(`candidate:${key}: discriminatingInput "${m}" is not a metric or inspection`)
    }
    if (!def.sourceIds.length) {
      errors.push(`candidate:${key}: sourceIds is empty`)
    }
    for (const s of def.sourceIds) {
      if (!(s in r.sources)) errors.push(`candidate:${key}: source "${s}" not in SOURCES`)
    }
    if (def.wizardResultId != null) {
      if (def.wizardResultId !== def.id) {
        errors.push(`candidate:${key}: wizardResultId "${def.wizardResultId}" !== candidate id`)
      }
      if (!(def.wizardResultId in r.wizardResults)) {
        errors.push(`candidate:${key}: wizardResultId "${def.wizardResultId}" has no wizard result`)
      }
      const prev = seenWizardIds.get(def.wizardResultId)
      if (prev) errors.push(`candidate:${key}: wizardResultId "${def.wizardResultId}" also claimed by ${prev}`)
      else seenWizardIds.set(def.wizardResultId, key)
    }
  }
  for (const id of Object.keys(r.wizardResults)) {
    if (!(id in r.candidates)) errors.push(`wizard:${id}: wizard result has no candidate`)
  }

  // ── rules ───────────────────────────────────────────────────────
  const seenRuleIds = new Set<string>()
  for (const rule of r.rules) {
    if (seenRuleIds.has(rule.id)) errors.push(`rule:${rule.id}: duplicate rule id`)
    seenRuleIds.add(rule.id)
    if (!RULE_DOMAINS.has(rule.domain)) errors.push(`rule:${rule.id}: unknown domain "${rule.domain}"`)
    if (!FINDING_KINDS.has(rule.kind)) errors.push(`rule:${rule.id}: unknown kind "${rule.kind}"`)
    if (rule.signal != null && !signalIds.has(rule.signal)) {
      errors.push(`rule:${rule.id}: signal "${rule.signal}" not in SIGNAL_IDS`)
    }
    // gap findings report missing data — provenance is only required
    // for rules that assert something about the grow
    if (rule.kind !== "gap" && !rule.sourceIds.length) {
      errors.push(`rule:${rule.id}: sourceIds is empty`)
    }
    for (const s of rule.sourceIds) {
      if (!(s in r.sources)) errors.push(`rule:${rule.id}: source "${s}" not in SOURCES`)
    }
  }

  // ── sources ─────────────────────────────────────────────────────
  // Registry hygiene: every entry must sit inside the tier taxonomy,
  // carry a real citation URL (INTERNAL_DATA points at repo files via
  // `publication` and is exempt), and be cited at least once — an
  // uncited source is dead weight that drifts out of date.
  const EVIDENCE_TIERS = new Set<string>([
    "PEER_REVIEWED", "EXTENSION", "GOVERNMENT", "PROFESSIONAL",
    "COMMUNITY", "INTERNAL_DATA",
  ])
  const citedSourceIds = new Set<string>()
  for (const def of Object.values(r.candidates)) {
    for (const s of def.sourceIds) citedSourceIds.add(s)
  }
  for (const rule of r.rules) {
    for (const s of rule.sourceIds) citedSourceIds.add(s)
  }
  for (const [key, s] of Object.entries(r.sources)) {
    if (s.id !== key) errors.push(`source:${key}: key does not match source.id "${s.id}"`)
    if (!EVIDENCE_TIERS.has(s.tier)) {
      errors.push(`source:${key}: tier "${s.tier}" not in the evidence taxonomy`)
    }
    if (s.tier !== "INTERNAL_DATA" && !/^https?:\/\/.+/.test(s.url)) {
      errors.push(`source:${key}: url missing or not http(s)`)
    }
    if (!citedSourceIds.has(key)) {
      errors.push(`source:${key}: registered but never cited by any rule or candidate`)
    }
  }

  // ── symptom-keyed tables ────────────────────────────────────────
  for (const [symptom, ids] of Object.entries(r.contra)) {
    if (!symptomIds.has(symptom)) errors.push(`contra:${symptom}: not a SymptomId`)
    for (const cid of ids ?? []) {
      if (!(cid in r.candidates)) errors.push(`contra:${symptom}: candidate "${cid}" not registered`)
    }
  }
  for (const [table, refinements] of [
    ["stageRefinements", r.stageRefinements],
    ["locationRefinements", r.locationRefinements],
  ] as const) {
    for (const [symptom, byKey] of Object.entries(refinements)) {
      if (!symptomIds.has(symptom)) errors.push(`${table}:${symptom}: not a SymptomId`)
      for (const [refKey, ids] of Object.entries(byKey ?? {})) {
        for (const cid of ids ?? []) {
          if (!(cid in r.candidates)) {
            errors.push(`${table}:${symptom}.${refKey}: candidate "${cid}" not registered`)
          }
        }
      }
    }
  }
  for (const entry of r.vocabFeeds) {
    for (const cid of entry.feeds) {
      if (!(cid in r.candidates)) errors.push(`vocab:${entry.id}: feeds "${cid}" not registered`)
    }
  }

  // ── next-step registries ────────────────────────────────────────
  for (const [id, info] of Object.entries(r.inspectionInfo)) {
    for (const s of info.resolvedBy ?? []) {
      if (!symptomIds.has(s)) errors.push(`inspection:${id}: resolvedBy "${s}" is not a SymptomId`)
    }
  }
  for (const id of r.measurementPriority) {
    if (!isMetricOrInspect(id)) errors.push(`measurementPriority: "${id}" is not a metric or inspection`)
  }
  for (const m of METRIC_IDS) {
    if (!(m in r.measurementLabels)) errors.push(`measurementLabels: metric "${m}" has no label/why`)
  }

  return errors
}
