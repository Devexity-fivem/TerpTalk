"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { usePathname } from "next/navigation"
import { MessageSquare, Loader2 } from "lucide-react"
import { signInHref } from "@/lib/callback-url"
import ImageUploader from "@/components/image-uploader"
import MarkdownComposer from "@/components/markdown-composer"
import { useToast } from "@/components/ui/toast"

interface ReplyFormProps {
  threadId: string
}

export default function ReplyForm({ threadId }: ReplyFormProps) {
  const { data: session } = useSession()
  const pathname = usePathname()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [content, setContent] = useState("")
  const [images, setImages] = useState<string[]>([])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!content.trim() || content.length < 10) {
      setError("Please enter at least 10 characters")
      return
    }

    if (!session) {
      setError("You must be signed in to reply")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/forum/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, threadId, images }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to post reply")
      }

      // Refresh the page to show the new post
      window.location.reload()
    } catch (error: unknown) {
      const message = (error as Error).message
      setError(message)
      toast(message, "error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-8 bg-card rounded-lg border border-border p-6">
      <h3 className="font-semibold mb-4">Add to Discussion</h3>
      {!session ? (
        <p className="text-muted-foreground">
          Please <a href={signInHref(pathname)} className="text-primary hover:underline">sign in</a> to reply to this discussion.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <MarkdownComposer
            value={content}
            onChange={setContent}
            placeholder="Share your thoughts..."
            rows={6}
            minLength={10}
            maxLength={10000}
            disabled={loading}
          />
          <ImageUploader value={images} onChange={setImages} disabled={loading} />
          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className="bg-primary text-primary-foreground px-6 py-2 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Posting...
                </>
              ) : (
                <>
                  <MessageSquare className="w-4 h-4" />
                  Post Reply
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}