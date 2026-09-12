"use client"

import { useState, useEffect, useCallback } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Leaf, Loader2, RefreshCw } from "lucide-react"
import { safeCallbackUrl } from "@/lib/callback-url"

interface Captcha {
  id: string
  question: string
}

export default function SignUpPage() {
  const router = useRouter()
  const [captcha, setCaptcha] = useState<Captcha | null>(null)
  const [captchaAnswer, setCaptchaAnswer] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const callback = typeof window !== "undefined"
    ? safeCallbackUrl(new URLSearchParams(window.location.search).get("callbackUrl"))
    : null
  const signinHref = callback ? `/auth/signin?callbackUrl=${encodeURIComponent(callback)}` : "/auth/signin"
  const [formData, setFormData] = useState(() => {
    const ref = typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("ref") || ""
      : ""
    return {
      referralCode: ref,
      username: "",
      password: "",
      confirmPassword: "",
      ageVerified: false,
    }
  })

  const loadCaptcha = useCallback(async () => {
    try {
      const res = await fetch("/api/captcha")
      const data = await res.json()
      if (res.ok && data.id && data.question) {
        setCaptcha({ id: data.id, question: data.question })
      } else {
        throw new Error(data.error || "Failed to load challenge")
      }
    } catch (err) {
      console.error("Captcha load error:", err)
      setCaptcha(null)
    }
  }, [])

  // Fetch the initial challenge. State is set from promise callbacks rather
  // than synchronously in the effect body, and the request is aborted on
  // unmount so a late response cannot update a stale component.
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/captcha", { signal: controller.signal })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        setCaptcha(ok && data.id && data.question ? { id: data.id, question: data.question } : null)
      })
      .catch(() => {
        /* Aborted or offline — the refresh button lets the user retry */
      })
    return () => controller.abort()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.ageVerified) {
      setError("You must verify you are 21+ years old to join")
      return
    }

    if (!captcha) {
      setError("Challenge not loaded. Please refresh the page.")
      return
    }

    if (!captchaAnswer.trim()) {
      setError("Please answer the security question")
      return
    }

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match")
      return
    }

    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }

    setLoading(true)

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
          ageVerified: formData.ageVerified,
          referralCode: formData.referralCode,
          captchaId: captcha.id,
          captchaAnswer,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Registration failed")
      }

      const result = await signIn("credentials", {
        username: formData.username,
        password: formData.password,
        redirect: false,
      })

      if (result?.error) {
        throw new Error("Registration successful but login failed")
      }

      router.push(callback ? `/welcome?callbackUrl=${encodeURIComponent(callback)}` : "/welcome")
    } catch (error: unknown) {
      setError((error as Error).message)
      setCaptchaAnswer("")
      loadCaptcha()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="bg-primary/10 p-3 rounded-full">
              <Leaf className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">Join TerpTalk</h1>
          <p className="text-muted-foreground mt-2">Create your account — 21+ only</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="referralCode" className="block text-sm font-medium mb-2">
              Referral Username <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="referralCode"
              type="text"
              value={formData.referralCode}
              onChange={(e) => setFormData({ ...formData, referralCode: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Who invited you?"
              maxLength={20}
            />
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
              placeholder="Choose a username"
              minLength={3}
              maxLength={20}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-2">
              Password *
            </label>
            <input
              id="password"
              type="password"
              required
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Minimum 8 characters"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2">
              Confirm Password *
            </label>
            <input
              id="confirmPassword"
              type="password"
              required
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Confirm your password"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="captchaAnswer" className="block text-sm font-medium">
                Security Question *
              </label>
              <button
                type="button"
                onClick={loadCaptcha}
                disabled={!captcha}
                className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-50"
              >
                <RefreshCw className="w-3 h-3" />
                New question
              </button>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              {captcha ? captcha.question : "Loading..."}
            </p>
            <input
              id="captchaAnswer"
              type="text"
              required
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Enter the answer"
              autoComplete="off"
            />
          </div>

          <div className="flex items-center">
            <input
              id="ageVerified"
              type="checkbox"
              required
              checked={formData.ageVerified}
              onChange={(e) => setFormData({ ...formData, ageVerified: e.target.checked })}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <label htmlFor="ageVerified" className="ml-2 text-sm">
              I verify that I am 21+ years old
            </label>
          </div>

          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm">
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
                Creating account...
              </>
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Already have an account?{" "}
          <Link
            href={signinHref}
            className="text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
