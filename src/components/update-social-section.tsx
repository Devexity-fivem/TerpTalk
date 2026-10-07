import Link from "next/link"
import DiaryReactions from "@/components/diary-reactions"
import UpdateCommentForm from "@/components/update-comment-form"
import PostContent from "@/components/post-content"
import PostActions from "@/components/post-actions"
import ProfileCard from "@/components/ui/profile-card"
import TimeAgo from "@/components/ui/time-ago"
import type { UpdateSocial } from "@/lib/update-social"

// Social Grow Updates — the interaction row under one grow update:
// reactions (existing DiaryReactions control, update target), the newest
// few anchored comments (existing PostContent + PostActions, so report /
// edit / delete / moderation controls are the forum's own), and the inline
// composer. Server-rendered and passed into the client update card as a
// slot. Reactor identities never leave the server: other members' ids are
// scrubbed exactly as on the thread page.
export default function UpdateSocialSection({
  updateId,
  diaryId,
  diaryHref,
  social,
  commentable,
  interactive,
  threadId,
  threadSlug,
  viewerId,
}: {
  updateId: string
  diaryId: string
  diaryHref: string
  social: UpdateSocial
  /** grow is PUBLIC — comments exist only on public grows */
  commentable: boolean
  /** viewer may interact (no block in either direction with the grower) */
  interactive: boolean
  threadId: string | null
  threadSlug: string | null
  viewerId?: string | null
}) {
  const hidden = social.commentCount - social.comments.length
  const reactionTotal = Object.values(social.reactionCounts).reduce((a, b) => a + b, 0)

  return (
    <div className="space-y-2" data-update-social={updateId}>
      <div className="flex flex-wrap items-center gap-1.5">
        {interactive ? (
          <DiaryReactions
            diaryUpdateId={updateId}
            initialCounts={social.reactionCounts}
            initialMine={social.myReaction}
          />
        ) : (
          reactionTotal > 0 && (
            <span className="text-xs text-muted-foreground">
              {reactionTotal} reaction{reactionTotal === 1 ? "" : "s"}
            </span>
          )
        )}
        {commentable && interactive && (
          <UpdateCommentForm
            diaryId={diaryId}
            diaryHref={diaryHref}
            updateId={updateId}
            threadId={threadId}
            commentCount={social.commentCount}
          />
        )}
        {commentable && !interactive && social.commentCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {social.commentCount} comment{social.commentCount === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {commentable && social.comments.length > 0 && (
        <ul className="space-y-2 pl-3 border-l-2 border-border/60" aria-label="Comments on this update">
          {social.comments.map((c) => (
            <li key={c.id} id={`post-${c.id}`} className="text-sm">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-0.5">
                <ProfileCard
                  username={c.author.profile?.username}
                  name={c.author.profile?.username || c.author.name}
                  avatarUrl={c.author.image}
                  xp={c.author.profile?.xp ?? 0}
                  publicMilestoneOptOut={c.author.profile?.publicMilestoneOptOut}
                  size="sm"
                />
                <TimeAgo value={c.createdAt} />
                {c.edited && <span>(edited)</span>}
              </div>
              <PostContent content={c.content} authorRole={c.author.role} pagePath={diaryHref} />
              <PostActions
                postId={c.id}
                authorId={c.author.id}
                initialContent={c.content}
                currentUserId={viewerId ?? undefined}
                reactions={c.reactions.map((r) => ({ userId: r.userId === viewerId ? r.userId : "", type: r.type }))}
              />
            </li>
          ))}
        </ul>
      )}

      {commentable && hidden > 0 && threadSlug && (
        <Link href={`/forum/thread/${threadSlug}`} className="inline-block text-xs text-primary hover:underline">
          View all {social.commentCount} comments in the grow discussion
        </Link>
      )}
    </div>
  )
}
