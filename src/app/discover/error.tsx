"use client"

import { useEffect } from "react"
import Link from "next/link"
import { AlertTriangle } from "@/lib/icons"

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Discover error:", error)
  }, [error])

  return (
    <div className="min-h-[70vh] flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="bg-destructive/10 p-5 rounded-2xl ring-1 ring-destructive/30 mb-6">
        <AlertTriangle className="w-12 h-12 text-destructive" />
      </div>
      <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight mb-3">Discover didn&apos;t load</h1>
      <p className="text-muted-foreground max-w-md mb-8">
        Something went wrong while loading this feed. Try again, or head back to the community.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={reset}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium rounded-lg bg-card border border-border hover:bg-secondary transition-colors"
        >
          Back to home
        </Link>
      </div>
    </div>
  )
}
