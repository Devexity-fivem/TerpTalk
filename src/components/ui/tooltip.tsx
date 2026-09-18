"use client"

// Lightweight styled tooltip — pure CSS via group-hover / group-focus-within.
// Works on hover, keyboard focus, and mobile tap (tapping the focusable
// wrapper focuses it, which triggers focus-within). The bubble is
// pointer-events-none so it can never trap the cursor. Screen readers get
// the same text through an sr-only copy inside the wrapper.

import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

type Side = "top" | "bottom"
type Align = "center" | "start" | "end"

const SIDE_CLASS: Record<Side, string> = {
  top: "bottom-full mb-1.5",
  bottom: "top-full mt-1.5",
}

const ALIGN_CLASS: Record<Align, string> = {
  center: "left-1/2 -translate-x-1/2",
  start: "left-0",
  end: "right-0",
}

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  side?: Side
  align?: Align
  className?: string
}

export default function Tooltip({ content, children, side = "top", align = "center", className }: TooltipProps) {
  return (
    <span tabIndex={0} className={cn("group/tt relative inline-flex outline-none", className)}>
      {children}
      {typeof content === "string" && <span className="sr-only">{content}</span>}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute z-50 w-max max-w-56 rounded-md border border-border bg-card px-2.5 py-1.5",
          "text-left text-xs font-normal leading-snug text-foreground shadow-lg",
          "invisible opacity-0 transition-opacity duration-150",
          "group-hover/tt:visible group-hover/tt:opacity-100 group-focus-within/tt:visible group-focus-within/tt:opacity-100",
          SIDE_CLASS[side],
          ALIGN_CLASS[align]
        )}
      >
        {content}
      </span>
    </span>
  )
}

// Small "i" affordance for section headers and jargon — the icon is the
// trigger, the string is the explanation.
export function InfoTip({ content, side, align, className }: { content: string; side?: Side; align?: Align; className?: string }) {
  return (
    <Tooltip content={content} side={side} align={align} className={className}>
      <span className="inline-flex cursor-help rounded-full text-muted-foreground/60 transition-colors hover:text-muted-foreground">
        <Info className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="sr-only">What is this?</span>
      </span>
    </Tooltip>
  )
}
