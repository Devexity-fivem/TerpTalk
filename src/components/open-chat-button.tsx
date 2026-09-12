"use client"

import { signInHref } from "@/lib/callback-url"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { MessageCircle } from "lucide-react"
import { cn } from "@/lib/utils"

interface OpenChatButtonProps {
  className?: string
}

export function OpenChatButton({ className }: OpenChatButtonProps) {
  const { data: session } = useSession()
  const router = useRouter()

  const openChat = () => {
    if (session) {
      window.dispatchEvent(new CustomEvent("tt-open-chat"))
    } else {
      router.push(signInHref(window.location.pathname + window.location.search))
    }
  }

  return (
    <button
      onClick={openChat}
      className={cn(
        "inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline",
        className
      )}
    >
      <MessageCircle className="w-4 h-4" />
      Live community chat
    </button>
  )
}
