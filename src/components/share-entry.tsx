"use client"

// Inline composer entry — the social-platform "share box". A prompt
// button opens the unified ShareComposer; quick chips preselect the
// real content types so members can share an update, photo, or question
// without navigating into the forum first. Guests get the composer's
// sign-in gate, same as the header Create button.
import { useSession } from "next-auth/react"
import { Image as ImageIcon, HelpCircle, Sprout, MessageSquare, Clock } from "@/lib/icons"
import { Avatar } from "@/components/ui/avatar"
import { useShareComposer } from "@/components/share-composer"
import type { FeedableDiary } from "@/components/feed-share-button"

interface ShareEntryProps {
  activeDiaries?: FeedableDiary[]
}

const chipCls =
  "inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"

export default function ShareEntry({ activeDiaries = [] }: ShareEntryProps) {
  const { data: session } = useSession()
  const composer = useShareComposer()
  // Exactly one live grow → one-tap prefill. More than one → the composer
  // opens its own-diary picker (it refetches, so this take:2 list just
  // decides the label). None → the start-a-diary path.
  const live = activeDiaries.filter((d) => !d.harvested)
  const preferred = live.length === 1 ? live[0] : null

  return (
    <div className="tt-spotlight rounded-2xl border border-border/70 bg-card/80 p-3 sm:p-4">
      <div className="flex items-center gap-3">
        <Avatar
          src={session?.user?.image}
          alt={session?.user?.name ? `${session.user.name}'s avatar` : "Your avatar"}
          size="md"
          className="hidden sm:flex"
        />
        <button
          type="button"
          onClick={() => composer.open()}
          className="min-h-11 flex-1 rounded-full border border-border/70 bg-secondary/60 px-4 text-left text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-secondary"
          aria-label="Share something"
        >
          What&apos;s growing in your garden?
        </button>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1 border-t border-border/50 pt-2.5 sm:pl-13">
        <button type="button" onClick={() => composer.open({ type: "moment" })} className={chipCls}>
          <ImageIcon className="h-4 w-4 text-primary" aria-hidden="true" />
          Post or photo
        </button>
        <button type="button" onClick={() => composer.open({ type: "story" })} className={chipCls}>
          <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
          Story
        </button>
        {live.length > 0 ? (
          <button
            type="button"
            onClick={() =>
              composer.open({
                type: "grow-update",
                ...(preferred
                  ? {
                      diary: {
                        id: preferred.id,
                        title: preferred.title,
                        stage: preferred.stage,
                        harvested: preferred.harvested,
                        own: true,
                      },
                    }
                  : {}),
              })
            }
            className={chipCls}
          >
            <Sprout className="h-4 w-4 text-primary" aria-hidden="true" />
            Log to diary
          </button>
        ) : (
          <button
            type="button"
            onClick={() => composer.open({ type: "diary" })}
            className={chipCls}
          >
            <Sprout className="h-4 w-4 text-primary" aria-hidden="true" />
            Start a diary
          </button>
        )}
        <button type="button" onClick={() => composer.open({ type: "question" })} className={chipCls}>
          <HelpCircle className="h-4 w-4 text-primary" aria-hidden="true" />
          Ask a question
        </button>
        <button
          type="button"
          onClick={() => composer.open({ type: "discussion" })}
          className={chipCls}
        >
          <MessageSquare className="h-4 w-4 text-primary" aria-hidden="true" />
          Discussion
        </button>
      </div>
    </div>
  )
}
