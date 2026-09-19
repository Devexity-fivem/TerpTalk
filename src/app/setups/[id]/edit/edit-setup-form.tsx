"use client"

import { useRouter } from "next/navigation"
import SetupForm, {
  type SetupFormImage,
  type SetupFormSubmit,
  type SetupFormValues,
} from "@/components/setup-form"

interface EditSetupFormProps {
  setupId: string
  setupHref: string
  initial: SetupFormValues
  images: SetupFormImage[]
}

export default function EditSetupForm({ setupId, setupHref, initial, images }: EditSetupFormProps) {
  const router = useRouter()

  const handleSubmit = async ({ fields, keepImageIds, newImages }: SetupFormSubmit) => {
    const response = await fetch("/api/setups", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: setupId,
        ...fields,
        keepImageIds,
        images: newImages,
      }),
    })

    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || "Failed to save changes")
    }

    router.push(setupHref)
    router.refresh()
  }

  return (
    <SetupForm
      initialValues={initial}
      initialImages={images}
      onSubmit={handleSubmit}
      submitLabel="Save Changes"
      submitBusyLabel="Saving..."
      cancelHref={setupHref}
    />
  )
}
