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

  // claims land on their own key when the grower named a location that
  // has reports; a symptom-scoped claim with no (or a foreign) location
  // falls back to that symptom's most recently reported bucket — the
  // grower means the thing they reported, not a phantom new episode
  const reportBucketsOf = (s: SymptomId) =>
    [...byKey.values()].filter(
      (b) => b.symptom === s && b.evs.some((e) => e.kind === "report")
    )
  const unscoped: Ev[] = []
  for (const r of resolutions) {
    if (!r.symptom) {
      unscoped.push({ t: r.t, kind: r.kind })
      continue
    }
    const exact = byKey.get(key(r.symptom, r.location))
    let target = exact && exact.evs.some((e) => e.kind === "report") ? exact : undefined
    if (!target) {
      // deterministic fallback: the same-symptom bucket whose latest
      // report is closest to (and not after) the claim
      for (const b of reportBucketsOf(r.symptom)) {
        const lastReport = Math.max(
          ...b.evs.filter((e) => e.kind === "report").map((e) => e.t)
        )
        if (lastReport > r.t) continue
        if (
          !target ||
          lastReport >
            Math.max(...target.evs.filter((e) => e.kind === "report").map((e) => e.t))
        ) {
          target = b
        }
      }
    }
    (target ?? bucket(r.symptom, r.location)).evs.push({ t: r.t, kind: r.kind })
  }

  const episodes: SymptomEpisode[] = []
  const KIND_ORDER = { report: 0, worsening: 1, stable: 2, improving: 3, resolved: 4 }

  // process scoped events per key
  const sortedKeys = [...byKey.keys()].sort()
  for (const k of sortedKeys) {
    const b = byKey.get(k)!
    const evs = b.evs.sort((a, c) => a.t - c.t || KIND_ORDER[a.kind as keyof typeof KIND_ORDER] - KIND_ORDER[c.kind as keyof typeof KIND_ORDER])
    let ep: SymptomEpisode | null = null
    let lastReportApprox = false
    for (const e of evs) {
      if (!ep) {
        lastReportApprox = e.kind === "report" && !!e.approximate
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
        if (e.kind === "report") lastReportApprox = !!e.approximate
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
    // tApproximate reports open/extend history but can't mint a
    // "current" episode — the episode is marked approximate so
    // renderers/rules don't treat it as a fresh sighting
    if (ep && lastReportApprox) ep.approximate = true
    if (ep) episodes.push(ep)
  }

  // unscoped claims apply to the most recently relevant episode
  // existing at claim time — deterministic: latest lastSeen ≤ claim t.
  // worsening claims may also target a resolved episode (recurrence).
  for (const e of unscoped.sort((a, b) => a.t - b.t)) {
    let target: SymptomEpisode | null = null
    for (const ep of episodes) {
      if (e.kind === "worsening"
        ? ep.status === "improving"
        : ep.status === "resolved" || ep.status === "improving") continue
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
    } else if (target.status === "resolved") {
      target.status = "recurred"
      target.episodeCount++
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
