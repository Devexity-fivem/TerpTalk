import { NextResponse } from "next/server"
import { requireStaff } from "@/lib/require-staff"
import { forbidden } from "@/lib/security"
import { activationReport } from "@/lib/activation"

// GET ?days=7|30|90 — aggregate activation funnel for staff. Counts and
// percentages only: no user ids, usernames, content, or endpoints ever
// leave this route. Same staff gate as /ops (fresh DB role check).
export async function GET(request: Request) {
  const staff = await requireStaff()
  if (!staff) return forbidden()
  const raw = Number(new URL(request.url).searchParams.get("days") ?? 30)
  const days = [7, 30, 90].includes(raw) ? raw : 30
  const report = await activationReport(days)
  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } })
}
