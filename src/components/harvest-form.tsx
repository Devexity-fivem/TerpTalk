"use client"

import { useState } from "react"
import { Leaf, Loader2, Scale } from "lucide-react"
import { useRouter } from "next/navigation"

interface HarvestFormProps {
  diaryId: string
  canEdit: boolean
  initialHarvested: boolean
  initialAmount?: number | null
  initialUnit?: string | null
  initialAt?: Date | string | null
}

const UNITS = ["g", "oz", "lb", "kg"]

export default function HarvestForm({
  diaryId,
  canEdit,
  initialHarvested,
  initialAmount,
  initialUnit,
  initialAt,
}: HarvestFormProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [harvested, setHarvested] = useState(initialHarvested)
  const [amount, setAmount] = useState(initialAmount?.toString() || "")
  const [unit, setUnit] = useState(initialUnit || "g")
  const [at, setAt] = useState(() => {
    if (!initialAt) return ""
    const d = new Date(initialAt)
    return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10)
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canEdit) return
    setBusy(true)
    setError("")
    const body: Record<string, unknown> = { harvested: true }
    if (amount.trim()) body.yieldAmount = Number(amount)
    if (unit) body.yieldUnit = unit
    if (at) body.harvestedAt = at
    try {
      const res = await fetch(`/api/diaries/${diaryId}/harvest`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to log harvest")
      } else {
        setOpen(false)
        setHarvested(true)
        router.refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  const handleUnmark = async () => {
    if (!canEdit || !confirm("Remove harvest record?")) return
    setBusy(true)
    setError("")
    const res = await fetch(`/api/diaries/${diaryId}/harvest`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ harvested: false }),
    })
    if (!res.ok) {
      const data = await res.json()
      setError(data.error || "Failed to update")
    } else {
      setHarvested(false)
      setAmount("")
      setAt("")
      router.refresh()
    }
    setBusy(false)
  }

  return (
    <div className="bg-card rounded-xl border border-border p-4 sm:p-5">
      <div className="flex items-start sm:items-center justify-between gap-4 flex-col sm:flex-row">
        <div className="flex items-center gap-3">
          <div className="bg-emerald-500/10 p-2.5 rounded-lg">
            <Leaf className="w-5 h-5 text-emerald-500" />
          </div>
          <div>
            <h3 className="font-semibold">{harvested ? "Harvest logged" : "Not yet harvested"}</h3>
            <p className="text-sm text-muted-foreground">
              {harvested ? "This diary has reached harvest." : "Log yield and harvest date when the grow is done."}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {!harvested ? (
              <button
                onClick={() => setOpen(true)}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Scale className="w-4 h-4" /> Log harvest
              </button>
            ) : (
              <>
                <button
                  onClick={() => setOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={handleUnmark}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Unmark"}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {harvested && (initialAmount || initialAt) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
          {initialAmount ? (
            <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-500 font-medium">
              Yield: {initialAmount} {initialUnit || "g"}
            </span>
          ) : null}
          {initialAt ? (
            <span className="text-muted-foreground">
              Harvested {new Date(initialAt).toLocaleDateString()}
            </span>
          ) : null}
        </div>
      )}

      {open && (
        <div className="mt-4 pt-4 border-t border-border">
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-sm font-medium">Yield amount</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={0}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium">Unit</span>
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>{u}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium">Harvest date</span>
              <input
                type="date"
                value={at}
                onChange={(e) => setAt(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
              />
            </label>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save harvest"}
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-secondary hover:bg-secondary/80"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
