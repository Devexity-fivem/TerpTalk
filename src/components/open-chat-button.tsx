"use client"

import { MessagesSquare } from "lucide-react"
import { useChatPanel } from "@/components/chat-panel"

// Opens the persistent chat panel in place — the same affordance the nav
// and bottom bar use, not a second chat implementation.
export default function OpenChatButton({ className }: { className?: string }) {
  const { openPanel } = useChatPanel()
  return (
    <button
      type="button"
      onClick={openPanel}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      }
    >
      <MessagesSquare className="h-4 w-4" aria-hidden="true" />
      Open chat
    </button>
  )
}
