// feed-verify.mts — Feed Core verification suite.
//
// Covers the canonical feed module (src/lib/feed.ts) and its two
// consumers: the /feed page and /api/feed continuation endpoint.
// Ordering/privacy is asserted against the real getFeedPage(); the HTTP
// checks exercise the route contract end-to-end. All fixtures are
// `feedv_`-marked and cleaned up at the end.
import "./db-guard.mjs"
import { makeHarness } from "./lib/http-harness.mjs"
import { prisma } from "@/lib/prisma"
import { resolveFeedScope, resolveAuthorFeedScope, getFeedPage, encodeFeedCursor } from "@/lib/feed"
import { getProfileSection } from "@/lib/public-profile"
import type { FeedItem, FeedKind, FeedScope } from "@/lib/feed"

const harnessOpts = {
  name: (t: string, ts: string) => `feedv_${t}_${ts}`,
  username: (t: string, ts: string) => `fv-${t}-${ts}`,
  password: "Feed!Verify123",
}
const { BASE, ts, pass, fail, createUser, login: rawLogin, finish } = makeHarness(
  harnessOpts as { name: (t: string, ts: string) => string },
)
const login = (u: string, p: string) => rawLogin(u, p) as Promise<{ cookie: string }>

type Res = { status: number; data: Record<string, unknown> | null }
async function api(path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}): Promise<Res> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers: { "Content-Type": "application/json", ...(opts.cookie ? { cookie: opts.cookie } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  return { status: res.status, data: await res.json().catch(() => null) }
}

const M = (s: string) => `feedv ${s} ${ts}`

// ── fixture handles ────────────────────────────────────────────────
type VerifyUser = Awaited<ReturnType<typeof createUser>>
type IdRow = { id: string }
let author: VerifyUser, viewer: VerifyUser, other: VerifyUser, blockedU: VerifyUser, bannedU: VerifyUser, nofollow: VerifyUser
let diaryPub: IdRow, diaryUnl: IdRow, diaryPriv: IdRow, diaryHarv: IdRow, diaryDel: IdRow
let fvCat: { id: string }
const pubUpdates: { id: string; createdAt: Date }[] = []
const unlUpdates: { id: string; createdAt: Date }[] = []
const privUpdates: { id: string; createdAt: Date }[] = []
const authorThreads: { id: string; createdAt: Date }[] = []
let otherUpdateId = "", blockedUpdateId = "", bannedUpdateId = "", deletedUpdateId = ""
let catThreadId = "", otherThreadId = ""
const createdThreadIds: string[] = []
const createdDiaryIds: string[] = []

async function mkUpdate(diaryId: string, authorId: string, title: string, createdAt: Date) {
  const u = await prisma.diaryUpdate.create({
    data: { diaryId, authorId, title, content: `${title} body`, stage: "VEGETATIVE", createdAt },
    select: { id: true, createdAt: true },
  })
  return u
}

async function mkDiary(authorId: string, title: string, extra: Record<string, unknown> = {}) {
  const d = await prisma.growDiary.create({
    data: { title, description: "", growType: "INDOOR", startDate: new Date("2026-09-01"), authorId, ...extra },
    select: { id: true },
  })
  createdDiaryIds.push(d.id)
  return d
}

async function mkThread(authorId: string, categoryId: string, title: string, createdAt: Date) {
  const t = await prisma.thread.create({
    data: { title, slug: `fv-${title.replace(/\W+/g, "-").toLowerCase()}-${ts}-${createdThreadIds.length}`, content: `${title} content`, categoryId, authorId, createdAt },
    select: { id: true, createdAt: true },
  })
  createdThreadIds.push(t.id)
  return t
}

async function pageAll(scope: FeedScope, kinds?: FeedKind[], limit = 30): Promise<FeedItem[]> {
  const out: FeedItem[] = []
  let cursor: string | null = null
  for (let i = 0; i < 50; i++) {
    const p = await getFeedPage({ scope, kinds, cursor, limit })
    out.push(...p.items)
    if (!p.nextCursor) break
    cursor = p.nextCursor
  }
  return out
}

const below = (item: FeedItem, cur: { ts: number; id: string }) =>
  item.sortAt.getTime() < cur.ts || (item.sortAt.getTime() === cur.ts && item.id < cur.id)

async function main() {
  console.log("── feed core ──")

  // ── fixtures ────────────────────────────────────────────────────
  author = await createUser("author")
  viewer = await createUser("viewer")
  other = await createUser("other")
  blockedU = await createUser("blocked")
  bannedU = await createUser("banned", { banned: true })
  nofollow = await createUser("nofollow")

  const base = Date.now() - 60_000
  diaryPub = await mkDiary(author.id, M("pub"))
  diaryUnl = await mkDiary(author.id, M("unl"), { visibility: "UNLISTED" })
  diaryPriv = await mkDiary(author.id, M("priv"), { visibility: "PRIVATE" })
  diaryHarv = await mkDiary(author.id, M("harv"), { harvested: true, harvestedAt: new Date(base - 5 * 60_000) })
  diaryDel = await mkDiary(author.id, M("del"), { deleted: true })

  // 30 public updates — drives multi-page keyset tests. Three share an
  // identical timestamp to prove the id tiebreak across a page boundary.
  const SHARED_TS = new Date(base - 12 * 60_000)
  for (let i = 0; i < 30; i++) {
    const ts_i = i >= 10 && i <= 12 ? SHARED_TS : new Date(base - i * 60_000)
    pubUpdates.push(await mkUpdate(diaryPub.id, author.id, M(`u${String(i).padStart(2, "0")}`), ts_i))
  }
  unlUpdates.push(await mkUpdate(diaryUnl.id, author.id, M("unl1"), new Date(base - 40 * 60_000)))
  unlUpdates.push(await mkUpdate(diaryUnl.id, author.id, M("unl2"), new Date(base - 41 * 60_000)))
  privUpdates.push(await mkUpdate(diaryPriv.id, author.id, M("priv1"), new Date(base - 42 * 60_000)))
  privUpdates.push(await mkUpdate(diaryPriv.id, author.id, M("priv2"), new Date(base - 43 * 60_000)))
  deletedUpdateId = (await mkUpdate(diaryDel.id, author.id, M("del"), new Date(base - 44 * 60_000))).id

  const seededCat = await prisma.category.findFirst({ where: { hidden: false }, select: { id: true } })
  fvCat = await prisma.category.create({ data: { name: M("cat"), slug: `fv-cat-${ts}`, description: "", order: 990 } })
  if (!seededCat) throw new Error("no visible category seeded")
  for (let i = 0; i < 3; i++) {
    authorThreads.push(await mkThread(author.id, seededCat.id, M(`t${i}`), new Date(base - (3 * i + 2) * 60_000)))
  }
  catThreadId = (await mkThread(other.id, fvCat.id, M("cat thread"), new Date(base - 6 * 60_000))).id
  otherThreadId = (await mkThread(other.id, seededCat.id, M("other thread"), new Date(base - 7 * 60_000))).id

  const othDiary = await mkDiary(other.id, M("other"))
  otherUpdateId = (await mkUpdate(othDiary.id, other.id, M("other"), new Date(base - 8 * 60_000))).id
  const blkDiary = await mkDiary(blockedU.id, M("blocked"))
  blockedUpdateId = (await mkUpdate(blkDiary.id, blockedU.id, M("blocked"), new Date(base - 9 * 60_000))).id
  const banDiary = await mkDiary(bannedU.id, M("banned"))
  bannedUpdateId = (await mkUpdate(banDiary.id, bannedU.id, M("banned"), new Date(base - 10 * 60_000))).id

  // Social graph: viewer follows author + the UNLISTED diary + fvCat;
  // viewer blocks blockedU (either direction excluded by blockedUserIds).
  await prisma.follow.create({ data: { followerId: viewer.id, followingId: author.id } })
  await prisma.diaryFollow.create({ data: { userId: viewer.id, diaryId: diaryUnl.id } })
  await prisma.categoryFollow.create({ data: { userId: viewer.id, categoryId: fvCat.id } })
  await prisma.block.create({ data: { blockerId: viewer.id, blockedId: blockedU.id } })

  // Phase 1 integration: one anchored comment + reaction on update[0].
  const discussion = await mkThread(author.id, seededCat.id, M("discussion"), new Date(base - 200 * 60_000))
  await prisma.growDiary.update({ where: { id: diaryPub.id }, data: { threadId: discussion.id } })
  await prisma.post.create({ data: { threadId: discussion.id, diaryUpdateId: pubUpdates[0].id, authorId: viewer.id, content: M("anchored comment") } })
  await prisma.reaction.create({ data: { userId: viewer.id, diaryUpdateId: pubUpdates[0].id, type: "LIKE" } })

  const expectedFollowing = [
    ...pubUpdates.map((u) => ({ kind: "update", id: u.id, sortAt: u.createdAt })),
    ...unlUpdates.map((u) => ({ kind: "update", id: u.id, sortAt: u.createdAt })),
    ...authorThreads.map((t) => ({ kind: "thread", id: t.id, sortAt: t.createdAt })),
    { kind: "thread", id: discussion.id, sortAt: discussion.createdAt },
    { kind: "harvest", id: diaryHarv.id, sortAt: new Date(base - 5 * 60_000) },
  ].sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime() || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0))

  // ── A. ordering + keyset pagination (lib) ───────────────────────
  const followScope = await resolveFeedScope(viewer.id, "following")
  {
    const p1 = await getFeedPage({ scope: followScope, limit: 5 })
    const sorted = p1.items.every((it, i) => i === 0 || p1.items[i - 1].sortAt.getTime() > it.sortAt.getTime() ||
      (p1.items[i - 1].sortAt.getTime() === it.sortAt.getTime() && p1.items[i - 1].id > it.id))
    sorted ? pass("page 1 items strictly (sortAt,id) desc") : fail("page 1 order", p1.items.map((i) => i.id))
    p1.items.length === 5 && p1.nextCursor ? pass("page 1 fills limit and yields cursor") : fail("page 1", { n: p1.items.length, c: p1.nextCursor })

    const all = await pageAll(followScope, undefined, 5)
    const keys = all.map((i) => `${i.kind}:${i.id}`)
    new Set(keys).size === keys.length ? pass(`no duplicates across pages (${keys.length} items)`) : fail("dup ids", keys)
    const expectedKeys = expectedFollowing.map((e) => `${e.kind}:${e.id}`)
    JSON.stringify(keys) === JSON.stringify(expectedKeys)
      ? pass("following stream is exactly the scoped set, in (ts,id) order")
      : fail("following stream", { got: keys.slice(0, 12), want: expectedKeys.slice(0, 12) })
  }

  // each page strictly below its cursor
  {
    let cursor: string | null = null
    let ok = true
    let lastKey: { ts: number; id: string } | null = null
    for (let i = 0; i < 12; i++) {
      const p = await getFeedPage({ scope: followScope, cursor, limit: 5 })
      if (lastKey && !p.items.every((it) => below(it, lastKey!))) { ok = false; break }
      lastKey = p.nextCursor ? (() => {
        const m = Buffer.from(p.nextCursor!.slice(3), "base64url").toString()
        const [t, id] = m.split(":")
        return { ts: Number(t), id }
      })() : null
      if (!p.nextCursor) break
      cursor = p.nextCursor
    }
    ok ? pass("every page strictly below its cursor key") : fail("cursor boundary", lastKey)
  }

  // malformed cursors fail safe → page 1
  for (const bad of ["garbage", "f1.!!!", "f1." + Buffer.from("abc:not-an-id*").toString("base64url"), "x".repeat(500)]) {
    const p = await getFeedPage({ scope: followScope, cursor: bad, limit: 5 })
    p.items.length === 5 && p.items[0].id === expectedFollowing[0].id
      ? pass(`malformed cursor → page 1 (${bad.slice(0, 14)}…)`)
      : fail("malformed cursor", { bad: bad.slice(0, 30), first: p.items[0]?.id })
  }

  // a cursor crafted from a PRIVATE update's key cannot leak it
  {
    const privCur = encodeFeedCursor(privUpdates[0].createdAt, privUpdates[0].id)
    const p = await getFeedPage({ scope: followScope, cursor: privCur, limit: 30 })
    !p.items.some((i) => i.id === privUpdates[0].id || i.id === privUpdates[1].id)
      ? pass("crafted cursor cannot leak private update")
      : fail("cursor privacy", p.items.map((i) => i.id))
  }

  // single-kind + empty-source pagination
  {
    const all = await pageAll(followScope, ["update"], 7)
    const keys = all.map((i) => i.id)
    const want = [...pubUpdates, ...unlUpdates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || (b.id < a.id ? -1 : 1)).map((u) => u.id)
    keys.length === want.length && want.every((id, i) => keys[i] === id) && all.every((i) => i.kind === "update")
      ? pass("single-kind (updates) pagination is complete and ordered")
      : fail("single-kind pages", { n: keys.length, want: want.length })
    const none = await getFeedPage({ scope: await resolveFeedScope(nofollow.id, "following"), kinds: ["thread"], limit: 5 })
    // nofollow has no follows → cold start → global threads, not empty —
    // this asserts the coldStart fallback rather than emptiness.
    none.coldStart === true ? pass("no-follows member → coldStart flag set") : fail("coldStart", none.coldStart)
    none.items.every((i) => i.kind === "thread")
      ? pass("cold-start stream honors kinds filter")
      : fail("coldStart kinds", none.items.map((i) => i.kind))
  }

  // ── B. privacy scoping ──────────────────────────────────────────
  {
    const guest = await resolveFeedScope(null, "latest")
    const all = await pageAll(guest, ["update"], 30)
    const ids = new Set(all.map((i) => i.id))
    !ids.has(privUpdates[0].id) && !ids.has(unlUpdates[0].id) && !ids.has(deletedUpdateId) && !ids.has(bannedUpdateId)
      ? pass("guest latest: private/unlisted/deleted/banned updates absent")
      : fail("guest latest leak", { priv: ids.has(privUpdates[0].id), unl: ids.has(unlUpdates[0].id), del: ids.has(deletedUpdateId), ban: ids.has(bannedUpdateId) })
    pubUpdates.every((u) => ids.has(u.id))
      ? pass("guest latest: all 30 public updates reachable via pagination")
      : fail("guest latest missing public", pubUpdates.filter((u) => !ids.has(u.id)).length)

    const guestPersonal = await getFeedPage({ scope: await resolveFeedScope(null, "following"), limit: 5 })
    guestPersonal.items.length === 0 && guestPersonal.nextCursor === null
      ? pass("guest following → empty page (no personalized material)")
      : fail("guest following", guestPersonal.items.length)

    const viewerLatest = await pageAll(await resolveFeedScope(viewer.id, "latest"), ["update"], 30)
    const vIds = new Set(viewerLatest.map((i) => i.id))
    !vIds.has(blockedUpdateId)
      ? pass("blocked author's update absent from viewer latest")
      : fail("blocked leak", blockedUpdateId)
    !vIds.has(unlUpdates[0].id)
      ? pass("unlisted update absent from viewer latest (global mode)")
      : fail("unlisted in latest", unlUpdates[0].id)
  }

  // visibility flips take effect immediately (session-dynamic, no cache)
  {
    await prisma.growDiary.update({ where: { id: diaryPub.id }, data: { visibility: "UNLISTED" } })
    const hidden = await pageAll(await resolveFeedScope(viewer.id, "following"), ["update"], 30)
    const hIds = new Set(hidden.map((i) => i.id))
    !pubUpdates.some((u) => hIds.has(u.id)) && unlUpdates.every((u) => hIds.has(u.id))
      ? pass("PUBLIC→UNLISTED hides followed-author updates, keeps diary-followed")
      : fail("flip to unlisted", { pub: pubUpdates.filter((u) => hIds.has(u.id)).length })
    await prisma.growDiary.update({ where: { id: diaryPub.id }, data: { visibility: "PRIVATE" } })
    const hidden2 = await pageAll(await resolveFeedScope(viewer.id, "following"), ["update"], 30)
    !pubUpdates.some((u) => new Set(hidden2.map((i) => i.id)).has(u.id))
      ? pass("PUBLIC→PRIVATE hides all updates from the grow")
      : fail("flip to private", "public updates still visible")
    await prisma.growDiary.update({ where: { id: diaryPub.id }, data: { visibility: "PUBLIC" } })
    const back = await pageAll(await resolveFeedScope(viewer.id, "following"), ["update"], 30)
    pubUpdates.every((u) => new Set(back.map((i) => i.id)).has(u.id))
      ? pass("PRIVATE→PUBLIC restores updates")
      : fail("flip back", "missing")
  }

  // for-you: category follow surfaces an unfollowed author's thread
  {
    const fy = await getFeedPage({ scope: await resolveFeedScope(viewer.id, "for-you"), limit: 30 })
    const keys = new Set(fy.items.map((i) => `${i.kind}:${i.id}`))
    keys.has(`thread:${catThreadId}`)
      ? pass("for-you: followed category surfaces unfollowed author's thread")
      : fail("for-you category", [...keys].filter((k) => k.startsWith("thread")))
    !keys.has(`update:${otherUpdateId}`) && !keys.has(`thread:${otherThreadId}`)
      ? pass("for-you: unfollowed, uncategorized content stays out")
      : fail("for-you scope", "unexpected content")
    // for-you ordering within the page is score-ranked but windowed —
    // every returned item must still be a scoped item.
    fy.items.every((i) => expectedFollowing.some((e) => e.id === i.id) || i.id === catThreadId)
      ? pass("for-you page contains only scoped items")
      : fail("for-you leakage", fy.items.map((i) => i.id))
  }

  // Phase 1 integration: interaction counts ride the update row
  {
    const p = await getFeedPage({ scope: await resolveFeedScope(null, "latest"), kinds: ["update"], limit: 30 })
    const u0 = p.items.find((i) => i.id === pubUpdates[0].id)
    u0 && u0.kind === "update" && u0.data._count.reactions === 1 && u0.data._count.comments === 1
      ? pass("update feed item carries Phase 1 reaction/comment counts")
      : fail("update counts", u0?.kind === "update" ? u0.data._count : "missing")
    const hrefOk = u0?.href.includes(`#update-${pubUpdates[0].id}`)
    hrefOk ? pass("update item href is the update anchor") : fail("update href", u0?.href)
  }

  // ── C. HTTP boundary ────────────────────────────────────────────
  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login" } } })
  const { cookie: vc } = await login(viewer.username, viewer.password)

  let r = await api("/api/feed")
  const items0 = (r.data?.items ?? []) as FeedItem[]
  if (r.status === 200 && Array.isArray(r.data?.items)) {
    const ids = new Set(items0.map((i: FeedItem) => i.id))
    !ids.has(privUpdates[0].id) && !ids.has(unlUpdates[0].id)
      ? pass("GET /api/feed guest: private/unlisted absent")
      : fail("api guest leak", "present")
    items0.every((i: FeedItem) => i.kind && i.id && i.href && i.data)
      ? pass("api items have canonical shape (kind,id,href,data)")
      : fail("api item shape", r.data.items[0] && Object.keys(r.data.items[0]))
  } else fail("GET /api/feed", r.status)

  r = await api("/api/feed?mode=following")
  r.status === 200 && (r.data?.items as FeedItem[] | undefined)?.length === 0 && r.data?.nextCursor === null
    ? pass("guest following → empty page over HTTP")
    : fail("api guest following", { s: r.status, n: (r.data?.items as unknown[] | undefined)?.length })

  for (const [q, label] of [["?mode=bogus", "bad mode"], ["?kinds=bogus", "bad kinds"], ["?limit=-1", "bad limit"]] as const) {
    r = await api(`/api/feed${q}`)
    r.status === 400 ? pass(`${label} → 400`) : fail(label, r.status)
  }

  r = await api("/api/feed?mode=following&limit=5", { cookie: vc })
  const items1 = (r.data?.items ?? []) as FeedItem[]
  if (r.status === 200 && items1.length === 5 && r.data?.nextCursor) {
    const ids1 = new Set(items1.map((i: FeedItem) => i.id))
    const r2 = await api(`/api/feed?mode=following&limit=5&cursor=${encodeURIComponent(String(r.data.nextCursor))}`, { cookie: vc })
    const overlap = ((r2.data?.items ?? []) as FeedItem[]).filter((i) => ids1.has(i.id))
    r2.status === 200 && overlap.length === 0
      ? pass("api pagination: page 2 disjoint from page 1")
      : fail("api page 2", { s: r2.status, overlap })
    items1[0]?.href?.includes("#update-")
      ? pass("api update href deep-links the update")
      : fail("api href", items1[0]?.href)
  } else fail("api authed following", { s: r.status, d: r.data })

  // /feed page renders the stream + Load more
  const html = await (await fetch(`${BASE}/feed`)).text()
  html.includes("Community Feed") ? pass("/feed renders stream") : fail("/feed html", html.length)
  const htmlF = await (await fetch(`${BASE}/feed?tab=following`, { headers: { cookie: vc } })).text()
  htmlF.includes("From Your Follows") && htmlF.includes("Load more")
    ? pass("/feed?tab=following renders items + Load more")
    : fail("following html", { follows: htmlF.includes("From Your Follows"), more: htmlF.includes("Load more") })
  const htmlG = await (await fetch(`${BASE}/feed?tab=following`)).text()
  htmlG.includes("Sign in to build your feed")
    ? pass("guest following tab → sign-in empty state")
    : fail("guest following html", htmlG.length)
  const htmlD = await (await fetch(`${BASE}/feed?tab=discussions`, { headers: { cookie: vc } })).text()
  htmlD.includes("Discussions") ? pass("/feed?tab=discussions renders") : fail("discussions html", htmlD.length)

  // ── D. profile activity (author-scoped feed) ────────────────────
  // The Activity tab is the canonical feed with an author scope. The
  // profile visibility contract differs from Following on purpose:
  // UNLISTED is never profile-listed — even for a diary-follower.
  {
    const memberScope = await resolveAuthorFeedScope(author.id, viewer.id)
    const all = await pageAll(memberScope, undefined, 7)
    const want = [...pubUpdates, ...authorThreads.map((t) => ({ id: t.id, createdAt: t.createdAt })), { id: discussion.id, createdAt: discussion.createdAt }]
      .map((x) => ({ id: x.id, ts: x.createdAt }))
    want.push({ id: diaryHarv.id, ts: new Date(base - 5 * 60_000) })
    want.sort((a, b) => b.ts.getTime() - a.ts.getTime() || (b.id < a.id ? -1 : b.id > a.id ? 1 : 0))
    const got = all.map((i) => i.id)
    JSON.stringify(got) === JSON.stringify(want.map((w) => w.id))
      ? pass("profile activity: exact public author set, (ts,id) order")
      : fail("profile activity set", { got: got.slice(0, 8), want: want.slice(0, 8).map((w) => w.id) })
    const gotSet = new Set(got)
    unlUpdates.every((u) => !gotSet.has(u.id)) && privUpdates.every((u) => !gotSet.has(u.id)) && !gotSet.has(deletedUpdateId)
      ? pass("profile activity: unlisted/private/deleted excluded (even for diary-follower)")
      : fail("profile activity leak", { unl: unlUpdates.filter((u) => gotSet.has(u.id)).length })

    // Guests get the same public set — no personalized material.
    const guestSet = new Set((await pageAll(await resolveAuthorFeedScope(author.id, null), undefined, 30)).map((i) => i.id))
    JSON.stringify([...guestSet].sort()) === JSON.stringify([...gotSet].sort())
      ? pass("guest profile activity = member public set")
      : fail("guest activity", { guest: guestSet.size, member: gotSet.size })

    // The owner sees their own UNLISTED/PRIVATE rows — deleted stays out.
    const ownIds = new Set((await pageAll(await resolveAuthorFeedScope(author.id, author.id), ["update"], 40)).map((i) => i.id))
    unlUpdates.every((u) => ownIds.has(u.id)) && privUpdates.every((u) => ownIds.has(u.id)) && !ownIds.has(deletedUpdateId)
      ? pass("owner activity includes own unlisted+private updates, not deleted")
      : fail("owner activity", { unl: unlUpdates.filter((u) => ownIds.has(u.id)).length })

    // Keyset page boundary within the author stream.
    const p1 = await getFeedPage({ scope: memberScope, limit: 5 })
    const p2 = await getFeedPage({ scope: memberScope, cursor: p1.nextCursor, limit: 5 })
    const p1k = new Set(p1.items.map((i) => `${i.kind}:${i.id}`))
    p2.items.length > 0 && p2.items.every((i) => !p1k.has(`${i.kind}:${i.id}`))
      ? pass("profile activity page 2 disjoint from page 1")
      : fail("profile activity overlap", p2.items.map((i) => i.id))
    const bad = await getFeedPage({ scope: memberScope, cursor: "f1.garbage!!", limit: 5 })
    bad.items.length === 5 && bad.items[0].id === want[0].id
      ? pass("profile activity malformed cursor → page 1")
      : fail("activity malformed cursor", bad.items[0]?.id)

    // Yield privacy: a yieldPrivate harvest never serializes the amount
    // for non-owners (payload-level, not just card-level).
    const yh = await mkDiary(author.id, M("yieldpriv"), { harvested: true, harvestedAt: new Date(base - 3 * 60_000), yieldAmount: 420, yieldUnit: "g", yieldPrivate: true })
    const memberItems = await getFeedPage({ scope: memberScope, kinds: ["harvest"], limit: 10 })
    const yItem = memberItems.items.find((i) => i.id === yh.id)
    yItem && yItem.kind === "harvest" && yItem.data.yieldAmount === null && yItem.data.yieldPrivate === true
      ? pass("yieldPrivate harvest redacts amount for non-owner")
      : fail("yield privacy", yItem?.kind === "harvest" ? { y: yItem.data.yieldAmount, p: yItem.data.yieldPrivate } : "missing")
    const ownItems = await getFeedPage({ scope: await resolveAuthorFeedScope(author.id, author.id), kinds: ["harvest"], limit: 10 })
    const ownY = ownItems.items.find((i) => i.id === yh.id)
    ownY && ownY.kind === "harvest" && ownY.data.yieldAmount === 420
      ? pass("yieldPrivate harvest keeps amount for the owner")
      : fail("owner yield", ownY?.kind === "harvest" ? ownY.data.yieldAmount : "missing")

    // getProfileSection plumbing: block → null, banned → null.
    const blockedPage = await getProfileSection(blockedU.username, "activity", viewer.id)
    blockedPage === null ? pass("activity section: block either direction → null") : fail("activity block", blockedPage)
    const bannedPage = await getProfileSection(bannedU.username, "activity", viewer.id)
    bannedPage === null ? pass("activity section: banned author → null") : fail("activity banned", bannedPage)
    const activityPage = await getProfileSection(author.username, "activity", viewer.id, undefined)
    activityPage?.section === "activity" && Array.isArray(activityPage.items) && activityPage.items.length > 0 && (activityPage.items[0] as FeedItem).kind
      ? pass("activity section returns canonical FeedItems")
      : fail("activity section", activityPage && activityPage.items.length)
  }

  // HTTP boundary for the profile activity endpoint.
  {
    r = await api(`/api/users/${author.username}/sections/activity`)
    const acts = (r.data?.items ?? []) as FeedItem[]
    const aSet = new Set(acts.map((i) => i.id))
    r.status === 200 && acts.length > 0 && acts.every((i) => i.kind && i.id && i.href)
      ? pass("GET sections/activity guest → canonical items")
      : fail("api activity", { s: r.status, n: acts.length })
    unlUpdates.every((u) => !aSet.has(u.id)) && privUpdates.every((u) => !aSet.has(u.id))
      ? pass("api activity: unlisted/private absent for guest")
      : fail("api activity leak", "present")
    r = await api(`/api/users/${author.username}/sections/activity?cursor=${encodeURIComponent("f1.garbage!!")}`)
    r.status === 200 && ((r.data?.items ?? []) as FeedItem[]).length > 0
      ? pass("api activity malformed cursor → page 1")
      : fail("api activity cursor", r.status)
    r = await api(`/api/users/${blockedU.username}/sections/activity`, { cookie: vc })
    r.status === 404 ? pass("api activity blocked → 404") : fail("api activity blocked", r.status)
    r = await api("/api/users/no-such-member-xyz/sections/activity")
    r.status === 404 ? pass("api activity unknown member → 404") : fail("api activity 404", r.status)
    r = await api("/api/users/x/sections/bogus-section")
    r.status === 400 ? pass("api unknown section → 400") : fail("api bogus section", r.status)
  }

  // ── member home: from growers you follow ──────────────────────────
  // viewer user-follows `author` and diary-follows diaryUnl. Home should
  // surface public grower-authored activity without private/unlisted leak
  // (except the diary-followed unlisted diary — viewer holds that link).
  {
    const { getMemberHomeData } = await import("@/lib/member-home")
    // A followed-then-blocked author exercises the block boundary: viewer
    // blocks blockedU already, so creating the follow row directly proves
    // blocks win over follows on home surfaces.
    await prisma.follow.create({ data: { followerId: viewer.id, followingId: blockedU.id } })
    await mkThread(blockedU.id, fvCat.id, M("blk thread"), new Date())

    const home = await getMemberHomeData(viewer.id)
    const du = home?.sinceLastVisit.diaryUpdates ?? []
    const gt = home?.sinceLastVisit.growerThreads ?? []
    du.some((u) => u.diaryId === diaryPub.id)
      ? pass("home: followed grower's public update surfaces")
      : fail("home pub update", du.map((u) => u.diaryId))
    // (The unlisted diary-followed path is asserted below via `nofollow`,
    // whose top-4 it can win — viewer's newest 4 are all diaryPub.)
    du.every((u) => u.diaryId !== diaryPriv.id && u.diaryId !== diaryDel.id)
      ? pass("home: private/deleted grower updates never surface")
      : fail("home priv leak", du.map((u) => u.diaryId))
    du.every((u) => u.diaryId !== blkDiary.id)
      ? pass("home: blocked grower's updates suppressed despite follow")
      : fail("home blocked update", du.map((u) => u.diaryId))
    du.length <= 4
      ? pass("home: diaryUpdates bounded at 4")
      : fail("home bound", du.length)
    gt.some((t) => t.title === M("t0"))
      ? pass("home: followed grower's thread surfaces")
      : fail("home grower thread", gt.map((t) => t.slug))
    gt.every((t) => t.title !== M("blk thread"))
      ? pass("home: blocked grower's thread suppressed")
      : fail("home blocked thread", gt.map((t) => t.slug))
    gt.every((t) => t.title !== M("cat thread") && t.title !== M("other thread"))
      ? pass("home: threads from unfollowed authors absent")
      : fail("home unfollowed thread", gt.map((t) => t.slug))

    const home2 = await getMemberHomeData(nofollow.id)
    home2 && home2.sinceLastVisit.diaryUpdates.length === 0 && home2.sinceLastVisit.growerThreads.length === 0
      ? pass("home: member with no follows gets empty lists")
      : fail("home nofollow", home2?.sinceLastVisit.diaryUpdates.length)

    // Diary-follow branch: a member who only diary-follows an UNLISTED
    // diary is a link-holder — its updates surface, private ones don't.
    await prisma.diaryFollow.create({ data: { userId: nofollow.id, diaryId: diaryUnl.id } })
    const home3 = await getMemberHomeData(nofollow.id)
    home3?.sinceLastVisit.diaryUpdates.some((u) => u.diaryId === diaryUnl.id)
      ? pass("home: diary-followed unlisted update surfaces (link-holder)")
      : fail("home unl update", home3?.sinceLastVisit.diaryUpdates.map((u) => u.diaryId))
    await prisma.diaryFollow.deleteMany({ where: { userId: nofollow.id, diaryId: diaryUnl.id } })
    await prisma.follow.deleteMany({ where: { followerId: viewer.id, followingId: blockedU.id } })
  }

  // ── cleanup ─────────────────────────────────────────────────────
  for (const u of [author, viewer, other, blockedU, bannedU, nofollow]) {
    if (u?.id) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
  }
  if (fvCat?.id) await prisma.category.delete({ where: { id: fvCat.id } }).catch(() => {})
  const resid = {
    users: await prisma.user.count({ where: { name: { startsWith: "feedv_" } } }),
    diaries: await prisma.growDiary.count({ where: { title: { contains: "feedv" } } }),
    threads: await prisma.thread.count({ where: { title: { contains: "feedv" } } }),
    updates: await prisma.diaryUpdate.count({ where: { title: { contains: "feedv" } } }),
    cats: await prisma.category.count({ where: { slug: { startsWith: "fv-" } } }),
  }
  Object.values(resid).every((n) => n === 0)
    ? pass("cleanup: zero feedv residue")
    : fail("cleanup residue", resid)

  await prisma.$disconnect().catch(() => {})
  process.exitCode = finish()
}

main().catch(async (e) => {
  console.error("feed-verify crashed:", e)
  try {
    for (const u of [author, viewer, other, blockedU, bannedU, nofollow]) {
      if (u?.id) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    }
    if (fvCat?.id) await prisma.category.delete({ where: { id: fvCat.id } }).catch(() => {})
    await prisma.$disconnect().catch(() => {})
  } finally {
    process.exit(1)
  }
})
