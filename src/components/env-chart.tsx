"use client"

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, ReferenceArea, ReferenceLine, ComposedChart,
} from "recharts"

interface Reading {
  createdAt: string
  temperature: number | null
  humidity: number | null
  vpd: number | null
  ph: number | null
  ec: number | null
}

// Environment charts for a diary — temp/RH with VPD comfort band + pH/EC
export default function EnvCharts({ updates }: { updates: Reading[] }) {
  const points = updates.map((u) => ({
    date: new Date(u.createdAt).toLocaleDateString([], { month: "short", day: "numeric" }),
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

  return (
    <div className="space-y-4 mb-6">
      {envData.length >= 2 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="font-semibold text-sm mb-3">Environment — Temp / RH / VPD</h2>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={envData}>
              {/* VPD comfort zone 0.8–1.5 kPa */}
              <ReferenceArea y1={0.8} y2={1.5} fill="#22c55e" fillOpacity={0.08} />
              <XAxis dataKey="date" tick={axis} />
              <YAxis tick={axis} width={32} />
              <Tooltip contentStyle={tipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="temp" name="Temp °" stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="humidity" name="RH %" stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="vpd" name="VPD" stroke="#22c55e" dot={{ r: 2 }} strokeWidth={2} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-muted-foreground mt-2">
            Green band = healthy VPD range (0.8–1.5 kPa). VPD outside it means your room is too dry or too humid for the plant&apos;s stage.
          </p>
        </div>
      )}

      {chemData.length >= 2 && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h2 className="font-semibold text-sm mb-3">Nutrients — pH / EC</h2>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chemData}>
              <ReferenceLine y={6.5} stroke="#ef4444" strokeDasharray="4 4" />
              <ReferenceLine y={5.5} stroke="#ef4444" strokeDasharray="4 4" />
              <XAxis dataKey="date" tick={axis} />
              <YAxis tick={axis} width={32} />
              <Tooltip contentStyle={tipStyle} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="ph" name="pH" stroke="#a855f7" dot={false} strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="ec" name="EC" stroke="#14b8a6" dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-muted-foreground mt-2">
            Dashed lines = safe pH window (5.5–6.5). Outside that, nutrient uptake stalls.
          </p>
        </div>
      )}
    </div>
  )
}
