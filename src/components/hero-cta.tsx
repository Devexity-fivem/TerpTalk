"use client"

import Link from "next/link"
import { useSession } from "next-auth/react"
import { PenLine, ArrowRight, Sprout, UserPlus } from "lucide-react"

// Session-aware hero actions — the page shell is prerendered, so the
// signed-out vs signed-in choice happens client-side.
export default function HeroCta() {
  const { status } = useSession()
  const authenticated = status === "authenticated"

  return (
    <>
      <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-6">
        {authenticated ? (
          <Link
            href="/forum/new"
            className="tt-cta inline-flex items-center justify-center gap-2 text-primary-foreground px-8 py-3 rounded-full font-semibold transition-all"
          >
            <PenLine className="w-4 h-4" />
            Start a discussion
          </Link>
        ) : (
          <Link
            href="/auth/signup"
            className="tt-cta inline-flex items-center justify-center gap-2 text-primary-foreground px-8 py-3 rounded-full font-semibold transition-all"
          >
            <UserPlus className="w-4 h-4" />
            Join the community
          </Link>
        )}
        <Link
          href="/forum"
          className="inline-flex items-center justify-center gap-2 px-8 py-3 rounded-full font-semibold border border-border/70 bg-card/70 backdrop-blur-sm hover:bg-card hover:border-primary/40 transition-all"
        >
          Browse the forums
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-center lg:justify-start gap-2 sm:gap-3">
        <Link
          href={authenticated ? "/diaries/new" : "/about"}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-card border border-border hover:border-primary/40 hover:bg-secondary transition-colors"
        >
          <Sprout className="w-4 h-4" />
          {authenticated ? "New diary" : "What is TerpTalk?"}
        </Link>
        {authenticated && (
          <Link
            href="/feed"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-card border border-border hover:border-primary/40 hover:bg-secondary transition-colors"
          >
            Your feed
          </Link>
        )}
      </div>
    </>
  )
}
