"use client"

// StoryViewer — one story at a time with progress bars, tap/arrow
// navigation and a like action. Server already filtered the list to
// stories this viewer may see; deleted stories remove themselves.
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { ChevronLeft, ChevronRight, Heart, Loader2, Trash2, X } from "@/lib/icons"
import TimeAgo from "@/components/ui/time-ago"
import { Avatar } from "@/components/ui/avatar"
import MomentText from "@/components/moment-text"
import ConfirmDialog from "@/components/ui/confirm-dialog"
import { useToast } from "@/components/ui/toast"
import { signInHref } from "@/lib/callback-url"
import { cn } from "@/lib/utils"
import type { MomentDTO } from "@/lib/moments"

const ADVANCE_MS = 7000

export default function StoryViewer({ stories, username, avatarUrl }: { stories: MomentDTO[]; username: string; avatarUrl?: string | null }) {
  const { data: session } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const { toast } = useToast()
  const [list, setList] = useState(stories)
  const [idx, setIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [likedIds, setLikedIds] = useState<Set<string>>(() => new Set(stories.filter((s) => s.liked).map((s) => s.id)))
  // Per-story like totals — seeded from the server DTOs and kept in step
  // with the viewer's own toggles so the count stays honest.
  const [likeCounts, setLikeCounts] = useState<Map<string, number>>(
    () => new Map(stories.map((s) => [s.id, s.counts.likes])),
  )

  const story = list[idx]

  const go = useCallback(
    (delta: number) => {
      setIdx((i) => {
        const next = i + delta
        if (next < 0) return 0
        if (next >= list.length) return list.length - 1
        return next
      })
    },
    [list.length],
  )

  // Auto-advance while the tab is visible.
  useEffect(() => {
    if (!story || list.length <= 1) return
    const t = setTimeout(() => {
      setIdx((i) => (i < list.length - 1 ? i + 1 : i))
    }, ADVANCE_MS)
    return () => clearTimeout(t)
  }, [idx, story, list.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1)
      else if (e.key === "ArrowLeft") go(-1)
      else if (e.key === "Escape") router.push("/feed")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [go, router])

  if (!story) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <div className="tt-eyebrow justify-center mb-3">Story</div>
          <h1 className="font-display text-2xl font-semibold tracking-tight mb-2">This story has expired</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Stories stay up for 24 hours, then they&apos;re gone for good.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Link
              href={`/u/${username}`}
              className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition-colors hover:bg-secondary"
            >
              View @{username}
            </Link>
            <Link
              href="/feed"
              className="tt-cta rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground"
            >
              Back to feed
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const like = async () => {
    if (!session?.user?.id) {
      router.push(signInHref(pathname))
      return
    }
    if (busy) return
    setBusy(true)
    const wasLiked = likedIds.has(story.id)
    const bump = wasLiked ? -1 : 1
    setLikedIds((s) => {
      const n = new Set(s)
      if (wasLiked) n.delete(story.id)
      else n.add(story.id)
      return n
    })
    setLikeCounts((m) => {
      const n = new Map(m)
      n.set(story.id, Math.max(0, (n.get(story.id) ?? story.counts.likes) + bump))
      return n
    })
    try {
      const res = await fetch("/api/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "LIKE", momentId: story.id }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setLikedIds((s) => {
        const n = new Set(s)
        if (wasLiked) n.add(story.id)
        else n.delete(story.id)
        return n
      })
      setLikeCounts((m) => {
        const n = new Map(m)
        n.set(story.id, Math.max(0, (n.get(story.id) ?? story.counts.likes) - bump))
        return n
      })
      toast("Couldn't update your like", "error")
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    try {
      const res = await fetch(`/api/moments/${story.id}`, { method: "DELETE" })
      if (!res.ok) {
        toast("Couldn't delete this story", "error")
        return
      }
      const rest = list.filter((s) => s.id !== story.id)
      setList(rest)
      if (rest.length === 0) router.push("/feed")
      else setIdx((i) => Math.min(i, rest.length - 1))
    } catch {
      toast("Network error — couldn't delete this story", "error")
    } finally {
      setConfirmDelete(false)
    }
  }

  const isAuthor = session?.user?.id === story.author.id
  const liked = likedIds.has(story.id)
  const likeCount = likeCounts.get(story.id) ?? story.counts.likes
  const atEnd = idx >= list.length - 1

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="tt-eyebrow mb-3">Story</div>
        {/* progress bars */}
        <div className="flex gap-1 mb-3" aria-hidden="true">
          {list.map((s, i) => (
            <span key={s.id} className="h-1 flex-1 rounded-full bg-secondary overflow-hidden">
              <span
                className={cn("block h-full bg-primary", i < idx ? "w-full" : i === idx ? "w-full" : "w-0")}
                style={i === idx ? { transition: `width ${ADVANCE_MS}ms linear` } : undefined}
              />
            </span>
          ))}
        </div>

        <div className="flex items-center justify-between mb-3 gap-2">
          <Link href={`/u/${username}`} className="flex items-center gap-2.5 text-sm font-semibold hover:text-primary min-w-0">
            <Avatar
              src={avatarUrl}
              size="sm"
              alt={`@${username}`}
              className="ring-2 ring-primary/40"
              fallback={<span className="text-primary text-xs font-bold">{username[0]?.toUpperCase()}</span>}
            />
            <span className="min-w-0">
              <span className="block truncate">@{username}</span>
              <span className="block text-xs font-normal text-muted-foreground"><TimeAgo value={story.createdAt} /></span>
            </span>
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs tabular-nums text-muted-foreground" aria-label={`Story ${idx + 1} of ${list.length}`}>
              {idx + 1}/{list.length}
            </span>
            <Link href="/feed" aria-label="Close stories" className="p-1.5 text-muted-foreground hover:text-foreground">
              <X className="w-5 h-5" />
            </Link>
          </div>
        </div>

        <div className="relative rounded-2xl overflow-hidden border border-border/70 bg-card/80">
          {story.images[0] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={story.images[0].url} alt="" className="w-full aspect-[3/4] object-cover bg-secondary" />
          ) : (
            <div className="w-full aspect-[3/4] bg-gradient-to-br from-primary/20 via-secondary to-background flex items-center justify-center p-8">
              <MomentText text={story.content} className="text-center text-lg whitespace-pre-wrap wrap-break-word" />
            </div>
          )}
          {/* tap zones */}
          <button type="button" aria-label="Previous story" onClick={() => go(-1)} className="absolute inset-y-0 left-0 w-1/3" />
          <button type="button" aria-label="Next story" onClick={() => go(1)} className="absolute inset-y-0 right-0 w-1/3" />
        </div>

        {story.images.length > 0 && story.content && (
          <div className="mt-3 rounded-2xl border border-border/70 bg-card/80 px-4 py-3">
            <MomentText text={story.content} className="text-sm whitespace-pre-wrap wrap-break-word" />
          </div>
        )}

        <div className="flex items-center justify-between mt-4">
          <div className="flex gap-2">
            <button type="button" onClick={() => go(-1)} disabled={idx === 0} aria-label="Previous" className="p-2 rounded-full border border-border text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button type="button" onClick={() => go(1)} disabled={atEnd} aria-label="Next" className="p-2 rounded-full border border-border text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={like}
              disabled={busy}
              aria-pressed={liked}
              aria-label={liked ? "Unlike" : "Like"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 transition-colors disabled:opacity-50",
                liked ? "text-destructive border-destructive/40" : "text-muted-foreground hover:text-foreground border-border",
              )}
            >
              {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Heart className={cn("w-5 h-5", liked && "fill-current")} />}
              {likeCount > 0 && <span className="text-xs font-medium tabular-nums">{likeCount}</span>}
            </button>
            {isAuthor && (
              <button type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete story" className="p-2 rounded-full border border-border text-muted-foreground hover:text-destructive">
                <Trash2 className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {atEnd && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            That&apos;s the latest from @{username}
          </p>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this story?"
        description="It will disappear immediately. This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  )
}
