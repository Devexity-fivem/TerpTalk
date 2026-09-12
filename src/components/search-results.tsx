"use client"

import { useEffect, useState, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { Search, MessageSquare, Leaf, Dna, User, Tag, Loader2, Bookmark, ArrowUpDown, BookOpen, Wrench, CheckCircle2, AlertCircle } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import EmptyState from "@/components/ui/empty-state"

interface ThreadResult {
  id: string
  title: string
  slug: string
  category: { name: string }
  replyCount: number
  views: number
  solved: boolean
  answerSnippet: string | null
  answerAuthor: string | null
  matchedPost: { id: string; snippet: string } | null
}

interface Results {
  threads: ThreadResult[]
  strains: { id: string; name: string; type: string | null; genetics: string | null }[]
  users: { username: string; avatarUrl: string | null; bio: string | null; reputation: number }[]
  diaries: { id: string; title: string; strain: string | null; stage: string; _count: { updates: number } }[]
  guides: { id: string; slug: string; title: string; excerpt: string; topic: string }[]
  setups: { id: string; title: string; strain: string | null; author: { name: string | null; profile: { username: string } | null } }[]
  tags: { name: string; slug: string; _count: { threads: number } }[]
  hasMore: Record<string, boolean>
}

interface Suggestion {
  type: "thread" | "strain" | "user" | "tag" | "guide"
  title: string
  slug: string
}

const TYPES = [
  { key: "all", label: "All", icon: Search },
  { key: "threads", label: "Threads", icon: MessageSquare },
  { key: "guides", label: "Guides", icon: BookOpen },
  { key: "strains", label: "Strains", icon: Dna },
  { key: "diaries", label: "Diaries", icon: Leaf },
  { key: "setups", label: "Setups", icon: Wrench },
  { key: "tags", label: "Tags", icon: Tag },
  { key: "users", label: "Growers", icon: User },
] as const

const SUGGEST_ICONS = { thread: MessageSquare, strain: Dna, user: User, tag: Tag, guide: BookOpen } as const

export default function SearchResults() {
  const { data: session } = useSession()
  const router = useRouter()
  const params = useSearchParams()
  const q = params.get("q") || ""
  const type = params.get("type") || "all"
  const sort = params.get("sort") || "latest"
  const page = Math.max(1, parseInt(params.get("page") || "1") || 1)

  const [input, setInput] = useState(q)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [results, setResults] = useState<Results | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(q.trim().length >= 2)
  const [saved, setSaved] = useState(false)
  const suggestionTimeout = useRef<number | null>(null)

  useEffect(() => {
    if (q.trim().length < 2) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(false)
    let cancelled = false
    fetch(`/api/search?q=${encodeURIComponent(q)}&type=${type}&sort=${sort}&page=${page}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) { setResults(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [q, type, sort, page])

  const updateParams = (next: { q?: string; type?: string; sort?: string; page?: number }) => {
    const p = new URLSearchParams(params.toString())
    if (next.q !== undefined) p.set("q", next.q)
    if (next.type !== undefined) p.set("type", next.type)
    if (next.sort !== undefined) p.set("sort", next.sort)
    if (next.page !== undefined) {
      if (next.page > 1) p.set("page", String(next.page))
      else p.delete("page")
    }
    // Type/sort changes reset pagination.
    if (next.type !== undefined || next.sort !== undefined) p.delete("page")
    router.replace(`/search?${p.toString()}`, { scroll: false })
  }

  const fetchSuggestions = (value: string) => {
    if (suggestionTimeout.current) window.clearTimeout(suggestionTimeout.current)
    if (value.trim().length < 2) {
      setSuggestions([])
      return
    }
    suggestionTimeout.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(value)}`)
        if (!res.ok) return
        const data = await res.json()
        setSuggestions((data.suggestions || []) as Suggestion[])
        setShowSuggestions(true)
      } catch {
        setSuggestions([])
      }
    }, 150)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim()) return
    setShowSuggestions(false)
    updateParams({ q: input.trim() })
  }

  const sectionCounts = results
    ? [results.threads, results.strains, results.users, results.diaries, results.guides, results.setups, results.tags]
        .reduce((n, arr) => n + arr.length, 0)
    : 0
  const empty = results && sectionCounts === 0
  const singleType = type !== "all" ? type : null
  const hasMore = singleType ? results?.hasMore?.[singleType] : false

  return (
    <div>
      <form onSubmit={handleSubmit} className="mb-4 relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value); fetchSuggestions(e.target.value) }}
            onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true) }}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            placeholder="Search threads, guides, strains, growers..."
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
            {suggestions.map((s) => {
              const Icon = SUGGEST_ICONS[s.type]
              const href =
                s.type === "thread" ? `/forum/thread/${s.slug}`
                : s.type === "strain" ? `/strains/${s.slug}`
                : s.type === "user" ? `/u/${s.slug}`
                : s.type === "guide" ? `/guides/${s.slug}`
                : `/forum/tags/${s.slug}`
              return (
                <Link
                  key={`${s.type}-${s.slug}`}
                  href={href}
                  onClick={() => setShowSuggestions(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm hover:bg-secondary"
                >
                  <Icon className="w-4 h-4 text-muted-foreground shrink-0" />
                  <span className="truncate">{s.title}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                    {s.type}
                  </span>
                </Link>
              )
            })}
            <button
              type="submit"
              className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-primary hover:bg-secondary border-t border-border"
            >
              <Search className="w-4 h-4 shrink-0" />
              See all results for &quot;{input.trim()}&quot;
            </button>
          </div>
        )}
      </form>

      {q.trim().length >= 2 && (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap gap-2">
            {TYPES.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => updateParams({ type: key })}
                className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                  type === key ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <ArrowUpDown className="w-4 h-4 text-muted-foreground" />
            <select
              value={sort}
              onChange={(e) => updateParams({ sort: e.target.value })}
              className="px-3 py-1.5 rounded-lg border border-border bg-card text-sm"
            >
              <option value="latest">Latest</option>
              <option value="popular">Popular</option>
            </select>
          </div>
        </div>
      )}

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

      {error && !loading && (
        <EmptyState
          icon={AlertCircle}
          title="Search didn't work"
          description="Something went wrong — try again in a moment."
          action={{ label: "Try again", href: `/search?q=${encodeURIComponent(q)}` }}
        />
      )}

      {empty && !loading && !error && q && (
        <EmptyState
          icon={Search}
          title={`No results for "${q}"`}
          description="Try different keywords, or ask the community directly — chances are someone has grown through the same question."
          action={{ label: "Ask the community", href: "/forum/new" }}
        />
      )}

      {!results && !loading && !error && q.trim().length < 2 && (
        <EmptyState
          icon={Search}
          title="Search TerpTalk"
          description="Find discussions, guides, strains, grow diaries, setups, and growers."
          action={{ label: "Browse the forum", href: "/forum" }}
        />
      )}

      {results && !loading && !error && (
        <div className="space-y-6">
          {results.threads.length > 0 && (
            <section className="bg-card rounded-xl border border-border">
              <h2 className="p-4 border-b border-border font-semibold flex items-center gap-2 text-sm">
                <MessageSquare className="w-4 h-4 text-primary" /> Threads
                <span className="text-muted-foreground font-normal">({results.threads.length}{type === "all" ? " top" : ""})</span>
              </h2>
              <div className="divide-y divide-border">
                {results.threads.map((t) => (
                  <Link
                    key={t.id}
                    href={t.matchedPost ? `/forum/thread/${t.slug}?post=${t.matchedPost.id}#post-${t.matchedPost.id}` : `/forum/thread/${t.slug}`}
                    className="block p-3 hover:bg-secondary/50 transition-colors"
                  >
                    <div className="font-medium text-sm flex items-center gap-2">
                      <span className="min-w-0 truncate">{t.title}</span>
                      {t.solved && (
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-green-500 shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Solved
                        </span>
                      )}
                    </div>
                    {t.matchedPost && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.matchedPost.snippet}</div>
                    )}
                    {!t.matchedPost && t.answerSnippet && (
                      <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        Accepted answer{t.answerAuthor ? ` by ${t.answerAuthor}` : ""}: {t.answerSnippet}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">{t.category.name} · {t.views} views · {t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}</div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.guides.length > 0 && (
            <section className="bg-card rounded-xl border border-border">
              <h2 className="p-4 border-b border-border font-semibold flex items-center gap-2 text-sm">
                <BookOpen className="w-4 h-4 text-primary" /> Guides
                <span className="text-muted-foreground font-normal">({results.guides.length}{type === "all" ? " top" : ""})</span>
              </h2>
              <div className="divide-y divide-border">
                {results.guides.map((g) => (
                  <Link key={g.id} href={`/guides/${g.slug}`} className="block p-3 hover:bg-secondary/50 transition-colors">
                    <div className="font-medium text-sm">{g.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{g.excerpt}</div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.strains.length > 0 && (
            <section className="bg-card rounded-xl border border-border">
              <h2 className="p-4 border-b border-border font-semibold flex items-center gap-2 text-sm">
                <Dna className="w-4 h-4 text-primary" /> Strains
                <span className="text-muted-foreground font-normal">({results.strains.length}{type === "all" ? " top" : ""})</span>
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
                <span className="text-muted-foreground font-normal">({results.diaries.length}{type === "all" ? " top" : ""})</span>
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

          {results.setups.length > 0 && (
            <section className="bg-card rounded-xl border border-border">
              <h2 className="p-4 border-b border-border font-semibold flex items-center gap-2 text-sm">
                <Wrench className="w-4 h-4 text-primary" /> Setups
                <span className="text-muted-foreground font-normal">({results.setups.length}{type === "all" ? " top" : ""})</span>
              </h2>
              <div className="divide-y divide-border">
                {results.setups.map((s) => (
                  <Link key={s.id} href={`/setups/${s.id}`} className="block p-3 hover:bg-secondary/50 transition-colors">
                    <div className="font-medium text-sm">{s.title} {s.strain && <span className="text-xs text-muted-foreground">— {s.strain}</span>}</div>
                    <div className="text-xs text-muted-foreground">by {s.author.profile?.username || s.author.name}</div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.tags.length > 0 && (
            <section className="bg-card rounded-xl border border-border">
              <h2 className="p-4 border-b border-border font-semibold flex items-center gap-2 text-sm">
                <Tag className="w-4 h-4 text-primary" /> Tags
                <span className="text-muted-foreground font-normal">({results.tags.length}{type === "all" ? " top" : ""})</span>
              </h2>
              <div className="divide-y divide-border">
                {results.tags.map((t) => (
                  <Link key={t.slug} href={`/forum/tags/${t.slug}`} className="flex items-center justify-between p-3 hover:bg-secondary/50 transition-colors">
                    <span className="font-medium text-sm">#{t.name}</span>
                    <span className="text-xs text-muted-foreground">{t._count.threads} thread{t._count.threads === 1 ? "" : "s"}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {results.users.length > 0 && (
            <section className="bg-card rounded-xl border border-border">
              <h2 className="p-4 border-b border-border font-semibold flex items-center gap-2 text-sm">
                <User className="w-4 h-4 text-primary" /> Growers
                <span className="text-muted-foreground font-normal">({results.users.length}{type === "all" ? " top" : ""})</span>
              </h2>
              <div className="divide-y divide-border">
                {results.users.map((u) => (
                  <Link key={u.username} href={`/u/${u.username}`} className="flex items-center gap-3 p-3 hover:bg-secondary/50 transition-colors">
                    <Avatar
                      src={u.avatarUrl}
                      alt=""
                      size="md"
                      className="w-9 h-9 bg-primary/10"
                      fallback={<span className="text-primary font-bold text-sm">{u.username[0].toUpperCase()}</span>}
                    />
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{u.username} <span className="text-xs text-amber-500">{u.reputation} rep</span></div>
                      {u.bio && <div className="text-xs text-muted-foreground truncate">{u.bio}</div>}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Pagination — only for single-type views */}
          {singleType && (page > 1 || hasMore) && (
            <div className="flex items-center justify-center gap-3 text-sm">
              {page > 1 && (
                <button
                  onClick={() => updateParams({ page: page - 1 })}
                  className="px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
                >
                  ← Previous
                </button>
              )}
              <span className="text-muted-foreground">Page {page}</span>
              {hasMore && (
                <button
                  onClick={() => updateParams({ page: page + 1 })}
                  className="px-4 py-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-colors"
                >
                  Next →
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
