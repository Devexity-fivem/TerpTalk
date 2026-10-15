import { NextRequest, NextResponse } from "next/server"
import { runCronTask } from "@/lib/cron-claim"
import { sendDiaryReminders } from "@/lib/diary-reminders"
import { safeEqualSecret } from "@/lib/security"

// Daily grow-loop reminder job — one aggregated DIARY_REMINDER per member
// with an active diary stale for 7+ days. Invoked by the Vercel cron
// configured in vercel.json. The day-scoped claim plus the per-member
// weekly claims and the notification-level 7-day throttle make repeated
// and concurrent invocations idempotent.
export const maxDuration = 60

export async function GET(request: NextRequest) {
  // Fail closed: without CRON_SECRET the vercel-cron user-agent header is
  // forgeable by anyone. Unsigned requests are only accepted outside
  // production (local/manual runs).
  const secret = process.env.CRON_SECRET
  if (secret) {
    if (!safeEqualSecret(request.headers.get("authorization"), `Bearer ${secret}`)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  } else {
    if (process.env.NODE_ENV === "production") {
      console.error("[cron] CRON_SECRET is not configured — refusing to run in production")
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const ua = request.headers.get("user-agent") || ""
    if (!ua.startsWith("vercel-cron") && !ua.startsWith("Mozilla") && !ua.includes("curl")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const posted: string[] = []
  const failed: string[] = []

  const today = new Date().toISOString().slice(0, 10)
  await runCronTask(`diary-reminders:${today}`, async () => {
    const { scanned, reminded } = await sendDiaryReminders()
    return `diary-reminders:${scanned}scanned/${reminded}reminded`
  }, posted, failed, "diary-reminders")

  return NextResponse.json({ posted, failed })
}
