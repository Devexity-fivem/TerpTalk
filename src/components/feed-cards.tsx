"use client"

// Feed item cards — the renderers for the canonical feed item union.
// Used by the server-rendered first page (via FeedList) and by
// client-fetched continuation pages, so every card must be client-safe
// and date-tolerant (API pages arrive JSON-serialized).
import Link from "next/link"
import { Leaf, MessageSquare, Users, Heart } from "@/lib/icons"
import ProfileCard from "@/components/ui/profile-card"
import Tooltip from "@/components/ui/tooltip"
import TimeAgo from "@/components/ui/time-ago"
import RoleBadge from "@/components/role-badge"
import type { FeedUpdateRow, FeedThreadRow, FeedHarvestRow } from "@/lib/feed"

// ─── Threads ──────────────────────────────────────────────────────

export function FeedThreadCard({
  thread: t,
  href,
  variant = "compact",
  unread = false,
}: {
  thread: FeedThreadRow
  href: string
  variant?: "compact" | "list"
  unread?: boolean
}) {
  if (variant === "list") {
    return (
      <Link href={href} className="block p-4 hover:bg-secondary/50 transition-colors">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex min-w-0 items-center gap-1.5 font-semibold text-sm">
                <ProfileCard
                  username={t.author.profile?.username}
                  name={t.author.profile?.username || t.author.name}
                  avatarUrl={t.author.image}
                  xp={t.author.profile?.xp}
                  publicMilestoneOptOut={t.author.profile?.publicMilestoneOptOut}
                  size="sm"
                  linked={false}
                />
                <RoleBadge role={t.author.role} />
              </span>
            </div>
            <h3 className="font-medium mb-1 flex items-center gap-2">
              {unread && (
                <Tooltip content="New activity" className="shrink-0">
                  <span className="h-2 w-2 rounded-full bg-primary" role="img" aria-label="Unread" />
                </Tooltip>
              )}
              {t.title}
            </h3>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> {t.category.name}</span>
              <span>•</span>
              <span>{t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}</span>
              <span>•</span>
              <span><TimeAgo value={t.createdAt} /></span>
            </div>
          </div>
        </div>
      </Link>
    )
  }

  return (
    <Link href={href} className="block p-4 hover:bg-secondary/50 transition-colors">
      <div className="flex items-start gap-3">
        <div className="shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
          <MessageSquare className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm mb-1 flex items-center gap-2">
            {unread && (
              <Tooltip content="New activity" className="shrink-0">
                <span className="h-2 w-2 rounded-full bg-primary" role="img" aria-label="Unread" />
              </Tooltip>
            )}
            {t.title}
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <ProfileCard
              username={t.author.profile?.username}
              name={t.author.profile?.username || t.author.name}
              avatarUrl={t.author.image}
              xp={t.author.profile?.xp}
              publicMilestoneOptOut={t.author.profile?.publicMilestoneOptOut}
              size="sm"
              linked={false}
            />
            <span>•</span>
            <span>{t.category.name}</span>
            <span>•</span>
            <span>{t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}</span>
            <span>•</span>
            <span><TimeAgo value={t.createdAt} /></span>
          </div>
        </div>
      </div>
    </Link>
  )
}

// ─── Diary updates ────────────────────────────────────────────────

export function FeedUpdateCard({
  update: u,
  href,
  variant = "compact",
}: {
  update: FeedUpdateRow
  href: string
  variant?: "compact" | "card"
}) {
  if (variant === "card") {
    return (
      <Link href={href} className="block p-4 hover:bg-secondary/50 transition-colors">
        <div className="flex items-start gap-3">
          {u.images[0]?.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={u.images[0].url} alt="" loading="lazy" decoding="async" className="w-16 h-16 rounded-xl object-cover shrink-0" />
          ) : (
            <div className="shrink-0 w-16 h-16 bg-primary/10 rounded-xl flex items-center justify-center">
              <Leaf className="w-6 h-6 text-primary" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="flex min-w-0 items-center gap-1.5 text-sm">
                <ProfileCard
                  username={u.author.profile?.username}
                  name={u.author.profile?.username || u.author.name}
                  avatarUrl={u.author.image}
                  xp={u.author.profile?.xp}
                  publicMilestoneOptOut={u.author.profile?.publicMilestoneOptOut}
                  size="sm"
                  linked={false}
                />
              </span>
              <span className="text-xs text-muted-foreground ml-auto shrink-0">
                <TimeAgo value={u.createdAt} />
              </span>
            </div>
            <h3 className="font-medium text-sm mb-0.5">{u.title}</h3>
            <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{u.content}</p>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Leaf className="w-3 h-3" />
              <span className="truncate">{u.diary.title}</span>
            </div>
          </div>
        </div>
      </Link>
    )
  }

  // Anchored comments only exist/render on PUBLIC grows — never surface
  // a count for a followed UNLISTED grow.
  const commentCount = u.diary.visibility === "PUBLIC" ? u._count.comments : 0
  return (
    <Link href={href} className="block p-4 hover:bg-secondary/50 transition-colors">
      <div className="flex items-start gap-3">
        {u.images[0]?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={u.images[0].url} alt="" loading="lazy" decoding="async" className="w-10 h-10 rounded-lg object-cover shrink-0" />
        ) : (
          <div className="shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
            <Leaf className="w-5 h-5 text-primary" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm mb-1">{u.title}</div>
          <p className="text-xs text-muted-foreground line-clamp-1 mb-1">{u.content}</p>
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <span className="truncate">{u.diary.title}</span>
            <span>•</span>
            <span><TimeAgo value={u.createdAt} /></span>
            {u._count.reactions > 0 && (
              <span className="inline-flex items-center gap-0.5" aria-label={`${u._count.reactions} reactions`}>
                <Heart className="w-3 h-3" /> {u._count.reactions}
              </span>
            )}
            <span className="inline-flex items-center gap-0.5 text-primary" aria-label={commentCount > 0 ? `${commentCount} comments` : "Comment"}>
              <MessageSquare className="w-3 h-3" /> {commentCount > 0 ? commentCount : "Comment"}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

// ─── Harvests ─────────────────────────────────────────────────────

export function FeedHarvestCard({
  diary: h,
  href,
  variant = "compact",
  viewerId,
}: {
  diary: FeedHarvestRow
  href: string
  variant?: "compact" | "tile"
  viewerId?: string | null
}) {
  const thumb = h.updates[0]?.images[0]?.url
  const dayCount = h.harvestedAt && h.startDate
    ? Math.max(0, Math.floor((new Date(h.harvestedAt).getTime() - new Date(h.startDate).getTime()) / 86400000))
    : null
  const showYield = h.yieldAmount != null && (!h.yieldPrivate || h.authorId === viewerId)

  if (variant === "tile") {
    return (
      <Link href={href} className="group flex flex-col rounded-xl border border-border/70 hover:border-primary/40 overflow-hidden transition-all">
        <div className="relative h-32 bg-secondary">
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Leaf className="w-8 h-8 text-muted-foreground" />
            </div>
          )}
          <div className="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/60 to-transparent px-3 py-2">
            {h.strain && (
              <span className="text-[11px] font-medium text-white/90">{h.strain}</span>
            )}
          </div>
        </div>
        <div className="p-3 flex-1">
          <h3 className="font-medium text-sm mb-1 line-clamp-1 group-hover:text-primary transition-colors">{h.title}</h3>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
            <ProfileCard
              username={h.author.profile?.username}
              name={h.author.profile?.username || h.author.name}
              avatarUrl={h.author.image}
              xp={h.author.profile?.xp}
              publicMilestoneOptOut={h.author.profile?.publicMilestoneOptOut}
              size="sm"
              linked={false}
            />
          </div>
          <div className="flex items-center gap-3 text-xs">
            {dayCount != null && (
              <span className="text-muted-foreground">{dayCount}d grow</span>
            )}
            {showYield && (
              <span className="font-medium text-success">{h.yieldAmount} {h.yieldUnit || "g"}</span>
            )}
            {h.harvestRating != null && (
              <span className="font-medium text-warning">{h.harvestRating}/10</span>
            )}
          </div>
        </div>
      </Link>
    )
  }

  return (
    <Link href={href} className="block p-4 hover:bg-secondary/50 transition-colors">
      <div className="flex items-start gap-3">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" loading="lazy" decoding="async" className="w-16 h-16 rounded-xl object-cover shrink-0" />
        ) : (
          <div className="shrink-0 w-16 h-16 bg-success/10 rounded-xl flex items-center justify-center">
            <Leaf className="w-6 h-6 text-success" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-medium text-success">Harvested</span>
            {h.strain && <span className="text-xs text-muted-foreground truncate">{h.strain}</span>}
          </div>
          <h3 className="font-medium text-sm mb-1">{h.title}</h3>
          <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap">
            <ProfileCard
              username={h.author.profile?.username}
              name={h.author.profile?.username || h.author.name}
              avatarUrl={h.author.image}
              xp={h.author.profile?.xp}
              publicMilestoneOptOut={h.author.profile?.publicMilestoneOptOut}
              size="sm"
              linked={false}
            />
            {dayCount != null && <span>• {dayCount}d</span>}
            {showYield && <span className="text-success font-medium">• {h.yieldAmount} {h.yieldUnit || "g"}</span>}
            {h.harvestRating != null && <span className="text-warning">• {h.harvestRating}/10</span>}
          </div>
        </div>
      </div>
    </Link>
  )
}
