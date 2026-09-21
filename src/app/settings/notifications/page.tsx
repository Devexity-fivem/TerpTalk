"use client"

import { signInHref } from "@/lib/callback-url"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { ArrowLeft, Bell, Loader2, Save } from "lucide-react"
import { useRouter } from "next/navigation"
import Link from "next/link"

const TOGGLES = [
  { key: "notifyOnReply", label: "Replies to my threads", desc: "When someone replies to a thread I started." },
  { key: "notifyOnMention", label: "Mentions", desc: "When someone @mentions me in a post or thread." },
  { key: "notifyOnCategoryFollow", label: "Followed content activity", desc: "New threads in categories I follow, new replies in threads I follow, and new diaries or threads from members I follow." },
  { key: "notifyOnMessage", label: "Direct messages", desc: "When I receive a private message." },
  { key: "notifyOnComment", label: "Comments on my setups", desc: "When someone comments on my grow setup." },
  { key: "notifyOnFollow", label: "New followers", desc: "When someone follows my profile." },
  { key: "notifyOnReaction", label: "Reactions", desc: "When someone reacts to my posts or grow diaries." },
  { key: "notifyOnMilestone", label: "Milestones", desc: "Tier-ups, badges, and reputation milestones." },
  { key: "notifyOnBotAssist", label: "TerpBot tips", desc: "Occasional pointers from TerpBot (our automated helper) about my threads, diaries, and account. Doesn't affect reply or accepted-answer notices." },
] as const

const PRIVACY_TOGGLES = [
  { key: "hideOnlineStatus", label: "Hide my online status", desc: "Don't show me in 'who's online' lists or mark me as active. Members may still see your public posts and comments." },
  { key: "publicMilestoneOptOut", label: "Opt out of public recognition", desc: "Skip me in TerpBot's public shout-outs (tier-ups, badges, harvests, contest winners) and leaderboard-style spotlights. You still earn the badges, reputation, and private notifications." },
] as const

const DM_OPTIONS = [
  { value: "EVERYONE", label: "Anyone can message me" },
  { value: "FOLLOWING", label: "Only members I follow" },
  { value: "NONE", label: "Nobody" },
] as const

type Prefs = Record<(typeof TOGGLES)[number]["key"], boolean> &
  Record<(typeof PRIVACY_TOGGLES)[number]["key"], boolean> &
  { dmPolicy: string }

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
        <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> All settings
        </Link>
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold flex items-center gap-2 tracking-tight">
            <Bell className="w-6 h-6 text-primary" /> Notifications & Privacy
          </h1>
          <p className="text-muted-foreground">Choose what you want to be notified about, and how visible you are to others.</p>
        </div>

        <h2 id="notifications" className="font-display text-lg font-semibold mb-3 scroll-mt-20">Notifications</h2>

        <div className="bg-card/80 rounded-2xl border border-border/70 divide-y divide-border">
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
                className="w-6 h-6 mt-0.5 accent-primary rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </label>
          ))}
        </div>

        <h2 id="privacy" className="font-display text-lg font-semibold mt-8 mb-3 scroll-mt-20">Privacy</h2>
        <div className="bg-card/80 rounded-2xl border border-border/70 divide-y divide-border">
          {PRIVACY_TOGGLES.map(({ key, label, desc }) => (
            <label key={key} className="flex items-start justify-between gap-4 p-4 cursor-pointer hover:bg-secondary/30 transition-colors">
              <div>
                <div className="font-medium">{label}</div>
                <div className="text-sm text-muted-foreground">{desc}</div>
              </div>
              <input
                type="checkbox"
                checked={!!prefs[key]}
                onChange={(e) => handleToggle(key, e.target.checked)}
                className="w-6 h-6 mt-0.5 accent-primary rounded focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              />
            </label>
          ))}
          <div className="flex items-start justify-between gap-4 p-4">
            <div>
              <div className="font-medium">Direct messages</div>
              <div className="text-sm text-muted-foreground">Who can start a private conversation with you. Existing conversations aren&apos;t affected.</div>
            </div>
            <select
              value={prefs.dmPolicy}
              onChange={(e) => setPrefs({ ...prefs, dmPolicy: e.target.value })}
              className="bg-input border border-border rounded-md px-2 py-1.5 text-sm"
            >
              {DM_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {message && (
          <p className={`mt-4 text-sm ${message === "Saved." ? "text-success" : "text-destructive"}`}>{message}</p>
        )}

        <div className="mt-6">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-full font-medium disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save preferences
          </button>
        </div>
      </div>
    </div>
  )
}
