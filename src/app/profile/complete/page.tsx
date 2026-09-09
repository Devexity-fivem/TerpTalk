"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { User, Camera, Loader2, Check } from "lucide-react"

export default function CompleteProfilePage() {
  const { update } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [formData, setFormData] = useState({
    username: "",
    bio: "",
    location: "",
    website: "",
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch("/api/profile/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      })

      if (!response.ok) {
        throw new Error("Failed to update profile")
      }

      setSuccess(true)
      // Update session
      await update()
      
      setTimeout(() => {
        router.push("/")
      }, 1500)
    } catch (error) {
      console.error("Profile update error:", error)
    } finally {
      setLoading(false)
    }
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
            {/* Avatar Upload (placeholder for now) */}
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center">
                <User className="w-10 h-10 text-muted-foreground" />
              </div>
              <div>
                <button
                  type="button"
                  className="flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors"
                >
                  <Camera className="w-4 h-4" />
                  Upload Avatar
                </button>
                <p className="text-sm text-muted-foreground mt-1">
                  JPG, PNG or GIF. Max 2MB.
                </p>
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

            <div>
              <label htmlFor="website" className="block text-sm font-medium mb-2">
                Website
              </label>
              <input
                id="website"
                type="url"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="https://yourwebsite.com"
              />
            </div>

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
            onClick={() => router.push("/")}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  )
}