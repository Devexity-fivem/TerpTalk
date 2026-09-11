"use client"

import * as Lucide from "lucide-react"
import { cn } from "@/lib/utils"
import { getBadgeByName, type BadgeRarity, type BadgeDefinition } from "@/lib/badge-registry"

export type AchievementBadgeMode = "compact" | "profile" | "showcase" | "locked"

interface AchievementBadgeProps {
  name: string
  earned?: boolean
  mode?: AchievementBadgeMode
  className?: string
  onClick?: () => void
}

const RARITY_STYLES: Record<BadgeRarity, { border: string; bg: string; text: string; glow: string; icon: string; label: string }> = {
  common: {
    border: "border-slate-500/35",
    bg: "bg-slate-900/45",
    text: "text-slate-300",
    glow: "",
    icon: "text-slate-400",
    label: "Common",
  },
  rare: {
    border: "border-emerald-500/40",
    bg: "bg-emerald-950/35",
    text: "text-emerald-300",
    glow: "shadow-[0_0_10px_-2px_rgba(16,185,129,0.15)]",
    icon: "text-emerald-400",
    label: "Rare",
  },
  epic: {
    border: "border-purple-500/40",
    bg: "bg-gradient-to-br from-purple-950/60 to-indigo-950/35",
    text: "text-purple-200",
    glow: "shadow-[0_0_14px_-2px_rgba(168,85,247,0.22)]",
    icon: "text-purple-300",
    label: "Epic",
  },
  legendary: {
    border: "border-amber-400/50",
    bg: "bg-gradient-to-br from-amber-950/60 to-orange-950/35",
    text: "text-amber-100",
    glow: "shadow-[0_0_16px_-2px_rgba(251,191,36,0.28)]",
    icon: "text-amber-300",
    label: "Legendary",
  },
}

function IconFor({ name, className }: { name: string; className?: string }) {
  const Icon = (Lucide[name as keyof typeof Lucide] as React.ComponentType<{ className?: string }>) || Lucide.Award
  return <Icon className={className} />
}

export default function AchievementBadge({ name, earned = true, mode = "profile", className, onClick }: AchievementBadgeProps) {
  const badge = getBadgeByName(name)
  const definition: BadgeDefinition = badge ?? { name, description: "", requirement: "", rarity: "common", icon: "Award" }
  const style = RARITY_STYLES[definition.rarity]
  const locked = !earned

  const base = cn(
    "relative inline-flex items-center gap-2 select-none transition-all duration-150 motion-reduce:transition-none",
    "rounded-full border",
    style.border,
    locked ? "opacity-55 saturate-[0.4]" : style.bg,
    style.glow,
    {
      "px-2 py-1 text-[10px]": mode === "compact",
      "px-3 py-1.5 text-xs": mode === "profile",
      "flex-col px-4 py-4 text-sm text-center w-32 sm:w-36 rounded-2xl": mode === "showcase",
      "px-3 py-2 text-xs opacity-60 line-through decoration-slate-500/50": locked && mode !== "showcase",
    },
    className
  )

  const iconContainer = cn(
    "shrink-0 flex items-center justify-center rounded-full bg-white/10",
    {
      "w-4 h-4": mode === "compact",
      "w-5 h-5": mode === "profile" || (locked && mode !== "showcase"),
      "w-12 h-12 mb-2": mode === "showcase",
    }
  )

  const iconSize = cn(
    "shrink-0",
    style.icon,
    {
      "w-2.5 h-2.5": mode === "compact",
      "w-3.5 h-3.5": mode === "profile" || (locked && mode !== "showcase"),
      "w-6 h-6": mode === "showcase",
    }
  )

  const label = (
    <span className={cn("font-medium tracking-tight", style.text, locked && "text-slate-400")}>
      {definition.name}
    </span>
  )

  const tooltip = (
    <div
      className={cn(
        "pointer-events-none absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 w-56 sm:w-64",
        "rounded-xl border border-border bg-card/95 backdrop-blur-sm p-3 text-left shadow-xl",
        "opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100 group-focus-visible:opacity-100 group-focus-visible:scale-100",
        "transition-all duration-150 motion-reduce:transition-none",
        mode === "showcase" ? "-top-2 bottom-auto mb-0" : ""
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className={cn("w-5 h-5 rounded-full flex items-center justify-center bg-white/10", style.icon)}>
          <IconFor name={definition.icon} className="w-3 h-3" />
        </div>
        <span className={cn("font-semibold text-sm", style.text)}>{definition.name}</span>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{definition.description}</p>
      <p className="text-[10px] text-slate-400 mb-1.5">
        <span className="text-foreground/70 font-medium">How to earn:</span> {definition.requirement}
      </p>
      <span className={cn("inline-flex items-center text-[10px] font-bold uppercase tracking-wider", style.text)}>
        {style.label}
      </span>
    </div>
  )

  const ariaLabel = locked
    ? `${definition.name} — ${style.label} — not earned yet`
    : `${definition.name} — ${style.label} — ${definition.description}`

  return (
    <div
      className={cn("group relative", onClick && "cursor-pointer")}
      onClick={onClick}
      role="img"
      aria-label={ariaLabel}
      tabIndex={0}
    >
      <div className={cn(base, !locked && "hover:shadow-lg hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none")}>
        <span className={iconContainer}>
          {locked ? (
            <Lucide.Lock className={cn(iconSize, "text-slate-500")} />
          ) : (
            <IconFor name={definition.icon} className={iconSize} />
          )}
        </span>
        {mode === "showcase" ? (
          <>
            {label}
            <span className={cn("text-[10px] font-semibold uppercase tracking-wider mt-0.5", style.text)}>{style.label}</span>
          </>
        ) : (
          label
        )}
      </div>
      {tooltip}
    </div>
  )
}
