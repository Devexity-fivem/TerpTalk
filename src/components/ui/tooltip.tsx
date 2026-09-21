"use client"

// Lightweight styled tooltip — pure CSS via group-hover / group-focus-within.
// Works on hover, keyboard focus, and mobile tap. The bubble is
// pointer-events-none so it can never trap the cursor. Screen readers get
// the same text through an sr-only copy inside the wrapper.
//
// Accessibility contract:
// - If the child is already an interactive element (link/button/input or a
//   component that accepts href/onClick/etc.), the wrapper is NOT focusable
//   and NOT interactive — the child's own tab stop and focus ring are the
//   trigger. This avoids nested interactive controls and duplicate tab stops.
// - If the child is plain content, the wrapper gets tabIndex={0} with a
//   visible focus ring so keyboard users can still reach the tooltip.

import React from "react"
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

const INTERACTIVE_TAGS = new Set(["a", "button", "input", "select", "textarea", "summary"])

function isInteractive(el: React.ReactNode, depth = 0): boolean {
  if (!React.isValidElement(el)) return false
  // Unwrap fragments / single-child wrappers one level so
  // <><button/></> still counts as interactive.
  if (depth < 2 && el.type === React.Fragment) {
    const kids = React.Children.toArray((el.props as { children?: React.ReactNode }).children)
    return kids.length === 1 && isInteractive(kids[0], depth + 1)
  }
  if (typeof el.type === "string") return INTERACTIVE_TAGS.has(el.type)
  const p = el.props as Record<string, unknown>
  return (
    typeof p.href === "string" ||
    typeof p.onClick === "function" ||
    typeof p.onKeyDown === "function" ||
    typeof p.tabIndex === "number" ||
    p.role === "button" ||
    p.role === "link"
  )
}

interface TooltipProps {
  content: React.ReactNode
  children: React.ReactNode
  side?: Side
  align?: Align
  className?: string
}

export default function Tooltip({ content, children, side = "top", align = "center", className }: TooltipProps) {
  const childInteractive = isInteractive(children)
  return (
    <span
      tabIndex={childInteractive ? undefined : 0}
      className={cn(
        "group/tt relative inline-flex rounded-sm",
        // Visible keyboard focus — only the non-interactive wrapper needs a
        // ring; interactive children show their own focus styles.
        !childInteractive && "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        className
      )}
    >
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
// trigger, the string is the explanation. Standalone (non-interactive), so
// Tooltip gives it a real tab stop with a visible focus ring.
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
