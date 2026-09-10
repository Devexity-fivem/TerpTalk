"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ImagePlus, Loader2, X, ArrowLeft, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

// Must stay under MAX_DATA_URI_LEN in lib/blob.ts (400,000 chars ≈ 300KB).
const MAX_DATA_URI_LEN = 400_000
const ACCEPT = "image/png,image/jpeg,image/webp"
const MAX_SOURCE_BYTES = 15 * 1024 * 1024

/**
 * Downscale to `max` px on the long edge, stepping quality down until the
 * encoded data URI fits the server's size ceiling.
 */
async function resizeImage(file: File, max = 1400): Promise<string> {
  const bitmap = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error("Unreadable image"))
    }
    img.src = url
  })

  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas unavailable")
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

  for (const quality of [0.82, 0.7, 0.58, 0.45]) {
    const uri = canvas.toDataURL("image/webp", quality)
    if (uri.length <= MAX_DATA_URI_LEN) return uri
  }
  throw new Error("Image is too detailed to compress — try a smaller crop")
}

interface ImageUploaderProps {
  value: string[]
  onChange: (next: string[]) => void
  max?: number
  /** Element to listen on for paste events. Defaults to the whole document. */
  disabled?: boolean
}

export default function ImageUploader({ value, onChange, max = 4, disabled }: ImageUploaderProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const remaining = max - value.length

  const addFiles = useCallback(
    async (files: File[]) => {
      if (disabled || !files.length) return
      setError("")

      const images = files.filter((f) => f.type.startsWith("image/"))
      if (!images.length) {
        setError("Those files are not images")
        return
      }
      if (remaining <= 0) {
        setError(`You can attach up to ${max} images`)
        return
      }

      const batch = images.slice(0, remaining)
      const skipped = images.length - batch.length
      setBusy(true)
      const accepted: string[] = []
      const problems: string[] = []

      for (const file of batch) {
        if (file.size > MAX_SOURCE_BYTES) {
          problems.push(`${file.name} is over 15MB`)
          continue
        }
        try {
          accepted.push(await resizeImage(file))
        } catch (err) {
          problems.push(err instanceof Error ? err.message : `${file.name} could not be processed`)
        }
      }

      if (accepted.length) onChange([...value, ...accepted])
      if (skipped > 0) problems.push(`${skipped} image${skipped === 1 ? "" : "s"} skipped — limit is ${max}`)
      setError(problems.join(". "))
      setBusy(false)
    },
    [disabled, max, onChange, remaining, value]
  )

  // Let users paste screenshots straight into the composer.
  useEffect(() => {
    if (disabled) return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? [])
      if (files.length) {
        e.preventDefault()
        void addFiles(files)
      }
    }
    document.addEventListener("paste", onPaste)
    return () => document.removeEventListener("paste", onPaste)
  }, [addFiles, disabled])

  const move = (from: number, to: number) => {
    if (to < 0 || to >= value.length) return
    const next = [...value]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onChange(next)
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []))
          e.target.value = ""
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault()
          if (!dragging) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void addFiles(Array.from(e.dataTransfer.files))
        }}
        className={cn(
          "rounded-xl border-2 border-dashed p-4 text-center transition-colors",
          dragging ? "border-primary bg-primary/5" : "border-border",
          disabled && "opacity-50"
        )}
      >
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy || remaining <= 0}
          className="inline-flex items-center gap-2 rounded-lg bg-secondary px-3 py-2 text-sm font-medium transition-colors hover:bg-secondary/80 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {busy ? "Processing..." : "Add images"}
        </button>
        <p className="mt-2 text-xs text-muted-foreground">
          Drag, drop, or paste. PNG, JPEG, or WebP — up to {max}.
          {remaining > 0 && value.length > 0 && ` ${remaining} slot${remaining === 1 ? "" : "s"} left.`}
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}

      {value.length > 0 && (
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {value.map((src, i) => (
            <li key={`${i}-${src.slice(-24)}`} className="group relative overflow-hidden rounded-lg border border-border">
              {/* Local preview of a data URI; next/image adds no value here. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`Attachment ${i + 1}`} className="aspect-square w-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(value.filter((_, idx) => idx !== i))}
                aria-label={`Remove attachment ${i + 1}`}
                className="absolute right-1 top-1 rounded-full bg-background/90 p-1 text-foreground shadow transition-colors hover:bg-destructive hover:text-destructive-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
              <div className="absolute bottom-1 left-1 flex gap-1">
                <button
                  type="button"
                  onClick={() => move(i, i - 1)}
                  disabled={i === 0}
                  aria-label={`Move attachment ${i + 1} earlier`}
                  className="rounded-full bg-background/90 p-1 shadow transition-colors hover:bg-secondary disabled:opacity-30"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === value.length - 1}
                  aria-label={`Move attachment ${i + 1} later`}
                  className="rounded-full bg-background/90 p-1 shadow transition-colors hover:bg-secondary disabled:opacity-30"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
