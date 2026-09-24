// Ops surface verification — /ops staff gate (guest/member/staff), ops
// metrics shape + bounds, feedback deviceType capture + spoof resistance.
// Temp users/feedback fully cleaned up.
import "./db-guard.mjs"
import { makeHarness } from "./lib/http-harness.mjs"
import { getOpsData } from "@/lib/ops-metrics"

const harnessOpts = {
  username: (tag: string, ts: string) => `__ops_${tag}_${ts}`,
  name: (tag: string, ts: string) => `__ops_${tag}_${ts}`,
  summary: "fraction",
}
// harness option typing omits `username` — required at runtime.
const { prisma, ts: TS, pass, fail, createUser, login: rawLogin, finish } = makeHarness(
  harnessOpts as { name: (tag: string, ts: string) => string; summary: string },
)
const login = (u: string, p: string) =>
  rawLogin(u, p) as Promise<{ cookie: string }>

const BASE = process.env.BASE_URL || "http://localhost:3000"

const main = async () => {
  const member = await createUser("member")
  const mod = await createUser("mod", { role: "MODERATOR" })
  const admin = await createUser("admin", { role: "ADMINISTRATOR" })
  const users = [member, mod, admin]
  const feedbackIds: string[] = []

  try {
    const { cookie: memberCookie } = await login(member.username, member.password)
    const { cookie: modCookie } = await login(mod.username, mod.password)
    const { cookie: adminCookie } = await login(admin.username, admin.password)

    // ── /ops page gate ──────────────────────────────────────────────
    {
      const guest = await fetch(`${BASE}/ops`, { redirect: "manual" })
      // Unauthenticated → redirect to sign-in (307/308) — never the page.
      const loc = guest.headers.get("location") || ""
      ;[301, 302, 303, 307, 308].includes(guest.status) && loc.includes("signin")
        ? pass("guest /ops redirects to sign-in")
        : fail("guest /ops redirects to sign-in", { s: guest.status, loc })

      const mem = await fetch(`${BASE}/ops`, { redirect: "manual", headers: { cookie: memberCookie } })
      mem.status === 404
        ? pass("member /ops is 404 (no existence oracle)")
        : fail("member /ops is 404", { s: mem.status })

      const staff = await fetch(`${BASE}/ops`, { headers: { cookie: modCookie } })
      const html = await staff.text()
      staff.status === 200 && html.includes("Activation funnel") && html.includes("Unanswered discussions")
        ? pass("moderator /ops renders sections")
        : fail("moderator /ops renders sections", { s: staff.status })
    }

    // ── getOpsData shape + bounds ───────────────────────────────────
    {
      const data = await getOpsData()
      const shapeOk =
        typeof data.funnel7d.signups === "number" &&
        typeof data.funnel7d.activated === "number" &&
        typeof data.funnel30d.returned24h === "number" &&
        typeof data.health.uniqueContributors7d === "number" &&
        Array.isArray(data.unanswered) && data.unanswered.length <= 25 &&
        typeof data.trust.pendingFlags === "number" &&
        Array.isArray(data.security.rateLimitHits7d) &&
        typeof data.cron.tasksDone === "number"
      shapeOk ? pass("getOpsData returns all bounded sections") : fail("getOpsData returns all bounded sections", Object.keys(data))

      // No message bodies, no IPs: unanswered carries only public fields.
      const leak = data.unanswered.some((t) => JSON.stringify(t).length > 500)
      !leak ? pass("unanswered rows stay small/public") : fail("unanswered rows stay small/public")
    }

    // ── Feedback deviceType: server-derived, spoof-resistant ────────
    {
      const r = await fetch(`${BASE}/api/feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: memberCookie,
          "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile Safari/604.1",
        },
        body: JSON.stringify({ type: "BUG", title: "mobile nav overlap", message: "menu covers feed", pagePath: "/feed", deviceType: "desktop" }),
      })
      const d = await r.json().catch(() => ({}))
      if (r.status === 200 && d.id) {
        feedbackIds.push(d.id)
        const row = await prisma.feedback.findUnique({ where: { id: d.id } })
        row?.deviceType === "mobile"
          ? pass("deviceType derived from UA, body value ignored")
          : fail("deviceType derived from UA, body value ignored", { deviceType: row?.deviceType })
      } else {
        fail("member feedback with UA", { s: r.status, d })
      }

      // Desktop UA → desktop; no UA header → null (never guessed).
      const r2 = await fetch(`${BASE}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: memberCookie, "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        body: JSON.stringify({ type: "UX", title: "desktop check", message: "x" }),
      })
      const d2 = await r2.json().catch(() => ({}))
      if (d2.id) feedbackIds.push(d2.id)
      const row2 = d2.id ? await prisma.feedback.findUnique({ where: { id: d2.id } }) : null
      row2?.deviceType === "desktop"
        ? pass("desktop UA classified")
        : fail("desktop UA classified", { deviceType: row2?.deviceType })

      // Admin list exposes deviceType to staff (endpoint is admin-only;
      // the moderator session must NOT reach it).
      const denied = await fetch(`${BASE}/api/admin/feedback?status=NEW`, { headers: { cookie: modCookie } })
      denied.status === 403 ? pass("moderator cannot read admin feedback list") : fail("moderator cannot read admin feedback list", { s: denied.status })
      const listRes = await fetch(`${BASE}/api/admin/feedback?status=NEW`, { headers: { cookie: adminCookie } })
      const list = await listRes.json().catch(() => ({}))
      const item = (list.items || []).find((f: { id: string }) => feedbackIds.includes(f.id))
      item && "deviceType" in item
        ? pass("admin feedback list carries deviceType")
        : fail("admin feedback list carries deviceType", { s: listRes.status, keys: item ? Object.keys(item) : list })
    }
  } finally {
    if (feedbackIds.length) await prisma.feedback.deleteMany({ where: { id: { in: feedbackIds } } })
    for (const u of users) {
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    }
  }

  finish()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
