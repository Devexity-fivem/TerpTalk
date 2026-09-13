"use client"

import { signInHref } from "@/lib/callback-url"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Bell, Loader2, Save } from "lucide-react"
import { useRouter } from "next/navigation"

const TOGGLES = [
  { key: "notifyOnReply", label: "Replies to my threads", desc: "When someone replies to a thread I started." },
  { key: "notifyOnMention", label: "Mentions", desc: "When someone @mentions me in a post or thread." },
  { key: "notifyOnCategoryFollow", label: "Followed content activity", desc: "New threads in categories I follow, and new replies in threads I follow." },
  { key: "notifyOnMessage", label: "Direct messages", desc: "When I receive a private message." },
  { key: "notifyOnComment", label: "Comments on my setups", desc: "When someone comments on my grow setup." },
  { key: "notifyOnFollow", label: "New followers", desc: "When someone follows my profile." },
  { key: "notifyOnReaction", label: "Reactions", desc: "When someone reacts to my posts or grow diaries." },
  { key: "notifyOnMilestone", label: "Milestones", desc: "Tier-ups, badges, and reputation milestones." },
] as const

type Prefs = Record<(typeof TOGGLES)[number]["key"], boolean> & { emailDigestFrequency: string | null }

export default function NotificationSettingsPage() {
  const { status } = useSession()
  const router = useRouter()
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(signInHref(window.location.pathname + window.location.search))
      return
    }
    if (status === "loading") return
    fetch("/api/profile/notifications")
      .then((res) => res.json())
      .then((data) => setPrefs(data))
      .catch(() => setMessage("Failed to load preferences"))
      .finally(() => setLoading(false))
  }, [status, router])

  const handleToggle = (key: keyof Prefs, value: boolean) => {
    if (!prefs) return
    setPrefs({ ...prefs, [key]: value })
  }

  const handleSave = async () => {
    if (!prefs) return
    setSaving(true)
    setMessage("")
    const res = await fetch("/api/profile/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(prefs),
    })
    setSaving(false)
    setMessage(res.ok ? "Saved." : "Failed to save.")
  }

  if (loading || !prefs) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6 text-primary" /> Notification Settings
          </h1>
          <p className="text-muted-foreground">Choose what you want to be notified about.</p>
        </div>

        <div className="bg-card rounded-lg border border-border divide-y divide-border">
          {TOGGLES.map(({ key, label, desc }) => (
            <label key={key} className="flex items-start justify-between gap-4 p-4 cursor-pointer hover:bg-secondary/30 transition-colors">
              <div>
                <div className="font-medium">{label}</div>
                <div className="text-sm text-muted-foreground">{desc}</div>
              </div>
              <input
                type="checkbox"
                checked={!!prefs[key as keyof Prefs]}
                onChange={(e) => handleToggle(key as keyof Prefs, e.target.checked)}
                className="w-5 h-5 mt-0.5 accent-primary"
              />
            </label>
          ))}
        </div>

        {message && (
          <p className={`mt-4 text-sm ${message === "Saved." ? "text-green-500" : "text-destructive"}`}>{message}</p>
        )}

        <div className="mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save preferences
          </button>
        </div>
      </div>
    </div>
  )
}
