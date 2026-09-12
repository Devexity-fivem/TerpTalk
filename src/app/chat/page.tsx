"use client"

import { signInHref } from "@/lib/callback-url"
import { Suspense } from "react"
import { useSession } from "next-auth/react"
import { Loader2, MessageCircle } from "lucide-react"
import Link from "next/link"
import ChatRoom from "@/components/chat-room"

export default function ChatPage() {
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
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <MessageCircle className="w-10 h-10 text-primary mx-auto mb-3" />
          <h1 className="text-xl font-bold mb-2">Community Chat</h1>
          <p className="text-sm text-muted-foreground mb-4">
            Sign in to join the live conversation — and meet TerpBot, our community assistant.
          </p>
          <Link
            href={signInHref("/chat")}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Sign in to chat
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-4 sm:py-6 h-[calc(100dvh-4rem-4rem)] lg:h-[calc(100dvh-4rem)] flex flex-col">
        <ChatRoom />
      </div>
    </div>
  )
}
