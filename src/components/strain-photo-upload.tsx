"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Camera, Loader2, X } from "lucide-react"

// Resize to max 800px on the long edge, WebP — keeps stored data URIs small
function resizeImage(file: File, max = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext("2d")
      if (!ctx) return reject(new Error("no canvas"))
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL("image/webp", 0.82))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

export default function StrainPhotoUpload({
  strainId,
  kind,
}: {
  strainId: string
  kind: "PLANT" | "FLOWER"
}) {
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setError("")
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB")
      return
    }
    setUploading(true)
    try {
      const dataUri = await resizeImage(file)
      const res = await fetch("/api/strains/photos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ strainId, kind, image: dataUri }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error || "Upload failed")
      } else {
        router.refresh()
      }
    } catch {
      setError("Could not process that image")
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) handleFile(f)
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="flex items-center gap-2 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
      >
        {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
        {uploading ? "Uploading..." : kind === "PLANT" ? "Add Plant Photo" : "Add Flower Photo"}
      </button>
      {error && (
        <p className="text-xs text-destructive mt-2 flex items-center gap-1">
          <X className="w-3 h-3" /> {error}
        </p>
      )}
    </div>
  )
}
