// Product-event telemetry verification — the canonical analytics sink.
//
// Covers: FOLLOW_CREATED/FIRST_FOLLOW writes + exactly-once keying,
// source allowlist (never a URL), INTERACTION_POSTED on both post
// shapes, the /api/events beacon boundary (digest view, followed-content
// view fail-closed semantics), keyed daily dedupe, lib-level failure
// isolation, the staff-only report surface, and stored-field privacy.
// Requires a dev server at BASE. Fixtures are `pe_`-marked and cleaned up.
import "./db-guard.mjs"
import { makeHarness } from "./lib/http-harness.mjs"
import { enableMaintenanceForTest } from "./lib/maintenance-mode.mjs"
import { recordProductEvent, socialLoopReport } from "@/lib/product-events"
import { eventSource, withVia } from "@/lib/event-sources"

const harnessOpts = {
  name: (t: string, t2: string) => `pe_${t}_${t2}`,
  username: (t: string, t2: string) => `pe-${t}-${t2}`,
}
const { prisma, BASE, ts, pass, fail, createUser, login: rawLogin, finish } = makeHarness(
  harnessOpts as { name: (t: string, ts: string) => string },
)
const login = (u: string, p: string) => rawLogin(u, p) as Promise<{ cookie: string }>

type Res = { status: number; data: Record<string, unknown> | null }
async function api(path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: "manual",
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}

const evs = (userId: string, type?: string) =>
  prisma.productEvent.findMany({ where: { userId, ...(type ? { type } : {}) }, orderBy: { createdAt: "asc" } })

async function run() {
  const viewer = await createUser("viewer")
  const grower = await createUser("grower")
  const third = await createUser("third")
  const staff = await createUser("staff", { role: "ADMINISTRATOR" })
  const vCookie = await login(viewer.username, viewer.password).then((l) => l.cookie)
  const sCookie = await login(staff.username, staff.password).then((l) => l.cookie)

  // ── follow → FOLLOW_CREATED + FIRST_FOLLOW with allowlisted source ──
  const f1 = await api("/api/follows", { method: "POST", cookie: vCookie, body: { userId: grower.id, source: "discover" } }) as Res
  f1.status === 200 && f1.data?.following === true
    ? pass("follow succeeds")
    : fail("follow succeeds", f1)

  const afterFirst = await evs(viewer.id)
  const fc = afterFirst.find((e) => e.type === "FOLLOW_CREATED")
  const ff = afterFirst.find((e) => e.type === "FIRST_FOLLOW")
  fc && fc.source === "discover" && fc.objectType === "User" && fc.objectId === grower.id && fc.userId === viewer.id
    ? pass("FOLLOW_CREATED: actor, source, object reference")
    : fail("FOLLOW_CREATED", afterFirst)
  ff && ff.source === "discover" && ff.key === `ff:${viewer.id}`
    ? pass("FIRST_FOLLOW: milestone written, keyed per member")
    : fail("FIRST_FOLLOW", afterFirst)

  // ── second + refollow: FIRST_FOLLOW stays exactly one ──
  await api("/api/follows", { method: "POST", cookie: vCookie, body: { userId: third.id, source: "member_home" } })
  await api("/api/follows", { method: "POST", cookie: vCookie, body: { userId: third.id, source: "member_home" } }) // unfollow
  await api("/api/follows", { method: "POST", cookie: vCookie, body: { userId: third.id, source: "member_home" } }) // refollow
  const ffs = await evs(viewer.id, "FIRST_FOLLOW")
  ffs.length === 1
    ? pass("FIRST_FOLLOW is exactly-once across follow/unfollow/refollow")
    : fail("FIRST_FOLLOW exactly-once", ffs)
  ;(await evs(viewer.id, "FOLLOW_CREATED")).length === 3
    ? pass("FOLLOW_CREATED records each successful transition")
    : fail("FOLLOW_CREATED count", await evs(viewer.id, "FOLLOW_CREATED"))

  // ── source allowlist: a URL is never stored ──
  const stranger = await createUser("stranger")
  const s2Cookie = await login(stranger.username, stranger.password).then((l) => l.cookie)
  await api("/api/follows", { method: "POST", cookie: s2Cookie, body: { userId: grower.id, source: "https://evil.example/x?y=z" } })
  const badSrc = (await evs(stranger.id, "FOLLOW_CREATED"))[0]
  badSrc && badSrc.source === "unknown" && !JSON.stringify(badSrc).includes("evil.example")
    ? pass("source allowlist: URL collapses to \"unknown\", never stored")
    : fail("source allowlist", badSrc)

  // ── diary follow → FIRST_FCOVERED objectType=Diary path ──
  const diary = await prisma.growDiary.create({
    data: { title: `pe_diary_${ts}`, description: "", growType: "INDOOR", startDate: new Date(), authorId: grower.id, visibility: "PUBLIC" },
  })
  const diaryFollower = await createUser("dfol")
  const dCookie = await login(diaryFollower.username, diaryFollower.password).then((l) => l.cookie)
  await api("/api/follows", { method: "POST", cookie: dCookie, body: { diaryId: diary.id, source: "diary" } })
  const dfEvs = await evs(diaryFollower.id)
  dfEvs.some((e) => e.type === "FOLLOW_CREATED" && e.objectType === "Diary" && e.objectId === diary.id) &&
  dfEvs.some((e) => e.type === "FIRST_FOLLOW" && e.objectType === "Diary")
    ? pass("diary follow: FOLLOW_CREATED + FIRST_FOLLOW with Diary reference")
    : fail("diary follow events", dfEvs)

  // ── diary-first, grower-second: any-kind milestone consumed by the
  // diary follow, but the grower metric must still see the member
  // follow with ITS surface — not the diary surface ──
  await api("/api/follows", { method: "POST", cookie: dCookie, body: { userId: grower.id, source: "member_home" } })
  const dfAfter = await evs(diaryFollower.id, "FIRST_FOLLOW")
  dfAfter.length === 1 && dfAfter[0].objectType === "Diary"
    ? pass("diary-first member: FIRST_FOLLOW stays once, keeps the diary kind")
    : fail("diary-first FIRST_FOLLOW", dfAfter)
  const repCheck = await socialLoopReport(7)
  const growerSrc = repCheck.firstGrowerFollowBySource.find((r) => r.source === "member_home")
  repCheck.firstGrowerFollows >= 2 && (growerSrc?.count ?? 0) >= 1
    ? pass("first-grower-follow: diary-first member counted with the member-follow surface")
    : fail("first-grower-follow derivation", repCheck.firstGrowerFollowBySource)
  // attribution stability: viewer's first grower follow is "discover"
  // even though they later followed `third` from member_home
  repCheck.firstGrowerFollowBySource.find((r) => r.source === "discover")
    ? pass("first-grower-follow attribution is stable across later follows")
    : fail("first-grower attribution stability", repCheck.firstGrowerFollowBySource)
  // any-kind milestone still reported separately; every member lands
  // in exactly ONE source bucket — no cross-surface double counting.
  // (Report is global: dev-DB rows from deleted prior-run users are
  // legitimate cohort members too, so assert the bucket invariant, not
  // fixture counts.)
  const sumSrc = (rows: { source: string; count: number }[]) => rows.reduce((a, r) => a + r.count, 0)
  repCheck.firstFollowsAnyKind >= 3 && repCheck.firstGrowerFollows >= 3 &&
    sumSrc(repCheck.firstGrowerFollowBySource) === repCheck.firstGrowerFollows &&
    sumSrc(repCheck.firstFollowAnyKindBySource) === repCheck.firstFollowsAnyKind
    ? pass("any-kind vs grower metrics coexist; members counted once per cohort")
    : fail("any-kind vs grower counts", repCheck)

  // ── INTERACTION_POSTED: thread reply + anchored update comment ──
  const cat = await prisma.category.findFirst({ where: { hidden: false }, select: { id: true } })
  const thread = await prisma.thread.create({
    data: { title: `pe_thread_${ts}`, slug: `pe-thread-${ts}`, content: "x".repeat(20), authorId: grower.id, categoryId: cat!.id },
  })
  const p1 = await api("/api/forum/posts", {
    method: "POST", cookie: vCookie,
    body: { threadId: thread.id, content: "Reply from the weekly digest link.", source: "digest" },
  }) as Res
  p1.status === 201 || p1.status === 200
    ? pass("reply posts")
    : fail("reply posts", p1)
  const ix1 = (await evs(viewer.id, "INTERACTION_POSTED"))[0]
  ix1 && ix1.source === "digest" && ix1.objectType === "Thread" && ix1.objectId === thread.id
    ? pass("INTERACTION_POSTED: thread reply with digest source")
    : fail("INTERACTION_POSTED thread", ix1)

  // Anchored update comment — lazy discussion, then a diaryUpdateId post.
  const upd = await prisma.diaryUpdate.create({
    data: { diaryId: diary.id, authorId: grower.id, title: `pe_upd_${ts}`, content: "x".repeat(20), stage: "VEGETATIVE" },
  })
  const dres = await api(`/api/diaries/${diary.id}/discuss`, { method: "POST", cookie: vCookie }) as Res
  const dTid = (dres.data as { threadId?: string } | null)?.threadId
  const p2 = dTid ? await api("/api/forum/posts", {
    method: "POST", cookie: vCookie,
    body: { threadId: dTid, diaryUpdateId: upd.id, content: "Comment via the member-home update row.", source: "member_home" },
  }) as Res : ({ status: 0, data: null } as Res)
  const ix2 = (await evs(viewer.id, "INTERACTION_POSTED")).find((e) => e.objectType === "DiaryUpdate")
  p2.status < 300 && ix2 && ix2.source === "member_home" && ix2.objectId === upd.id
    ? pass("INTERACTION_POSTED: anchored comment references the update")
    : fail("INTERACTION_POSTED update", { p2: p2.status, ix2 })

  // ── /api/events: DIGEST_VIEWED keyed once per UTC day ──
  const unauth = await api("/api/events", { method: "POST", body: { type: "DIGEST_VIEWED" } }) as Res
  unauth.status === 401
    ? pass("events: unauthenticated beacon rejected")
    : fail("events unauth", unauth)
  await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "DIGEST_VIEWED" } })
  await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "DIGEST_VIEWED" } })
  ;(await evs(viewer.id, "DIGEST_VIEWED")).length === 1
    ? pass("DIGEST_VIEWED is once per member per UTC day (remount/retry safe)")
    : fail("DIGEST_VIEWED dedupe", await evs(viewer.id, "DIGEST_VIEWED"))
  const badType = await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "PAGE_VIEWED", source: "digest" } }) as Res
  badType.status === 400
    ? pass("events: non-allowlisted type rejected")
    : fail("events type allowlist", badType)

  // ── /api/events: FOLLOWED_CONTENT_VIEWED fail-closed semantics ──
  await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Diary", objectId: diary.id, source: "digest" } })
  await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Diary", objectId: diary.id, source: "digest" } })
  const fcv = await evs(viewer.id, "FOLLOWED_CONTENT_VIEWED")
  fcv.length === 1 && fcv[0].source === "digest" && fcv[0].objectId === diary.id
    ? pass("FOLLOWED_CONTENT_VIEWED: recorded once per diary per day")
    : fail("FCV recorded", fcv)

  const nonFollower = await createUser("nofol")
  const nCookie = await login(nonFollower.username, nonFollower.password).then((l) => l.cookie)
  const nf = await api("/api/events", { method: "POST", cookie: nCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Diary", objectId: diary.id } }) as Res
  nf.status === 200 && (await evs(nonFollower.id, "FOLLOWED_CONTENT_VIEWED")).length === 0
    ? pass("FCV fail-closed: unfollowed viewer records nothing (200, no oracle)")
    : fail("FCV non-follower", { nf: nf.status })

  const privDiary = await prisma.growDiary.create({
    data: { title: `pe_priv_${ts}`, description: "", growType: "INDOOR", startDate: new Date(), authorId: third.id, visibility: "PRIVATE" },
  })
  await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Diary", objectId: privDiary.id } })
  await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Diary", objectId: "nonexistent-id" } })
  ;(await evs(viewer.id, "FOLLOWED_CONTENT_VIEWED")).length === 1
    ? pass("FCV fail-closed: private/nonexistent grows record nothing")
    : fail("FCV privacy", await evs(viewer.id, "FOLLOWED_CONTENT_VIEWED"))

  // ── Moment telemetry: INTERACTION_POSTED + FCV on the social surface ──
  const mPub = await prisma.moment.create({
    data: { kind: "POST", content: `pe_moment_${ts}`, authorId: grower.id, visibility: "PUBLIC" },
  })
  const mFol = await prisma.moment.create({
    data: { kind: "POST", content: `pe_folmoment_${ts}`, authorId: grower.id, visibility: "FOLLOWERS" },
  })
  const mDel = await prisma.moment.create({
    data: { kind: "POST", content: `pe_delmoment_${ts}`, authorId: grower.id, deleted: true },
  })

  // Creation emits through the real POST route.
  const mc = await api("/api/moments", { method: "POST", cookie: vCookie, body: { content: `pe_create_${ts}`, source: "member_home" } }) as Res
  const mcId = (mc.data as { moment?: { id?: string } } | null)?.moment?.id
  mc.status === 201 && !!mcId ? pass("moment create via API") : fail("moment create", mc)
  const ixm = async () => (await evs(viewer.id, "INTERACTION_POSTED")).filter((e) => e.objectType === "Moment")
  ;(await ixm()).some((e) => e.objectId === mcId && e.source === "member_home")
    ? pass("INTERACTION_POSTED: moment create references the Moment id")
    : fail("moment create event", await ixm())

  // Comment + reaction emit against the moment id.
  const cm = await api(`/api/moments/${mPub.id}/comments`, { method: "POST", cookie: vCookie, body: { content: "pe comment", source: "member_home" } }) as Res
  const rx = await api("/api/reactions", { method: "POST", cookie: vCookie, body: { type: "LIKE", momentId: mPub.id } }) as Res
  const mPubEvs = (await ixm()).filter((e) => e.objectId === mPub.id)
  cm.status === 201 && rx.status === 201 && mPubEvs.length === 2
    ? pass("INTERACTION_POSTED: moment comment + reaction each recorded once")
    : fail("moment interaction events", { cm: cm.status, rx: rx.status, n: mPubEvs.length })

  // Rejected operations emit nothing: guest create 401, non-follower
  // comment + reaction on a followers-only post 404.
  const gCreate = await api("/api/moments", { method: "POST", body: { content: "guest" } }) as Res
  gCreate.status === 401 ? pass("guest moment create rejected") : fail("guest create", gCreate)
  const ncm = await api(`/api/moments/${mFol.id}/comments`, { method: "POST", cookie: nCookie, body: { content: "x" } }) as Res
  const nrx = await api("/api/reactions", { method: "POST", cookie: nCookie, body: { type: "LIKE", momentId: mFol.id } }) as Res
  ncm.status === 404 && nrx.status === 404 &&
    !(await evs(nonFollower.id, "INTERACTION_POSTED")).some((e) => e.objectType === "Moment")
    ? pass("rejected moment interactions emit no event")
    : fail("rejected moment events", { ncm: ncm.status, nrx: nrx.status })

  // FCV on a Moment — viewer follows grower: public + followers posts both
  // record (day-keyed), non-follower/deleted/self record nothing.
  await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: mPub.id, source: "member_home" } })
  await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: mPub.id, source: "member_home" } })
  await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: mFol.id } })
  await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: mDel.id } })
  const fcvM = (await evs(viewer.id, "FOLLOWED_CONTENT_VIEWED")).filter((e) => e.objectType === "Moment")
  fcvM.length === 2 && fcvM.some((e) => e.objectId === mPub.id && e.source === "member_home") &&
    fcvM.some((e) => e.objectId === mFol.id) && !fcvM.some((e) => e.objectId === mDel.id)
    ? pass("FCV Moment: public + followers post recorded once; deleted excluded")
    : fail("FCV moments", fcvM)
  await api("/api/events", { method: "POST", cookie: nCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: mPub.id } })
  !(await evs(nonFollower.id, "FOLLOWED_CONTENT_VIEWED")).some((e) => e.objectType === "Moment")
    ? pass("FCV Moment fail-closed: unfollowed viewer records nothing")
    : fail("FCV moment non-follower", await evs(nonFollower.id, "FOLLOWED_CONTENT_VIEWED"))
  const gCookie = await login(grower.username, grower.password).then((l) => l.cookie)
  await api("/api/events", { method: "POST", cookie: gCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: mPub.id } })
  !(await evs(grower.id, "FOLLOWED_CONTENT_VIEWED")).some((e) => e.objectId === mPub.id)
    ? pass("FCV Moment: self-view records nothing")
    : fail("FCV moment self", "recorded")
  // Bogus objectType stays a silent 200.
  const bogus = await api("/api/events", { method: "POST", cookie: vCookie, body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Post", objectId: mPub.id } }) as Res
  bogus.status === 200 ? pass("FCV: unknown objectType fails closed") : fail("FCV bogus", bogus)

  // ── lib failure isolation: a throwing client never breaks the caller ──
  const failing = { productEvent: { create: () => Promise.reject(new Error("db down")), upsert: () => Promise.reject(new Error("db down")) } }
  await recordProductEvent({ type: "FOLLOW_CREATED", userId: viewer.id, source: "discover" }, failing as never)
  await recordProductEvent({ type: "FIRST_FOLLOW", userId: viewer.id, key: "ff:k" }, failing as never)
  pass("recordProductEvent never throws — analytics cannot break the action")

  // keyed upsert is idempotent at the storage level too
  await recordProductEvent({ type: "FIRST_FOLLOW", userId: viewer.id, source: "discover", key: `ff:${viewer.id}` })
  ;(await evs(viewer.id, "FIRST_FOLLOW")).length === 1
    ? pass("keyed upsert: replayed FIRST_FOLLOW keeps the original row")
    : fail("keyed upsert", await evs(viewer.id, "FIRST_FOLLOW"))

  // ── stored-field privacy: only the allowed columns ever exist ──
  const all = await prisma.productEvent.findMany({ where: { userId: { in: [viewer.id, stranger.id, diaryFollower.id, nonFollower.id] } } })
  const ALLOWED = new Set(["id", "type", "userId", "source", "objectType", "objectId", "key", "createdAt"])
  all.length > 0 && all.every((r) => Object.keys(r).every((k) => ALLOWED.has(k)) && (!r.source || !r.source.includes("/")))
    ? pass("privacy: events carry only ids/type/source-token/key/timestamp — no content or URLs")
    : fail("privacy fields", all[0])

  // ── report surface: member rejected, staff gets the social section ──
  const memberRes = await api("/api/admin/activation?days=30", { cookie: vCookie }) as Res
  memberRes.status === 403 || memberRes.status === 401
    ? pass("report: ordinary member cannot read analytics")
    : fail("report member gate", memberRes)
  const staffRes = await api("/api/admin/activation?days=30", { cookie: sCookie }) as Res
  const social = (staffRes.data as { social?: Record<string, unknown> } | null)?.social
  staffRes.status === 200 && social &&
    "firstGrowerFollowBySource" in social && "followedContentViewers" in social &&
    "interactionsBySource" in social && "growerFollowerInteractionRate" in social &&
    "firstFollowsAnyKind" in social &&
    !JSON.stringify(social).includes(viewer.id) && !JSON.stringify(social).includes(viewer.username)
    ? pass("report: staff aggregate has the social section — counts only, no member ids")
    : fail("report staff shape", { s: staffRes.status, social })

  // ── socialLoopReport: fixture events aggregate correctly ──
  const rep = await socialLoopReport(7)
  const ffSrc = rep.firstGrowerFollowBySource.find((r) => r.source === "discover")
  const ixSrc = rep.interactionsBySource.find((r) => r.source === "digest")
  rep.firstGrowerFollows >= 1 && (ffSrc?.count ?? 0) >= 1 && (ixSrc?.count ?? 0) >= 1 && rep.followedContentViewers >= 1 && rep.digestViewers >= 1
    ? pass("socialLoopReport: grower-follow source, interaction source, viewers aggregate")
    : fail("socialLoopReport", rep)

  // withVia: query params land before the fragment, cleanup-compatible
  const w = withVia("/diaries/x?post=abc#update-u1", "digest")
  w === "/diaries/x?post=abc&via=digest#update-u1" && withVia("/forum/thread/s", "notification") === "/forum/thread/s?via=notification"
    ? pass("withVia inserts the param before the fragment")
    : fail("withVia", w)
  eventSource("digest") === "digest" && eventSource("javascript:alert(1)") === null && eventSource(42) === null
    ? pass("eventSource validates the allowlist")
    : fail("eventSource", null)

  // ── maintenance freeze — telemetry is an explicit exemption ──
  {
    const restore = await enableMaintenanceForTest()
    try {
      let r = await api("/api/events", { method: "POST", cookie: s2Cookie, body: { type: "DIGEST_VIEWED" } }) as Res
      r.status === 200
        ? pass("maintenance: product events still accepted")
        : fail("maintenance events exemption", r.status)
      r = await api("/api/push/event", { method: "POST", cookie: s2Cookie, body: { type: "PROMPT_SHOWN" } })
      r.status === 200
        ? pass("maintenance: push events still accepted")
        : fail("maintenance push-event exemption", r.status)
    } finally {
      await restore()
    }
  }

  // ── cleanup ──
  const userIds = [viewer.id, grower.id, third.id, stranger.id, diaryFollower.id, nonFollower.id, staff.id]
  await prisma.productEvent.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.diaryUpdate.deleteMany({ where: { id: upd.id } }).catch(() => {})
  await prisma.post.deleteMany({ where: { threadId: { in: [thread.id, dTid ?? ""] } } })
  await prisma.thread.deleteMany({ where: { id: { in: [thread.id, dTid ?? ""] } } })
  await prisma.growDiary.deleteMany({ where: { id: { in: [diary.id, privDiary.id] } } })
  await prisma.moment.deleteMany({ where: { id: { in: [mPub.id, mFol.id, mDel.id, mcId ?? ""] } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  const left = await prisma.productEvent.count({ where: { userId: { in: userIds } } })
  left === 0 ? pass("cleanup: zero residue") : fail("cleanup", left)
}

run()
  .then(() => process.exit(finish()))
  .catch(async (e) => {
    console.error("fatal:", e)
    // Aborted runs leak fixture users (e.g. a dead dev server fails at
    // login). Sweep pe_-marked residue so it can't contaminate the DB.
    try {
      const orphans = await prisma.user.findMany({ where: { name: { startsWith: "pe_" } }, select: { id: true } })
      const ids = orphans.map((o) => o.id)
      await prisma.productEvent.deleteMany({ where: { userId: { in: ids } } })
      await prisma.user.deleteMany({ where: { id: { in: ids } } })
      console.error(`fatal cleanup: removed ${ids.length} orphaned fixture users`)
    } catch { /* best-effort */ }
    process.exit(1)
  })
