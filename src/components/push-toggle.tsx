"use client"

import { useCallback, useEffect, useState } from "react"
import { Bell, BellOff, Loader2, X } from "@/lib/icons"

// Web Push opt-in. Two presentations of one state machine:
//  - "invite": a compact member-home card, shown only when the browser can
//    do push, permission is still "default", the member hasn't dismissed
//    it, and nothing is subscribed yet. Never requests permission on load.
//  - "settings": the delivery-channel row on /settings/notifications.
// Push is a delivery channel — which notifications exist is still decided
// by the member's notification preferences.

type State = "loading" | "unsupported" | "unavailable" | "denied" | "off" | "on"

const DISMISS_KEY = "tt-push-dismissed"

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4)
  const raw = window.atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function postEvent(type: "PROMPT_SHOWN" | "PERMISSION_DENIED") {
  fetch("/api/push/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  }).catch(() => {})
}

export default function PushToggle({ variant }: { variant: "invite" | "settings" }) {
  const [state, setState] = useState<State>("loading")
  const [publicKey, setPublicKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [error, setError] = useState("")

  const refresh = useCallback(async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setState("unsupported")
      return
    }
    const res = await fetch("/api/push/subscribe").catch(() => null)
    const data = res?.ok ? await res.json() : null
    if (!data?.configured || !data.publicKey) {
      setState("unavailable")
      return
    }
    setPublicKey(data.publicKey)
    if (Notification.permission === "denied") {
      setState("denied")
      return
    }
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    setState(sub && data.subscriptions > 0 && Notification.permission === "granted" ? "on" : "off")
  }, [])

  useEffect(() => {
    // Deferred so the first client render matches the server ("loading").
    const t = setTimeout(() => {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1")
      refresh().catch(() => setState("unsupported"))
    }, 0)
    return () => clearTimeout(t)
  }, [refresh])

  const showInvite = variant === "invite" && state === "off" && !dismissed
  useEffect(() => {
    if (showInvite) postEvent("PROMPT_SHOWN")
  }, [showInvite])

  const enable = async () => {
    if (!publicKey) return
    setBusy(true)
    setError("")
    try {
      const reg = await navigator.serviceWorker.register("/sw.js")
      await navigator.serviceWorker.ready
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        if (permission === "denied") postEvent("PERMISSION_DENIED")
        localStorage.setItem(DISMISS_KEY, "1")
        setDismissed(true)
        setState(permission === "denied" ? "denied" : "off")
        return
      }
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }))
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error("subscribe failed")
      setState("on")
    } catch {
      setError("Couldn't turn on notifications in this browser.")
    } finally {
      setBusy(false)
    }
  }

  const disable = async () => {
    setBusy(true)
    setError("")
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub ? { endpoint: sub.endpoint } : {}),
      })
      await sub?.unsubscribe().catch(() => {})
      setState("off")
    } catch {
      setError("Couldn't turn off notifications.")
    } finally {
      setBusy(false)
    }
  }

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1")
    setDismissed(true)
  }

  if (variant === "invite") {
    if (!showInvite) return null
    return (
      <section
        data-testid="push-invite"
        className="mb-6 flex flex-col gap-3 rounded-2xl border border-primary/30 bg-card/80 p-4 sm:flex-row sm:items-center sm:p-5"
      >
        <Bell className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-sm font-semibold">Stay in the loop</h2>
          <p className="text-xs text-muted-foreground">
            Get replies, mentions, accepted answers, your weekly recap, and Plant Doctor follow-ups on this device. Nothing else.
          </p>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="tt-cta inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
            Turn on
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Not now"
            className="tap-target inline-flex items-center justify-center rounded-full p-2 text-muted-foreground hover:bg-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </section>
    )
  }

  // settings variant
  const status: Record<State, string> = {
    loading: "Checking this browser…",
    unsupported: "This browser doesn't support push notifications.",
    unavailable: "Push notifications aren't available right now.",
    denied: "Blocked in your browser settings — allow notifications for this site to turn them on.",
    off: "Off on this device.",
    on: "On for this device.",
  }
  return (
    <div data-testid="push-settings" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-medium">Push notifications on this device</p>
        <p className="text-xs text-muted-foreground" data-testid="push-status">{status[state]}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Only replies, mentions, accepted answers, the weekly recap, and Plant Doctor follow-ups — and only types you have turned on above.
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      {(state === "off" || state === "on") && (
        <button
          type="button"
          onClick={state === "on" ? disable : enable}
          disabled={busy}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium hover:bg-secondary disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "on" ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
          {state === "on" ? "Turn off" : "Turn on"}
        </button>
      )}
    </div>
  )
}
