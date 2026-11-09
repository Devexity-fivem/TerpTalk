"use client"

import { signInHref } from "@/lib/callback-url"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { isAdmin } from "@/lib/roles"
import { Video, Check, X, Loader2, ShieldCheck } from "@/lib/icons"
import { Avatar } from "@/components/ui/avatar"
import EmptyState from "@/components/ui/empty-state"

interface Youtuber {
  id: string
  username: string
  avatarUrl: string | null
  youtubeChannelUrl: string
  isVerified: boolean
}

export default function AdminYoutubersPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const role = (session?.user as { role?: string })?.role

  const [youtubers, setYoutubers] = useState<Youtuber[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(signInHref(window.location.pathname + window.location.search))
      return
    }
    if (status !== "authenticated" || !isAdmin(role)) return
    fetch("/api/admin/youtubers")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error)
        setYoutubers(data.youtubers || [])
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [status, router, role])

  const toggle = async (userId: string) => {
    try {
      const res = await fetch("/api/admin/youtubers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      setYoutubers((prev) =>
        prev.map((y) => (y.id === userId ? { ...y, isVerified: data.verified } : y))
      )
    } catch (err: unknown) {
      setError((err as Error).message)
    }
  }

  if (status === "loading" || (loading && isAdmin(role))) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!isAdmin(role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <ShieldCheck className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <h1 className="text-2xl font-bold font-display mb-2">Access denied</h1>
          <p className="text-muted-foreground">Administrator access required.</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg">{error}</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-6">
          <Video className="w-8 h-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold font-display">YouTuber Applications</h1>
            <p className="text-muted-foreground text-sm">Members who applied for the Verified YouTuber badge</p>
          </div>
        </div>

        {youtubers.length === 0 ? (
          <EmptyState
            compact={false}
            icon={Video}
            title="No applications yet"
            description="Members who apply for the Verified YouTuber badge appear here."
          />
        ) : (
          <div className="space-y-3">
            {youtubers.map((y) => (
              <div
                key={y.id}
                className="tt-spotlight flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card/40 p-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {y.avatarUrl ? (
                    <Avatar src={y.avatarUrl} alt={y.username} size="md" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Video className="w-5 h-5 text-primary" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="font-display font-semibold truncate">{y.username}</p>
                    <a
                      href={y.youtubeChannelUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline truncate max-w-xs block"
                    >
                      {y.youtubeChannelUrl}
                    </a>
                  </div>
                </div>

                <button
                  onClick={() => toggle(y.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0 ${
                    y.isVerified
                      ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                      : "bg-primary/10 text-primary hover:bg-primary/20"
                  }`}
                >
                  {y.isVerified ? (
                    <>
                      <X className="w-4 h-4" />
                      Remove
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      Verify
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
