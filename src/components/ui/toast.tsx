"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react"
import { cn } from "@/lib/utils"

type ToastVariant = "success" | "error" | "info"

interface Toast {
  id: number
  message: string
  variant: ToastVariant
}

interface ToastContextValue {
  toast: (message: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "border-primary/40 bg-card text-foreground",
  error: "border-destructive/50 bg-card text-foreground",
  info: "border-border bg-card text-foreground",
}

const VARIANT_ICONS: Record<ToastVariant, typeof Info> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
}

const ICON_COLORS: Record<ToastVariant, string> = {
  success: "text-primary",
  error: "text-destructive",
  info: "text-muted-foreground",
}

const DURATION_MS = 4000

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      const id = nextId.current++
      setToasts((current) => [...current, { id, message, variant }])
      setTimeout(() => dismiss(id), DURATION_MS)
    },
    [dismiss]
  )

  const value = useMemo(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Top-centre on mobile so it clears the bottom nav, bottom-right on desktop */}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-0 top-20 z-[100] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:top-auto sm:items-end sm:px-0"
      >
        {toasts.map(({ id, message, variant }) => {
          const Icon = VARIANT_ICONS[variant]
          return (
            <div
              key={id}
              role="status"
              className={cn(
                "pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border p-4 shadow-lg backdrop-blur animate-in",
                VARIANT_STYLES[variant]
              )}
            >
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", ICON_COLORS[variant])} />
              <p className="flex-1 text-sm leading-snug">{message}</p>
              <button
                onClick={() => dismiss(id)}
                aria-label="Dismiss notification"
                className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

/**
 * Show a transient message. Falls back to a no-op outside the provider so
 * components stay usable in isolation (e.g. tests) without crashing.
 */
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) return { toast: () => {} }
  return context
}
