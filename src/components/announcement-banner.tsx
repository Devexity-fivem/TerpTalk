"use client"

import { useEffect, useState } from "react"
import { X, Megaphone } from "lucide-react"
import Link from "next/link"

interface Announcement {
  enabled: boolean
  title?: string | null
  content?: string | null
  link?: string
}

function bannerKey(a: Announcement) {
  return `terptalk-banner-${a.title}-${a.content}`
}

export default function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => {
      fetch("/api/settings/announcement")
        .then((res) => (res.ok ? res.json() : { enabled: false }))
        .then((d: Announcement) => {
          setAnnouncement(d)
          if (d.enabled && (d.title || d.content)) {
            const key = bannerKey(d)
            setDismissed(typeof window !== "undefined" && localStorage.getItem(key) === "1")
          } else {
            setDismissed(true)
          }
        })
    }, 0)
    return () => clearTimeout(t)
  }, [])

  if (!announcement?.enabled || dismissed) return null

  const dismiss = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem(bannerKey(announcement), "1")
    }
    setDismissed(true)
  }

  const containerClass = "ml-2 underline font-medium hover:text-amber-700"

  return (
    <div className="bg-amber-500/10 text-amber-600 border-b border-amber-500/20 px-4 py-2.5">
      <div className="max-w-6xl mx-auto flex items-start gap-3">
        <Megaphone className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="flex-1 text-sm">
          {announcement.title && <span className="font-semibold mr-1">{announcement.title}</span>}
          {announcement.content && <span className="text-amber-700">{announcement.content}</span>}
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
