"use client"

import { useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Leaf, Loader2 } from "lucide-react"
import { safeCallbackUrl } from "@/lib/callback-url"

export default function SignInPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [formData, setFormData] = useState({
    username: "",
    password: "",
  })
  const callback = typeof window !== "undefined"
    ? safeCallbackUrl(new URLSearchParams(window.location.search).get("callbackUrl"))
    : null
  const signupHref = callback ? `/auth/signup?callbackUrl=${encodeURIComponent(callback)}` : "/auth/signup"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const result = await signIn("credentials", {
        username: formData.username,
        password: formData.password,
        redirect: false,
      })

      if (result?.error === "AccountBanned" || result?.error === "AccountSuspended") {
        setError("restricted")
      } else if (result?.error && /too many/i.test(result.error)) {
        // The login rate limit trips on the attempted username regardless of
        // whether the account exists, so distinguishing it leaks nothing —
        // and a throttled member needs "wait" guidance, not "wrong password".
        setError("Too many attempts. Please try again later.")
      } else if (result?.error) {
        setError("Invalid username or password")
      } else {
        router.push(callback ?? "/")
        router.refresh()
      }
    } catch {
      setError("An error occurred. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="bg-primary/10 ring-1 ring-primary/20 p-3 rounded-full shadow-md">
              <Leaf className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Welcome to TerpTalk</h1>
          <p className="text-muted-foreground mt-2">Sign in to your account</p>
        </div>

        <form onSubmit={handleSubmit} className="tt-glass rounded-2xl border border-border/70 p-6 space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm font-medium mb-2">
              Username
            </label>
            <input
              id="username"
              type="text"
              required
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/50 transition-colors"
              placeholder="Your username"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/50 transition-colors"
              placeholder="Your password"
            />
          </div>

          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2.5 rounded-xl text-sm">
              {error === "restricted" ? (
                <>
                  Your account is suspended or banned.{" "}
                  <Link href="/restricted" className="underline">
                    Check your status or request a review
                  </Link>
                </>
              ) : (
                <>
                  {error}
                  {" "}
                  <Link href="/restricted" className="underline">
                    Account suspended or banned? Check your status
                  </Link>
                </>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="tt-cta w-full py-3 rounded-full font-semibold text-primary-foreground transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Signing in...
              </>
            ) : (
              "Sign In"
            )}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Don&apos;t have an account?{" "}
          <Link href={signupHref} className="text-primary hover:underline">
            Sign up
          </Link>
        </p>
        <p className="text-center text-sm text-muted-foreground mt-2">
          Lost access?{" "}
          <Link href="/auth/recover" className="text-primary hover:underline">
            Recover with your phrase
          </Link>
        </p>
      </div>
    </div>
  )
}