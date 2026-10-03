"use client"

import { useEffect, useState } from "react"
import { X, Megaphone } from "@/lib/icons"
import Link from "next/link"
import type { SiteAnnouncement } from "@/lib/announcement"

function bannerKey(a: SiteAnnouncement) {
  return `terptalk-banner-${a.title}-${a.content}`
}

// Server-rendered from the root layout — the announcement payload arrives
// as a prop, so this component makes no client API request.
export default function AnnouncementBanner({ announcement }: { announcement: SiteAnnouncement }) {
  const [dismissed, setDismissed] = useState(true)

  // localStorage read is deferred to a microtask so no setState runs
  // synchronously inside the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!announcement.enabled || !(announcement.title || announcement.content)) return
    queueMicrotask(() => {
      setDismissed(typeof window !== "undefined" && localStorage.getItem(bannerKey(announcement)) === "1")
    })
  }, [announcement])

  if (!announcement.enabled || dismissed) return null

  const dismiss = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(bannerKey(announcement), "1")
    }
    setDismissed(true)
  }

  const containerClass = "ml-2 underline font-medium hover:text-warning"

  return (
    <div className="bg-amber-500/10 text-warning border-b border-amber-500/20 px-4 py-2.5">
      <div className="max-w-6xl mx-auto flex items-start gap-3">
        <Megaphone className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1 text-sm">
          {announcement.title && <span className="font-semibold mr-1">{announcement.title}</span>}
          {announcement.content && <span className="text-warning">{announcement.content}</span>}
          {announcement.link && (
            <Link href={announcement.link} className={containerClass}>
              Learn more
            </Link>
          )}
        </div>
        <button onClick={dismiss} className="shrink-0 p-1 hover:bg-amber-500/20 rounded" aria-label="Dismiss announcement">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
