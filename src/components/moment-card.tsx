"use client"

// MomentCard — renders a MomentDTO (lib/moments.ts) for the feed, profile
// wall, hashtag pages and the post page. Client-safe and date-tolerant
// (continuation pages arrive JSON-serialized). Actions on a pure repost
// target the original post; the server re-checks every permission.
import { useState } from "react"
import Link from "next/link"
import { useRouter, usePathname } from "next/navigation"
import { useSession } from "next-auth/react"
import { Heart, MessageCircle, Repeat2, Quote, Share2, Users, Sprout, Leaf, Trash2, Clock } from "@/lib/icons"
import ProfileCard from "@/components/ui/profile-card"
import TimeAgo from "@/components/ui/time-ago"
import RoleBadge from "@/components/role-badge"
import MomentText from "@/components/moment-text"
import ReportButton from "@/components/report-button"
import ConfirmDialog from "@/components/ui/confirm-dialog"
import { useShareComposer } from "@/components/share-composer"
import { useToast } from "@/components/ui/toast"
import { signInHref } from "@/lib/callback-url"
import { cn } from "@/lib/utils"
import type { MomentCore, MomentDTO } from "@/lib/moments"

function Images({ images, href, linked }: { images: MomentCore["images"]; href: string; linked: boolean }) {
  if (images.length === 0) return null
  const grid = images.length === 1 ? "grid-cols-1" : "grid-cols-2"
  const body = (
    <div className={cn("grid gap-1 mt-2 rounded-xl overflow-hidden border border-border/60", grid)}>
      {images.map((img, i) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={img.id}
          src={img.url}
          alt=""
          loading="lazy"
          decoding="async"
          className={cn(
            "w-full object-cover bg-secondary",
            images.length === 1 ? "max-h-[28rem]" : "aspect-square",
            images.length === 3 && i === 0 && "row-span-2 h-full aspect-auto",
          )}
        />
      ))}
    </div>
  )
  return linked ? <Link href={href} aria-label="Open post">{body}</Link> : body
}

function Chips({ m }: { m: MomentCore }) {
  if (!m.grow && !m.strain) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {m.grow && (
        <Link href={m.grow.href} className="inline-flex items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-xs font-medium hover:bg-primary/15">
          <Sprout className="w-3 h-3" /> {m.grow.title}
          <span className="opacity-70">· {m.grow.stage.toLowerCase()}</span>
        </Link>
      )}
      {m.strain && (
        <Link href={m.strain.href} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium hover:bg-secondary/80">
          <Leaf className="w-3 h-3" /> {m.strain.name}
        </Link>
      )}
    </div>
  )
}

function Byline({ m, compact = false }: { m: MomentCore; compact?: boolean }) {
  return (
    <div className="flex items-center gap-2 min-w-0 text-sm">
      <span className="flex min-w-0 items-center gap-1.5 font-semibold">
        <ProfileCard
          username={m.author.profile?.username}
          name={m.author.profile?.username || m.author.name}
          avatarUrl={m.author.image}
          xp={m.author.profile?.xp}
          publicMilestoneOptOut={m.author.profile?.publicMilestoneOptOut}
          size="sm"
        />
        {!compact && <RoleBadge role={m.author.role} />}
      </span>
      <Link href={m.href} className="text-xs text-muted-foreground hover:underline shrink-0">
        <TimeAgo value={m.createdAt} />
      </Link>
      {m.visibility === "FOLLOWERS" && (
        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground shrink-0" title="Followers only">
          <Users className="w-3 h-3" /> <span className="sr-only">Followers only</span>
        </span>
      )}
      {m.kind === "STORY" && (
        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
          <Clock className="w-3 h-3" /> Story
        </span>
      )}
    </div>
  )
}

/** Embedded original inside a quote post. */
function QuotedCard({ m }: { m: MomentCore }) {
  return (
    <div className="mt-2 rounded-xl border border-border/70 p-3 hover:bg-secondary/40 transition-colors">
      <Byline m={m} compact />
      {m.content && (
        <Link href={m.href} className="block mt-1">
          <MomentText text={m.content} className="text-sm whitespace-pre-wrap wrap-break-word line-clamp-4" />
        </Link>
      )}
      <Images images={m.images.slice(0, 1)} href={m.href} linked />
    </div>
  )
}

export default function MomentCard({
  moment,
  variant = "feed",
  onDeleted,
}: {
  moment: MomentDTO
  variant?: "feed" | "detail"
  onDeleted?: () => void
}) {
  const { data: session } = useSession()
  const router = useRouter()
  const pathname = usePathname()
  const composer = useShareComposer()
  const { toast } = useToast()
  const viewerId = session?.user?.id ?? null

  // A pure repost renders (and acts on) the original.
  const target: MomentCore | null = moment.isRepost ? moment.repostOf : moment
  const [liked, setLiked] = useState(target?.liked ?? false)
  const [likes, setLikes] = useState(target?.counts.likes ?? 0)
  const [reposted, setReposted] = useState(target?.reposted ?? false)
  const [reposts, setReposts] = useState(target?.counts.reposts ?? 0)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [gone, setGone] = useState(false)

  if (gone) return null
  if (!target) {
    return (
      <div className="p-4 text-sm text-muted-foreground">This post is no longer available.</div>
    )
  }

  const needAuth = () => {
    if (viewerId) return false
    router.push(signInHref(pathname))
    return true
  }

  const toggleLike = async () => {
    if (needAuth() || busy) return
    setBusy(true)
    const prev = { liked, likes }
    setLiked(!liked)
    setLikes(likes + (liked ? -1 : 1))
    try {
      const res = await fetch("/api/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "LIKE", momentId: target.id }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setLiked(prev.liked)
      setLikes(prev.likes)
      toast("Couldn't update your like", "error")
    } finally {
      setBusy(false)
    }
  }

  const toggleRepost = async () => {
    if (needAuth() || busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/moments/${target.id}/repost`, { method: "POST" })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(d.error)
      setReposted(d.reposted)
      setReposts(d.reposts)
      toast(d.reposted ? "Reposted to your followers" : "Repost removed", "success")
      if (!d.reposted && moment.isRepost && moment.author.id === viewerId) setGone(true)
    } catch (e) {
      toast((e as Error).message || "Couldn't repost", "error")
    } finally {
      setBusy(false)
    }
  }

  const quote = () => {
    if (needAuth()) return
    composer.open({
      type: "moment",
      quote: {
        id: target.id,
        author: target.author.profile?.username ?? "member",
        excerpt: target.content.slice(0, 200) || "Photo post",
      },
    })
  }

  const share = async () => {
    const url = `${window.location.origin}${target.href}`
    try {
      if (navigator.share) await navigator.share({ url })
      else {
        await navigator.clipboard.writeText(url)
        toast("Link copied", "success")
      }
    } catch {
      /* dismissed */
    }
  }

  const remove = async () => {
    try {
      const res = await fetch(`/api/moments/${moment.id}`, { method: "DELETE" })
      if (!res.ok) {
        toast("Couldn't delete this post", "error")
        return
      }
      toast("Post deleted", "success")
      setGone(true)
      onDeleted?.()
    } catch {
      toast("Network error — couldn't delete this post", "error")
    } finally {
      setConfirmDelete(false)
    }
  }

  const ownRow = viewerId === moment.author.id
  const repostable = target.kind === "POST" && target.visibility === "PUBLIC"
  const action = "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors min-h-9"

  return (
    <article className={cn("p-4", variant === "feed" && "hover:bg-secondary/20 transition-colors")} aria-label={`Post by ${target.author.profile?.username ?? "member"}`}>
      {moment.isRepost && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
          <Repeat2 className="w-3.5 h-3.5" />
          <Link href={`/u/${moment.author.profile?.username ?? ""}`} className="font-medium hover:underline">
            @{moment.author.profile?.username}
          </Link>
          reposted
        </div>
      )}
      <Byline m={target} />
      {target.content && (
        variant === "feed"
          ? <MomentText text={target.content} className="mt-1.5 whitespace-pre-wrap wrap-break-word text-sm leading-relaxed line-clamp-[12]" />
          : <MomentText text={target.content} className="mt-2 whitespace-pre-wrap wrap-break-word text-base leading-relaxed" />
      )}
      <Images images={target.images} href={target.href} linked={variant === "feed"} />
      {!moment.isRepost && moment.repostOf && <QuotedCard m={moment.repostOf} />}
      {!moment.isRepost && moment.repostUnavailable && (
        <div className="mt-2 rounded-xl border border-dashed border-border p-3 text-xs text-muted-foreground">
          The original post is no longer available.
        </div>
      )}
      <Chips m={target} />

      <div className="flex flex-wrap items-center gap-1 mt-3 -ml-2.5">
        <button type="button" onClick={toggleLike} aria-pressed={liked} aria-label={liked ? "Unlike" : "Like"} className={cn(action, liked && "text-destructive")}>
          <Heart className={cn("w-4 h-4", liked && "fill-current")} /> <span className="tabular-nums">{likes > 0 ? likes : ""}</span>
        </button>
        {target.kind === "POST" && (
          <Link href={`${target.href}#comments`} className={action} aria-label={`${target.counts.comments} comments`}>
            <MessageCircle className="w-4 h-4" /> <span className="tabular-nums">{target.counts.comments > 0 ? target.counts.comments : ""}</span>
          </Link>
        )}
        {repostable && (
          <button type="button" onClick={toggleRepost} aria-pressed={reposted} aria-label={reposted ? "Undo repost" : "Repost"} className={cn(action, reposted && "text-primary")}>
            <Repeat2 className="w-4 h-4" /> <span className="tabular-nums">{reposts > 0 ? reposts : ""}</span>
          </button>
        )}
        {repostable && (
          <button type="button" onClick={quote} aria-label="Quote post" className={action}>
            <Quote className="w-4 h-4" />
          </button>
        )}
        <button type="button" onClick={share} aria-label="Share link" className={action}>
          <Share2 className="w-4 h-4" />
        </button>
        <span className="ml-auto flex items-center gap-1">
          {ownRow && !moment.isRepost && (
            <button type="button" onClick={() => setConfirmDelete(true)} aria-label="Delete post" className={action}>
              <Trash2 className="w-4 h-4" />
            </button>
          )}
          {!moment.isRepost && <ReportButton type="MOMENT" targetId={moment.id} authorId={moment.author.id} />}
        </span>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this post?"
        description="It will be removed from feeds and your profile. This can't be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />
    </article>
  )
}
