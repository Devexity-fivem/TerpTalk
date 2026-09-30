"use client"

import { useMemo, useState } from "react"
import { LineChart, Line, ResponsiveContainer } from "recharts"
import { ArrowDown, ArrowUp, Minus, Lock } from "@/lib/icons"
import { cn } from "@/lib/utils"

/**
 * env-insights — the `env-analytics` unlock (Vegged + Journaling 3).
 *
 * The diary's public env chart covers temp/humidity/VPD/pH/EC for everyone.
 * This panel is the owner-only advanced layer over the same stored
 * readings: the extended sensor set (night/substrate temp, CO₂, PPFD,
 * photoperiod, runoff, lamp distance), per-metric aggregates and trends,
 * a day/night temperature split, and a 30/90/all-time window. No new
 * data is collected — it surfaces fields updates already capture.
 */

export interface EnvUpdatePoint {
  createdAt: string | Date
  temperature: number | null
  humidity: number | null
  vpd: number | null
  nightTemperature: number | null
  substrateTemperature: number | null
  co2Ppm: number | null
  ppfd: number | null
  photoperiodHours: number | null
  runoffPh: number | null
  runoffEc: number | null
  lampDistanceCm: number | null
  wateringLiters: number | null
}

type MetricKey = Exclude<keyof EnvUpdatePoint, "createdAt">

const METRICS: { key: MetricKey; label: string; unit: string; sum?: boolean }[] = [
  { key: "temperature", label: "Day temp", unit: "°C" },
  { key: "nightTemperature", label: "Night temp", unit: "°C" },
  { key: "substrateTemperature", label: "Substrate temp", unit: "°C" },
  { key: "humidity", label: "Humidity", unit: "%" },
  { key: "vpd", label: "VPD", unit: "kPa" },
  { key: "co2Ppm", label: "CO₂", unit: "ppm" },
  { key: "ppfd", label: "PPFD", unit: "µmol" },
  { key: "photoperiodHours", label: "Photoperiod", unit: "h" },
  { key: "runoffPh", label: "Runoff pH", unit: "" },
  { key: "runoffEc", label: "Runoff EC", unit: "mS" },
  { key: "lampDistanceCm", label: "Lamp distance", unit: "cm" },
  { key: "wateringLiters", label: "Watering", unit: "L", sum: true },
]

const WINDOWS = [
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
  { key: "all", label: "All", days: null as number | null },
]

interface MetricStat {
  latest: number
  avg: number
  min: number
  max: number
  delta: number | null // avg(second half) − avg(first half)
  points: number[]
  count: number
}

function stats(values: number[]): MetricStat | null {
  if (values.length < 2) return null
  const latest = values[values.length - 1]
  const avg = values.reduce((a, b) => a + b, 0) / values.length
  const min = Math.min(...values)
  const max = Math.max(...values)
  let delta: number | null = null
  if (values.length >= 4) {
    const half = Math.floor(values.length / 2)
    const first = values.slice(0, values.length - half)
    const second = values.slice(values.length - half)
    delta = second.reduce((a, b) => a + b, 0) / second.length - first.reduce((a, b) => a + b, 0) / first.length
  }
  return { latest, avg, min, max, delta, points: values, count: values.length }
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10)

function MetricCard({ label, unit, s }: { label: string; unit: string; s: MetricStat }) {
  const Trend = s.delta === null || Math.abs(s.delta) < 0.05 * Math.max(Math.abs(s.avg), 1)
    ? Minus
    : s.delta > 0 ? ArrowUp : ArrowDown
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
        <Trend className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
      </div>
      <p className="text-lg font-semibold leading-tight tabular-nums">
        {fmt(s.latest)}
        <span className="text-xs font-normal text-muted-foreground ml-0.5">{unit}</span>
      </p>
      <div className="h-8 mt-1 -mx-1" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={s.points.map((v, i) => ({ i, v }))} margin={{ top: 1, right: 1, bottom: 1, left: 1 }}>
            <Line type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
        avg {fmt(s.avg)}{unit} · {fmt(s.min)}–{fmt(s.max)} · {s.count} readings
      </p>
    </div>
  )
}

export default function EnvInsights({ updates, unlocked, nowMs }: { updates: EnvUpdatePoint[]; unlocked: boolean; nowMs: number }) {
  const [windowKey, setWindowKey] = useState("30")
  const window = WINDOWS.find((w) => w.key === windowKey) ?? WINDOWS[0]

  const rows = useMemo(() => {
    const cutoff = window.days === null ? null : nowMs - window.days * 86400000
    return updates
      .map((u) => ({ ...u, t: new Date(u.createdAt).getTime() }))
      .filter((u) => cutoff === null || u.t >= cutoff)
      .sort((a, b) => a.t - b.t)
  }, [updates, window.days, nowMs])

  const metricStats = useMemo(
    () =>
      METRICS.map((m) => ({
        ...m,
        s: stats(rows.map((r) => r[m.key]).filter((v): v is number => v != null)),
      })).filter((m) => m.s !== null),
    [rows]
  )

  // Day/night temperature split — the pair this feature exists for.
  const dayNight = useMemo(() => {
    const days = rows.map((r) => r.temperature).filter((v): v is number => v != null)
    const nights = rows.map((r) => r.nightTemperature).filter((v): v is number => v != null)
    if (days.length < 2 || nights.length < 2) return null
    const dAvg = days.reduce((a, b) => a + b, 0) / days.length
    const nAvg = nights.reduce((a, b) => a + b, 0) / nights.length
    return { dAvg, nAvg, delta: dAvg - nAvg }
  }, [rows])

  const totalWater = useMemo(
    () => rows.reduce((acc, r) => acc + (r.wateringLiters ?? 0), 0),
    [rows]
  )

  if (!unlocked) {
    return (
      <section className="mb-6 rounded-2xl border border-border/70 bg-card/60 p-4" aria-label="Advanced environment analytics">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Lock className="w-3.5 h-3.5" aria-hidden />
          Advanced environment analytics — night/substrate temps, CO₂, PPFD, runoff and trend windows — unlock at <strong className="text-foreground">Vegged</strong> rank with Journaling level 2.
        </p>
      </section>
    )
  }

  if (metricStats.length === 0) {
    return (
      <section className="mb-6 rounded-2xl border border-border/70 bg-card/60 p-4" aria-label="Advanced environment analytics">
        <p className="text-sm text-muted-foreground">
          Advanced analytics unlocks as your updates carry environment readings — log temperature, VPD, CO₂ or runoff values to see trends here.
        </p>
      </section>
    )
  }

  return (
    <section className="mb-6 rounded-2xl border border-border/70 bg-card/80 p-4" aria-label="Advanced environment analytics">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="text-sm font-semibold">Environment insights</h2>
        <div className="flex rounded-lg border border-border/60 overflow-hidden" role="group" aria-label="Time window">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWindowKey(w.key)}
              aria-pressed={windowKey === w.key}
              className={cn(
                "px-2.5 py-1 text-[11px] font-medium transition-colors",
                windowKey === w.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"
              )}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      {(dayNight || totalWater > 0) && (
        <p className="text-xs text-muted-foreground mb-3 tabular-nums">
          {dayNight && (
            <>Day avg {fmt(dayNight.dAvg)}°C · night avg {fmt(dayNight.nAvg)}°C · {fmt(Math.abs(dayNight.delta))}°C swing{totalWater > 0 ? " · " : ""}</>
          )}
          {totalWater > 0 && <>{fmt(totalWater)}L watered in window</>}
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {metricStats.map((m) => (
          <MetricCard key={m.key} label={m.label} unit={m.unit} s={m.s!} />
        ))}
      </div>
    </section>
  )
}
