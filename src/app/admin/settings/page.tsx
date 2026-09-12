"use client"

import { signInHref } from "@/lib/callback-url"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { ShieldCheck, Loader2, Settings, Save } from "lucide-react"

const SETTING_LABELS: Record<string, { label: string; type: "toggle" | "text"; help: string }> = {
  maintenance_mode: { label: "Maintenance mode", type: "toggle", help: "Block public actions with a maintenance message." },
  registration_enabled: { label: "Registration enabled", type: "toggle", help: "Allow new users to sign up." },
  new_threads_enabled: { label: "New threads enabled", type: "toggle", help: "Allow creating new forum threads." },
  image_uploads_enabled: { label: "Image uploads enabled", type: "toggle", help: "Allow image uploads across the site." },
  chat_enabled: { label: "Chat enabled", type: "toggle", help: "Enable live community chat." },
  contest_enabled: { label: "Contest enabled", type: "toggle", help: "Enable weekly photo contest." },
  announcement_title: { label: "Announcement title", type: "text", help: "Shown at the top of every page when set." },
  announcement_content: { label: "Announcement content", type: "text", help: "Short message under the title." },
  announcement_link: { label: "Announcement link", type: "text", help: "Optional /path users are sent to." },
}

export default function AdminSettingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const role = (session?.user as { role?: string })?.role

  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState("")
  const [error, setError] = useState("")

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/settings")
    if (!res.ok) { setLoading(false); return }
    const d = await res.json()
    setSettings(d.settings || {})
    setLoading(false)
  }, [])

  useEffect(() => {
    if (status === "unauthenticated") router.push(signInHref(window.location.pathname + window.location.search))
    else if (status === "authenticated") { const t = setTimeout(load, 0); return () => clearTimeout(t) }
  }, [status, router, load])

  if (status === "loading" || (loading && !Object.keys(settings).length)) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
  }

  if (role !== "ADMINISTRATOR") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold mb-2">Access denied</h1>
          <p className="text-muted-foreground">Administrator access required.</p>
        </div>
      </div>
    )
  }

  const update = (key: string, value: string) => {
    setSettings((s) => ({ ...s, [key]: value }))
  }

  const save = async () => {
    setSaving(true)
    setError("")
    setNotice("")
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      })
      const d = await res.json()
      if (res.ok) { setNotice("Settings saved") }
      else { setError(d.error || "Failed to save") }
    } finally { setSaving(false) }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <Settings className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Site Controls</h1>
            <p className="text-muted-foreground text-sm">Enable or disable platform features</p>
          </div>
        </div>

        {error && <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm mb-4">{error}</div>}
        {notice && <div className="bg-primary/10 text-primary px-4 py-2 rounded-lg text-sm mb-4">{notice}</div>}

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {Object.entries(SETTING_LABELS).map(([key, { label, type, help }]) => (
              <div key={key} className="p-4 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{help}</div>
                </div>
                {type === "toggle" ? (
                  <button
                    onClick={() => update(key, (settings[key] ?? "true") === "true" ? "false" : "true")}
                    className={`relative w-11 h-6 rounded-full transition-colors ${(settings[key] ?? "true") === "true" ? "bg-primary" : "bg-muted"}`}
                  >
                    <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${(settings[key] ?? "true") === "true" ? "translate-x-5" : ""}`} />
                  </button>
                ) : (
                  <input
                    value={settings[key] ?? ""}
                    onChange={(e) => update(key, e.target.value)}
                    placeholder={help}
                    className="w-64 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save settings
          </button>
        </div>
      </div>
    </div>
  )
}
