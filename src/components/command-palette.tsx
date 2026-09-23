"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import {
  Search, ArrowRight, MessageCircle, Leaf, Dna, Stethoscope, Trophy,
  User, BookOpen, Home, TrendingUp, Settings, Bell, Mail, Sprout,
  MessagesSquare, Plus, Medal, Tag, Tent, X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useChatPanel } from "@/components/chat-panel"

// ── Context ────────────────────────────────────────────────────────

interface CommandPaletteContextValue {
  open: boolean
  openPalette: () => void
  closePalette: () => void
}

const CommandPaletteContext = createContext<CommandPaletteContextValue>({
  open: false,
  openPalette: () => {},
  closePalette: () => {},
})

export function useCommandPalette() {
  return useContext(CommandPaletteContext)
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)

  const openPalette = useCallback(() => setOpen(true), [])
  const closePalette = useCallback(() => setOpen(false), [])

  // Global Cmd/Ctrl+K shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <CommandPaletteContext.Provider value={{ open, openPalette, closePalette }}>
      {children}
      {open && <CommandPaletteDialog onClose={closePalette} />}
    </CommandPaletteContext.Provider>
  )
}

// ── Static actions ─────────────────────────────────────────────────

interface Action {
  id: string
  label: string
  icon: React.ElementType
  href?: string
  section: string
  /** Only show to authenticated users */
  auth?: boolean
  /** Callback instead of navigation */
  action?: () => void
  keywords?: string
}

function getActions(openChat: () => void): Action[] {
  return [
    // Navigate
    { id: "home", label: "Go home", icon: Home, href: "/", section: "Navigate", keywords: "dashboard today" },
    { id: "discover", label: "Discover", icon: TrendingUp, href: "/discover", section: "Navigate", keywords: "trending explore" },
    { id: "forum", label: "Discussions", icon: MessageCircle, href: "/forum", section: "Navigate", keywords: "forum threads" },
    { id: "diaries", label: "Grow Diaries", icon: Leaf, href: "/diaries", section: "Navigate", keywords: "grows journals" },
    { id: "strains", label: "Strains", icon: Dna, href: "/strains", section: "Navigate", keywords: "genetics varieties" },
    { id: "chat", label: "Open Chat", icon: MessagesSquare, section: "Navigate", action: openChat, keywords: "talk room" },
    { id: "plant-doctor", label: "Plant Doctor", icon: Stethoscope, href: "/plant-doctor", section: "Navigate", keywords: "diagnose problem symptom" },
    { id: "guides", label: "Guides", icon: BookOpen, href: "/guides", section: "Navigate" },
    { id: "contest", label: "Contest", icon: Trophy, href: "/contest", section: "Navigate", keywords: "budshot photo" },
    { id: "leaderboard", label: "Leaderboard", icon: Medal, href: "/leaderboard", section: "Navigate" },
    { id: "setups", label: "Setups", icon: Tent, href: "/setups", section: "Navigate", keywords: "equipment" },
    { id: "deals", label: "Deals", icon: Tag, href: "/deals", section: "Navigate", keywords: "discount coupon" },
    // Create
    { id: "new-thread", label: "Start a discussion", icon: Plus, href: "/forum/new", section: "Create", auth: true, keywords: "post thread conversation" },
    { id: "new-question", label: "Ask the community", icon: Search, href: "/forum/new?category=questions", section: "Create", auth: true, keywords: "question help problem" },
    { id: "new-diary", label: "Start a grow diary", icon: Sprout, href: "/diaries/new", section: "Create", auth: true, keywords: "journal grow log track" },
    { id: "new-setup", label: "Share a setup", icon: Tent, href: "/setups/new", section: "Create", auth: true, keywords: "equipment build gear" },
    { id: "new-strain", label: "Add a strain", icon: Dna, href: "/strains/new", section: "Create", auth: true, keywords: "genetics variety database" },
    // Personal
    { id: "profile", label: "My profile", icon: User, href: "/profile", section: "Personal", auth: true },
    { id: "progress", label: "My progress", icon: Trophy, href: "/progress", section: "Personal", auth: true, keywords: "achievements badges quests rank" },
    { id: "notifications", label: "Notifications", icon: Bell, href: "/notifications", section: "Personal", auth: true },
    { id: "messages", label: "Messages", icon: Mail, href: "/messages", section: "Personal", auth: true, keywords: "dm inbox" },
    { id: "settings", label: "Settings", icon: Settings, href: "/settings", section: "Personal", auth: true },
  ]
}

// ── Search result types ────────────────────────────────────────────

interface SearchResult {
  id: string
  type: "thread" | "strain" | "diary" | "user" | "guide"
  title: string
  subtitle?: string
  href: string
}

const typeIcons: Record<string, React.ElementType> = {
  thread: MessageCircle,
  strain: Dna,
  diary: Leaf,
  user: User,
  guide: BookOpen,
}

// ── Dialog ─────────────────────────────────────────────────────────

function CommandPaletteDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const { data: session } = useSession()
  const { openPanel } = useChatPanel()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  const actions = getActions(() => {
    openPanel()
    onClose()
  })

  const isAuthed = !!session

  // Filter actions by query and auth state
  const filteredActions = query.length > 0
    ? actions.filter((a) => {
        if (a.auth && !isAuthed) return false
        const haystack = `${a.label} ${a.keywords || ""} ${a.section}`.toLowerCase()
        return query.toLowerCase().split(/\s+/).every((w) => haystack.includes(w))
      })
    : actions.filter((a) => !a.auth || isAuthed)

  // Group actions by section
  const sections = filteredActions.reduce<Record<string, Action[]>>((acc, a) => {
    ;(acc[a.section] ??= []).push(a)
    return acc
  }, {})

  // Search API when query is long enough
  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setSearching(true)
      fetch(`/api/search/suggest?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((d) => {
          setResults((d.results || []).slice(0, 6))
          setSearching(false)
        })
        .catch(() => setSearching(false))
    }, 200)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query])

  // Total selectable items
  const allItems: { type: "action" | "result"; item: Action | SearchResult }[] = [
    ...results.map((r) => ({ type: "result" as const, item: r })),
    ...filteredActions.map((a) => ({ type: "action" as const, item: a })),
  ]

  // Reset index when list changes
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // Keyboard navigation
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose()
    } else if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, allItems.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const selected = allItems[selectedIndex]
      if (selected) selectItem(selected)
    }
  }

  const selectItem = (item: (typeof allItems)[number]) => {
    if (item.type === "result") {
      router.push((item.item as SearchResult).href)
      onClose()
    } else {
      const action = item.item as Action
      if (action.action) {
        action.action()
      } else if (action.href) {
        router.push(action.href)
        onClose()
      }
    }
  }

  // Auto-scroll selected into view
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`)
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  let itemIndex = -1

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      {/* Dialog */}
      <div
        role="dialog"
        aria-label="Command palette"
        aria-modal="true"
        className="fixed left-1/2 top-[12vh] z-[101] w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 animate-in"
      >
        <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl">
          {/* Input */}
          <div className="flex items-center gap-3 border-b border-border/60 px-4">
            <Search className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              placeholder="Search TerpTalk or type a command..."
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              aria-label="Search or command"
              autoComplete="off"
              spellCheck={false}
            />
            <kbd className="hidden shrink-0 items-center gap-0.5 rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-flex">
              Esc
            </kbd>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-1 text-muted-foreground hover:text-foreground sm:hidden"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Results */}
          <div
            ref={listRef}
            className="max-h-[min(50vh,24rem)] overflow-y-auto overscroll-contain p-2"
            role="listbox"
          >
            {/* Live search results */}
            {results.length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Results
                </div>
                {results.map((r) => {
                  itemIndex++
                  const Icon = typeIcons[r.type] || Search
                  const idx = itemIndex
                  return (
                    <button
                      key={r.id}
                      data-index={idx}
                      role="option"
                      aria-selected={selectedIndex === idx}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                        selectedIndex === idx
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                      onClick={() => { router.push(r.href); onClose() }}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{r.title}</div>
                        {r.subtitle && (
                          <div className="truncate text-xs text-muted-foreground">{r.subtitle}</div>
                        )}
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                    </button>
                  )
                })}
              </div>
            )}

            {/* Searching indicator */}
            {searching && query.length >= 2 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">Searching...</div>
            )}

            {/* Actions grouped by section */}
            {Object.entries(sections).map(([section, acts]) => (
              <div key={section} className="mb-2">
                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {section}
                </div>
                {acts.map((a) => {
                  itemIndex++
                  const idx = itemIndex
                  const Icon = a.icon
                  return (
                    <button
                      key={a.id}
                      data-index={idx}
                      role="option"
                      aria-selected={selectedIndex === idx}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
                        selectedIndex === idx
                          ? "bg-primary/10 text-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                      )}
                      onClick={() => selectItem({ type: "action", item: a })}
                      onMouseEnter={() => setSelectedIndex(idx)}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.label}</span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-40" />
                    </button>
                  )
                })}
              </div>
            ))}

            {/* Empty state */}
            {allItems.length === 0 && query.length > 0 && !searching && (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                No results for &ldquo;{query}&rdquo;
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-[10px] text-muted-foreground">
            <span>
              <kbd className="rounded border border-border bg-secondary px-1 py-0.5 font-mono">↑↓</kbd>{" "}
              navigate{" "}
              <kbd className="rounded border border-border bg-secondary px-1 py-0.5 font-mono">↵</kbd>{" "}
              select
            </span>
            <span>
              <kbd className="rounded border border-border bg-secondary px-1 py-0.5 font-mono">⌘K</kbd>{" "}
              toggle
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
