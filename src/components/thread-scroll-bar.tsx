"use client"

import { useEffect, useState } from "react"
import { ArrowUp, Reply } from "lucide-react"

/**
 * Floating action pill for long threads — appears after the reader has
 * scrolled past the opener. Sits above the mobile bottom bar; Reply jumps
 * to the composer anchor, top returns to the thread header.
 */
export default function ThreadScrollBar({ replyAnchor }: { replyAnchor?: string }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setVisible(window.scrollY > 560)
      })
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      window.removeEventListener("scroll", onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 flex justify-center transition-all duration-300 lg:bottom-6 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      }`}
      aria-hidden={!visible}
    >
      <div className="tt-glass pointer-events-auto flex items-center gap-1 rounded-full border border-border/60 p-1.5 shadow-xl shadow-black/10">
        <button
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          tabIndex={visible ? 0 : -1}
          className="flex min-h-10 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ArrowUp className="h-4 w-4" />
          Top
        </button>
        {replyAnchor && (
          <a
            href={replyAnchor}
            tabIndex={visible ? 0 : -1}
            className="tt-cta flex min-h-10 items-center gap-1.5 rounded-full px-4 text-sm font-semibold text-primary-foreground transition-all"
          >
            <Reply className="h-4 w-4" />
            Reply
          </a>
        )}
      </div>
    </div>
  )
}
