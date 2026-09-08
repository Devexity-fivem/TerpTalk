"use client"

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts"

interface Reading {
  createdAt: string
  temperature: number | null
  humidity: number | null
  vpd: number | null
}

// Environment chart for a diary — plots temp/humidity/VPD from updates
export default function EnvChart({ updates }: { updates: Reading[] }) {
  const data = updates
    .filter((u) => u.temperature != null || u.humidity != null || u.vpd != null)
    .map((u) => ({
      date: new Date(u.createdAt).toLocaleDateString([], { month: "short", day: "numeric" }),
      temp: u.temperature,
      humidity: u.humidity,
      vpd: u.vpd,
    }))

  if (data.length < 2) return null

  return (
    <div className="bg-card rounded-xl border border-border p-4 mb-6">
      <h2 className="font-semibold text-sm mb-3">Environment History</h2>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
          <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={32} />
          <Tooltip
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="temp" name="Temp °" stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls />
          <Line type="monotone" dataKey="humidity" name="RH %" stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls />
          <Line type="monotone" dataKey="vpd" name="VPD" stroke="#22c55e" dot={false} strokeWidth={2} connectNulls />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
