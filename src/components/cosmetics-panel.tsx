"use client"

import { useState } from "react"
import { Palette, Lock, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { AVATAR_FRAMES, PROFILE_TITLES, PROFILE_THEMES, unlockTierName } from "@/lib/cosmetics"
import { useToast } from "@/components/ui/toast"

type Field = "avatarFrame" | "profileTitle" | "profileTheme"

interface CosmeticsPanelProps {
  reputation: number
  equipped: Record<Field, string | null>
  onSaved: (p: Record<Field, string | null>) => void
}

interface RowProps {
  items: { key: string; name: string; unlockedAt: number }[]
  field: Field
  reputation: number
  equipped: string | null
  saving: boolean
  onEquip: (field: Field, key: string | null) => void
  render?: (item: { key: string; name: string; unlockedAt: number }) => React.ReactNode
}

function Row({ items, field, reputation, equipped, saving, onEquip, render }: RowProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        onClick={() => onEquip(field, null)}
        disabled={saving}
        className={cn(
          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
          equipped === null ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
        )}
      >
        None
      </button>
      {items.map((item) => {
        const locked = reputation < item.unlockedAt
        const active = equipped === item.key
        return (
          <button
            key={item.key}
            disabled={locked || saving}
            onClick={() => onEquip(field, item.key)}
            title={locked ? `Unlocks at ${item.unlockedAt.toLocaleString()} rep (${unlockTierName(item.unlockedAt)})` : item.name}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
              active
                ? "border-primary bg-primary/10 text-primary"
                : locked
                  ? "border-border text-muted-foreground/50 cursor-not-allowed"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
            )}
          >
            {locked ? <Lock className="w-3 h-3" /> : active ? <Check className="w-3 h-3" /> : null}
            {render ? render(item) : item.name}
          </button>
        )
      })}
    </div>
  )
}

// Cosmetic equip panel — registry keys only, server re-validates unlocks.
export default function CosmeticsPanel({ reputation, equipped, onSaved }: CosmeticsPanelProps) {
  const { toast } = useToast()
  const [saving, setSaving] = useState<string | null>(null)

  async function equip(field: Field, key: string | null) {
    setSaving(field + (key ?? ""))
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: key }),
    })
    setSaving(null)
    if (res.ok) {
      const d = await res.json()
      onSaved(d.profile)
      toast(key ? "Reward equipped" : "Reward removed")
    } else {
      const d = await res.json().catch(() => ({}))
      toast(d.error || "Could not equip", "error")
    }
  }

  return (
    <div className="bg-card rounded-lg border border-border p-6">
      <div className="flex items-center gap-2 mb-1">
        <Palette className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">Your Rewards</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Unlocked by reputation. Higher tiers unlock rarer looks.</p>
      <div className="space-y-4">
        <div>
          <h3 className="text-sm font-medium mb-2">Avatar frame</h3>
          <Row
            items={AVATAR_FRAMES}
            field="avatarFrame"
            reputation={reputation}
            equipped={equipped.avatarFrame}
            saving={saving !== null}
            onEquip={equip}
            render={(f) => (
              <span className="inline-flex items-center gap-1.5">
                <span className={cn("inline-block w-3 h-3 rounded-full bg-secondary", AVATAR_FRAMES.find((x) => x.key === f.key)?.className.split(" ").filter((c) => c.startsWith("ring")).slice(0, 2).join(" "))} />
                {f.name}
              </span>
            )}
          />
        </div>
        <div>
          <h3 className="text-sm font-medium mb-2">Profile title</h3>
          <Row
            items={PROFILE_TITLES}
            field="profileTitle"
            reputation={reputation}
            equipped={equipped.profileTitle}
            saving={saving !== null}
            onEquip={equip}
          />
        </div>
        <div>
          <h3 className="text-sm font-medium mb-2">Profile theme</h3>
          <Row
            items={PROFILE_THEMES}
            field="profileTheme"
            reputation={reputation}
            equipped={equipped.profileTheme}
            saving={saving !== null}
            onEquip={equip}
          />
        </div>
      </div>
    </div>
  )
}
