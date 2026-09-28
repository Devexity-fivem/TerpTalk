"use client"

import { cn } from "@/lib/utils"
import { useEffect, useRef, useState, type ReactNode } from "react"

interface ConfirmDialogProps {
  open: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  title: string
  description?: ReactNode
  /** Button labels */
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive styling + copy for irreversible actions */
  destructive?: boolean
}

/**
 * Accessible confirmation dialog — replaces native confirm() for
 * user-impacting actions (block, delete, unfollow, privacy changes). Focus
 * moves to the cancel button on open and returns to the previously focused
 * element on close. Escape cancels; the dialog traps focus while open.
 */
export default function ConfirmDialog({
  open,
  onConfirm,
  onCancel,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    restoreRef.current = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel()
      if (e.key === "Tab") {
        // Minimal trap — the dialog only contains the two buttons.
        const buttons = Array.from(
          document.querySelectorAll<HTMLElement>("[data-confirm-dialog] button:not([disabled])")
        )
        if (buttons.length === 0) return
        const first = buttons[0]
        const last = buttons[buttons.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      restoreRef.current?.focus?.()
    }
  }, [open, onCancel])

  if (!open) return null

  const handleConfirm = async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div
        data-confirm-dialog
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? "confirm-dialog-desc" : undefined}
        className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl"
      >
        <h2 id="confirm-dialog-title" className="font-display text-lg font-semibold">
          {title}
        </h2>
        {description && (
          <div id="confirm-dialog-desc" className="mt-1.5 text-sm text-muted-foreground">
            {description}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl px-4 py-2 text-sm font-medium bg-secondary/60 hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={cn(
              "rounded-xl px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
