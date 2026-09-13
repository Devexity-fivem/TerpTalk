// Trust & Safety workqueue verification — permissions matrix, reporter
// privacy, case state transitions, assignment, bulk bounds, IDOR, flags,
// and admin reputation endpoints. Creates temp users/cases, cleans up fully.
// Requires a dev server: VERIFY_URL (default http://localhost:3000).
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"

const BASE = process.env.VERIFY_URL || "http://localhost:3000"
const prisma = new PrismaClient()
const results = []
function pass(n) { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
function fail(n, i) { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }

async function createUser(tag, role = "MEMBER") {
  const password = "VerifyPass123!"
  const user = await prisma.user.create({
    data: {
      name: `__ts_${tag}_${Date.now()}`,
      ageVerified: true,
      password: await bcrypt.hash(password, 12),
      sessionVersion: 1,
      onboardingCompletedAt: new Date(),
      role,
      profile: { create: { username: `__ts_${tag}_${Date.now().toString(36)}` } },
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
  return cookies
}

async function api(path, { method = "GET", body, cookie } = {}) {
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
  try { data = await res.json() } catch { /* non-json */ }
  return { status: res.status, data }
}

const main = async () => {
  const reporter = await createUser("reporter")
  const target = await createUser("target")
  const support = await createUser("support", "SUPPORT")
  const mod = await createUser("mod", "MODERATOR")
  const admin = await createUser("admin", "ADMINISTRATOR")
  const modReporter = await createUser("modrep", "MODERATOR")

  const users = [reporter, target, support, mod, admin, modReporter]
  const flagIds = []
  let thread = null

  try {
    const category = await prisma.category.findFirst({ where: { hidden: false }, select: { id: true } })
    thread = await prisma.thread.create({
      data: {
        title: `__ts thread ${Date.now()}`,
        slug: `__ts-t-${Date.now()}`,
        content: "trust & safety verification thread",
        categoryId: category.id,
        authorId: target.id,
      },
    })

    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login" } } })
    const reporterC = await login(reporter.username, reporter.password)
    const supportC = await login(support.username, support.password)
    const modC = await login(mod.username, mod.password)
    const adminC = await login(admin.username, admin.password)
    const modRepC = await login(modReporter.username, modReporter.password)

    // ── A. Queue permissions matrix ─────────────────────────────────
    {
      const anon = await api("/api/moderation/queue")
      anon.status === 401 || anon.status === 403 ? pass("anon → queue denied") : fail("anon queue", anon.status)
      const member = await api("/api/moderation/queue", { cookie: reporterC })
      member.status === 403 ? pass("member → queue 403") : fail("member queue", member.status)
      for (const [who, c] of [["support", supportC], ["mod", modC], ["admin", adminC]]) {
        const r = await api("/api/moderation/queue", { cookie: c })
        r.status === 200 && Array.isArray(r.data.items) && r.data.counts ? pass(`${who} → queue 200`) : fail(`${who} queue`, r.status)
      }
      const staffAnon = await api("/api/moderation/queue/staff")
      staffAnon.status === 403 || staffAnon.status === 401 ? pass("anon → staff list denied") : fail("anon staff", staffAnon.status)
      const staffSupport = await api("/api/moderation/queue/staff", { cookie: supportC })
      staffSupport.status === 403 ? pass("support → staff list 403") : fail("support staff", staffSupport.status)
      const staffMod = await api("/api/moderation/queue/staff", { cookie: modC })
      staffMod.status === 200 && staffMod.data.staff?.some((s) => s.username === support.username)
        ? pass("mod → staff list includes support") : fail("mod staff list", staffMod.status)
    }

    // ── B. Report intake ────────────────────────────────────────────
    let reportId = null
    {
      const r = await api("/api/reports", {
        method: "POST", cookie: reporterC,
        body: { type: "THREAD", targetId: thread.id, reason: "HARASSMENT", description: "verification report" },
      })
      r.status === 201 ? pass("report submitted") : fail("report submit", r)
      const row = await prisma.report.findFirst({ where: { reporterId: reporter.id, targetId: thread.id } })
      if (row) {
        reportId = row.id
        row.priority === "HIGH" ? pass("report priority derived (HARASSMENT→HIGH)") : fail("priority derive", row.priority)
      } else fail("report row missing")

      const dup = await api("/api/reports", {
        method: "POST", cookie: reporterC,
        body: { type: "THREAD", targetId: thread.id, reason: "SPAM" },
      })
      dup.status === 409 ? pass("duplicate open report → 409") : fail("dup report", dup.status)

      const self = await api("/api/reports", {
        method: "POST", cookie: reporterC,
        body: { type: "PROFILE", targetId: reporter.id, reason: "SPAM" },
      })
      self.status === 400 ? pass("self-report → 400") : fail("self-report", self.status)
    }

    // ── C. Reporter privacy ─────────────────────────────────────────
    {
      const supportQ = await api("/api/moderation/queue", { cookie: supportC })
      const sItem = supportQ.data.items?.find((i) => i.id === reportId)
      sItem && sItem.reporter === null ? pass("SUPPORT: reporter masked") : fail("support reporter mask", sItem?.reporter)

      const modQ = await api("/api/moderation/queue", { cookie: modC })
      const mItem = modQ.data.items?.find((i) => i.id === reportId)
      mItem && mItem.reporter === reporter.username ? pass("MOD: reporter visible") : fail("mod reporter", mItem?.reporter)

      const memberCase = await api(`/api/moderation/queue/${reportId}?kind=REPORT`, { cookie: reporterC })
      memberCase.status === 403 ? pass("member → case detail 403") : fail("member case", memberCase.status)

      const supportCase = await api(`/api/moderation/queue/${reportId}?kind=REPORT`, { cookie: supportC })
      supportCase.status === 200 && supportCase.data.item?.reporter === null && !supportCase.data.subject?.recentReputation
        ? pass("SUPPORT case: masked reporter, summary-only context")
        : fail("support case", { s: supportCase.status, rep: supportCase.data?.item?.reporter })

      const modCase = await api(`/api/moderation/queue/${reportId}?kind=REPORT`, { cookie: modC })
      modCase.status === 200 && modCase.data.item?.reporter === reporter.username &&
        Array.isArray(modCase.data.subject?.recentReputation) && modCase.data.subject?.suspendedUntil !== undefined
        ? pass("MOD case: reporter + full context (suspendedUntil, rep events)")
        : fail("mod case", { s: modCase.status, keys: Object.keys(modCase.data?.subject ?? {}) })
    }

    // ── D. Triage + state transitions ───────────────────────────────
    {
      const triage = await api("/api/moderation/queue", {
        method: "PATCH", cookie: supportC,
        body: { kind: "REPORT", id: reportId, action: "status", status: "REVIEWING" },
      })
      triage.status === 200 ? pass("SUPPORT → REVIEWING (triage)") : fail("support triage", triage.status)

      const resolve = await api("/api/moderation/queue", {
        method: "PATCH", cookie: supportC,
        body: { kind: "REPORT", id: reportId, action: "status", status: "RESOLVED" },
      })
      resolve.status === 403 ? pass("SUPPORT → RESOLVED denied") : fail("support resolve", resolve.status)

      const assign = await api("/api/moderation/queue", {
        method: "PATCH", cookie: supportC,
        body: { kind: "REPORT", id: reportId, action: "assign", assignTo: mod.id },
      })
      assign.status === 403 ? pass("SUPPORT → assign denied") : fail("support assign", assign.status)

      const badStatus = await api("/api/moderation/queue", {
        method: "PATCH", cookie: modC,
        body: { kind: "REPORT", id: reportId, action: "status", status: "BOGUS" },
      })
      badStatus.status === 400 ? pass("invalid status → 400") : fail("bad status", badStatus.status)

      const missing = await api("/api/moderation/queue", {
        method: "PATCH", cookie: modC,
        body: { kind: "REPORT", id: "nonexistent", action: "status", status: "RESOLVED" },
      })
      missing.status === 404 ? pass("unknown case → 404") : fail("missing case", missing.status)

      // IDOR: report id under kind=FLAG must not resolve
      const idor = await api("/api/moderation/queue", {
        method: "PATCH", cookie: modC,
        body: { kind: "FLAG", id: reportId, action: "status", status: "RESOLVED" },
      })
      idor.status === 404 ? pass("IDOR: report id as FLAG → 404") : fail("idor", idor.status)

      const assignR = await api("/api/moderation/queue", {
        method: "PATCH", cookie: modC,
        body: { kind: "REPORT", id: reportId, action: "assign", assignTo: admin.id },
      })
      assignR.status === 200 ? pass("mod → assign to admin") : fail("assign", assignR.status)
      const assigned = await prisma.report.findUnique({ where: { id: reportId } })
      assigned?.assignedToId === admin.id ? pass("assignedToId persisted") : fail("assign persist", assigned?.assignedToId)
      const assignAction = await prisma.moderationAction.findFirst({
        where: { reportId, type: "REPORT_ASSIGNED", moderatorId: mod.id },
      })
      assignAction ? pass("REPORT_ASSIGNED audit row linked to case") : fail("assign audit")

      const badAssignee = await api("/api/moderation/queue", {
        method: "PATCH", cookie: modC,
        body: { kind: "REPORT", id: reportId, action: "assign", assignTo: reporter.id },
      })
      badAssignee.status === 400 ? pass("assign to non-staff → 400") : fail("bad assignee", badAssignee.status)

      const pri = await api("/api/moderation/queue", {
        method: "PATCH", cookie: modC,
        body: { kind: "REPORT", id: reportId, action: "priority", priority: "URGENT" },
      })
      pri.status === 200 ? pass("priority override") : fail("priority", pri.status)
      const priAction = await prisma.moderationAction.findFirst({ where: { reportId, type: "REPORT_PRIORITY" } })
      priAction ? pass("REPORT_PRIORITY audit row") : fail("priority audit")

      const esc = await api("/api/moderation/queue", {
        method: "PATCH", cookie: modC,
        body: { kind: "REPORT", id: reportId, action: "status", status: "ESCALATED" },
      })
      esc.status === 200 ? pass("mod → ESCALATED") : fail("escalate", esc.status)

      const res = await api("/api/moderation/queue", {
        method: "PATCH", cookie: modC,
        body: { kind: "REPORT", id: reportId, action: "status", status: "RESOLVED", resolution: "verified resolution" },
      })
      res.status === 200 ? pass("mod → RESOLVED") : fail("resolve", res.status)
      const resolved = await prisma.report.findUnique({ where: { id: reportId } })
      resolved?.resolvedById === mod.id && resolved?.resolvedAt && resolved?.resolution === "verified resolution"
        ? pass("resolvedBy/resolvedAt/resolution recorded") : fail("resolve fields", resolved)
      const resAction = await prisma.moderationAction.findFirst({
        where: { reportId, type: "REPORT_RESOLVED", moderatorId: mod.id },
      })
      resAction ? pass("REPORT_RESOLVED audit row linked") : fail("resolve audit")
    }

    // ── E. Self-adjudication guard ──────────────────────────────────
    {
      await api("/api/reports", {
        method: "POST", cookie: modRepC,
        body: { type: "THREAD", targetId: thread.id, reason: "SPAM" },
      })
      const ownReport = await prisma.report.findFirst({
        where: { reporterId: modReporter.id, targetId: thread.id, status: { in: ["PENDING", "REVIEWING", "ESCALATED"] } },
      })
      if (!ownReport) fail("mod-filed report missing")
      else {
        const own = await api("/api/moderation/queue", {
          method: "PATCH", cookie: modRepC,
          body: { kind: "REPORT", id: ownReport.id, action: "status", status: "RESOLVED" },
        })
        own.status === 403 ? pass("staff cannot resolve own report") : fail("own report", own.status)
      }
    }

    // ── F. Abuse flags in the queue ─────────────────────────────────
    let flagId = null
    {
      const flag = await prisma.abuseFlag.create({
        data: {
          signal: "REP_VELOCITY",
          userId: target.id,
          key: `repvel:${target.id}:${new Date().toISOString().slice(0, 10)}`,
          evidence: { gained: 999, window: "24h", threshold: 150 },
          priority: "HIGH",
          updatedAt: new Date(),
        },
      })
      flagIds.push(flag.id)
      flagId = flag.id

      const q = await api("/api/moderation/queue?kind=FLAG", { cookie: modC })
      const fItem = q.data.items?.find((i) => i.id === flagId)
      fItem && fItem.kind === "FLAG" && fItem.signalLabel ? pass("flag appears in queue") : fail("flag in queue", q.status)

      const detail = await api(`/api/moderation/queue/${flagId}?kind=FLAG`, { cookie: modC })
      detail.status === 200 && detail.data.item?.evidence?.gained === 999 && detail.data.subject?.username === target.username
        ? pass("flag case detail: evidence + subject") : fail("flag detail", detail.status)

      const flagSupport = await api(`/api/moderation/queue/${flagId}?kind=FLAG`, { cookie: supportC })
      flagSupport.status === 200 ? pass("support → flag case viewable") : fail("support flag", flagSupport.status)

      const flagDismiss = await api("/api/moderation/queue", {
        method: "PATCH", cookie: modC,
        body: { kind: "FLAG", id: flagId, action: "status", status: "DISMISSED", resolution: "legitimate activity" },
      })
      flagDismiss.status === 200 ? pass("flag dismissed") : fail("flag dismiss", flagDismiss.status)
      const flagAction = await prisma.moderationAction.findFirst({
        where: { flagId, type: "FLAG_DISMISSED", moderatorId: mod.id },
      })
      flagAction ? pass("FLAG_DISMISSED audit row linked") : fail("flag audit")
    }

    // ── G. Bulk actions ─────────────────────────────────────────────
    {
      const bulkReports = []
      for (let i = 0; i < 3; i++) {
        const r = await prisma.report.create({
          data: {
            type: "PROFILE", reason: "OTHER", description: `bulk ${i}`,
            reporterId: reporter.id, reportedId: target.id, targetId: target.id,
          },
        })
        bulkReports.push(r.id)
      }

      const memberBulk = await api("/api/moderation/queue/bulk", {
        method: "POST", cookie: reporterC,
        body: { items: bulkReports.map((id) => ({ kind: "REPORT", id })), action: "resolve" },
      })
      memberBulk.status === 403 ? pass("member → bulk 403") : fail("member bulk", memberBulk.status)

      const supportBulk = await api("/api/moderation/queue/bulk", {
        method: "POST", cookie: supportC,
        body: { items: bulkReports.map((id) => ({ kind: "REPORT", id })), action: "resolve" },
      })
      supportBulk.status === 403 ? pass("support → bulk 403") : fail("support bulk", supportBulk.status)

      const empty = await api("/api/moderation/queue/bulk", {
        method: "POST", cookie: modC, body: { items: [], action: "resolve" },
      })
      empty.status === 400 ? pass("bulk empty → 400") : fail("bulk empty", empty.status)

      const tooMany = await api("/api/moderation/queue/bulk", {
        method: "POST", cookie: modC,
        body: { items: Array.from({ length: 51 }, (_, i) => ({ kind: "REPORT", id: `x${i}` })), action: "resolve" },
      })
      tooMany.status === 400 ? pass("bulk >50 → 400") : fail("bulk >50", tooMany.status)

      const badAction = await api("/api/moderation/queue/bulk", {
        method: "POST", cookie: modC,
        body: { items: bulkReports.map((id) => ({ kind: "REPORT", id })), action: "ban" },
      })
      badAction.status === 400 ? pass("bulk enforcement action → 400") : fail("bulk action", badAction.status)

      const bulk = await api("/api/moderation/queue/bulk", {
        method: "POST", cookie: modC,
        body: { items: [...bulkReports.map((id) => ({ kind: "REPORT", id })), { kind: "REPORT", id: "missing" }], action: "resolve" },
      })
      bulk.status === 200 && bulk.data.succeeded === 3 && bulk.data.failed?.length === 1
        ? pass("bulk resolve: 3 ok + 1 not-found") : fail("bulk resolve", bulk.data)
      const resolvedCount = await prisma.report.count({ where: { id: { in: bulkReports }, status: "RESOLVED", resolvedById: mod.id } })
      resolvedCount === 3 ? pass("bulk resolved rows stamped") : fail("bulk rows", resolvedCount)
      const bulkAudit = await prisma.moderationAction.count({ where: { reportId: { in: bulkReports }, type: "REPORT_RESOLVED" } })
      bulkAudit === 3 ? pass("bulk audit rows per item") : fail("bulk audit", bulkAudit)
    }

    // ── H. Admin reputation endpoints over HTTP ─────────────────────
    {
      for (const [who, c] of [["member", reporterC], ["support", supportC], ["mod", modC]]) {
        const r = await api("/api/admin/reputation/flags", { cookie: c })
        r.status === 403 ? pass(`${who} → flags 403`) : fail(`${who} flags`, r.status)
      }
      const flags = await api("/api/admin/reputation/flags", { cookie: adminC })
      flags.status === 200 && "velocity" in flags.data && "staffActions" in flags.data
        ? pass("admin → flags sections") : fail("admin flags", flags.status)

      const zero = await api("/api/admin/reputation", {
        method: "POST", cookie: adminC, body: { username: target.username, delta: 0, reason: "x" },
      })
      zero.status === 400 ? pass("admin rep delta 0 → 400") : fail("delta 0", zero.status)

      const over = await api("/api/admin/reputation", {
        method: "POST", cookie: adminC, body: { username: target.username, delta: 501, reason: "x" },
      })
      over.status === 400 ? pass("admin rep delta >500 → 400") : fail("delta >500", over.status)

      const selfAdj = await api("/api/admin/reputation", {
        method: "POST", cookie: adminC, body: { username: admin.username, delta: 10, reason: "x" },
      })
      selfAdj.status === 403 ? pass("admin self-adjust → 403") : fail("self adjust", selfAdj.status)

      const modAdj = await api("/api/admin/reputation", {
        method: "POST", cookie: modC, body: { username: target.username, delta: 10, reason: "x" },
      })
      modAdj.status === 403 ? pass("mod → admin rep endpoint 403") : fail("mod adjust", modAdj.status)

      const ok = await api("/api/admin/reputation", {
        method: "POST", cookie: adminC, body: { username: target.username, delta: 10, reason: "verification" },
      })
      ok.status === 200 ? pass("admin rep adjust works") : fail("admin adjust", ok.status)
      const adjAction = await prisma.moderationAction.findFirst({
        where: { targetUserId: target.id, type: "REPUTATION_ADJUSTMENT", moderatorId: admin.id },
      })
      adjAction ? pass("REPUTATION_ADJUSTMENT audit row") : fail("adjust audit")
    }

    // ── I. Queue rate limit ─────────────────────────────────────────
    {
      await prisma.rateLimit.upsert({
        where: { key: `queue:${mod.id}` },
        create: { key: `queue:${mod.id}`, count: 999, expiresAt: new Date(Date.now() + 60000) },
        update: { count: 999, expiresAt: new Date(Date.now() + 60000) },
      })
      const limited = await api("/api/moderation/queue", { cookie: modC })
      limited.status === 429 ? pass("queue rate limit → 429") : fail("queue 429", limited.status)
      await prisma.rateLimit.delete({ where: { key: `queue:${mod.id}` } }).catch(() => {})
    }
  } finally {
    // Cleanup — users cascade reports/actions/notifications; flags + thread
    // have no FK and need explicit removal.
    await prisma.abuseFlag.deleteMany({ where: { id: { in: flagIds } } }).catch(() => {})
    if (thread) await prisma.thread.delete({ where: { id: thread.id } }).catch(() => {})
    for (const u of users) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    await prisma.rateLimit.deleteMany({
      where: { key: { contains: "__ts_" } },
    }).catch(() => {})
    for (const u of users) {
      for (const prefix of ["queue", "queue-mutate", "queue-case", "queue-staff", "queue-bulk", "report", "mod-reports", "mod-reports-mutate", "admin-rep-flags", "admin-reputation"]) {
        await prisma.rateLimit.delete({ where: { key: `${prefix}:${u.id}` } }).catch(() => {})
      }
    }
    await prisma.$disconnect()
  }

  const passed = results.filter(([r]) => r === "PASS").length
  const failed = results.filter(([r]) => r === "FAIL").length
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
