"use client"

import { useRouter } from "next/navigation"
import DiaryForm, { DiaryFormData } from "@/components/diary-form"

interface Props {
  diaryId: string
  diaryHref: string
  initial: DiaryFormData
  startDateDisplay: string
  strainSuggestion?: { id: string; name: string } | null
}

// Thin submit wrapper around the shared DiaryForm — PATCHes the diary
// and returns to it on success. Errors surface via the form's error box.
export default function EditDiaryForm({ diaryId, diaryHref, initial, startDateDisplay, strainSuggestion }: Props) {
  const router = useRouter()

  const handleSubmit = async (formData: DiaryFormData) => {
    const response = await fetch(`/api/diaries/${diaryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...formData,
        startDate: undefined, // immutable — never sent
        strainId: formData.strainId || null,
        mediumType: formData.mediumType || null,
        lightType: formData.lightType || null,
        setupId: formData.setupId || null,
      }),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || "Failed to save changes")
    }

    router.push(diaryHref)
    router.refresh()
  }

  return (
    <DiaryForm
      initial={initial}
      submitLabel="Save Changes"
      pendingLabel="Saving..."
      onSubmit={handleSubmit}
      cancelHref={diaryHref}
      startDateDisplay={startDateDisplay}
      strainSuggestion={strainSuggestion}
    />
  )
}
