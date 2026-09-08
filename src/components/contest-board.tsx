"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Trophy, Camera, Loader2, Heart } from "lucide-react"
import RoleBadge from "@/components/role-badge"

interface Entry {
  id: string
  imageUrl: string
  caption: string | null
  votes: number
  votedByMe: boolean
  mine: boolean
  user: { name: string | null; role: string; profile: { username: string | null } | null }
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

  const nameOf = (u: Entry["user"]) => u.profile?.username || u.name || "Member"
  const alreadyEntered = session && entries.some((e) => e.mine)

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>

  return (
    <div>
      {/* Entry CTA */}
      {session && !alreadyEntered && (
        <div className="bg-card border border-border rounded-xl p-4 mb-6 flex flex-col sm:flex-row gap-3">
          <input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption — strain, week of flower, etc. (optional)"
            maxLength={200}
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
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
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 text-sm font-medium shrink-0"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
            Submit a photo
          </button>
        </div>
      )}
      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {entries.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-12 text-center">
          <Trophy className="w-14 h-14 text-amber-500/50 mx-auto mb-4" />
          <h3 className="font-semibold mb-1">No entries yet this week</h3>
          <p className="text-sm text-muted-foreground">Be the first — snap your best budshot.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((e, i) => (
            <div key={e.id} className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={e.imageUrl} alt={e.caption || "Budshot entry"} className="w-full aspect-square object-cover" />
                {i === 0 && e.votes > 0 && (
                  <span className="absolute top-2 left-2 bg-amber-500 text-black text-xs font-bold px-2 py-1 rounded-full flex items-center gap-1">
                    <Trophy className="w-3 h-3" /> Leading
                  </span>
                )}
              </div>
              <div className="p-3">
                {e.caption && <p className="text-sm mb-2">{e.caption}</p>}
                <div className="flex items-center justify-between">
                  <Link
                    href={`/u/${nameOf(e.user)}`}
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                  >
                    {nameOf(e.user)} <RoleBadge role={e.user.role} />
                  </Link>
                  <button
                    onClick={() => vote(e.id)}
                    disabled={!session || e.mine}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 ${
                      e.votedByMe
                        ? "bg-red-500/15 text-red-500"
                        : "bg-secondary hover:bg-secondary/80"
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${e.votedByMe ? "fill-current" : ""}`} />
                    {e.votes}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
