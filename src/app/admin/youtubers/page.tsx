"use client"

import { useEffect, useState } from "react"
import { Video, Check, X, Loader2 } from "lucide-react"

interface Youtuber {
  id: string
  username: string
  avatarUrl: string | null
  youtubeChannelUrl: string
  isVerified: boolean
}

export default function AdminYoutubersPage() {
  const [youtubers, setYoutubers] = useState<Youtuber[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    fetch("/api/admin/youtubers")
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error)
        setYoutubers(data.youtubers || [])
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin" />
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
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">YouTuber Applications</h1>

        {youtubers.length === 0 ? (
          <p className="text-muted-foreground">No applications yet.</p>
        ) : (
          <div className="space-y-3">
            {youtubers.map((y) => (
              <div
                key={y.id}
                className="flex items-center justify-between border border-border rounded-lg p-4 bg-card"
              >
                <div className="flex items-center gap-3">
                  {y.avatarUrl ? (
                    <img
                      src={y.avatarUrl}
                      alt={y.username}
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Video className="w-5 h-5 text-primary" />
                    </div>
                  )}
                  <div>
                    <p className="font-semibold">{y.username}</p>
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
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
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
