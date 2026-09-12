"use client"

import { signInHref } from "@/lib/callback-url"

import { useState, useEffect, Suspense } from "react"
import { useSession } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { MessageSquare, Loader2 } from "lucide-react"
import ImageUploader from "@/components/image-uploader"
import MarkdownComposer from "@/components/markdown-composer"
import TagInput from "@/components/tag-input"
import PollComposer from "@/components/poll-composer"
import Link from "next/link"
import { WIZARD_RESULTS } from "@/lib/problem-wizard"

interface Category {
  id: string
  name: string
  slug: string
}

interface SimilarThread {
  id: string
  slug: string
  title: string
  createdAt: string
  category: { name: string; slug: string }
  replyCount: number
}

function NewThreadForm() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [categories, setCategories] = useState<Category[]>([])
  const [formData, setFormData] = useState(() => {
    const resultId = searchParams?.get("result")
    const result = resultId ? WIZARD_RESULTS[resultId] : null
    return {
      title: result ? `Help: ${result.title}` : "",
      content: result
        ? [
            `I used the TerpTalk plant problem wizard and it suggested this might be **${result.title}**.`,
            "",
            `**Likely cause:** ${result.cause}`,
            "",
            "**Suggested fixes:**",
            ...result.fixes.map((f) => `- ${f}`),
            "",
            "What do you think? Any photos or extra details I should add?",
          ].join("\n")
        : "",
      categoryId: "",
    }
  })

  const [similarThreads, setSimilarThreads] = useState<SimilarThread[]>([])
  const [images, setImages] = useState<string[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [poll, setPoll] = useState<{ question: string; options: string[] } | null>(null)

  useEffect(() => {
    fetch("/api/categories")
      .then(res => res.json())
      .then(data => setCategories(data.categories || []))
      .catch(() => setError("Failed to load categories"))
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      if (formData.title.trim().length < 4) {
        setSimilarThreads([])
        return
      }
      fetch(`/api/forum/threads/similar?title=${encodeURIComponent(formData.title)}&categoryId=${encodeURIComponent(formData.categoryId || "")}`)
        .then((res) => res.json())
        .then((data) => setSimilarThreads(data.threads || []))
        .catch(() => setSimilarThreads([]))
    }, 400)
    return () => clearTimeout(t)
  }, [formData.title, formData.categoryId])

  if (status === "loading") {
    return (
      <div role="status" aria-label="Loading" className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!session) {
    router.push(signInHref(window.location.pathname + window.location.search))
    return null
  }

  const prefillCategoryId =
    searchParams?.get("category") ? categories.find((c) => c.slug === searchParams!.get("category"))?.id : ""

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    const categoryId = formData.categoryId || prefillCategoryId

    if (!formData.title.trim() || !formData.content.trim() || !categoryId) {
      setError("Please fill in all required fields")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/forum/threads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, categoryId, images, tags, poll }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to create thread")
      }

      const data = await response.json()
      router.push(`/forum/thread/${data.thread.slug}`)
    } catch (error: unknown) {
      setError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/forum" className="text-sm text-muted-foreground hover:text-foreground mb-2 block">
            ← Back to Discussions
          </Link>
          <h1 className="text-3xl font-bold mb-2">Create New Discussion</h1>
          <p className="text-muted-foreground">Start a new discussion in the community</p>
        </div>

        {/* Form */}
        <div className="bg-card rounded-lg border border-border p-6">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="category" className="block text-sm font-medium mb-2">
                Category *
              </label>
              <select
                id="category"
                required
                value={formData.categoryId || prefillCategoryId || ""}
                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="title" className="block text-sm font-medium mb-2">
                Title *
              </label>
              <input
                id="title"
                type="text"
                required
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Enter a descriptive title for your thread"
                maxLength={150}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {formData.title.length}/150 characters
              </p>
            </div>

            {similarThreads.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                <p className="text-sm font-medium text-amber-400 mb-2">Similar discussions already exist</p>
                <ul className="space-y-2">
                  {similarThreads.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/forum/thread/${t.slug}`}
                        target="_blank"
                        className="text-sm text-amber-300 hover:underline"
                      >
                        {t.title}
                      </Link>
                      <span className="text-xs text-muted-foreground ml-2">in {t.category.name} · {t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <MarkdownComposer
              id="content"
              label="Content *"
              value={formData.content}
              onChange={(v) => setFormData({ ...formData, content: v })}
              placeholder="Share your thoughts, questions, or experiences..."
              rows={12}
              minLength={10}
              maxLength={10000}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              Minimum 10 characters. Be descriptive and helpful.
            </p>

            <details className="border border-border rounded-lg p-4 group">
              <summary className="text-sm font-medium cursor-pointer select-none list-none flex items-center justify-between">
                <span>Images, tags, or poll (optional)</span>
                <span aria-hidden="true" className="group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="pt-4 space-y-4">
                <div>
                  <span className="block text-sm font-medium mb-2">Images</span>
                  <ImageUploader value={images} onChange={setImages} disabled={loading} />
                </div>
                <TagInput value={tags} onChange={setTags} disabled={loading} />
                <PollComposer value={poll} onChange={setPoll} disabled={loading} />
              </div>
            </details>

            {error && (
              <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}

            <div className="flex gap-4">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-primary text-primary-foreground py-3 rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating discussion...
                  </>
                ) : (
                  <>
                    <MessageSquare className="w-4 h-4" />
                    Create Discussion
                  </>
                )}
              </button>
              <Link
                href="/forum"
                className="px-6 py-3 border border-border rounded-lg hover:bg-secondary transition-colors text-center"
              >
                Cancel
              </Link>
            </div>
          </form>
        </div>

        {/* Guidelines */}
        <div className="mt-6 bg-secondary/50 rounded-lg p-4">
          <h3 className="font-semibold mb-2">Community Guidelines</h3>
          <ul className="text-sm text-muted-foreground space-y-1">
            <li>• Be respectful and constructive in your discussions</li>
            <li>• Search before posting to avoid duplicate threads</li>
            <li>• Use descriptive titles that help others understand your topic</li>
            <li>• Include relevant details in your content for better responses</li>
            <li>• Stay on topic and post in the appropriate category</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

function Loading() {
  return (
    <div role="status" aria-label="Loading" className="min-h-screen flex items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
    </div>
  )
}

export default function NewThreadPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewThreadForm />
    </Suspense>
  )
}