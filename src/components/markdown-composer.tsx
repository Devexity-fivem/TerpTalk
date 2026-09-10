"use client"

import { useState, useRef, useCallback } from "react"
import { Bold, Italic, Heading, Quote, Link as LinkIcon, List, ListOrdered, Code, Eye, Pencil } from "lucide-react"
import { MarkdownRenderer } from "@/lib/markdown"

interface MarkdownComposerProps {
  id?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  rows?: number
  minLength?: number
  maxLength?: number
  disabled?: boolean
  label?: string
  hidePreview?: boolean
}

interface ToolbarButtonProps {
  onClick: () => void
  title: string
  disabled: boolean
  children: React.ReactNode
}

function ToolbarButton({ onClick, title, disabled, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}

export default function MarkdownComposer({
  id,
  value,
  onChange,
  placeholder = "Share your thoughts...",
  rows = 6,
  minLength,
  maxLength,
  disabled,
  label,
  hidePreview = false,
}: MarkdownComposerProps) {
  const [mode, setMode] = useState<"write" | "preview">("write")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const insertAtCursor = useCallback((before: string, after: string = "", placeholderText = "") => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end)
    const textToInsert = selected || placeholderText
    const newValue = value.slice(0, start) + before + textToInsert + after + value.slice(end)
    onChange(newValue)
    const newCursor = start + before.length + textToInsert.length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(newCursor, newCursor)
    })
  }, [value, onChange])

  const wrapLine = useCallback((marker: string) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end)
    if (!selected) {
      insertAtCursor(marker + " ", "", "")
      return
    }
    const before = value.slice(0, start)
    const after = value.slice(end)
    const lines = selected.split("\n")
    const newLines = lines.map((l) => (l.trim() ? `${marker} ${l.trim()}` : l))
    const newValue = before + newLines.join("\n") + after
    onChange(newValue)
    const newEnd = start + newLines.join("\n").length
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start, newEnd)
    })
  }, [value, onChange, insertAtCursor])

  const toolbarDisabled = disabled || mode === "preview"

  return (
    <div className="space-y-2">
      {label && <label htmlFor={id} className="block text-sm font-medium">{label}</label>}
      <div className="rounded-lg border border-border bg-background overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-secondary/30 px-2 py-1.5">
          <div className="flex items-center gap-0.5">
            <ToolbarButton title="Bold" onClick={() => insertAtCursor("**", "**", "bold text")} disabled={toolbarDisabled}>
              <Bold className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton title="Italic" onClick={() => insertAtCursor("*", "*", "italic text")} disabled={toolbarDisabled}>
              <Italic className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton title="Heading" onClick={() => wrapLine("##")} disabled={toolbarDisabled}>
              <Heading className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton title="Link" onClick={() => insertAtCursor("[", "](https://example.com)", "link text")} disabled={toolbarDisabled}>
              <LinkIcon className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton title="Quote" onClick={() => wrapLine(">")} disabled={toolbarDisabled}>
              <Quote className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton title="Bulleted list" onClick={() => wrapLine("-")} disabled={toolbarDisabled}>
              <List className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton title="Numbered list" onClick={() => wrapLine("1.")} disabled={toolbarDisabled}>
              <ListOrdered className="w-4 h-4" />
            </ToolbarButton>
            <ToolbarButton title="Code block" onClick={() => insertAtCursor("```\n", "\n```", "code")} disabled={toolbarDisabled}>
              <Code className="w-4 h-4" />
            </ToolbarButton>
          </div>
          {!hidePreview && (
            <div className="flex items-center bg-secondary rounded-md p-0.5">
              <button
                type="button"
                onClick={() => setMode("write")}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded-sm transition-colors ${mode === "write" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Pencil className="w-3 h-3" /> Write
              </button>
              <button
                type="button"
                onClick={() => setMode("preview")}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded-sm transition-colors ${mode === "preview" ? "bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Eye className="w-3 h-3" /> Preview
              </button>
            </div>
          )}
        </div>
        {mode === "write" ? (
          <textarea
            id={id}
            ref={textareaRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={rows}
            minLength={minLength}
            maxLength={maxLength}
            disabled={disabled}
            className="w-full px-4 py-3 bg-background text-foreground focus:outline-none resize-none font-mono text-sm leading-relaxed"
            style={{ minHeight: rows * 24 }}
          />
        ) : (
          <div className="px-4 py-3 min-h-[144px] max-h-[400px] overflow-y-auto post-content">
            {value.trim() ? <MarkdownRenderer content={value} /> : <p className="text-muted-foreground italic">Nothing to preview yet.</p>}
          </div>
        )}
      </div>
      {maxLength && (
        <p className="text-xs text-muted-foreground text-right">
          {value.length}/{maxLength}
        </p>
      )}
    </div>
  )
}
