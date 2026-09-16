"use client"

import { useEffect, useRef, useState } from "react"

interface StrainOption {
  id: string
  name: string
  type: string | null
}

interface Props {
  /** The visible text — legacy free-text strain value. */
  value: string
  /** Selected community strain id, or null when using free text. */
  strainId: string | null
  onChange: (text: string, strainId: string | null) => void
  disabled?: boolean
}

// Strain picker for the diary form: autocomplete against the community
// strain catalog, with a free-text escape ("not listed — keep as text").
// Selecting a suggestion sets strainId; editing the text afterwards drops
// the structured link back to plain text.
export default function StrainCombobox({ value, strainId, onChange, disabled }: Props) {
  const [options, setOptions] = useState<StrainOption[]>([])
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => {
      fetch(`/api/strains?q=${encodeURIComponent(value)}`)
        .then((res) => res.json())
        .then((data) => setOptions(data.strains || []))
        .catch(() => setOptions([]))
    }, 200)
    return () => clearTimeout(t)
  }, [value, open])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDocClick)
    return () => document.removeEventListener("mousedown", onDocClick)
  }, [])

  return (
    <div ref={boxRef} className="relative">
      <input
        id="strain"
        type="text"
        value={value}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          const text = e.target.value
          // Editing away from the chosen strain's name drops the link.
          const keep = strainId && options.find((o) => o.id === strainId)?.name === text ? strainId : null
          onChange(text, keep)
          setOpen(true)
        }}
        className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
        placeholder="e.g., Blue Dream, OG Kush"
        autoComplete="off"
      />
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-56 overflow-y-auto">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className="w-full text-left px-4 py-2 text-sm hover:bg-secondary flex items-center justify-between"
              onClick={() => {
                onChange(o.name, o.id)
                setOpen(false)
              }}
            >
              <span>{o.name}</span>
              {o.type && <span className="text-xs text-muted-foreground">{o.type}</span>}
            </button>
          ))}
          <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
            Not listed? Keep typing — your text is saved as-is.
          </div>
        </div>
      )}
      {strainId && (
        <p className="text-xs text-muted-foreground mt-1">
          Linked to community strain — your grow will count toward its stats.
        </p>
      )}
    </div>
  )
}
