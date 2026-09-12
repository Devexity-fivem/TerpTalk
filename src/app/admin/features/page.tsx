"use client"

import { signInHref } from "@/lib/callback-url"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { ToggleLeft, Loader2 } from "lucide-react"
import Link from "next/link"

interface Feature {
  key: string
  label: string
  default: boolean
  enabled: boolean
}

export default function AdminFeaturesPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [features, setFeatures] = useState<Feature[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [message, setMessage] = useState("")

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(signInHref(window.location.pathname + window.location.search))
      return
    }
    if (status === "loading") return
    fetch("/api/admin/features")
      .then((res) => res.json())
      .then((data) => setFeatures(data.features || []))
      .catch(() => setMessage("Failed to load features"))
      .finally(() => setLoading(false))
  }, [status, router])

  const toggle = async (f: Feature) => {
    setSaving(f.key)
    setMessage("")
    const res = await fetch("/api/admin/features", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: f.key, enabled: !f.enabled }),
    })
    setSaving(null)
    if (res.ok) {
      setFeatures((prev) => prev.map((x) => (x.key === f.key ? { ...x, enabled: !x.enabled } : x)))
      setMessage(`Saved ${f.label}.`)
    } else {
      setMessage("Failed to save feature.")
    }
  }

  if (loading || status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    )
  }

  if (session?.user?.role !== "ADMINISTRATOR") {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Admins only. <Link href="/" className="text-primary ml-1">Go home</Link>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
          <ToggleLeft className="w-6 h-6 text-primary" /> Feature Flags
        </h1>
        <p className="text-muted-foreground mb-6">Toggle platform features without deploying code.</p>

        {message && (
          <p className={`mb-4 text-sm ${message.startsWith("Saved") ? "text-green-500" : "text-destructive"}`}>{message}</p>
        )}

        <div className="bg-card rounded-lg border border-border divide-y divide-border">
          {features.map((f) => (
            <div key={f.key} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">{f.label}</div>
                <div className="text-sm text-muted-foreground">feature:{f.key}</div>
              </div>
              <button
                onClick={() => toggle(f)}
                disabled={saving === f.key}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${f.enabled ? "bg-primary" : "bg-muted"}`}
                aria-pressed={f.enabled}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${f.enabled ? "translate-x-6" : "translate-x-1"}`}
                />
                {saving === f.key && <Loader2 className="absolute right-[-20px] w-4 h-4 animate-spin" />}
              </button>
            </div>
          ))}
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          Note: toggles are stored in the <code>Setting</code> table. Application code must read these flags to actually gate features.
        </p>
      </div>
    </div>
  )
}
