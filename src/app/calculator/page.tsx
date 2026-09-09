"use client"

import { useState } from "react"
import { Calculator as CalculatorIcon, Zap, Clock, DollarSign } from "lucide-react"
import CannabisLeaf from "@/components/cannabis-leaf"

export default function GrowLightCalculatorPage() {
  const [watts, setWatts] = useState(300)
  const [hours, setHours] = useState(18)
  const [days, setDays] = useState(7)
  const [rate, setRate] = useState(0.15)

  const kwhPerDay = (watts * hours) / 1000
  const kwhPerWeek = kwhPerDay * days
  const kwhPerMonth = kwhPerDay * 30.44
  const kwhPerYear = kwhPerDay * 365

  const costDay = kwhPerDay * rate
  const costWeek = kwhPerWeek * rate
  const costMonth = kwhPerMonth * rate
  const costYear = kwhPerYear * rate

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="flex justify-center mb-6">
          <div className="bg-primary/10 p-4 rounded-2xl ring-1 ring-primary/30">
            <CannabisLeaf className="w-12 h-12 text-primary" />
          </div>
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-center mb-2">Grow Light Cost Calculator</h1>
        <p className="text-center text-muted-foreground mb-10 max-w-xl mx-auto">
          Estimate how much it costs to run your grow lights. Plug in your wattage, schedule, and local kWh rate.
        </p>

        <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 mb-8">
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Total wattage (W)
              </label>
              <input
                type="number"
                min={0}
                step={10}
                value={watts}
                onChange={(e) => setWatts(Number(e.target.value) || 0)}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1.5">Combine all lights in your tent/room.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Hours per day
              </label>
              <input
                type="number"
                min={0}
                max={24}
                value={hours}
                onChange={(e) => setHours(Math.min(24, Number(e.target.value) || 0))}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1.5">e.g. 18 for veg, 12 for flower.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                <CalculatorIcon className="w-4 h-4 text-primary" />
                Days per week
              </label>
              <input
                type="number"
                min={0}
                max={7}
                value={days}
                onChange={(e) => setDays(Math.min(7, Number(e.target.value) || 0))}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2 flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-primary" />
                Electricity rate ($/kWh)
              </label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value) || 0)}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="text-xs text-muted-foreground mt-1.5">Check your utility bill.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-card border border-border rounded-xl p-5 text-center">
            <div className="text-sm text-muted-foreground mb-1">Daily</div>
            <div className="text-2xl font-bold text-primary">${costDay.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{kwhPerDay.toFixed(2)} kWh</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 text-center">
            <div className="text-sm text-muted-foreground mb-1">Weekly</div>
            <div className="text-2xl font-bold text-primary">${costWeek.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{kwhPerWeek.toFixed(2)} kWh</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 text-center">
            <div className="text-sm text-muted-foreground mb-1">Monthly</div>
            <div className="text-2xl font-bold text-primary">${costMonth.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{kwhPerMonth.toFixed(2)} kWh</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-5 text-center">
            <div className="text-sm text-muted-foreground mb-1">Yearly</div>
            <div className="text-2xl font-bold text-primary">${costYear.toFixed(2)}</div>
            <div className="text-xs text-muted-foreground">{kwhPerYear.toFixed(2)} kWh</div>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-8">
          Estimates are for the lights only. Fans, pumps, AC, and other gear are not included.
        </p>
      </div>
    </div>
  )
}
