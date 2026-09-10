"use client"

import { useCallback, useLayoutEffect, useState } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { cn } from "@/lib/utils"
import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme"

function applyTheme(theme: Theme) {
  const root = document.documentElement
  if (theme === "system") root.removeAttribute("data-theme")
  else root.setAttribute("data-theme", theme)
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === "dark" || stored === "light") return stored
  } catch {
    /* localStorage unavailable (private mode, blocked cookies) */
  }
  return "system"
}

const OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]

export default function ThemeToggle({ className }: { className?: string }) {
  // Lazy initialiser reads the same source as the inline script, so React's
  // first render always agrees with the DOM the script produced.
  const [theme, setTheme] = useState<Theme>(() =>
    typeof window === "undefined" ? "system" : readTheme()
  )

  // React's Strict Mode remount in development clears attributes it does not
  // manage, wiping what the inline script set. Re-applying here is a no-op in
  // production.
  useLayoutEffect(() => {
    applyTheme(readTheme())
  }, [])

  const select = useCallback((next: Theme) => {
    setTheme(next)
    applyTheme(next)
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY)
      else localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      /* Preference simply will not persist */
    }
  }, [])

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={cn("inline-flex items-center gap-0.5 rounded-lg border border-border bg-background p-0.5", className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          role="radio"
          aria-checked={theme === value}
          aria-label={label}
          title={label}
          onClick={() => select(value)}
          className={cn(
            "rounded-md p-1.5 transition-colors",
            theme === value
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  )
}
