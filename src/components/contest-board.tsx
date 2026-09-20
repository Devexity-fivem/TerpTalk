"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Trophy, Camera, Loader2, Heart } from "lucide-react"
import RoleBadge from "@/components/role-badge"
import TierChip from "@/components/tier-chip"
import EmptyState from "@/components/ui/empty-state"
import Tooltip from "@/components/ui/tooltip"

interface Entry {
  id: string
  imageUrl: string
  caption: string | null
  votes: number
  votedByMe: boolean
  mine: boolean
  user: { name: string | null; username: string | null; role: string; reputation: number; publicMilestoneOptOut: boolean }
}

export default function ContestBoard() {
  const { data: session } = useSession()
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [caption, setCaption] = useState("")
  const [error, setError] = useState("")
  const fileRef = useRef<HTMLInputElement>(null)

  const load = () =>
    fetch("/api/contest")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { setEntries(d?.entries || []); setLoading(false) })
      .catch(() => setLoading(false))

  useEffect(() => { load() }, [])

  const vote = async (entryId: string) => {
    if (!session) return
    const res = await fetch("/api/contest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vote", entryId }),
    })
    if (res.ok) load()
  }

  const enter = async (file: File) => {
    if (!file || busy) return
    if (file.size > 10 * 1024 * 1024) { setError("Image must be under 10MB"); return }
    setBusy(true)
    setError("")
    try {
      const img = new Image()
      const dataUrl = await new Promise<string>((resolve, reject) => {
        img.onload = () => {
          const scale = Math.min(1, 1200 / Math.max(img.width, img.height))
          const canvas = document.createElement("canvas")
          canvas.width = Math.round(img.width * scale)
          canvas.height = Math.round(img.height * scale)
          canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height)
          resolve(canvas.toDataURL("image/webp", 0.85))
        }
        img.onerror = reject
        img.src = URL.createObjectURL(file)
      })
      const res = await fetch("/api/contest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enter", image: dataUrl, caption }),
      })
      const d = await res.json()
      if (res.ok) { setCaption(""); load() }
      else setError(d.error || "Failed to enter")
    } catch { setError("Could not process image") }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = "" }
  }

  const nameOf = (u: Entry["user"]) => u.username || u.name || "Member"
  const alreadyEntered = session && entries.some((e) => e.mine)

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>

  return (
    <div>
      {/* Entry CTA */}
      {session && !alreadyEntered && (
        <div className="bg-card/80 border border-border/70 rounded-2xl p-4 mb-6 flex flex-col sm:flex-row gap-3">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption — strain, week of flower, etc. (optional)"
            maxLength={200}
            className="flex-1 px-3 py-2 rounded-xl border border-border/70 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && enter(e.target.files[0])}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-full hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 text-sm font-medium shrink-0"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            Submit a photo
          </button>
        </div>
      )}
      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {entries.length === 0 ? (
        <div className="bg-card/80 rounded-2xl border border-border/70">
          <EmptyState
            icon={Trophy}
            title="No entries yet this week"
            description="Be the first — snap your best budshot."
          />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((e, i) => (
            <div key={e.id} className="bg-card/80 border border-border/70 rounded-2xl overflow-hidden">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={e.imageUrl} alt={e.caption || "Budshot entry"} loading="lazy" decoding="async" className="w-full aspect-square object-cover" />
                {i === 0 && e.votes > 0 && (
                  <Tooltip content="Currently in first place this week" side="bottom" className="absolute top-2 left-2">
                    <span className="bg-amber-500 text-black text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                      <Trophy className="w-3 h-3" /> Leading
                    </span>
                  </Tooltip>
                )}
              </div>
              <div className="p-3">
                {e.caption && <p className="text-sm mb-2">{e.caption}</p>}
                <div className="flex items-center justify-between">
                  <Link
                    href={`/u/${nameOf(e.user)}`}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {nameOf(e.user)} <RoleBadge role={e.user.role} /> <TierChip reputation={e.user.reputation ?? 0} publicMilestoneOptOut={e.user.publicMilestoneOptOut} />
                  </Link>
                  <Tooltip content={e.mine ? "You can't vote on your own entry" : "Vote for this budshot — most votes wins the week"}>
                    <button
                      onClick={() => vote(e.id)}
                      disabled={!session || e.mine}
                      aria-label={e.mine ? "You can't vote on your own entry" : "Vote for this budshot"}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
                        e.votedByMe
                          ? "bg-red-500/15 text-red-500"
                          : "bg-secondary hover:bg-secondary/80"
                      }`}
                    >
                      <Heart className={`w-4 h-4 ${e.votedByMe ? "fill-current" : ""}`} />
                      {e.votes}
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
