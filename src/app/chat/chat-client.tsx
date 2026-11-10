"use client"

import { signInHref } from "@/lib/callback-url"
import { Suspense } from "react"
import { useSession } from "next-auth/react"
import { Bot, Leaf, Loader2, MessagesSquare } from "@/lib/icons"
import Link from "next/link"
import ChatRoom from "@/components/chat-room"

const PERKS = [
  {
    icon: MessagesSquare,
    title: "Real-time grow talk",
    body: "Live rooms for questions, harvests, and day-to-day grower chat.",
  },
  {
    icon: Bot,
    title: "@terpbot is in the room",
    body: "Ask for grow help, commands, or a nudge — TerpBot answers in chat.",
  },
  {
    icon: Leaf,
    title: "Rooms unlock as you grow",
    body: "Earn XP in the community to open members-only chat rooms.",
  },
]

export default function ChatClient() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      }
    >
      <ChatInner />
    </Suspense>
  )
}

function ChatInner() {
  const { data: session, status } = useSession()

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="relative flex min-h-[calc(100dvh-4rem)] items-center justify-center overflow-hidden bg-background px-4 py-10">
        {/* Faint journal-grid backdrop, masked to the hero zone */}
        <div className="tt-grid-bg pointer-events-none absolute inset-0" aria-hidden="true" />
        <div className="relative w-full max-w-lg text-center">
          <div className="tt-brand-tile mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl">
            <MessagesSquare className="h-7 w-7 text-primary" aria-hidden="true" />
          </div>
          <p className="tt-eyebrow justify-center">Live chat</p>
          <h1 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">
            Community Chat
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground sm:text-base">
            The room is open — growers trading tips, war stories, and questions
            in real time. Sign in to pull up a seat.
          </p>

          <ul className="mx-auto mt-7 max-w-sm space-y-3 text-left">
            {PERKS.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                  <Icon className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">{title}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">{body}</span>
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href={signInHref("/chat")}
              className="tt-cta inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-primary-foreground transition-all"
            >
              Sign in to chat
            </Link>
            <Link
              href="/feed"
              className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-5 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              Browse the feed first
            </Link>
          </div>
          <p className="mt-6 text-xs text-muted-foreground">
            New to TerpTalk?{" "}
            <Link href={`/auth/signup?callbackUrl=${encodeURIComponent("/chat")}`} className="font-medium text-primary hover:underline">
              Create an account
            </Link>{" "}
            — it takes a minute.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex h-[calc(100dvh-4rem-4rem)] max-w-5xl flex-col px-3 py-3 sm:px-4 sm:py-5 lg:h-[calc(100dvh-4rem)]">
        <ChatRoom />
      </div>
    </div>
  )
}
