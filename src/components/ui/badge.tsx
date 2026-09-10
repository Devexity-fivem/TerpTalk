"use client"

import { cn } from "@/lib/utils"
import { HTMLAttributes } from "react"

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "outline" | "primary" | "destructive"
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
        {
          "bg-primary/10 text-primary border border-primary/20": variant === "default" || variant === "primary",
          "bg-secondary text-secondary-foreground": variant === "secondary",
          "border border-border text-muted-foreground hover:bg-secondary": variant === "outline",
          "bg-destructive/10 text-destructive border border-destructive/20": variant === "destructive",
        },
        className
      )}
      {...props}
    />
  )
}
