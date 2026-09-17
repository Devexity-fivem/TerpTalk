"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { useChatPanel } from "@/components/chat-panel"

// Footer "Chat" — same session-aware behavior as the top nav and bottom
// bar: signed-in members open the persistent panel in place instead of
// navigating away; guests still reach /chat's sign-in wall. The href stays
// a real link either way.
export default function FooterChatLink({ className }: { className?: string }) {
  const { data: session } = useSession()
  const { openPanel } = useChatPanel()
  return (
    <Link
      href="/chat"
      className={className}
      onClick={
        session
          ? (e) => {
              e.preventDefault()
              openPanel()
            }
          : undefined
      }
    >
      Chat
    </Link>
  )
}
