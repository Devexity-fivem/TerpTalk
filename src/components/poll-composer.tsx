"use client"

import { useState } from "react"
import { Plus, X, BarChart3 } from "lucide-react"

interface PollComposerProps {
  value: { question: string; options: string[] } | null
  onChange: (poll: { question: string; options: string[] } | null) => void
  disabled?: boolean
}

export default function PollComposer({ value, onChange, disabled }: PollComposerProps) {
  const [enabled, setEnabled] = useState(!!value)

  const ensureEnabled = () => {
    if (!enabled) {
      setEnabled(true)
      onChange({ question: "", options: ["", ""] })
    }
  }

  const disable = () => {
    setEnabled(false)
    onChange(null)
  }

  const question = value?.question ?? ""
  const options = value?.options ?? ["", ""]

  const setQuestion = (q: string) => {
    onChange({ question: q, options })
  }

  const setOption = (i: number, text: string) => {
    const next = [...options]
    next[i] = text
    onChange({ question, options: next })
  }

  const addOption = () => {
    if (options.length >= 10) return
    onChange({ question, options: [...options, ""] })
  }

  const removeOption = (i: number) => {
    if (options.length <= 2) return
    const next = options.filter((_, idx) => idx !== i)
    onChange({ question, options: next })
  }

  if (!enabled) {
    return (
      <button
        type="button"
        onClick={ensureEnabled}
        disabled={disabled}
        className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1.5 disabled:opacity-50"
      >
        <BarChart3 className="w-4 h-4" /> Add a poll
      </button>
    )
  }

  return (
    <div className="border border-border rounded-lg p-4 bg-secondary/20 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <BarChart3 className="w-4 h-4" /> Poll
        </span>
        <button
          type="button"
          onClick={disable}
          disabled={disabled}
          className="text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
        >
          Remove poll
        </button>
      </div>
      <input
        type="text"
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder="Poll question"
        disabled={disabled}
        maxLength={200}
        className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
      />
      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              type="text"
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              disabled={disabled}
              maxLength={100}
              className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
            {options.length > 2 && (
              <button
                type="button"
                onClick={() => removeOption(i)}
                disabled={disabled}
                className="p-2 text-muted-foreground hover:text-destructive disabled:opacity-50"
                aria-label="Remove option"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {options.length < 10 && (
        <button
          type="button"
          onClick={addOption}
          disabled={disabled}
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Add option
        </button>
      )}
    </div>
  )
}
