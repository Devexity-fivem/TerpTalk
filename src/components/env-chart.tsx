"use client"

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, ReferenceArea, ReferenceLine, ComposedChart,
} from "recharts"

interface Reading {
  createdAt: string
  day?: number
  week?: number
  temperature: number | null
  humidity: number | null
  vpd: number | null
  ph: number | null
  ec: number | null
}

// Environment charts for a diary — temp/RH on the left axis, VPD and EC on
// right axes so small-range metrics aren't flattened against 0–100 scales.
export default function EnvCharts({ updates }: { updates: Reading[] }) {
  const points = updates.map((u) => ({
    date: new Date(u.createdAt).toLocaleDateString([], { month: "short", day: "numeric" }),
    day: u.day,
    week: u.week,
    temp: u.temperature,
    humidity: u.humidity,
    vpd: u.vpd,
    ph: u.ph,
    ec: u.ec,
  }))

  const envData = points.filter((p) => p.temp != null || p.humidity != null || p.vpd != null)
  const chemData = points.filter((p) => p.ph != null || p.ec != null)
  if (envData.length < 2 && chemData.length < 2) return null

  const axis = { fontSize: 11, fill: "var(--muted-foreground)" }
  const tipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }
  // Tooltips get the grow day/week alongside the date.
  const labelFormatter = (label: unknown, payload?: readonly { payload?: { day?: number; week?: number } }[]) => {
    const p = payload?.[0]?.payload
    const dw = p?.day != null ? `Day ${p.day}${p.week != null ? ` · Week ${p.week}` : ""} — ` : ""
    return `${dw}${label}`
  }

  return (
    <div className="space-y-4 mb-6">
      {envData.length >= 2 && (
        <section className="bg-card rounded-xl border border-border p-4" aria-label="Environment chart — temperature, humidity and VPD over time">
          <h2 className="font-semibold text-sm mb-3">Environment — Temp / RH / VPD</h2>
          <div role="img" aria-label="Line chart of temperature, relative humidity and VPD across diary updates">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={envData}>
                {/* VPD comfort zone 0.8–1.5 kPa (plotted on the right axis) */}
                <ReferenceArea yAxisId="right" y1={0.8} y2={1.5} fill="#22c55e" fillOpacity={0.08} />
                <XAxis dataKey="date" tick={axis} />
                <YAxis yAxisId="left" tick={axis} width={32} />
                <YAxis yAxisId="right" orientation="right" tick={axis} width={32} domain={[0, 3]} />
                <Tooltip contentStyle={tipStyle} labelFormatter={labelFormatter} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="left" type="monotone" dataKey="temp" name="Temp °F" stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls />
                <Line yAxisId="left" type="monotone" dataKey="humidity" name="RH %" stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="vpd" name="VPD" stroke="#22c55e" dot={{ r: 2 }} strokeWidth={2} connectNulls />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Green band = healthy VPD range (0.8–1.5 kPa). VPD outside it means your room is too dry or too humid for the plant&apos;s stage.
          </p>
          <table className="sr-only">
            <caption>Environment readings</caption>
            <thead><tr><th>Day</th><th>Date</th><th>Temp °F</th><th>RH %</th><th>VPD</th></tr></thead>
            <tbody>
              {envData.map((p, i) => (
                <tr key={i}><td>{p.day ?? ""}</td><td>{p.date}</td><td>{p.temp ?? ""}</td><td>{p.humidity ?? ""}</td><td>{p.vpd ?? ""}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {chemData.length >= 2 && (
        <section className="bg-card rounded-xl border border-border p-4" aria-label="Nutrient chart — pH and EC over time">
          <h2 className="font-semibold text-sm mb-3">Nutrients — pH / EC</h2>
          <div role="img" aria-label="Line chart of pH and EC across diary updates">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={chemData}>
                <ReferenceLine yAxisId="left" y={6.5} stroke="#ef4444" strokeDasharray="4 4" />
                <ReferenceLine yAxisId="left" y={5.5} stroke="#ef4444" strokeDasharray="4 4" />
                <XAxis dataKey="date" tick={axis} />
                <YAxis yAxisId="left" tick={axis} width={32} domain={[4, 9]} />
                <YAxis yAxisId="right" orientation="right" tick={axis} width={32} domain={[0, "dataMax + 0.5"]} />
                <Tooltip contentStyle={tipStyle} labelFormatter={labelFormatter} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line yAxisId="left" type="monotone" dataKey="ph" name="pH" stroke="#a855f7" dot={false} strokeWidth={2} connectNulls />
                <Line yAxisId="right" type="monotone" dataKey="ec" name="EC" stroke="#14b8a6" dot={{ r: 2 }} strokeWidth={2} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Dashed lines = safe pH window (5.5–6.5). Outside that, nutrient uptake stalls.
          </p>
          <table className="sr-only">
            <caption>Nutrient readings</caption>
            <thead><tr><th>Day</th><th>Date</th><th>pH</th><th>EC</th></tr></thead>
            <tbody>
              {chemData.map((p, i) => (
                <tr key={i}><td>{p.day ?? ""}</td><td>{p.date}</td><td>{p.ph ?? ""}</td><td>{p.ec ?? ""}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
