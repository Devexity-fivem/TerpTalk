"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Leaf, Loader2, RefreshCw } from "lucide-react"
import { safeCallbackUrl } from "@/lib/callback-url"

interface Captcha {
  id: string
  question: string
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ""

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      reset: (id?: string) => void
    }
  }
}

export default function SignUpPage() {
  const router = useRouter()
  const [captcha, setCaptcha] = useState<Captcha | null>(null)
  const [captchaAnswer, setCaptchaAnswer] = useState("")
  const [turnstileToken, setTurnstileToken] = useState("")
  const turnstileRef = useRef<HTMLDivElement>(null)
  const turnstileWidgetId = useRef<string | null>(null)
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
  // unmount so a late response cannot update a stale component. Skipped
  // entirely when Turnstile is configured.
  useEffect(() => {
    if (TURNSTILE_SITE_KEY) return
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

  // Render the Turnstile widget when configured. Explicit render keeps a
  // stable widget id so failures can reset it for a fresh token.
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !turnstileRef.current) return
    const render = () => {
      if (!turnstileRef.current || turnstileWidgetId.current || !window.turnstile) return
      turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (token: string) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      })
    }
    if (window.turnstile) {
      render()
      return
    }
    const script = document.createElement("script")
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
    script.async = true
    script.onload = render
    document.head.appendChild(script)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.ageVerified) {
      setError("You must verify you are 21+ years old to join")
      return
    }

    if (TURNSTILE_SITE_KEY) {
      if (!turnstileToken) {
        setError("Please complete the security check")
        return
      }
    } else {
      if (!captcha) {
        setError("Challenge not loaded. Please refresh the page.")
        return
      }

      if (!captchaAnswer.trim()) {
        setError("Please answer the security question")
        return
      }
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
          ...(TURNSTILE_SITE_KEY
            ? { turnstileToken }
            : { captchaId: captcha!.id, captchaAnswer }),
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
      setTurnstileToken("")
      if (TURNSTILE_SITE_KEY) {
        window.turnstile?.reset(turnstileWidgetId.current ?? undefined)
      } else {
        loadCaptcha()
      }
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
          <h1 className="font-display text-3xl font-bold tracking-tight">Join TerpTalk</h1>
          <p className="text-muted-foreground mt-2">Create your account — 21+ only</p>
        </div>

        <form onSubmit={handleSubmit} className="tt-glass rounded-2xl border border-border/70 p-6 space-y-4">
          <div>
            <label htmlFor="referralCode" className="block text-sm font-medium mb-2">
              Referral Username <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="referralCode"
              type="text"
              value={formData.referralCode}
              onChange={(e) => setFormData({ ...formData, referralCode: e.target.value })}
              className="w-full px-4 py-2.5 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/50 transition-colors"
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
              className="w-full px-4 py-2.5 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/50 transition-colors"
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
              className="w-full px-4 py-2.5 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/50 transition-colors"
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
              className="w-full px-4 py-2.5 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/50 transition-colors"
              placeholder="Confirm your password"
            />
          </div>

          {TURNSTILE_SITE_KEY ? (
            <div>
              <label className="block text-sm font-medium mb-2">Security Check *</label>
              <div ref={turnstileRef} />
            </div>
          ) : (
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
                className="w-full px-4 py-2.5 rounded-xl border border-border/70 bg-background focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-primary/50 transition-colors"
                placeholder="Enter the answer"
                autoComplete="off"
              />
            </div>
          )}

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

          <p className="text-xs text-muted-foreground">
            By creating an account you agree to the{" "}
            <Link href="/terms" className="text-primary hover:underline">Terms of Service</Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
          </p>

          <p className="text-xs text-muted-foreground bg-secondary/50 border border-border/70 rounded-xl px-3 py-2">
            We never ask for your email. After signup you&apos;ll get a recovery phrase —{" "}
            <strong className="text-foreground">it&apos;s the only way back in</strong> if you forget your password. Write it down and keep it safe.
          </p>

          {error && (
            <div className="bg-destructive/10 text-destructive px-4 py-2.5 rounded-xl text-sm">
              {error}
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
