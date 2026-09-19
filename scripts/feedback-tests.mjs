// Feedback verification — auth boundary, source/field forcing, admin
// list + detail + PATCH, internal-notes privacy, rate limiting, pagination.
// Temp users/feedback fully cleaned up.
import "./db-guard.mjs"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const BASE = process.env.VERIFY_URL || "http://localhost:3000"
const prisma = new PrismaClient()
const results = []
function pass(n) { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
function fail(n, i) { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }

const TS = Date.now().toString(36)

async function createUser(tag, extra = {}) {
  const password = "VerifyPass123!"
  const user = await prisma.user.create({
    data: {
      name: `__fb_${tag}_${TS}`,
      ageVerified: true,
      password: await bcrypt.hash(password, 12),
      sessionVersion: 1,
      onboardingCompletedAt: new Date(),
      profile: { create: { username: `__fb_${tag}_${TS}` } },
      ...extra,
    },
    include: { profile: true },
  })
  return { ...user, password, username: user.profile.username }
}

async function login(username, password) {
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  const { csrfToken } = await csrfRes.json()
  const csrfCookie = (csrfRes.headers.getSetCookie?.() || [csrfRes.headers.get("set-cookie")]).filter(Boolean).map((c) => c.split(";")[0]).join("; ")
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", cookie: csrfCookie },
    body: new URLSearchParams({ csrfToken, username, password, json: "true" }),
    redirect: "manual",
  })
  const cookies = [...(csrfCookie ? [csrfCookie] : []), ...(res.headers.getSetCookie?.() || []).map((c) => c.split(";")[0])].join("; ")
  return { cookie: cookies }
}

async function callApi(path, { method = "GET", body, cookie } = {}) {
  const headers = {}
  if (body) headers["Content-Type"] = "application/json"
  if (cookie) headers["cookie"] = cookie
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: "manual" })
  } catch (e) {
    return { status: 0, data: { fetchError: String(e) } }
  }
  let data = null
  try { data = await res.json() } catch { /* html/redirect */ }
  return { status: res.status, data }
}

const main = async () => {
  const member = await createUser("member")
  const member2 = await createUser("member2")
  const banned = await createUser("banned")
  const admin = await createUser("admin", { role: "ADMINISTRATOR" })
  const users = [member, member2, banned, admin]
  const feedbackIds = []

  try {
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login" } } })
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "feedback" } } })

    await prisma.user.update({ where: { id: banned.id }, data: { banned: true } })

    const { cookie: memberCookie } = await login(member.username, member.password)
    const { cookie: member2Cookie } = await login(member2.username, member2.password)
    const { cookie: bannedCookie } = await login(banned.username, banned.password)
    const { cookie: adminCookie } = await login(admin.username, admin.password)
    ;[memberCookie, member2Cookie, bannedCookie, adminCookie].every(Boolean)
      ? pass("logins work")
      : fail("logins", "missing session cookie")

    // ── Authentication ──────────────────────────────────────────────
    {
      const r = await callApi("/api/feedback", { method: "POST", body: { type: "BUG", title: "anon", message: "anon" } })
      r.status === 401 ? pass("anonymous cannot submit") : fail("anonymous cannot submit", { s: r.status })

      // Banned users get 401 (session invalidated by the JWT callback) or
      // 403 from the route's defense-in-depth isBanned check — either rejects.
      const b = await callApi("/api/feedback", { method: "POST", cookie: bannedCookie, body: { type: "BUG", title: "t", message: "m" } })
      b.status === 401 || b.status === 403 ? pass("banned member cannot submit") : fail("banned member cannot submit", { s: b.status })
    }

    // ── Creation + context ──────────────────────────────────────────
    let firstId = null
    {
      const r = await callApi("/api/feedback", {
        method: "POST", cookie: memberCookie,
        body: { type: "UX", title: "Stats misaligned", message: "Columns are ragged on mobile.", pagePath: "/u/testuser" },
      })
      r.status === 200 && r.data?.id ? pass("member can submit") : fail("member can submit", { s: r.status, d: r.data })
      firstId = r.data?.id ?? null
      if (firstId) {
        feedbackIds.push(firstId)
        const row = await prisma.feedback.findUnique({ where: { id: firstId } })
        row?.source === "USER" && row?.pagePath === "/u/testuser" && row?.status === "NEW" && row?.priority === "NORMAL" && row?.authorId === member.id
          ? pass("route + source captured correctly")
          : fail("route + source captured correctly", row)
      } else {
        fail("route + source captured correctly", "no id returned")
      }
    }

    // ── Members cannot force privileged fields ──────────────────────
    {
      const r = await callApi("/api/feedback", {
        method: "POST", cookie: memberCookie,
        body: {
          type: "BUG", title: "spoof attempt", message: "trying to escalate",
          source: "ADMIN_OBSERVATION", status: "RESOLVED", priority: "HIGH",
          adminNotes: "secret", resolvedById: admin.id, authorId: admin.id,
        },
      })
      if (r.status === 200 && r.data?.id) {
        feedbackIds.push(r.data.id)
        const row = await prisma.feedback.findUnique({ where: { id: r.data.id } })
        row?.source === "USER" && row?.status === "NEW" && row?.priority === "NORMAL" && row?.adminNotes === null && row?.authorId === member.id && row?.resolvedById === null
          ? pass("members cannot spoof source/status/priority/notes/author")
          : fail("members cannot spoof source/status/priority/notes/author", row)
      } else {
        fail("members cannot spoof source/status/priority/notes/author", { s: r.status, d: r.data })
      }
    }

    // ── Validation ──────────────────────────────────────────────────
    // Probes run on the admin's /api/feedback budget — the rate limiter
    // counts rejected submissions, so member's 5/hr is already spent.
    {
      const bad = await callApi("/api/feedback", { method: "POST", cookie: adminCookie, body: { type: "BUG", title: " ", message: "x" } })
      bad.status === 400 ? pass("empty title rejected") : fail("empty title rejected", { s: bad.status })
      const bad2 = await callApi("/api/feedback", { method: "POST", cookie: adminCookie, body: { type: "BUG", title: "t", message: " " } })
      bad2.status === 400 ? pass("empty message rejected") : fail("empty message rejected", { s: bad2.status })
      const bad3 = await callApi("/api/feedback", { method: "POST", cookie: adminCookie, body: { type: "NOPE", title: "t", message: "m" } })
      bad3.status === 400 ? pass("invalid type rejected") : fail("invalid type rejected", { s: bad3.status })
      const bad4 = await callApi("/api/feedback", {
        method: "POST", cookie: adminCookie,
        body: { type: "BUG", title: "ext path", message: "m", pagePath: "https://evil.example/x" },
      })
      if (bad4.status === 200 && bad4.data?.id) {
        feedbackIds.push(bad4.data.id)
        const row = await prisma.feedback.findUnique({ where: { id: bad4.data.id } })
        row?.pagePath === null ? pass("external URL not stored as pagePath") : fail("external URL not stored as pagePath", row?.pagePath)
      } else {
        fail("external URL not stored as pagePath", { s: bad4.status })
      }
    }

    // ── Admin list + counts + filters ───────────────────────────────
    {
      const r = await callApi("/api/admin/feedback", { cookie: adminCookie })
      r.status === 200 && Array.isArray(r.data?.items) && r.data?.counts
        ? pass("admin can list feedback")
        : fail("admin can list feedback", { s: r.status })

      const m = await callApi("/api/admin/feedback", { cookie: memberCookie })
      m.status === 403 ? pass("member cannot list feedback") : fail("member cannot list feedback", { s: m.status })

      const a = await callApi("/api/admin/feedback")
      a.status === 403 ? pass("anonymous cannot list feedback") : fail("anonymous cannot list feedback", { s: a.status })

      const f = await callApi("/api/admin/feedback?status=NEW&type=UX&source=USER", { cookie: adminCookie })
      f.status === 200 && f.data.items.every((i) => i.status === "NEW" && i.type === "UX" && i.source === "USER")
        ? pass("filters apply correctly")
        : fail("filters apply correctly", { s: f.status, n: f.data?.items?.length })
    }

    // ── Privacy: members cannot read feedback at all ────────────────
    {
      // There is intentionally no member GET endpoint — verify neither
      // list nor detail leaks via admin routes or a guessed member route.
      const r1 = await callApi(`/api/admin/feedback/${firstId}`, { cookie: memberCookie })
      r1.status === 403 ? pass("member cannot read feedback detail") : fail("member cannot read feedback detail", { s: r1.status })
      const r2 = await callApi("/api/feedback", { cookie: member2Cookie })
      r2.status === 404 || r2.status === 405 ? pass("no member read endpoint exists") : fail("no member read endpoint exists", { s: r2.status })
    }

    // ── Admin detail exposes notes; member PATCH forbidden ──────────
    {
      const r = await callApi(`/api/admin/feedback/${firstId}`, { cookie: adminCookie })
      r.status === 200 && r.data?.item?.id === firstId && "adminNotes" in r.data.item
        ? pass("admin detail includes internal notes field")
        : fail("admin detail includes internal notes field", { s: r.status })

      const p = await callApi(`/api/admin/feedback/${firstId}`, {
        method: "PATCH", cookie: memberCookie,
        body: { status: "RESOLVED" },
      })
      p.status === 403 ? pass("member cannot modify feedback") : fail("member cannot modify feedback", { s: p.status })
    }

    // ── Admin PATCH lifecycle ───────────────────────────────────────
    {
      const r = await callApi(`/api/admin/feedback/${firstId}`, {
        method: "PATCH", cookie: adminCookie,
        body: { status: "IN_PROGRESS", priority: "HIGH", type: "BUG", adminNotes: "Confirmed on iPhone. Repro at 390px." },
      })
      if (r.status === 200) {
        const row = await prisma.feedback.findUnique({ where: { id: firstId } })
        row?.status === "IN_PROGRESS" && row?.priority === "HIGH" && row?.type === "BUG" && row?.adminNotes?.includes("390px")
          ? pass("admin can classify + annotate")
          : fail("admin can classify + annotate", row)
      } else {
        fail("admin can classify + annotate", { s: r.status })
      }

      const res = await callApi(`/api/admin/feedback/${firstId}`, {
        method: "PATCH", cookie: adminCookie, body: { status: "RESOLVED" },
      })
      const row = await prisma.feedback.findUnique({ where: { id: firstId } })
      res.status === 200 && row?.resolvedAt && row?.resolvedById === admin.id
        ? pass("RESOLVED stamps resolvedAt + resolvedById")
        : fail("RESOLVED stamps resolvedAt + resolvedById", { s: res.status, row })

      const bad = await callApi(`/api/admin/feedback/${firstId}`, {
        method: "PATCH", cookie: adminCookie, body: { status: "BANANA" },
      })
      bad.status === 400 ? pass("invalid status rejected") : fail("invalid status rejected", { s: bad.status })
    }

    // ── Admin observation ───────────────────────────────────────────
    {
      const r = await callApi("/api/admin/feedback", {
        method: "POST", cookie: adminCookie,
        body: { type: "UX", title: "Homepage feels crowded below the hero", message: "Observed during beta onboarding review.", pagePath: "/" },
      })
      if (r.status === 200 && r.data?.id) {
        feedbackIds.push(r.data.id)
        const row = await prisma.feedback.findUnique({ where: { id: r.data.id } })
        row?.source === "ADMIN_OBSERVATION" && row?.authorId === admin.id
          ? pass("admin observation created with correct source")
          : fail("admin observation created with correct source", row)
      } else {
        fail("admin observation created with correct source", { s: r.status })
      }

      const m = await callApi("/api/admin/feedback", {
        method: "POST", cookie: memberCookie,
        body: { type: "UX", title: "member trying admin route", message: "x" },
      })
      m.status === 403 ? pass("member cannot create admin observation") : fail("member cannot create admin observation", { s: m.status })
    }

    // ── Pagination bounded ──────────────────────────────────────────
    {
      // Seed 30 rows directly (member submissions are rate-limited by design).
      const bulk = await prisma.feedback.createMany({
        data: Array.from({ length: 30 }, (_, i) => ({
          authorId: member.id, type: "OTHER", status: "NEW",
          title: `__fb_bulk_${TS}_${i}`, message: "bulk pagination row",
        })),
      })
      const rows = await prisma.feedback.findMany({ where: { title: { startsWith: `__fb_bulk_${TS}` } }, select: { id: true } })
      feedbackIds.push(...rows.map((r) => r.id))

      const p1 = await callApi("/api/admin/feedback?page=1", { cookie: adminCookie })
      const p2 = await callApi("/api/admin/feedback?page=2", { cookie: adminCookie })
      p1.status === 200 && p1.data.items.length <= 25 && p1.data.pageSize === 25 && p2.status === 200
        ? pass("admin list is paginated and bounded")
        : fail("admin list is paginated and bounded", { s1: p1.status, n1: p1.data?.items?.length, s2: p2.status })
      void bulk
    }

    // ── Rate limiting ───────────────────────────────────────────────
    {
      // member already used some of the 5/hr budget; member2 is fresh.
      // Exhaust member2's budget: 5 allowed, 6th rejected.
      let last = 0
      for (let i = 0; i < 6; i++) {
        const r = await callApi("/api/feedback", {
          method: "POST", cookie: member2Cookie,
          body: { type: "OTHER", title: `__fb_rl_${TS}_${i}`, message: "rate limit probe" },
        })
        last = r.status
        if (r.data?.id) feedbackIds.push(r.data.id)
      }
      last === 429 ? pass("excess submissions rate-limited") : fail("excess submissions rate-limited", { last })
    }
  } finally {
    await prisma.feedback.deleteMany({ where: { id: { in: feedbackIds } } }).catch(() => {})
    await prisma.feedback.deleteMany({ where: { title: { startsWith: `__fb_` } } }).catch(() => {})
    await prisma.profile.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } }).catch(() => {})
    await prisma.$disconnect()
  }

  const passed = results.filter(([r]) => r === "PASS").length
  console.log(`\n${passed}/${results.length} passed`)
  if (passed !== results.length) process.exit(1)
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
