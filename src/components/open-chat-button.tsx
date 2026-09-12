"use client"

import { signInHref } from "@/lib/callback-url"

import { useSession } from "next-auth/react"
import { MessageCircle } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

interface OpenChatButtonProps {
  className?: string
}

export function OpenChatButton({ className }: OpenChatButtonProps) {
  const { data: session } = useSession()
  const href = session ? "/chat" : signInHref("/chat")

  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline",
        className
      )}
    >
      <MessageCircle className="w-4 h-4" />
      Live community chat
    </Link>
  )
}
