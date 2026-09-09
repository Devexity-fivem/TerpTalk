"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Search, MessageSquare, Leaf, Dna, User, Loader2, Bookmark } from "lucide-react"

interface Results {
  threads: { id: string; title: string; slug: string; category: { name: string }; replyCount: number }[]
  strains: { id: string; name: string; type: string | null; genetics: string | null }[]
  users: { username: string; avatarUrl: string | null; bio: string | null; reputation: number }[]
  diaries: { id: string; title: string; strain: string | null; stage: string; _count: { updates: number } }[]
}

export default function SearchResults() {
  const { data: session } = useSession()
  const params = useSearchParams()
  const q = params.get("q") || ""
  const [results, setResults] = useState<Results | null>(null)
  const [loading, setLoading] = useState(q.trim().length >= 2)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) return
    let cancelled = false
    fetch(`/api/search?q=${encodeURIComponent(q)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled) { setResults(d); setLoading(false) } })
      .catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [q])

  const empty = results && !results.threads.length && !results.strains.length && !results.users.length && !results.diaries.length

  return (
    <div>
      <form action="/search" className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            name="q"
            key={q}
            defaultValue={q}
            placeholder="Search threads, strains, growers, diaries..."
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
      </form>

      {session && q.trim().length >= 2 && !saved && (
        <button
          onClick={async () => {
            const name = window.prompt("Name this saved search?")
            if (!name) return
            const res = await fetch("/api/saved-searches", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, query: q }),
            })
            if (res.ok) setSaved(true)
          }}
          className="mb-4 inline-flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <Bookmark className="w-4 h-4" /> Save this search
        </button>
      )}
      {session && saved && (
        <p className="mb-4 text-sm text-muted-foreground">Search saved.</p>
      )}

      {loading && <div className="flex justify-center py-8"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}

      {empty && !loading && q && (
        <p className="text-center text-muted-foreground py-8">No results for &quot;{q}&quot;.</p>
      )}

      {results && !loading && (
        <div className="space-y-6">
          {results.threads.length > 0 && (
            <section className="bg-card rounded-xl border border-border">
              <h2 className="p-4 border-b border-border font-semibold flex items-center gap-2 text-sm">
                <MessageSquare className="w-4 h-4 text-primary" /> Threads
              </h2>
              <div className="divide-y divide-border">
                {results.threads.map((t) => (
                  <Link key={t.id} href={`/forum/thread/${t.slug}`} className="block p-3 hover:bg-secondary/50 transition-colors">
                    <div className="font-medium text-sm">{t.title}</div>
                    <div className="text-xs text-muted-foreground">{t.category.name} · {t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}</div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.strains.length > 0 && (
            <section className="bg-card rounded-xl border border-border">
              <h2 className="p-4 border-b border-border font-semibold flex items-center gap-2 text-sm">
                <Dna className="w-4 h-4 text-primary" /> Strains
              </h2>
              <div className="divide-y divide-border">
                {results.strains.map((s) => (
                  <Link key={s.id} href={`/strains/${s.id}`} className="block p-3 hover:bg-secondary/50 transition-colors">
                    <div className="font-medium text-sm">{s.name} {s.type && <span className="text-xs text-muted-foreground">({s.type})</span>}</div>
                    {s.genetics && <div className="text-xs text-muted-foreground">{s.genetics}</div>}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.diaries.length > 0 && (
            <section className="bg-card rounded-xl border border-border">
              <h2 className="p-4 border-b border-border font-semibold flex items-center gap-2 text-sm">
                <Leaf className="w-4 h-4 text-primary" /> Diaries
              </h2>
              <div className="divide-y divide-border">
                {results.diaries.map((d) => (
                  <Link key={d.id} href={`/diaries/${d.id}`} className="block p-3 hover:bg-secondary/50 transition-colors">
                    <div className="font-medium text-sm">{d.title} {d.strain && <span className="text-xs text-muted-foreground">— {d.strain}</span>}</div>
                    <div className="text-xs text-muted-foreground">{d.stage} · {d._count.updates} updates</div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.users.length > 0 && (
            <section className="bg-card rounded-xl border border-border">
              <h2 className="p-4 border-b border-border font-semibold flex items-center gap-2 text-sm">
                <User className="w-4 h-4 text-primary" /> Growers
              </h2>
              <div className="divide-y divide-border">
                {results.users.map((u) => (
                  <Link key={u.username} href={`/u/${u.username}`} className="flex items-center gap-3 p-3 hover:bg-secondary/50 transition-colors">
                    <div className="w-9 h-9 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center shrink-0">
                      {u.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.avatarUrl} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-primary font-bold text-sm">{u.username[0].toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{u.username} <span className="text-xs text-amber-500">{u.reputation} rep</span></div>
                      {u.bio && <div className="text-xs text-muted-foreground truncate">{u.bio}</div>}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  )
}
