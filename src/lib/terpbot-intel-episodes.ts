// TerpBot intelligence — symptom episode derivation.
// Groups (symptom, location) reports + resolution/progression claims
// into episodes: active → stable → improving → resolved → recurred.
//
// Pure and derived-at-eval-time — episodes are NEVER persisted (they'd
// go stale under edited diary updates; derive them fresh from the
// bounded observation set each evaluation).
//
// Deliberate limits:
// - "resolved" requires an explicit grower claim (phrase or harvested
//   negation) — absence of reports is NOT resolution; silence can only
//   mark an episode quiet (rendered as "no new reports", never closed).
// - only an explicit claim or a fresh positive report can move status;
//   an unresolved episode stays active no matter how old it is — the
//   stale clamp handles evidence aging separately.
// - tApproximate observations open/extend history but can't mint
//   "current" episodes — they mark the episode approximate.

import type {
  LocationId,
  ResolutionClaim,
  StructuredObservation,
  SymptomEpisode,
  SymptomId,
} from "@/lib/terpbot-intel-types"

const key = (s: SymptomId, l?: LocationId) => `${s}|${l ?? ""}`

interface Ev {
  t: number
  kind: "report" | ResolutionClaim["kind"]
  approximate?: boolean
}

/** Derive episodes from a merged observation set + resolution claims.
 *  Deterministic: events sort by t then kind (claims evaluate against
 *  what the grower had already reported — a same-time report precedes
 *  the claim). */
export function episodesFromObservations(
  observations: StructuredObservation[],
  resolutions: ResolutionClaim[]
): SymptomEpisode[] {
  const byKey = new Map<string, { symptom: SymptomId; location?: LocationId; evs: Ev[] }>()

  const bucket = (s: SymptomId, l?: LocationId) => {
    const k = key(s, l)
    let b = byKey.get(k)
    if (!b) {
      b = { symptom: s, location: l, evs: [] }
      byKey.set(k, b)
    }
    return b
  }

  for (const o of observations) {
    bucket(o.symptom, o.location).evs.push({ t: o.t, kind: "report", approximate: o.tApproximate })
  }

  // scoped claims land on their own key; unscoped claims apply to the
  // most recently active episode (resolved below)
  const unscoped: Ev[] = []
  for (const r of resolutions) {
    if (r.symptom) bucket(r.symptom, r.location).evs.push({ t: r.t, kind: r.kind })
    else unscoped.push({ t: r.t, kind: r.kind })
  }

  const episodes: SymptomEpisode[] = []
  const KIND_ORDER = { report: 0, worsening: 1, stable: 2, improving: 3, resolved: 4 }

  // process scoped events per key
  const sortedKeys = [...byKey.keys()].sort()
  const episodesByKey = new Map<string, SymptomEpisode>()
  for (const k of sortedKeys) {
    const b = byKey.get(k)!
    const evs = b.evs.sort((a, c) => a.t - c.t || KIND_ORDER[a.kind as keyof typeof KIND_ORDER] - KIND_ORDER[c.kind as keyof typeof KIND_ORDER])
    let ep: SymptomEpisode | null = null
    for (const e of evs) {
      if (!ep) {
        ep = {
          symptom: b.symptom,
          location: b.location,
          firstSeen: e.t,
          lastSeen: e.t,
          // a claim about a never-reported symptom still opens an
          // episode — the claim implies the symptom existed; worsening
          // claims land as active
          status: e.kind === "report" || e.kind === "worsening" ? "active" : e.kind,
          statusAt: e.t,
          episodeCount: 1,
          ...(e.kind === "resolved" ? { lastResolvedAt: e.t } : {}),
        }
        continue
      }
      if (e.kind === "report" || e.kind === "worsening") {
        ep.lastSeen = e.t
        if (ep.status === "resolved") {
          // a positive report (or worsening claim) after resolution —
          // recurrence, not a new problem
          ep.status = "recurred"
          ep.episodeCount++
          ep.statusAt = e.t
        } else if (ep.status === "improving" || ep.status === "stable") {
          ep.status = "active"
          ep.statusAt = e.t
        }
        continue
      }
      if (e.kind === "resolved") {
        if (ep.status !== "resolved") {
          ep.status = "resolved"
          ep.statusAt = e.t
          ep.lastResolvedAt = e.t
        }
        continue
      }
      // improving / stable claims only soften an open episode
      if (ep.status === "active" || ep.status === "recurred" ||
          (ep.status === "stable" && e.kind === "improving")) {
        ep.status = e.kind
        ep.statusAt = e.t
      }
    }
    if (ep) {
      episodes.push(ep)
      episodesByKey.set(k, ep)
    }
  }

  // unscoped claims apply to the most recently active episode existing
  // at claim time — deterministic: latest lastSeen ≤ claim t
  for (const e of unscoped.sort((a, b) => a.t - b.t)) {
    let target: SymptomEpisode | null = null
    for (const ep of episodes) {
      if (ep.status === "resolved" || ep.status === "improving") continue
      if (ep.lastSeen > e.t || ep.statusAt > e.t) continue
      if (!target || ep.lastSeen > target.lastSeen) target = ep
    }
    if (!target) continue
    if (e.kind === "resolved") {
      target.status = "resolved"
      target.statusAt = e.t
      target.lastResolvedAt = e.t
    } else if (e.kind === "improving" || e.kind === "stable") {
      target.status = e.kind
      target.statusAt = e.t
    } else {
      target.status = "active"
      target.statusAt = e.t
    }
  }

  return episodes.sort(
    (a, b) => b.lastSeen - a.lastSeen || a.symptom.localeCompare(b.symptom)
  )
}
