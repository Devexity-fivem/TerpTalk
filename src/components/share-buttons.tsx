"use client"

import { useState, useEffect } from "react"
import { Share2, Link2, Check } from "lucide-react"

// Share a page — copy link + post to X/Reddit
export default function ShareButtons({ path, title }: { path: string; title: string }) {
  const [copied, setCopied] = useState(false)
  // Origin resolves after mount so SSR HTML and first client render match.
  const [origin, setOrigin] = useState("")
  useEffect(() => {
    const t = setTimeout(() => setOrigin(window.location.origin), 0)
    return () => clearTimeout(t)
  }, [])
  const url = `${origin}${path}`

  const copy = async () => {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const xShare = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`
  const redditShare = `https://www.reddit.com/submit?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={copy}
        className="tap-target flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary rounded-xl hover:bg-secondary/80 transition-colors"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Link2 className="w-3.5 h-3.5" />}
        {copied ? "Copied!" : "Copy link"}
      </button>
      <a
        href={xShare}
        target="_blank"
        rel="noopener noreferrer"
        className="tap-target flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary rounded-xl hover:bg-secondary/80 transition-colors"
      >
        <Share2 className="w-3.5 h-3.5" /> X
      </a>
      <a
        href={redditShare}
        target="_blank"
        rel="noopener noreferrer"
        className="tap-target flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary rounded-xl hover:bg-secondary/80 transition-colors"
      >
        <Share2 className="w-3.5 h-3.5" /> Reddit
      </a>
    </div>
  )
}
