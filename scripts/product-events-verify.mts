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
    "firstFollowBySource" in social && "followedContentViewers" in social &&
    "interactionsBySource" in social && "interactionRate" in social &&
    !JSON.stringify(social).includes(viewer.id) && !JSON.stringify(social).includes(viewer.username)
    ? pass("report: staff aggregate has the social section — counts only, no member ids")
    : fail("report staff shape", { s: staffRes.status, social })

  // ── socialLoopReport: fixture events aggregate correctly ──
  const rep = await socialLoopReport(7)
  const ffSrc = rep.firstFollowBySource.find((r) => r.source === "discover")
  const ixSrc = rep.interactionsBySource.find((r) => r.source === "digest")
  rep.firstFollows >= 1 && (ffSrc?.count ?? 0) >= 1 && (ixSrc?.count ?? 0) >= 1 && rep.followedContentViewers >= 1 && rep.digestViewers >= 1
    ? pass("socialLoopReport: first-follow source, interaction source, viewers aggregate")
    : fail("socialLoopReport", rep)

  // withVia: query params land before the fragment, cleanup-compatible
  const w = withVia("/diaries/x?post=abc#update-u1", "digest")
  w === "/diaries/x?post=abc&via=digest#update-u1" && withVia("/forum/thread/s", "notification") === "/forum/thread/s?via=notification"
    ? pass("withVia inserts the param before the fragment")
    : fail("withVia", w)
  eventSource("digest") === "digest" && eventSource("javascript:alert(1)") === null && eventSource(42) === null
    ? pass("eventSource validates the allowlist")
    : fail("eventSource", null)

  // ── cleanup ──
  const userIds = [viewer.id, grower.id, third.id, stranger.id, diaryFollower.id, nonFollower.id, staff.id]
  await prisma.productEvent.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.diaryUpdate.deleteMany({ where: { id: upd.id } }).catch(() => {})
  await prisma.post.deleteMany({ where: { threadId: { in: [thread.id, dTid ?? ""] } } })
  await prisma.thread.deleteMany({ where: { id: { in: [thread.id, dTid ?? ""] } } })
  await prisma.growDiary.deleteMany({ where: { id: { in: [diary.id, privDiary.id] } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
  const left = await prisma.productEvent.count({ where: { userId: { in: userIds } } })
  left === 0 ? pass("cleanup: zero residue") : fail("cleanup", left)
}

run()
  .then(() => process.exit(finish()))
  .catch(async (e) => {
    console.error("fatal:", e)
    process.exit(1)
  })
