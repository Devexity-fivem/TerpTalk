"use client"

import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine,
} from "recharts"

export interface HeightPoint {
  createdAt: string
  day: number
  week: number
  stage: string
  heightCm: number
}

// Height-over-time for a diary. Day-of-grow is the x axis (numeric, so
// same-day readings sit correctly and gaps show honestly); stage changes
// get vertical reference lines with tiny labels.
export default function HeightChart({ points }: { points: HeightPoint[] }) {
  const data = points.map((p) => ({
    day: p.day,
    week: p.week,
    stage: p.stage,
    height: p.heightCm,
    date: new Date(p.createdAt).toLocaleDateString([], { month: "short", day: "numeric" }),
  }))
  if (data.length < 2) return null

  // Stage transitions — first point carrying each new stage.
  const transitions: { day: number; stage: string }[] = []
  for (const p of data) {
    if (transitions[transitions.length - 1]?.stage !== p.stage) {
      transitions.push({ day: p.day, stage: p.stage })
    }
  }
  // The first transition is the chart's leftmost point — no marker needed.
  const markers = transitions.slice(1)

  const axis = { fontSize: 11, fill: "var(--muted-foreground)" }
  const tipStyle = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }
  const labelFormatter = (label: unknown, payload?: readonly { payload?: { week?: number; date?: string; stage?: string } }[]) => {
    const p = payload?.[0]?.payload
    const meta = [p?.week != null ? `Week ${p.week}` : null, p?.stage, p?.date].filter(Boolean).join(" · ")
    return `Day ${label}${meta ? ` — ${meta}` : ""}`
  }

  return (
    <div aria-label="Height chart — plant height over the grow">
      <div role="img" aria-label="Line chart of plant height in centimeters across diary updates">
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <XAxis dataKey="day" type="number" domain={["dataMin", "dataMax"]} tick={axis} tickFormatter={(d) => `D${d}`} />
            <YAxis tick={axis} width={36} domain={[0, "dataMax + 10"]} tickFormatter={(v) => `${v}`} />
            <Tooltip contentStyle={tipStyle} labelFormatter={labelFormatter} />
            {markers.map((m) => (
              <ReferenceLine
                key={`${m.stage}-${m.day}`}
                x={m.day}
                stroke="var(--muted-foreground)"
                strokeDasharray="3 3"
                strokeOpacity={0.4}
                label={{ value: m.stage.toLowerCase(), position: "insideTopRight", fontSize: 9, fill: "var(--muted-foreground)" }}
              />
            ))}
            <Line type="monotone" dataKey="height" name="Height cm" stroke="#22c55e" dot={{ r: 3 }} strokeWidth={2} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Height measurements</caption>
        <thead><tr><th>Day</th><th>Week</th><th>Date</th><th>Stage</th><th>Height cm</th></tr></thead>
        <tbody>
          {data.map((p, i) => (
            <tr key={i}><td>{p.day}</td><td>{p.week}</td><td>{p.date}</td><td>{p.stage}</td><td>{p.height}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
