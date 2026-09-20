"use client"

import { useState } from "react"
import Link from "next/link"
import { Shield, Loader2 } from "lucide-react"

type Status = {
  restricted: boolean
  banned?: boolean
  suspendedUntil?: string | null
  reason?: string | null
}

export default function RestrictedPage() {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [requestDeletion, setRequestDeletion] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/restricted", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          ...(status?.restricted ? { message, requestDeletion } : {}),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || "Something went wrong")
        return
      }
      if (data.restricted) {
        setStatus(data)
        if (status?.restricted) setSent(true)
      } else {
        setError("That account isn't restricted — you can sign in normally.")
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-card/80 border border-border/70 rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-primary" />
          <h1 className="font-display text-xl font-bold">Restricted account</h1>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          If your account was suspended or banned, sign in below to see your status and
          ask the moderation team to review it or delete your account.
        </p>

        {status?.restricted ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-secondary/30 p-4 text-sm">
              {status.banned ? (
                <p>Your account has been <strong>banned</strong> from TerpTalk.</p>
              ) : (
                <p>
                  Your account is <strong>suspended</strong>
                  {status.suspendedUntil ? ` until ${new Date(status.suspendedUntil).toLocaleDateString()}` : ""}.
                </p>
              )}
              {status.reason && (
                <p className="mt-2 text-muted-foreground">Reason given: {status.reason}</p>
              )}
            </div>

            {sent ? (
              <p className="text-sm text-green-500">
                Request received. The moderation team will review it.
              </p>
            ) : (
              <form onSubmit={submit} className="space-y-3">
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  placeholder="Tell the moderation team anything relevant (optional)"
                  className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <label className="flex items-start gap-2 text-sm text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={requestDeletion}
                    onChange={(e) => setRequestDeletion(e.target.checked)}
                    className="mt-0.5 accent-primary"
                  />
                  I want my account and content deleted instead.
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-full font-medium disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Send request to moderation team"}
                </button>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              autoComplete="username"
              required
              className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete="current-password"
              required
              className="w-full px-3 py-2 rounded-xl border border-border/70 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-full font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : "Check my status"}
            </button>
          </form>
        )}

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <p className="mt-5 text-xs text-muted-foreground">
          Wrong page? <Link href="/auth/signin" className="text-primary hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  )
}
