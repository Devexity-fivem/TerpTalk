"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"

export default function JoinButton() {
  const { status } = useSession()
  const authenticated = status === "authenticated"

  return (
    <Link
      href={authenticated ? "/feed" : "/auth/signup"}
      className="border border-border bg-card/60 backdrop-blur px-8 py-3 rounded-xl font-semibold hover:bg-secondary transition-colors text-center"
    >
      {authenticated ? "Your Feed" : "Join Community"}
    </Link>
  )
}
