"use client"

import { useEffect, useState } from "react"
import { BookOpen, Heart, Loader2, Trophy, Leaf } from "lucide-react"
import Link from "next/link"
import { useSession } from "next-auth/react"

interface ContestUser {
  name: string | null
  username: string | null
  image: string | null
  role: string | null
}

interface Entry {
  id: string
  user: ContestUser
  votes: number
  votedByMe: boolean
  mine: boolean
  diary: {
    id: string
    title: string
    strain: string | null
    stage: string
    harvested: boolean
    updateCount: number
    thumb: string | null
  }
}

interface BoardData {
  month: string
  entries: Entry[]
  eligible: { id: string; title: string; strain: string | null }[]
  alreadyEntered: boolean
}

export default function DiaryContestBoard() {
  const { data: session } = useSession()
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [pickId, setPickId] = useState("")

  const load = () =>
    fetch("/api/diary-contest")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setData(d); else setError("Could not load the diary contest") })
      .catch(() => setError("Could not load the diary contest"))

  useEffect(() => { load() }, [])

  const enter = async () => {
    if (!pickId) return
    setBusy(true)
    setError("")
    const res = await fetch("/api/diary-contest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "enter", diaryId: pickId }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) setError(body.error || "Could not enter")
    else load()
    setBusy(false)
  }

  const vote = async (entryId: string) => {
    setBusy(true)
    setError("")
    const res = await fetch("/api/diary-contest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "vote", entryId }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) setError(body.error || "Could not vote")
    else load()
    setBusy(false)
  }

  if (error && !data) {
    return <div className="bg-card rounded-xl border border-border p-6 text-sm text-muted-foreground">{error}</div>
  }
  if (!data) {
    return <div className="bg-card rounded-xl border border-border p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="bg-card rounded-xl border border-border p-5">
      <p className="text-xs text-muted-foreground mb-4">
        Enter a diary with 4+ updates this month and at least one photo. Community votes — most votes wins the <span className="text-amber-500 font-medium">Diary of the Month</span> badge. Voting requires a 7-day-old account with 10+ reputation.
      </p>

      {session && !data.alreadyEntered && data.eligible.length > 0 && (
        <div className="flex gap-2 mb-4">
          <select
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
            className="flex-1 px-3 py-2 rounded-lg border border-border bg-background text-sm"
          >
            <option value="">Choose an eligible diary…</option>
            {data.eligible.map((d) => (
              <option key={d.id} value={d.id}>{d.title}{d.strain ? ` (${d.strain})` : ""}</option>
            ))}
          </select>
          <button
            onClick={enter}
            disabled={!pickId || busy}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 min-h-11"
          >
            Enter
          </button>
        </div>
      )}
      {session && !data.alreadyEntered && data.eligible.length === 0 && (
        <p className="text-xs text-muted-foreground mb-4">
          None of your diaries qualify this month yet — keep logging updates and photos.
        </p>
      )}
      {error && <p className="text-xs text-destructive mb-3">{error}</p>}

      {data.entries.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground">
          <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
          No entries yet this month — be the first to enter a well-documented grow.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {data.entries.map((e) => (
            <div key={e.id} className="rounded-lg border border-border overflow-hidden">
              <Link href={`/diaries/${e.diary.id}`} className="block">
                <div className="aspect-video bg-secondary flex items-center justify-center overflow-hidden">
                  {e.diary.thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.diary.thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                  ) : (
                    <Leaf className="w-8 h-8 text-muted-foreground/40" />
                  )}
                </div>
              </Link>
              <div className="p-3">
                <Link href={`/diaries/${e.diary.id}`} className="font-medium text-sm hover:text-primary transition-colors line-clamp-1">
                  {e.diary.title}
                </Link>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                  <span>by {e.user.username || e.user.name}</span>
                  {e.diary.strain && <span>· {e.diary.strain}</span>}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {e.diary.stage.toLowerCase()} · {e.diary.updateCount} updates{e.diary.harvested ? " · 🌾 harvested" : ""}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-muted-foreground">{e.votes} vote{e.votes === 1 ? "" : "s"}</span>
                  {e.mine ? (
                    <span className="text-xs text-primary flex items-center gap-1"><Trophy className="w-3 h-3" /> Your entry</span>
                  ) : (
                    <button
                      onClick={() => vote(e.id)}
                      disabled={busy}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors min-h-9 ${e.votedByMe ? "bg-primary/10 text-primary" : "bg-secondary hover:bg-secondary/80"}`}
                    >
                      <Heart className={`w-3 h-3 inline mr-1 ${e.votedByMe ? "fill-current" : ""}`} />
                      {e.votedByMe ? "Voted" : "Vote"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
