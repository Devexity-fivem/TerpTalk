"use client"

import { useSession } from "next-auth/react"
import { signInHref } from "@/lib/callback-url"
import Link from "next/link"
import { MessagesSquare } from "lucide-react"
import { useChatPanel } from "@/components/chat-panel"

interface ChatTeaserProps {
  onlineCount: number
  roomName: string
  roomSlug: string
  latestAt: string | null
}

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// Homepage live-chat teaser — proves the room is alive using public-room
// metadata only (name + last activity + site-wide online count). No message
// content, no gated/private room data, no Pusher subscription.
export default function ChatTeaser({ onlineCount, roomName, roomSlug, latestAt }: ChatTeaserProps) {
  const { data: session } = useSession()
  const { openPanel } = useChatPanel()

  const body = (
    <>
      <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <MessagesSquare className="h-4 w-4 text-primary" aria-hidden="true" />
        <span
          className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-green-400 ring-2 ring-card"
          aria-hidden="true"
        />
      </span>
      <span className="min-w-0 text-left">
        <span className="block font-medium text-foreground">
          Live chat
          {onlineCount > 0 && (
            <span className="font-normal text-muted-foreground"> · {onlineCount} online</span>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {latestAt ? `Active ${timeAgo(latestAt)} in ${roomName}` : `Say hi in ${roomName}`}
        </span>
      </span>
    </>
  )

  // Signed-in: primary CTA opens the persistent panel in place; a
  // secondary link keeps the dedicated /chat page one tap away.
  if (session) {
    return (
      <div className="inline-flex max-w-full items-center gap-2.5 rounded-2xl border border-border/70 bg-card/80/80 px-4 py-2.5 text-sm shadow-sm transition-colors hover:border-primary/40">
        {body}
        <button
          onClick={openPanel}
          className="shrink-0 pl-1 text-xs font-medium text-primary hover:underline"
        >
          Open chat
        </button>
        <Link
          href={`/chat?room=${encodeURIComponent(roomSlug)}`}
          className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          Full chat
        </Link>
      </div>
    )
  }

  return (
    <Link
      href={signInHref("/chat")}
      className="group inline-flex max-w-full items-center gap-2.5 rounded-2xl border border-border/70 bg-card/80/80 px-4 py-2.5 text-sm shadow-sm transition-colors hover:border-primary/40"
    >
      {body}
      <span className="shrink-0 pl-1 text-xs font-medium text-primary group-hover:underline">
        Sign in
      </span>
    </Link>
  )
}
