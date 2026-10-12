"use client"

import { useSession } from "next-auth/react"
import { Sprout, PenLine, Loader2 } from "@/lib/icons"
import { useShareComposer } from "@/components/share-composer"
import { signInHref } from "@/lib/callback-url"
import { useRouter } from "next/navigation"

export interface FeedableDiary {
  id: string
  title: string
  stage: string
  harvested: boolean
}

interface FeedShareButtonProps {
  activeDiaries: FeedableDiary[]
}

export default function FeedShareButton({ activeDiaries }: FeedShareButtonProps) {
  const { data: session, status } = useSession()
  const composer = useShareComposer()
  const router = useRouter()

  if (status === "loading") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-medium text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </span>
    )
  }

  if (!session) {
    return (
      <button
        onClick={() => router.push(signInHref("/feed"))}
        className="tt-cta inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all"
        aria-label="Sign in to share something"
      >
        <PenLine className="h-4 w-4" />
        Share something
      </button>
    )
  }

  const preferred = activeDiaries[0]

  if (preferred) {
    return (
      <button
        onClick={() =>
          composer.open({
            type: "grow-update",
            diary: {
              id: preferred.id,
              title: preferred.title,
              stage: preferred.stage,
              harvested: preferred.harvested,
              own: true,
            },
          })
        }
        className="tt-cta inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all"
        aria-label="Share a grow update"
      >
        <Sprout className="h-4 w-4" />
        Share a grow update
      </button>
    )
  }

  return (
    <button
      onClick={() => composer.open({ type: "discussion" })}
      className="tt-cta inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all"
      aria-label="Share something — start a diary or choose another type"
    >
      <PenLine className="h-4 w-4" />
      Share something
    </button>
  )
}
