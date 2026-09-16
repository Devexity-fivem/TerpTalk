"use client"

import { signInHref } from "@/lib/callback-url"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import SetupForm, { type SetupFormSubmit } from "@/components/setup-form"

export default function NewSetupPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!session) {
    router.push(signInHref(window.location.pathname + window.location.search))
    return null
  }

  const handleSubmit = async ({ fields, newImages }: SetupFormSubmit) => {
    const response = await fetch("/api/setups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...fields, images: newImages }),
    })

    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || "Failed to create setup")
    }

    const data = await response.json()
    router.push(`/setups/${data.setup.id}`)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/setups" className="text-sm text-muted-foreground hover:text-foreground mb-2 block">
            ← Back to Setups
          </Link>
          <h1 className="text-3xl font-bold mb-2">Share Your Grow Setup</h1>
          <p className="text-muted-foreground">Show off your grow room and equipment to the community</p>
        </div>

        {/* Form */}
        <div className="bg-card rounded-lg border border-border p-6">
          <SetupForm
            onSubmit={handleSubmit}
            submitLabel="Share Setup"
            submitBusyLabel="Creating setup..."
            cancelHref="/setups"
          />
        </div>
      </div>
    </div>
  )
}
