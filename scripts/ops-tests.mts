// Ops surface verification — /ops staff gate (guest/member/staff), ops
// metrics shape + bounds, feedback deviceType capture + spoof resistance.
// Temp users/feedback fully cleaned up.
import "./db-guard.mjs"
import { makeHarness } from "./lib/http-harness.mjs"
import { getOpsData, getGrowthDetail, searchMembers } from "@/lib/ops-metrics"

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

    // ── /ops consolidation + /admin command-center gates ────────────
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

      // Staff /ops redirects into /admin (consolidated destination).
      const staff = await fetch(`${BASE}/ops`, { redirect: "manual", headers: { cookie: modCookie } })
      const staffLoc = staff.headers.get("location") || ""
      ;[301, 302, 303, 307, 308].includes(staff.status) && staffLoc.includes("/admin")
        ? pass("staff /ops redirects to /admin")
        : fail("staff /ops redirects to /admin", { s: staff.status, loc: staffLoc })
    }

    // ── Command-center role matrix ──────────────────────────────────
    {
      // Guests: every section sends them to sign-in.
      const guestAdmin = await fetch(`${BASE}/admin`, { redirect: "manual" })
      const gLoc = guestAdmin.headers.get("location") || ""
      ;[301, 302, 303, 307, 308].includes(guestAdmin.status) && gLoc.includes("signin")
        ? pass("guest /admin redirects to sign-in")
        : fail("guest /admin redirects to sign-in", { s: guestAdmin.status, loc: gLoc })

      // Members: 404 — no existence oracle, even on subsections.
      const memberPaths = ["/admin", "/admin/community", "/admin/members", "/admin/growth", "/admin/system", "/admin/manage"]
      let memberBlocked = true
      for (const p of memberPaths) {
        const r = await fetch(`${BASE}${p}`, { redirect: "manual", headers: { cookie: memberCookie } })
        if (r.status !== 404) memberBlocked = false
      }
      memberBlocked
        ? pass("member gets 404 on all admin sections")
        : fail("member gets 404 on all admin sections")

      // Moderator: overview + community + members render.
      for (const [p, marker] of [["/admin", "Overview"], ["/admin/community", "Unanswered discussions"], ["/admin/members", "Members"]] as const) {
        const r = await fetch(`${BASE}${p}`, { headers: { cookie: modCookie } })
        const html = await r.text()
        r.status === 200 && html.includes(marker)
          ? pass(`moderator ${p} renders`)
          : fail(`moderator ${p} renders`, { s: r.status })
      }

      // Moderator: admin-only sections deny (not just hidden nav).
      for (const p of ["/admin/growth", "/admin/system", "/admin/manage"]) {
        const r = await fetch(`${BASE}${p}`, { redirect: "manual", headers: { cookie: modCookie } })
        ;[403, 404].includes(r.status)
          ? pass(`moderator denied ${p}`)
          : fail(`moderator denied ${p}`, { s: r.status })
      }

      // Admin initial page access is exercised via browser QA (the manage
      // page is client-gated; HTTP-level gate lives in its APIs).
      const adminSys = await fetch(`${BASE}/admin/system`, { headers: { cookie: adminCookie } })
      const sysHtml = await adminSys.text()
      adminSys.status === 200 && sysHtml.includes("Rate limits")
        ? pass("admin /admin/system renders")
        : fail("admin /admin/system renders", { s: adminSys.status })
      const adminGrowth = await fetch(`${BASE}/admin/growth`, { headers: { cookie: adminCookie } })
      const growthHtml = await adminGrowth.text()
      adminGrowth.status === 200 && growthHtml.includes("Activation")
        ? pass("admin /admin/growth renders")
        : fail("admin /admin/growth renders", { s: adminGrowth.status })

      // Activation report + social loop render on the growth page, and the
      // overview shows Moment volume — aggregate labels only, no member
      // identity in the markup.
      const growthMarkers = ["Milestone ladder", "Received a response", "Step conversions",
        "Return by first contribution", "Return by push status", "Push lifecycle", "Social loop"]
      growthMarkers.every((mk) => growthHtml.includes(mk))
        ? pass("growth page renders milestone ladder, response, push + social-loop sections")
        : fail("growth sections", { missing: growthMarkers.filter((mk) => !growthHtml.includes(mk)) })
      !growthHtml.includes(member.username) && !growthHtml.includes(member.id)
        ? pass("growth page stays aggregate (no member identity in markup)")
        : fail("growth page privacy")
      const adminHome = await fetch(`${BASE}/admin`, { headers: { cookie: adminCookie } })
      const adminHtml = await adminHome.text()
      adminHome.status === 200 && adminHtml.includes("Moment posts") && adminHtml.includes("Moment comments")
        ? pass("admin overview shows Moment post/comment volume")
        : fail("admin overview moments", { s: adminHome.status })
      adminHtml.includes("Resolved (7d)") && adminHtml.includes("Median time to close")
        ? pass("admin overview renders queue-health fields")
        : fail("admin overview queue-health labels")

      // Moderation queue GET returns the health block for staff.
      const qRes = await fetch(`${BASE}/api/moderation/queue?status=OPEN`, { headers: { cookie: modCookie } })
      const qData = await qRes.json().catch(() => ({}))
      const hq = qData?.counts?.health
      qRes.status === 200 && hq &&
        typeof hq.resolved7d === "number" &&
        (hq.medianResolveHours30d === null || typeof hq.medianResolveHours30d === "number") &&
        (hq.oldestOpenDays === null || typeof hq.oldestOpenDays === "number")
        ? pass("queue API returns health block (resolved7d/median/oldest)")
        : fail("queue health block", { s: qRes.status, hq })

      // New admin-only sections deny moderators at the page level.
      for (const p of ["/admin/retention", "/admin/experiments"]) {
        const r = await fetch(`${BASE}${p}`, { redirect: "manual", headers: { cookie: modCookie } })
        ;[403, 404].includes(r.status)
          ? pass(`moderator denied ${p}`)
          : fail(`moderator denied ${p}`, { s: r.status })
        const a = await fetch(`${BASE}${p}`, { headers: { cookie: adminCookie } })
        a.status === 200
          ? pass(`admin ${p} renders`)
          : fail(`admin ${p} renders`, { s: a.status })
      }
    }

    // ── Growth detail shape + bounds ────────────────────────────────
    {
      const g = await getGrowthDetail()
      const ok =
        typeof g.firstAction30d.sampleSize === "number" &&
        Array.isArray(g.firstAction30d.byFirstAction) &&
        g.cohorts.length === 4 &&
        g.cohorts.every((c) => typeof c.signups === "number" && typeof c.returned24h === "number") &&
        typeof g.diary.diaries === "number" &&
        g.diary.noUpdates + g.diary.oneUpdate + g.diary.fewUpdates + g.diary.manyUpdates === g.diary.diaries &&
        typeof g.chat.uniqueChatters7d === "number" &&
        typeof g.bot.uniqueUsers7d === "number" &&
        typeof g.feedback.total === "number"
      ok ? pass("getGrowthDetail returns bounded sections") : fail("getGrowthDetail returns bounded sections", Object.keys(g))
      // First-action rows never leak member identity.
      const leak = JSON.stringify(g.firstAction30d.byFirstAction).match(/@|email|userId|authorId/i)
      !leak ? pass("first-action rows carry no member identity") : fail("first-action rows carry no member identity", leak)
    }

    // ── Experiments/change-log API ──────────────────────────────────
    {
      const denied = await fetch(`${BASE}/api/admin/experiments`, { headers: { cookie: modCookie } })
      denied.status === 403
        ? pass("moderator denied experiments API")
        : fail("moderator denied experiments API", { s: denied.status })

      const created = await fetch(`${BASE}/api/admin/experiments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ kind: "EXPERIMENT", title: "__ops_test change", description: "verify workflow", surface: "composer", hypothesis: "none", primaryMetric: "n/a" }),
      })
      const cd = await created.json().catch(() => ({}))
      if (created.status === 200 && cd.id) {
        pass("admin creates experiment record")
        const patch = await fetch(`${BASE}/api/admin/experiments/${cd.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", cookie: adminCookie },
          body: JSON.stringify({ status: "CONCLUDED", result: "verified in test", conclusion: "ok" }),
        })
        patch.status === 200 ? pass("admin concludes experiment") : fail("admin concludes experiment", { s: patch.status })
        await prisma.productChange.delete({ where: { id: cd.id } }).catch(() => {})
      } else {
        fail("admin creates experiment record", { s: created.status, d: cd })
      }

      // Members get nothing — not even the list.
      const memberList = await fetch(`${BASE}/api/admin/experiments`, { headers: { cookie: memberCookie } })
      memberList.status === 403
        ? pass("member denied experiments API")
        : fail("member denied experiments API", { s: memberList.status })
    }

    // ── Member search bounds + privacy ──────────────────────────────
    {
      const tooShort = await searchMembers("x")
      tooShort.length === 0
        ? pass("member search rejects <2 chars")
        : fail("member search rejects <2 chars", { n: tooShort.length })
      const hits = await searchMembers("__ops_member")
      const hit = hits.find((m) => m.username.toLowerCase().includes("__ops_member"))
      const keys = hit ? Object.keys(hit) : []
      const safe = hit && !("email" in hit) && !("password" in hit) && !("bio" in hit)
      hit && safe
        ? pass("member search returns bounded safe fields")
        : fail("member search returns bounded safe fields", { keys })
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

      // Queue-health extension — resolution rate, median close time
      // (null under n<5), open-age buckets, per-moderator workload.
      const t = data.trust
      const healthOk =
        typeof t.resolved7d === "number" &&
        (t.medianResolveHours30d === null || typeof t.medianResolveHours30d === "number") &&
        t.openAge.under24h + t.openAge.days1to3 + t.openAge.days3to7 + t.openAge.over7d >= 0 &&
        Array.isArray(t.actionsByModerator7d) &&
        t.actionsByModerator7d.every((m) => typeof m.moderator === "string" && typeof m.count === "number")
      healthOk ? pass("trust queue-health fields present and shaped") : fail("trust queue-health", t)
      // Workload rows carry handles only — never raw user ids.
      t.actionsByModerator7d.every((m) => m.moderator.startsWith("@") && !/^@?c[a-z0-9]{20,}$/i.test(m.moderator))
        ? pass("moderator workload rows carry handles only")
        : fail("moderator workload leak", t.actionsByModerator7d)

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

    // ── Moments parity in ops metrics ─────────────────────────────
    // Baseline-diff: suites run serially and clean up, so the delta
    // between two real metric calls is attributable to these fixtures.
    {
      const baseOps = await getOpsData()
      const baseGrowth = await getGrowthDetail()

      const mPoster = await createUser("mposter")   // authored moment only
      const mCommenter = await createUser("mcomment") // moment comment only
      const mReactor = await createUser("mreact")   // reaction only — never a contribution
      const mReposter = await createUser("mrepost") // pure repost only — amplification
      const mQuoter = await createUser("mquote")    // quote post — authored content
      const mReferred = await createUser("mref")    // referred, moment only
      const chatter = await createUser("mchatter")  // chat + moment → multi-surface
      const botUser = await createUser("mbot")      // TerpBot + moment comment
      const mDeleted = await createUser("mdeleted") // only contribution deleted
      users.push(mPoster, mCommenter, mReactor, mReposter, mQuoter, mReferred, chatter, botUser, mDeleted)

      await prisma.profile.update({ where: { userId: mReferred.id }, data: { referredById: admin.profile!.id } })
      const room = await prisma.chatRoom.findFirst({ select: { id: true } })
      if (!room) throw new Error("no seeded chat room for ops fixture")

      const anchor = await prisma.moment.create({ data: { authorId: mPoster.id, kind: "POST", content: `__ops moment ${TS}` } })
      const mkMoment = (authorId: string, extra: Record<string, unknown> = {}) =>
        prisma.moment.create({ data: { authorId, kind: "POST", content: `__ops m ${TS}`, ...extra } })
      await mkMoment(mReferred.id)
      await mkMoment(mDeleted.id).then((m) => prisma.moment.update({ where: { id: m.id }, data: { deleted: true } }))
      await mkMoment(mReposter.id, { content: "", repostOfId: anchor.id }) // pure repost
      await mkMoment(mQuoter.id, { repostOfId: anchor.id })                // quote: content + repostOfId
      await mkMoment(chatter.id, { createdAt: new Date(Date.now() - 2 * 3_600_000) })
      await prisma.momentComment.create({ data: { momentId: anchor.id, authorId: mCommenter.id, content: `__ops c ${TS}` } })
      await prisma.momentComment.create({ data: { momentId: anchor.id, authorId: botUser.id, content: `__ops c2 ${TS}` } })
      await prisma.reaction.create({ data: { userId: mReactor.id, momentId: anchor.id, type: "LIKE" } })
      await prisma.chatMessage.create({ data: { roomId: room.id, authorId: chatter.id, content: `__ops chat ${TS}`, createdAt: new Date(Date.now() - 3_600_000) } })
      await prisma.botEvent.create({ data: { type: "COMMAND_SLASH", command: "ask", userId: botUser.id, key: `__ops_bot_${TS}` } })

      const ops = await getOpsData()
      const growth = await getGrowthDetail()

      // Funnel: moment post / comment / quote each activate; reaction and
      // pure repost never do. mDeleted counts — the funnel measures that a
      // contribution happened, symmetric with deleted forum posts.
      const f = ops.funnel7d, bf = baseOps.funnel7d
      const funnelOk =
        f.signups === bf.signups + 9 &&
        f.activated === bf.activated + 7 &&
        f.firstMoment === bf.firstMoment + 5 &&
        f.firstMomentComment === bf.firstMomentComment + 2 &&
        f.referredSignups === bf.referredSignups + 1 &&
        f.referredActivated === bf.referredActivated + 1
      funnelOk
        ? pass("funnel counts moment contributions; reaction/pure-repost excluded")
        : fail("funnel moments parity", { f: { s: f.signups, a: f.activated, m: f.firstMoment, mc: f.firstMomentComment, rs: f.referredSignups, ra: f.referredActivated }, b: { s: bf.signups, a: bf.activated, m: bf.firstMoment, mc: bf.firstMomentComment, rs: bf.referredSignups, ra: bf.referredActivated } })

      // Retention cohorts use the same contribution definition.
      const cohortDelta = growth.cohorts[0].activated - baseGrowth.cohorts[0].activated
      cohortDelta === 7
        ? pass("retention cohort counts moment-only activated members")
        : fail("cohort activation delta", cohortDelta)

      // Community health: live-row union — deleted/repost/reaction excluded.
      const h = ops.health, bh = baseOps.health
      const healthOk =
        h.uniqueContributors7d === bh.uniqueContributors7d + 6 &&
        h.moments7d === bh.moments7d + 4 &&
        h.momentComments7d === bh.momentComments7d + 2
      healthOk
        ? pass("community health: unique contributors + moment counts")
        : fail("community health", { h: { u: h.uniqueContributors7d, m: h.moments7d, mc: h.momentComments7d }, b: { u: bh.uniqueContributors7d, m: bh.moments7d, mc: bh.momentComments7d } })

      // Cross-surface: chatter's moment counts as contributing elsewhere;
      // botUser's moment comment counts the same for TerpBot.
      const cvOk =
        growth.chat.uniqueChatters7d === baseGrowth.chat.uniqueChatters7d + 1 &&
        growth.chat.chattersWhoContributeElsewhere7d === baseGrowth.chat.chattersWhoContributeElsewhere7d + 1
      cvOk
        ? pass("chatValue: chatter who also posts a Moment counts as elsewhere-contributor")
        : fail("chatValue", { c: growth.chat, b: baseGrowth.chat })
      const bvOk =
        growth.bot.uniqueUsers7d === baseGrowth.bot.uniqueUsers7d + 1 &&
        growth.bot.usersWhoAlsoContribute7d === baseGrowth.bot.usersWhoAlsoContribute7d + 1
      bvOk
        ? pass("botValue: TerpBot user with a Moment comment counts as contributor")
        : fail("botValue", { b: growth.bot, base: baseGrowth.bot })

      // First-action analysis recognises Moment surfaces; aggregate shape only.
      const fa = growth.firstAction30d, bfa = baseGrowth.firstAction30d
      const faCount = (rows: { type: string; count: number }[], t: string) => rows.find((r) => r.type === t)?.count ?? 0
      const pathDelta = (fa.paths.find((p) => p.first === "moment post" && p.then === "chat")?.count ?? 0)
        - (bfa.paths.find((p) => p.first === "moment post" && p.then === "chat")?.count ?? 0)
      const faOk =
        faCount(fa.byFirstAction, "moment post") === faCount(bfa.byFirstAction, "moment post") + 4 &&
        faCount(fa.byFirstAction, "moment comment") === faCount(bfa.byFirstAction, "moment comment") + 2 &&
        fa.multiSurfaceMembers === bfa.multiSurfaceMembers + 1 &&
        fa.communityOnly === bfa.communityOnly + 6 &&
        pathDelta === 1
      faOk
        ? pass("first-action analysis: moment post/comment surfaces + paths")
        : fail("first-action", {
            mp: [faCount(fa.byFirstAction, "moment post"), faCount(bfa.byFirstAction, "moment post")],
            mc: [faCount(fa.byFirstAction, "moment comment"), faCount(bfa.byFirstAction, "moment comment")],
            multi: [fa.multiSurfaceMembers, bfa.multiSurfaceMembers],
            co: [fa.communityOnly, bfa.communityOnly],
            pathDelta,
          })
      const faLeak = JSON.stringify(fa).match(/__ops_|email|authorId/i)
      !faLeak ? pass("first-action analysis stays aggregate (no member identity)") : fail("first-action privacy", faLeak)

      // searchMembers exposes moment contribution counts.
      const mRows = await searchMembers(`__ops_mposter_${TS}`)
      mRows.length === 1 && mRows[0].counts.moments === 1
        ? pass("member summary counts authored moments")
        : fail("member summary moments", mRows.map((r) => r.username))
      const cRows = await searchMembers(`__ops_mcomment_${TS}`)
      cRows.length === 1 && cRows[0].counts.momentComments === 1
        ? pass("member summary counts moment comments")
        : fail("member summary momentComments", cRows.map((r) => r.username))
    }

    // ── Activation report gate (/api/admin/activation) ──────────────
    {
      const guest = await fetch(`${BASE}/api/admin/activation`)
      guest.status === 403 ? pass("guest activation report → 403") : fail("guest activation report → 403", { s: guest.status })
      const mem = await fetch(`${BASE}/api/admin/activation`, { headers: { cookie: memberCookie } })
      mem.status === 403 ? pass("member activation report → 403") : fail("member activation report → 403", { s: mem.status })
      const res = await fetch(`${BASE}/api/admin/activation?days=7`, { headers: { cookie: modCookie } })
      const rep = await res.json().catch(() => ({}))
      const json = JSON.stringify(rep)
      res.status === 200 && rep.windowDays === 7 && Array.isArray(rep.steps) && Array.isArray(rep.returnByPush) &&
        !json.includes(member.id) && !json.includes(member.username)
        ? pass("staff activation report: aggregate shape, no member ids/usernames")
        : fail("staff activation report", { s: res.status })

      // Response milestone + social-loop payload ride the same report.
      const resp = rep.response as { eligible?: number; received?: number } | undefined
      const respShape = resp !== undefined && typeof resp.eligible === "number" && typeof resp.received === "number" &&
        (resp.received ?? 0) <= (resp.eligible ?? 0) &&
        Array.isArray(rep.steps) && rep.steps.some((s: { key?: string }) => s.key === "firstResponseReceived") &&
        Array.isArray(rep.conversions) && rep.conversions.some((c: { from?: string; to?: string }) => c.from === "responseCapable" && c.to === "firstResponseReceived")
      respShape
        ? pass("activation report exposes the response milestone with the opportunity denominator")
        : fail("report response shape", resp)
      const soc = rep.social as { followsBySource?: unknown; followedContentViewers?: number; truncated?: boolean } | undefined
      soc !== undefined && Array.isArray(soc.followsBySource) && typeof soc.followedContentViewers === "number" &&
        typeof rep.push?.sent === "number" && typeof rep.push?.clicked === "number"
        ? pass("activation report carries push funnel + social-loop aggregates")
        : fail("report social/push", { hasSocial: !!soc })
    }

    // ── Admin stats: referral block stays exact under history ────────
    // Deltas, not absolutes — the dev DB may already carry real rows.
    // Seeds keyed/reversed/legacy events + 60 historical payouts and
    // asserts the aggregated response still reports exact metrics.
    {
      const stats = async () => {
        const res = await fetch(`${BASE}/api/admin/stats?range=all`, { headers: { cookie: adminCookie } })
        return { status: res.status, data: (await res.json().catch(() => ({}))) as { stats?: { referrals?: Record<string, unknown> } } }
      }
      const before = (await stats()).data?.stats?.referrals as
        | { referredProfiles: number; paidKeyed: number; legacyUnkeyed: number; reversed: number; eligibleUnpaid: { username: string }[] }
        | undefined
      if (!before) {
        fail("admin stats baseline", "referrals block missing")
      } else {
        const refSrc = await createUser("refsrc")
        // Distinct signup times are REQUIRED: the legacy unkeyed-payout
        // rule settles any referee who joined the same referrer within a
        // −60s/+600s window of the legacy stamp — identical timestamps
        // would make refElig ambiguous with refLeg.
        const mkReferee = async (tag: string, xp: number, ageDays = 30) => {
          const u = await createUser(tag)
          await prisma.profile.update({ where: { userId: u.id }, data: { referredById: refSrc.profile!.id, xp } })
          await prisma.user.update({ where: { id: u.id }, data: { createdAt: new Date(Date.now() - ageDays * 86400000) } })
          users.push(u)
          return u
        }
        users.push(refSrc)
        const refPaid = await mkReferee("refpaid", 100, 30)   // keyed payout → settled
        const refRev = await mkReferee("refrev", 0, 31)       // reversed payout, ineligible xp
        const refElig = await mkReferee("refelig", 100, 32)   // nothing recorded → eligible-unpaid
        const refLeg = await mkReferee("refleg", 100, 33)     // legacy unkeyed payout → settled

        const refSrcCreated = new Date(Date.now() - 60 * 86400000)
        await prisma.progressionEvent.create({
          data: { userId: refSrc.id, type: "REFERRAL", xp: 50, reason: "__ops ref", key: `referral:${refPaid.id}` },
        })
        await prisma.progressionEvent.create({
          data: { userId: refSrc.id, type: "REFERRAL", xp: 50, reason: "__ops ref", key: `referral:${refRev.id}`, reversedAt: new Date() },
        })
        // Legacy payout predates V2 keying — an unkeyed REFERRAL stamped on
        // the referrer at the referee's signup time settles that referee.
        const legJoined = (await prisma.user.findUnique({ where: { id: refLeg.id }, select: { createdAt: true } }))!.createdAt
        await prisma.reputationEvent.create({
          data: { userId: refSrc.id, type: "REFERRAL", amount: 50, reason: "__ops legacy", createdAt: legJoined },
        })
        // Volume: 60 keyed payouts — the response must still be exact.
        await prisma.progressionEvent.createMany({
          data: Array.from({ length: 60 }, (_, i) => ({
            userId: refSrc.id, type: "REFERRAL", xp: 50, reason: "__ops hist",
            key: `referral:hist-${TS}-${i}`, createdAt: refSrcCreated,
          })),
        })

        const after = (await stats()).data?.stats?.referrals as typeof before
        const deltas =
          after &&
          after.referredProfiles - before.referredProfiles === 4 &&
          after.paidKeyed - before.paidKeyed === 61 &&
          after.legacyUnkeyed - before.legacyUnkeyed === 1 &&
          after.reversed - before.reversed === 1
        deltas
          ? pass("admin stats: referral counts exact under 60+ seeded rows")
          : fail("admin stats referral deltas", { before, after })

        const unpaid = (after?.eligibleUnpaid ?? []).map((c) => c.username)
        unpaid.includes(refElig.username) && !unpaid.includes(refPaid.username) && !unpaid.includes(refLeg.username)
          ? pass("admin stats: eligibleUnpaid lists only the genuinely unpaid referee")
          : fail("admin stats eligibleUnpaid", unpaid)
      }
    }
  } finally {
    if (feedbackIds.length) await prisma.feedback.deleteMany({ where: { id: { in: feedbackIds } } })
    await prisma.botEvent.deleteMany({ where: { key: { startsWith: "__ops_bot_" } } }).catch(() => {})
    // Referred fixtures must go before the referrer — Profile.referredById.
    for (const u of [...users].reverse()) {
      await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    }
  }

  finish()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
