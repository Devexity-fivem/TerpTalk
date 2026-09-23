import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unauthorized, forbidden, isBanned } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { getGrowIntel } from "@/lib/grow-intel"
import { activeChecklist } from "@/lib/terpbot-intel-checklist"
import {
  renderCheck,
  renderChanges,
  renderMeasurements,
  renderNext,
  renderPlan,
  renderStatus,
  snapshotFrom,
} from "@/lib/terpbot-intel-status"
import { loadSession, saveSession } from "@/lib/terpbot-session"
import { renderExperimentLines } from "@/lib/experiments"

/**
 * GET /api/diaries/[id]/intel
 *
 * Owner-facing deterministic grow intelligence — the web equivalent of
 * the TerpBot chat commands, running the same context/snapshot/decision
 * pipeline at owner scope (chat commands are public-scope only, so
 * private diaries get their first-class surface here).
 *
 * ?action= (default "summary")
 *   summary      → compact GrowIntel projection for the cockpit/panel
 *   next|status|check|plan|measurements|changes → canonical rendered
 *                  lines, identical to the chat command output
 *
 * Owner-only: a non-owner gets 404 — the endpoint does not confirm the
 * diary's existence. "status" persists the session snapshot (same as the
 * chat /status) so "changes" diffs against the last viewed baseline.
 */

const ACTIONS = new Set([
  "summary",
  "next",
  "status",
  "check",
  "plan",
  "measurements",
  "changes",
  "experiments",
])

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()
  if (await isBanned(session.user.id)) return forbidden()

  const rl = await rateLimit(`diary-intel:${session.user.id}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many intel requests — try again later" },
      { status: 429 }
    )
  }

  const { id } = await params
  const action = new URL(request.url).searchParams.get("action") ?? "summary"
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 })
  }

  const bundle = await getGrowIntel(id, session.user.id)
  if (!bundle) {
    return NextResponse.json({ error: "Diary not found" }, { status: 404 })
  }
  const { ctx, snap, decisions, intel } = bundle

  if (action === "summary") {
    return NextResponse.json({ intel })
  }
  if (action === "experiments") {
    // Canonical lines at owner scope — private diaries get their
    // experiment awareness here (chat /experiments stays public-scope).
    return NextResponse.json({ lines: renderExperimentLines(intel.experiments) })
  }

  const now = Date.now()
  switch (action) {
    case "next":
      return NextResponse.json({ lines: renderNext(decisions) })
    case "check":
      return NextResponse.json({ lines: renderCheck(decisions) })
    case "plan":
      return NextResponse.json({ lines: renderPlan(snap, activeChecklist(snap), decisions) })
    case "measurements":
      return NextResponse.json({ lines: renderMeasurements(ctx) })
    case "changes": {
      const prev = (await loadSession(session.user.id, now))?.state.snapshot
      return NextResponse.json({ lines: renderChanges(ctx, snap.diagnosis, prev, decisions) })
    }
    case "status": {
      const lines = renderStatus(ctx, snap.diagnosis, decisions)
      // Same side effect as chat /status: this view becomes the /changes
      // baseline. Write-through mirrors the command semantics. The live
      // pendingAsk is preserved — viewing status must never drop an
      // in-flight chat question.
      try {
        const live = await loadSession(session.user.id, now)
        await saveSession(
          session.user.id,
          {
            diaryId: id,
            pendingAsk: live?.pendingAsk ?? null,
            snapshot: snapshotFrom(ctx, snap.diagnosis, now),
          },
          now
        )
      } catch {
        // snapshot persistence is best-effort — never fail the read
      }
      return NextResponse.json({ lines })
    }
  }
}
