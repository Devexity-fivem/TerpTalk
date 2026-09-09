"use client"

import { useState, useEffect } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Leaf, Loader2 } from "lucide-react"

const RECAPTCHA_SITE_KEY = "6Le-FbMtAAAAAB0IFWqe3WCPtuSyc7irvRLZ4gOK"

function SignUpForm() {
  const router = useRouter()
  const [recaptchaReady, setRecaptchaReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
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

  useEffect(() => {
    if (typeof window === "undefined" || document.getElementById("recaptcha-v3")) return

    const script = document.createElement("script")
    script.id = "recaptcha-v3"
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`
    script.async = true
    script.defer = true
    script.onload = () => {
      const grecaptcha = (window as { grecaptcha?: { ready: (cb: () => void) => void } }).grecaptcha
      if (grecaptcha) {
        grecaptcha.ready(() => setRecaptchaReady(true))
      } else {
        setRecaptchaReady(false)
      }
    }
    script.onerror = () => setRecaptchaReady(false)
    document.head.appendChild(script)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError("")

    if (!formData.ageVerified) {
      setError("You must verify you are 21+ years old to join")
      return
    }

    if (!recaptchaReady) {
      setError("Security check not ready. Please wait a moment and try again.")
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
      const grecaptcha = (window as { grecaptcha?: { ready: (cb: () => void) => void; execute: (key: string, opts: { action: string }) => Promise<string> } }).grecaptcha
      if (!grecaptcha) {
        throw new Error("Security check not ready. Please wait a moment and try again.")
      }

      const recaptchaToken = await new Promise<string>((resolve, reject) => {
        grecaptcha.ready(() => {
          grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: "signup" }).then(resolve).catch(reject)
        })
      })

      if (!recaptchaToken) {
        throw new Error("Security check failed. Please try again.")
      }

      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: formData.username,
          password: formData.password,
          ageVerified: formData.ageVerified,
          referralCode: formData.referralCode,
          recaptchaToken,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Registration failed")
      }

      // Auto sign in after registration
      const result = await signIn("credentials", {
        username: formData.username,
        password: formData.password,
        redirect: false,
      })

      if (result?.error) {
        throw new Error("Registration successful but login failed")
      }

      router.push("/profile/complete")
    } catch (error: unknown) {
      setError((error as Error).message)
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
            disabled={loading || !recaptchaReady}
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
          <Link href="/auth/signin" className="text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}

export default function SignUpPage() {
  return <SignUpForm />
}
