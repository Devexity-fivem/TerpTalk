"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { cn } from "@/lib/utils"

export interface GalleryImage {
  id: string
  url: string
  caption?: string | null
}

/**
 * Thumbnail grid that opens a full-screen lightbox with keyboard and swipe
 * navigation. Used for images attached to threads and replies.
 */
export default function ImageGallery({ images }: { images: GalleryImage[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const close = useCallback(() => setOpenIndex(null), [])
  const step = useCallback(
    (delta: number) => {
      setOpenIndex((current) =>
        current === null ? null : (current + delta + images.length) % images.length
      )
    },
    [images.length]
  )

  useEffect(() => {
    if (openIndex === null) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
      if (e.key === "ArrowRight") step(1)
      if (e.key === "ArrowLeft") step(-1)
    }
    window.addEventListener("keydown", onKeyDown)
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = previous
    }
  }, [openIndex, close, step])

  if (!images.length) return null

  const active = openIndex === null ? null : images[openIndex]

  return (
    <>
      <ul
        className={cn(
          "mt-3 grid gap-2",
          images.length === 1 ? "max-w-md" : "grid-cols-2 sm:grid-cols-3"
        )}
      >
        {images.map((image, i) => (
          <li key={image.id}>
            <button
              type="button"
              onClick={() => setOpenIndex(i)}
              className="block w-full overflow-hidden rounded-lg border border-border transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={image.caption || `View image ${i + 1} of ${images.length}`}
            >
              {/* Blob-hosted user uploads, already downscaled on the client. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image.url}
                alt={image.caption || ""}
                loading="lazy"
                decoding="async"
                className={cn("w-full object-cover", images.length === 1 ? "max-h-96" : "aspect-square")}
              />
            </button>
          </li>
        ))}
      </ul>

      {active && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Image viewer"
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4"
          onClick={close}
        >
          <button
            onClick={close}
            aria-label="Close viewer"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>

          {images.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  step(-1)
                }}
                aria-label="Previous image"
                className="absolute left-2 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 sm:left-4"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  step(1)
                }}
                aria-label="Next image"
                className="absolute right-2 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20 sm:right-4"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          <figure className="max-h-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={active.url}
              alt={active.caption || `Image ${(openIndex ?? 0) + 1}`}
              className="max-h-[80vh] w-auto rounded-lg object-contain"
            />
            <figcaption className="mt-3 text-center text-sm text-white/80">
              {active.caption}
              {images.length > 1 && (
                <span className="ml-2 text-white/50">
                  {(openIndex ?? 0) + 1} / {images.length}
                </span>
              )}
            </figcaption>
          </figure>
        </div>
      )}
    </>
  )
}
