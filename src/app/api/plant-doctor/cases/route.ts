import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unauthorized, getClientIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { createPlantDoctorCase, plantDoctorCasesFor } from "@/lib/plant-doctor"
import { isValidWizardResultId } from "@/lib/symptom-tags"

// Plant Doctor outcome loop — owner-scoped tracked cases. Cases are
// private records: GET returns the caller's own recent cases only, POST
// persists the wizard diagnosis + structured grow context so the member
// can report what actually happened later.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const cases = await plantDoctorCasesFor(session.user.id)
    return NextResponse.json({ cases })
  } catch (error) {
    console.error("Plant doctor cases GET error:", error)
    return NextResponse.json({ error: "Failed to load cases" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const rl = await rateLimit(`pd-case:${session.user.id}:${getClientIp(request)}`, 20, 60 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const body = await request.json().catch(() => ({}))
    const { resultId, diaryId } = body ?? {}
    if (!isValidWizardResultId(resultId)) {
      return NextResponse.json({ error: "Invalid wizard result" }, { status: 400 })
    }
    if (diaryId != null && typeof diaryId !== "string") {
      return NextResponse.json({ error: "Invalid diary" }, { status: 400 })
    }

    const r = await createPlantDoctorCase({
      userId: session.user.id,
      resultId,
      diaryId: diaryId ?? null,
    })
    if ("error" in r) {
      return NextResponse.json({ error: r.error === "diary not found" ? "Diary not found" : "Invalid wizard result" }, { status: 400 })
    }
    return NextResponse.json({ caseId: r.caseId, reused: r.reused })
  } catch (error) {
    console.error("Plant doctor case create error:", error)
    return NextResponse.json({ error: "Failed to track diagnosis" }, { status: 500 })
  }
}
