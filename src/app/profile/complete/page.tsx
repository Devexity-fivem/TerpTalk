"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { User, Camera, Loader2, Check } from "lucide-react"
import { safeCallbackUrl, signInHref } from "@/lib/callback-url"

// Resize an image file to a 128x128 data URI for avatar upload
function resizeImage(file: File, size = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement("canvas")
      const min = Math.min(img.width, img.height)
      const sx = (img.width - min) / 2
      const sy = (img.height - min) / 2
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext("2d")
      if (!ctx) return reject(new Error("no canvas"))
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size)
      resolve(canvas.toDataURL("image/png"))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

export default function CompleteProfilePage() {
  const { data: session, status, update } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState({
    username: "",
    bio: "",
    location: "",
  })
  const [avatar, setAvatar] = useState("")
  const [avatarError, setAvatarError] = useState("")
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // Auth guard — the API also enforces this, but render nothing meaningful
  // without a session instead of showing a form that can only fail.
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(signInHref("/profile/complete"))
    }
  }, [status, router])

  // Prefill the username the account was registered with.
  const [usernamePrefilled, setUsernamePrefilled] = useState(false)
  if (!usernamePrefilled && session?.user?.username) {
    setFormData((prev) => ({ ...prev, username: session.user.username! }))
    setUsernamePrefilled(true)
  }

  // Users who already finished onboarding shouldn't be dropped back here.
  useEffect(() => {
    if (session?.user?.onboardingCompletedAt) {
      router.push(safeCallbackUrl(new URLSearchParams(window.location.search).get("callbackUrl")) ?? "/")
    }
  }, [session?.user?.onboardingCompletedAt, router])

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setAvatarError("Avatar must be a JPG, PNG or WebP image")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Avatar must be under 5MB")
      return
    }
    try {
      setAvatar(await resizeImage(file))
      setAvatarError("")
    } catch {
      setAvatarError("Could not read that image")
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const response = await fetch("/api/profile/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, ...(avatar ? { avatarUrl: avatar } : {}) }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setError(data.error || "Failed to update profile")
        return
      }

      setSuccess(true)
      // Update session
      await update()

      const callback = safeCallbackUrl(new URLSearchParams(window.location.search).get("callbackUrl"))
      setTimeout(() => {
        router.push(callback ?? "/")
      }, 1500)
    } catch (err) {
      console.error("Profile update error:", err)
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  if (status === "loading" || status === "unauthenticated" || session?.user?.onboardingCompletedAt) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center">
          <div className="bg-primary/10 p-4 rounded-full inline-flex mb-4">
            <Check className="w-12 h-12 text-primary" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Profile Complete!</h1>
          <p className="text-muted-foreground">Redirecting to your dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="max-w-2xl w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="bg-primary/10 p-3 rounded-full">
              <User className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">Complete Your TerpTalk Profile</h1>
          <p className="text-muted-foreground mt-2">Tell the community about yourself</p>
        </div>

        <div className="bg-card p-8 rounded-lg border border-border">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Avatar Upload */}
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center overflow-hidden">
                {avatar ? (
                  <img src={avatar} alt="Avatar preview" className="w-full h-full object-cover" />
                ) : (
                  <User className="w-10 h-10 text-muted-foreground" />
                )}
              </div>
              <div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleAvatar}
                />
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors"
                >
                  <Camera className="w-4 h-4" />
                  {avatar ? "Change Avatar" : "Upload Avatar"}
                </button>
                <p className="text-sm text-muted-foreground mt-1">
                  JPG, PNG or WebP. Max 5MB.
                </p>
                {avatarError && <p className="text-xs text-destructive mt-1">{avatarError}</p>}
              </div>
            </div>

            <div>
              <label htmlFor="username" className="block text-sm font-medium mb-2">
                Username *
              </label>
              <input
                id="username"
                type="text"
                required
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Choose a unique username"
              />
            </div>

            <div>
              <label htmlFor="bio" className="block text-sm font-medium mb-2">
                Bio
              </label>
              <textarea
                id="bio"
                rows={4}
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                maxLength={150}
                title="Maximum 150 characters"
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                placeholder="Tell us about your growing experience, interests, and what you hope to share with the community..."
              />
            </div>

            <div>
              <label htmlFor="location" className="block text-sm font-medium mb-2">
                Location
              </label>
              <input
                id="location"
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="City, State, Country"
              />
            </div>

            {error && (
              <div role="alert" className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-3 rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving profile...
                </>
              ) : (
                "Complete Profile"
              )}
            </button>
          </form>
        </div>

        <div className="text-center mt-4">
          <button
            onClick={() => router.push(safeCallbackUrl(new URLSearchParams(window.location.search).get("callbackUrl")) ?? "/")}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  )
}