"use client"

import { useState, useRef, useCallback } from "react"
import { X } from "lucide-react"

interface TagInputProps {
  value: string[]
  onChange: (tags: string[]) => void
  max?: number
  disabled?: boolean
}

interface TagSuggestion {
  name: string
  slug: string
}

export default function TagInput({ value, onChange, max = 5, disabled }: TagInputProps) {
  const [input, setInput] = useState("")
  const [suggestions, setSuggestions] = useState<TagSuggestion[]>([])
  const [active, setActive] = useState(-1)
  const [focused, setFocused] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const visible = suggestions.filter((s) => !value.includes(s.name))

  const addTag = useCallback((name: string) => {
    const trimmed = name.trim().toLowerCase()
    if (!trimmed || value.length >= max || value.includes(trimmed)) return
    onChange([...value, trimmed])
    setInput("")
    setSuggestions([])
    setActive(-1)
  }, [value, onChange, max])

  const removeTag = useCallback((name: string) => {
    onChange(value.filter((t) => t !== name))
  }, [value, onChange])

  const fetchSuggestions = useCallback((q: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller
    timeoutRef.current = setTimeout(() => {
      fetch(`/api/forum/tags?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((data: { tags?: TagSuggestion[] }) => {
          setSuggestions(data.tags || [])
        })
        .catch(() => setSuggestions([]))
    }, 200)
  }, [])

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value
    setInput(v)
    setActive(-1)
    if (!v.trim()) {
      setSuggestions([])
      return
    }
    fetchSuggestions(v)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      if (active >= 0 && visible[active]) {
        addTag(visible[active].name)
      } else {
        addTag(input)
      }
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      removeTag(value[value.length - 1])
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, visible.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, -1))
    }
  }

  const open = focused && visible.length > 0 && input.trim().length > 0

  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium">Tags</label>
      <div className="min-h-[44px] w-full rounded-lg border border-border bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-primary">
        <div className="flex flex-wrap items-center gap-2">
          {value.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-secondary text-xs text-secondary-foreground"
            >
              #{tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                disabled={disabled}
                className="hover:text-destructive disabled:opacity-50"
                aria-label={`Remove ${tag}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            disabled={disabled || value.length >= max}
            placeholder={value.length >= max ? "" : "Add tags..."}
            className="flex-1 min-w-[120px] bg-transparent outline-none text-sm"
          />
        </div>
      </div>
      {open && (
        <ul className="border border-border rounded-lg bg-card shadow-lg max-h-40 overflow-y-auto z-10">
          {visible.map((s, i) => (
            <li
              key={s.slug}
              onMouseDown={(e) => {
                e.preventDefault()
                addTag(s.name)
              }}
              className={`px-3 py-2 text-sm cursor-pointer ${i === active ? "bg-primary/10" : "hover:bg-secondary"}`}
            >
              #{s.name}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Press Enter or comma to add. Up to {max} tags.</p>
    </div>
  )
}
