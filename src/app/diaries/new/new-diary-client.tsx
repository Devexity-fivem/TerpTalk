"use client"

import { signInHref } from "@/lib/callback-url"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import DiaryForm, { DiaryFormData } from "@/components/diary-form"

const EMPTY_FORM: DiaryFormData = {
  title: "",
  description: "",
  strain: "",
  strainId: null,
  genetics: "",
  growType: "INDOOR",
  startDate: "",
  medium: "",
  mediumType: "",
  containerSize: "",
  lighting: "",
  lightType: "",
  nutrients: "",
  equipment: "",
  techniques: [],
  spaceDimensions: "",
  setupId: "",
  visibility: "PUBLIC",
}

export default function NewDiaryClient({
  prefill,
}: {
  prefill?: { strain: string; strainId: string } | null
}) {
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

  const handleSubmit = async (formData: DiaryFormData) => {
    const response = await fetch("/api/diaries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...formData,
        strainId: formData.strainId || null,
        mediumType: formData.mediumType || null,
        lightType: formData.lightType || null,
        setupId: formData.setupId || null,
      }),
    })

    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || "Failed to create diary")
    }

    const data = await response.json()
    router.push(`/diaries/${data.diary.id}`)
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <Link href="/diaries" className="text-sm text-muted-foreground hover:text-foreground mb-2 block">
            ← Back to Diaries
          </Link>
          <h1 className="text-3xl font-bold mb-2">Start New Grow Diary</h1>
          <p className="text-muted-foreground">Document your complete grow journey from seed to harvest</p>
        </div>

        {/* Form */}
        <div className="bg-card rounded-lg border border-border p-6">
          <DiaryForm
            initial={{ ...EMPTY_FORM, ...(prefill ?? {}) }}
            submitLabel="Create Diary"
            pendingLabel="Creating diary..."
            onSubmit={handleSubmit}
            cancelHref="/diaries"
          />
        </div>
      </div>
    </div>
  )
}
