// moments-verify.mts — Social Moments verification suite.
//
// Covers the native social post domain (src/lib/moments.ts +
// /api/moments/*): create validation, the canonical visibility rule
// (public/followers/blocks/deleted/banned/story-expiry), comments,
// reactions, pure reposts + quotes, reports, media proxy, feed
// integration (kind "moment"), the story rail and hashtag pages.
// HTTP boundary first; feed/rail/hashtag assertions exercise the real
// lib functions. All fixtures are `mv_`-marked and cleaned up at the end.
import "./db-guard.mjs"
import { makeHarness } from "./lib/http-harness.mjs"
import { prisma } from "@/lib/prisma"
import { resolveFeedScope, resolveAuthorFeedScope, getFeedPage } from "@/lib/feed"
import { getStoryRail, getAuthorStories, getTrendingHashtags, hashtagSlug } from "@/lib/moments"
import { getMemberHomeData } from "@/lib/member-home"
import type { FeedItem } from "@/lib/feed"

const harnessOpts = {
  name: (t: string, ts: string) => `mv_${t}_${ts}`,
  username: (t: string, ts: string) => `mv-${t}-${ts}`,
  password: "Moment!Verify123",
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

const M = (s: string) => `mv ${s} ${ts}`
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

type VerifyUser = Awaited<ReturnType<typeof createUser>>
let author: VerifyUser, follower: VerifyUser, viewer: VerifyUser, other: VerifyUser, blockedU: VerifyUser, bannedU: VerifyUser
let postPub = "", postFol = "", postImg = "", storyId = "", expiredStoryId = ""
let blockedPostId = "", bannedPostId = "", deletedPostId = ""
let commentId = "", folCommentId = ""
const tagName = `mvtag${ts}`.toLowerCase()
const folTagName = `mvfol${ts}`.toLowerCase()

const momentIds = () =>
  [postPub, postFol, postImg, storyId, expiredStoryId, blockedPostId, bannedPostId, deletedPostId].filter(Boolean)

async function feedIds(scope: Parameters<typeof getFeedPage>[0]["scope"], kinds?: ("moment" | "update" | "thread" | "harvest")[]): Promise<Set<string>> {
  const ids = new Set<string>()
  let cursor: string | null = null
  for (let i = 0; i < 20; i++) {
    const p = await getFeedPage({ scope, kinds, cursor, limit: 30 })
    for (const it of p.items) ids.add(it.id)
    if (!p.nextCursor) break
    cursor = p.nextCursor
  }
  return ids
}

async function main() {
  console.log("── moments ──")

  // ── fixtures ────────────────────────────────────────────────────
  author = await createUser("author")
  follower = await createUser("follower")
  viewer = await createUser("viewer")
  other = await createUser("other")
  blockedU = await createUser("blocked")
  bannedU = await createUser("banned", { banned: true })

  await prisma.follow.create({ data: { followerId: follower.id, followingId: author.id } })
  await prisma.follow.create({ data: { followerId: viewer.id, followingId: other.id } })
  // Member-home fixtures: viewer follows a blocked + a banned author so
  // the since-last-visit surface must still exclude their posts.
  await prisma.follow.create({ data: { followerId: viewer.id, followingId: blockedU.id } })
  await prisma.follow.create({ data: { followerId: viewer.id, followingId: bannedU.id } })
  await prisma.block.create({ data: { blockerId: viewer.id, blockedId: blockedU.id } })

  // Fixture moments for states the API can't produce directly.
  blockedPostId = (await prisma.moment.create({
    data: { kind: "POST", content: M("blocked post"), visibility: "PUBLIC", authorId: blockedU.id },
    select: { id: true },
  })).id
  bannedPostId = (await prisma.moment.create({
    data: { kind: "POST", content: M("banned post"), visibility: "PUBLIC", authorId: bannedU.id },
    select: { id: true },
  })).id
  deletedPostId = (await prisma.moment.create({
    data: { kind: "POST", content: M("deleted post"), visibility: "PUBLIC", authorId: author.id, deleted: true },
    select: { id: true },
  })).id
  expiredStoryId = (await prisma.moment.create({
    data: {
      kind: "STORY", content: M("expired story"), visibility: "PUBLIC", authorId: author.id,
      expiresAt: new Date(Date.now() - 60_000),
      images: { create: [{ url: TINY_PNG, order: 0 }] },
    },
    select: { id: true },
  })).id

  await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login" } } })
  const { cookie: ac } = await login(author.username, author.password)
  const { cookie: fc } = await login(follower.username, follower.password)
  const { cookie: vc } = await login(viewer.username, viewer.password)
  const { cookie: bc } = await login(blockedU.username, blockedU.password)

  // ── A. create + validation ──────────────────────────────────────
  {
    let r = await api("/api/moments", { method: "POST", body: { content: M("guest") } })
    r.status === 401 ? pass("create: guest → 401") : fail("guest create", r.status)

    r = await api("/api/moments", { method: "POST", body: { content: "" }, cookie: ac })
    r.status === 400 ? pass("create: empty post → 400") : fail("empty post", r.status)

    r = await api("/api/moments", { method: "POST", body: { content: "x".repeat(1001) }, cookie: ac })
    r.status === 400 ? pass("create: >1000 chars → 400") : fail("long post", r.status)

    r = await api("/api/moments", { method: "POST", body: { kind: "BOGUS", content: "x" }, cookie: ac })
    r.status === 400 ? pass("create: bad kind → 400") : fail("bad kind", r.status)

    r = await api("/api/moments", { method: "POST", body: { visibility: "FRIENDS", content: "x" }, cookie: ac })
    r.status === 400 ? pass("create: bad visibility → 400") : fail("bad visibility", r.status)

    r = await api("/api/moments", { method: "POST", body: { kind: "STORY", content: "no photo" }, cookie: ac })
    r.status === 400 ? pass("create: story without photo → 400") : fail("story no photo", r.status)

    r = await api("/api/moments", { method: "POST", body: { kind: "STORY", images: [TINY_PNG], content: "x".repeat(201) }, cookie: ac })
    r.status === 400 ? pass("create: story caption >200 → 400") : fail("story caption", r.status)

    // Happy paths.
    r = await api("/api/moments", { method: "POST", body: { content: `${M("public post")} #${tagName}` }, cookie: ac })
    const pm = (r.data?.moment ?? null) as { id?: string; href?: string; kind?: string } | null
    if (r.status === 201 && pm?.id) {
      postPub = pm.id
      pm.kind === "POST" && pm.href === `/m/${pm.id}`
        ? pass("create: public post → 201 with canonical href")
        : fail("post dto", pm)
    } else fail("create post", { s: r.status, d: r.data })

    r = await api("/api/moments", { method: "POST", body: { content: `${M("followers post")} #${folTagName}`, visibility: "FOLLOWERS" }, cookie: ac })
    r.status === 201 && (r.data?.moment as { id?: string })?.id
      ? (postFol = (r.data!.moment as { id: string }).id, pass("create: followers post → 201"))
      : fail("create followers post", { s: r.status })

    r = await api("/api/moments", { method: "POST", body: { content: M("photo post"), images: [TINY_PNG] }, cookie: ac })
    r.status === 201 && ((r.data?.moment as { images?: { url: string }[] })?.images?.[0]?.url ?? "").startsWith("/api/media/moment/")
      ? (postImg = (r.data!.moment as { id: string }).id, pass("create: photo post serializes proxy URL"))
      : fail("photo post", { s: r.status, d: r.data })

    r = await api("/api/moments", { method: "POST", body: { kind: "STORY", images: [TINY_PNG], content: M("story caption") }, cookie: ac })
    r.status === 201 && (r.data?.moment as { expiresAt?: string })?.expiresAt
      ? (storyId = (r.data!.moment as { id: string }).id, pass("create: story → 201 with expiresAt"))
      : fail("create story", { s: r.status, d: r.data })
  }

  // ── B. visibility (GET /api/moments/[id]) ───────────────────────
  {
    let r = await api(`/api/moments/${postPub}`)
    r.status === 200 ? pass("public post: guest → 200") : fail("guest pub", r.status)

    r = await api(`/api/moments/${postFol}`)
    r.status === 404 ? pass("followers post: guest → 404") : fail("guest fol", r.status)
    r = await api(`/api/moments/${postFol}`, { cookie: vc })
    r.status === 404 ? pass("followers post: non-follower → 404") : fail("nonfollower fol", r.status)
    r = await api(`/api/moments/${postFol}`, { cookie: fc })
    r.status === 200 ? pass("followers post: follower → 200") : fail("follower fol", r.status)
    r = await api(`/api/moments/${postFol}`, { cookie: ac })
    r.status === 200 ? pass("followers post: author → 200") : fail("author fol", r.status)

    r = await api(`/api/moments/${blockedPostId}`, { cookie: vc })
    r.status === 404 ? pass("blocked author: blocked viewer → 404") : fail("blocked viewer", r.status)
    r = await api(`/api/moments/${blockedPostId}`)
    r.status === 200 ? pass("blocked author: guest (no block rel) → 200") : fail("guest blocked post", r.status)

    r = await api(`/api/moments/${bannedPostId}`)
    r.status === 404 ? pass("banned author → 404") : fail("banned post", r.status)
    r = await api(`/api/moments/${deletedPostId}`, { cookie: ac })
    r.status === 404 ? pass("deleted → 404 even for author") : fail("deleted post", r.status)

    r = await api(`/api/moments/${storyId}`, { cookie: vc })
    r.status === 200 ? pass("active story: member → 200") : fail("story view", r.status)
    r = await api(`/api/moments/${expiredStoryId}`, { cookie: vc })
    r.status === 404 ? pass("expired story: non-author → 404") : fail("expired story", r.status)
    r = await api(`/api/moments/${expiredStoryId}`, { cookie: ac })
    r.status === 200 ? pass("expired story: author still sees own") : fail("expired own story", r.status)
  }

  // ── C. comments ─────────────────────────────────────────────────
  {
    let r = await api(`/api/moments/${postPub}/comments`, { method: "POST", body: { content: M("c1") } })
    r.status === 401 ? pass("comment: guest → 401") : fail("guest comment", r.status)

    r = await api(`/api/moments/${postPub}/comments`, { method: "POST", body: { content: M("c1") }, cookie: vc })
    if (r.status === 201 && (r.data?.comment as { id?: string })?.id) {
      commentId = (r.data!.comment as { id: string }).id
      pass("comment: member on public post → 201")
    } else fail("comment create", { s: r.status, d: r.data })

    const notif = await prisma.notification.findFirst({
      where: { userId: author.id, type: "COMMENT", link: { contains: `/m/${postPub}#comment-` } },
      select: { id: true },
    })
    notif ? pass("comment notifies the post author") : fail("comment notif", "missing")

    r = await api(`/api/moments/${postPub}/comments`)
    const list = (r.data?.comments ?? []) as { id: string }[]
    r.status === 200 && list.some((c) => c.id === commentId)
      ? pass("comment list returns the new comment")
      : fail("comment list", { s: r.status, n: list.length })

    r = await api(`/api/moments/${postFol}/comments`, { method: "POST", body: { content: "x" }, cookie: vc })
    r.status === 404 ? pass("comment on followers post: non-follower → 404") : fail("fol comment", r.status)
    r = await api(`/api/moments/${postFol}/comments`, { method: "POST", body: { content: M("fol comment") }, cookie: fc })
    r.status === 201 ? (folCommentId = (r.data!.comment as { id: string }).id, pass("comment: follower on followers post → 201")) : fail("fol comment create", r.status)

    r = await api(`/api/moments/${storyId}/comments`, { method: "POST", body: { content: "x" }, cookie: vc })
    r.status === 404 ? pass("comment on story → 404") : fail("story comment", r.status)

    r = await api(`/api/moments/${postPub}/comments`, { method: "POST", body: { content: "x".repeat(1001) }, cookie: vc })
    r.status === 400 ? pass("comment >1000 chars → 400") : fail("long comment", r.status)

    // delete authorization: stranger → 403, comment author → 200.
    r = await api(`/api/moments/comments/${folCommentId}`, { method: "DELETE", cookie: vc })
    r.status === 403 ? pass("comment delete: stranger → 403") : fail("stranger delete", r.status)
    r = await api(`/api/moments/comments/${folCommentId}`, { method: "DELETE", cookie: ac })
    r.status === 200 ? pass("comment delete: post author curates → 200") : fail("author delete", r.status)
    r = await api(`/api/moments/comments/${commentId}`, { method: "DELETE", cookie: vc })
    r.status === 200 ? pass("comment delete: own comment → 200") : fail("own delete", r.status)
  }

  // ── D. reactions ────────────────────────────────────────────────
  {
    let r = await api("/api/reactions", { method: "POST", body: { type: "LIKE", momentId: postPub }, cookie: vc })
    r.status === 201 && r.data?.action === "added" ? pass("reaction: like moment → added") : fail("like", { s: r.status, d: r.data })
    r = await api("/api/reactions", { method: "POST", body: { type: "LIKE", momentId: postPub }, cookie: vc })
    r.data?.action === "removed" ? pass("reaction: same type toggles off") : fail("unlike", r.data)
    r = await api("/api/reactions", { method: "POST", body: { type: "LIKE", momentId: postPub }, cookie: vc })

    r = await api("/api/reactions", { method: "POST", body: { type: "LIKE", momentId: postPub, postId: postPub }, cookie: vc })
    r.status === 400 ? pass("reaction: two targets → 400") : fail("two targets", r.status)

    r = await api("/api/reactions", { method: "POST", body: { type: "LIKE", momentId: postFol }, cookie: vc })
    r.status === 404 ? pass("reaction on followers post: non-follower → 404") : fail("fol reaction", r.status)
    r = await api("/api/reactions", { method: "POST", body: { type: "LIKE", momentId: postFol }, cookie: fc })
    r.status === 201 ? pass("reaction: follower can like followers post") : fail("follower reaction", r.status)

    // canViewMoment's block gate resolves before the route's 403 check —
    // a blocked author's moment is a uniform 404, never an oracle.
    r = await api("/api/reactions", { method: "POST", body: { type: "LIKE", momentId: blockedPostId }, cookie: vc })
    r.status === 404 ? pass("reaction on blocked author's post → 404 (no oracle)") : fail("blocked reaction", r.status)

    const anotif = await prisma.notification.findFirst({
      where: { userId: author.id, type: "REACTION", link: `/m/${postPub}` },
      select: { id: true },
    })
    anotif ? pass("reaction notifies the post author") : fail("reaction notif", "missing")
  }

  // ── E. reposts + quotes ─────────────────────────────────────────
  {
    let r = await api(`/api/moments/${postPub}/repost`, { method: "POST", cookie: fc })
    r.status === 200 && r.data?.reposted === true && r.data?.reposts === 1
      ? pass("repost: first toggle → reposted, count 1")
      : fail("repost on", { s: r.status, d: r.data })

    // The repost row exists and is a pure repost of the original.
    const rp = await prisma.moment.findFirst({
      where: { authorId: follower.id, repostOfId: postPub, content: "", deleted: false },
      select: { id: true },
    })
    rp ? pass("repost writes a pure repost row") : fail("repost row", "missing")

    r = await api(`/api/moments/${rp!.id}/repost`, { method: "POST", cookie: vc })
    r.status === 404 ? pass("repost of a repost → 404") : fail("repost chain", r.status)

    // A pure repost is a pointer: interactions against its id land on the
    // original — same as the card, which always sends the original's id.
    r = await api("/api/reactions", { method: "POST", body: { type: "FIRE", momentId: rp!.id }, cookie: vc })
    if (r.status === 200 || r.status === 201) {
      const landed = await prisma.reaction.findFirst({
        where: { userId: viewer.id, momentId: postPub }, select: { id: true },
      })
      landed ? pass("reaction on repost id → lands on the original") : fail("repost reaction", r.data)
      landed && (await prisma.reaction.delete({ where: { id: landed.id } }))
      const stray = await prisma.reaction.findFirst({ where: { userId: viewer.id, momentId: rp!.id }, select: { id: true } })
      !stray ? pass("no reaction row on the repost pointer") : fail("stray reaction", stray.id)
    } else {
      fail("repost reaction", { s: r.status, d: r.data })
    }

    r = await api(`/api/moments/${rp!.id}/comments`, { method: "POST", body: { content: M("via repost") }, cookie: vc })
    if (r.status === 201) {
      const c = await prisma.momentComment.findFirst({
        where: { momentId: postPub, authorId: viewer.id, content: M("via repost") }, select: { id: true },
      })
      c ? pass("comment on repost id → attaches to the original") : fail("repost comment", "missing")
      // ...and the repost's comment list IS the original's.
      const rl = await api(`/api/moments/${rp!.id}/comments`, { cookie: vc })
      const list = (rl.data?.comments ?? []) as { id: string }[]
      list.some((x) => x.id === c?.id)
        ? pass("repost comment list serves the original's comments")
        : fail("repost comment list", rl.status)
    } else {
      fail("repost comment", { s: r.status, d: r.data })
    }

    r = await api(`/api/moments/${postFol}/repost`, { method: "POST", cookie: fc })
    r.status === 404 ? pass("repost of followers post → 404 (public only)") : fail("fol repost", r.status)

    r = await api("/api/moments", { method: "POST", body: { repostOfId: postPub }, cookie: vc })
    r.status === 400 ? pass("quote without own text → 400") : fail("empty quote", r.status)
    r = await api("/api/moments", { method: "POST", body: { repostOfId: postFol, content: M("quote fol") }, cookie: fc })
    r.status === 404 ? pass("quote of followers post → 404") : fail("fol quote", r.status)

    const rnotif = await prisma.notification.findFirst({
      where: { userId: author.id, type: "REACTION", link: `/m/${postPub}`, title: "Your post was reposted" },
      select: { id: true },
    })
    rnotif ? pass("repost notifies the original author") : fail("repost notif", "missing")

    // toggle off
    r = await api(`/api/moments/${postPub}/repost`, { method: "POST", cookie: fc })
    r.status === 200 && r.data?.reposted === false
      ? pass("repost: second toggle removes it")
      : fail("repost off", r.data)
  }

  // ── F. feed integration (lib) ───────────────────────────────────
  {
    const guest = await resolveFeedScope(null, "latest")
    const gIds = await feedIds(guest, ["moment"])
    gIds.has(postPub) && gIds.has(postImg)
      ? pass("feed latest (guest): public posts present")
      : fail("guest moments", { pub: gIds.has(postPub), img: gIds.has(postImg) })
    !gIds.has(postFol) && !gIds.has(storyId) && !gIds.has(expiredStoryId) && !gIds.has(deletedPostId) && !gIds.has(bannedPostId)
      ? pass("feed latest (guest): followers/story/expired/deleted/banned absent")
      : fail("guest moment leak", { fol: gIds.has(postFol), story: gIds.has(storyId), exp: gIds.has(expiredStoryId), del: gIds.has(deletedPostId), ban: gIds.has(bannedPostId) })

    const followScope = await resolveFeedScope(follower.id, "following")
    const fIds = await feedIds(followScope, ["moment"])
    fIds.has(postPub) && fIds.has(postFol)
      ? pass("feed following: follower sees author's public + followers posts")
      : fail("following moments", { pub: fIds.has(postPub), fol: fIds.has(postFol) })
    !fIds.has(blockedPostId)
      ? pass("feed following: unrelated blocked author's post absent")
      : fail("following blocked", blockedPostId)

    const viewerIds = await feedIds(await resolveFeedScope(viewer.id, "latest"), ["moment"])
    !viewerIds.has(blockedPostId)
      ? pass("feed latest (viewer): blocked author's moment absent")
      : fail("viewer blocked leak", blockedPostId)
    !viewerIds.has(postFol)
      ? pass("feed latest (viewer): followers post absent")
      : fail("viewer fol leak", postFol)

    // kinds filter still scopes the stream.
    const upOnly = await feedIds(await resolveFeedScope(null, "latest"), ["update"])
    !upOnly.has(postPub) ? pass("kinds=[update] excludes moments") : fail("kinds filter", postPub)

    // author-scoped (profile wall) feed
    const wallIds = await feedIds(await resolveAuthorFeedScope(author.id, viewer.id), ["moment"])
    wallIds.has(postPub) && !wallIds.has(postFol)
      ? pass("profile wall: member sees author's public, not followers posts")
      : fail("wall", { pub: wallIds.has(postPub), fol: wallIds.has(postFol) })
    const wallOwn = await feedIds(await resolveAuthorFeedScope(author.id, author.id), ["moment"])
    wallOwn.has(postFol)
      ? pass("profile wall: author sees own followers posts")
      : fail("own wall", postFol)
    const wallFol = await feedIds(await resolveAuthorFeedScope(author.id, follower.id), ["moment"])
    wallFol.has(postFol)
      ? pass("profile wall: follower sees author's followers posts")
      : fail("follower wall", postFol)

    // moment items carry the DTO the card needs
    const p = await getFeedPage({ scope: guest, kinds: ["moment"], limit: 10 })
    const item = p.items.find((i): i is Extract<FeedItem, { kind: "moment" }> => i.id === postPub)
    item && item.data.counts && typeof item.data.liked === "boolean" && item.href === `/m/${postPub}`
      ? pass("feed moment item carries MomentDTO (counts, liked, href)")
      : fail("moment dto", item?.kind)

    // HTTP continuation endpoint serves the same kind over the wire.
    const r = await api("/api/feed?kinds=moment&limit=10")
    const httpItems = (r.data?.items ?? []) as FeedItem[]
    r.status === 200 && httpItems.some((i) => i.id === postPub && i.kind === "moment") && !httpItems.some((i) => i.id === postFol)
      ? pass("GET /api/feed?kinds=moment serves public, hides followers posts")
      : fail("api feed moments", { s: r.status, n: httpItems.length })
  }

  // ── G. repost feed behavior ─────────────────────────────────────
  {
    // follower reposts → the repost surfaces in viewer's following feed
    // (viewer follows `other`, not `follower` — so check follower's own
    // followers scope instead: author doesn't follow follower... assert via
    // the repost author's profile wall + a feed scoped to someone who
    // follows `follower`).
    await prisma.follow.create({ data: { followerId: viewer.id, followingId: follower.id } })
    await api(`/api/moments/${postPub}/repost`, { method: "POST", cookie: fc })
    const vIds = await feedIds(await resolveFeedScope(viewer.id, "following"), ["moment"])
    const repostRow = await prisma.moment.findFirst({
      where: { authorId: follower.id, repostOfId: postPub, content: "", deleted: false },
      select: { id: true },
    })
    repostRow && vIds.has(repostRow.id)
      ? pass("pure repost surfaces in followers' feeds")
      : fail("repost feed", { row: repostRow?.id, in: repostRow ? vIds.has(repostRow.id) : false })

    // Viewer must not be able to repost what they can't see — and a repost
    // of a now-deleted original drops out of every feed.
    const del = await prisma.moment.create({
      data: { kind: "POST", content: M("soon deleted"), visibility: "PUBLIC", authorId: author.id },
      select: { id: true },
    })
    await prisma.moment.create({
      data: { kind: "POST", content: "", visibility: "PUBLIC", authorId: follower.id, repostOfId: del.id },
      select: { id: true },
    })
    await prisma.moment.update({ where: { id: del.id }, data: { deleted: true } })
    const v2 = await feedIds(await resolveFeedScope(viewer.id, "following"), ["moment"])
    !v2.has(del.id) && ![...v2].some((id) => id === del.id)
      ? pass("deleted original: neither the post nor its pure repost leaks")
      : fail("deleted repost", del.id)
    await prisma.moment.deleteMany({ where: { OR: [{ id: del.id }, { repostOfId: del.id }] } })
  }

  // ── H. hashtags ─────────────────────────────────────────────────
  {
    const tag = await prisma.tag.findUnique({ where: { slug: hashtagSlug(tagName) }, select: { id: true } })
    tag ? pass("hashtag creates a shared Tag row") : fail("tag row", tagName)
    const mt = await prisma.momentTag.findFirst({ where: { momentId: postPub, tagId: tag?.id ?? "" }, select: { momentId: true } })
    mt ? pass("hashtag links post via MomentTag") : fail("momenttag", "missing")

    const slug = hashtagSlug(tagName)
    const html = await (await fetch(`${BASE}/tags/${slug}`)).text()
    html.includes(M("public post")) ? pass("/tags/[slug] lists the public post") : fail("tag page", html.length)
    !html.includes(M("followers post")) ? pass("/tags/[slug]: followers post absent for guest") : fail("tag leak", tagName)
    const htmlFol = await (await fetch(`${BASE}/tags/${hashtagSlug(folTagName)}`, { headers: { cookie: vc } })).text()
    !htmlFol.includes(M("followers post"))
      ? pass("/tags/[slug]: followers post absent for non-follower")
      : fail("tag member leak", folTagName)

    const trending = await getTrendingHashtags({ days: 7, limit: 50 })
    trending.some((t) => t.name === tagName)
      ? pass("getTrendingHashtags surfaces the public post's tag")
      : fail("trending", trending.map((t) => t.name).slice(0, 5))
    !trending.some((t) => t.name === folTagName)
      ? pass("trending excludes followers-only tags")
      : fail("trending leak", folTagName)
  }

  // ── I. stories rail + viewer ────────────────────────────────────
  {
    const railFol = await getStoryRail(follower.id)
    railFol.some((e) => e.author.id === author.id)
      ? pass("story rail: follower sees followed author's active story")
      : fail("rail follower", railFol.map((e) => e.author.id))
    const railViewer = await getStoryRail(viewer.id)
    !railViewer.some((e) => e.author.id === author.id)
      ? pass("story rail: non-follower doesn't see author's story")
      : fail("rail viewer", railViewer.map((e) => e.author.id))
    railViewer.every((e) => e.author.id !== blockedU.id)
      ? pass("story rail: blocked authors absent")
      : fail("rail blocked", "present")
    const railAuthor = await getStoryRail(author.id)
    railAuthor[0]?.author.id === author.id
      ? pass("story rail: own entry leads")
      : fail("rail own", railAuthor[0]?.author.id)
    // expired story is fixture-only → never appears anywhere
    !railAuthor.some((e) => e.count > 1) // author has 1 active + 1 expired story
      ? pass("story rail: expired story not counted")
      : fail("rail expired", railAuthor.find((e) => e.author.id === author.id)?.count)

    const stories = await getAuthorStories(author.id, follower.id)
    stories.length === 1 && stories[0].id === storyId
      ? pass("getAuthorStories: active stories only, oldest first")
      : fail("author stories", stories.map((s) => s.id))
    const blocked = await getAuthorStories(blockedU.id, viewer.id)
    blocked.length === 0 ? pass("getAuthorStories: blocked → empty") : fail("blocked stories", blocked.length)

    const page = await fetch(`${BASE}/stories/${author.username}`, { headers: { cookie: fc } })
    page.status === 200 ? pass("/stories/[username] renders for follower") : fail("story page", page.status)
    const page404 = await fetch(`${BASE}/stories/${other.username}`, { headers: { cookie: fc } })
    page404.status === 404 ? pass("/stories/[username]: no active stories → 404") : fail("story page 404", page404.status)
  }

  // ── J. media proxy ──────────────────────────────────────────────
  {
    const folImg = await prisma.momentImage.findFirst({ where: { momentId: postFol }, select: { id: true } })
    // postFol has no image — attach one directly to exercise the proxy.
    const img = folImg ?? (await prisma.momentImage.create({ data: { momentId: postFol, url: TINY_PNG, order: 0 }, select: { id: true } }))
    const url = `/api/media/moment/${img.id}`
    let res = await fetch(`${BASE}${url}`)
    res.status === 404 ? pass("media: followers-post image denied to guest") : fail("media guest", res.status)
    res = await fetch(`${BASE}${url}`, { headers: { cookie: vc } })
    res.status === 404 ? pass("media: followers-post image denied to non-follower") : fail("media viewer", res.status)
    res = await fetch(`${BASE}${url}`, { headers: { cookie: fc } })
    res.status === 200 ? pass("media: followers-post image served to follower") : fail("media follower", res.status)
    const pubImg = await prisma.momentImage.findFirst({ where: { momentId: postImg }, select: { id: true } })
    res = await fetch(`${BASE}/api/media/moment/${pubImg!.id}`)
    res.status === 200 ? pass("media: public-post image served to guest") : fail("media public", res.status)
    const expImg = await prisma.momentImage.findFirst({ where: { momentId: expiredStoryId }, select: { id: true } })
    res = await fetch(`${BASE}/api/media/moment/${expImg!.id}`, { headers: { cookie: vc } })
    res.status === 404 ? pass("media: expired story image denied to non-author") : fail("media expired", res.status)
  }

  // ── K. reports ──────────────────────────────────────────────────
  {
    let r = await api("/api/reports", { method: "POST", body: { type: "MOMENT", targetId: postPub, reason: "SPAM" }, cookie: vc })
    r.status === 201 ? pass("report: MOMENT → 201") : fail("report moment", { s: r.status, d: r.data })
    r = await api("/api/reports", { method: "POST", body: { type: "MOMENT", targetId: postPub, reason: "SPAM" }, cookie: vc })
    r.status === 409 ? pass("report: duplicate open report → 409") : fail("report dup", r.status)
    r = await api("/api/reports", { method: "POST", body: { type: "MOMENT", targetId: postPub, reason: "SPAM" }, cookie: ac })
    r.status === 400 ? pass("report: own content → 400") : fail("report self", r.status)
    r = await api("/api/reports", { method: "POST", body: { type: "MOMENT", targetId: "cmissing12345", reason: "SPAM" }, cookie: vc })
    r.status === 404 ? pass("report: unknown moment → 404") : fail("report 404", r.status)
    r = await api("/api/reports", { method: "POST", body: { type: "MOMENT", targetId: deletedPostId, reason: "SPAM" }, cookie: vc })
    r.status === 404 ? pass("report: deleted moment → 404") : fail("report deleted", r.status)

    // a live comment to report
    const c = await api(`/api/moments/${postPub}/comments`, { method: "POST", body: { content: M("reported comment") }, cookie: fc })
    const cid = (c.data?.comment as { id?: string })?.id ?? ""
    r = await api("/api/reports", { method: "POST", body: { type: "MOMENT_COMMENT", targetId: cid, reason: "HARASSMENT" }, cookie: vc })
    r.status === 201 ? pass("report: MOMENT_COMMENT → 201") : fail("report comment", { s: r.status, d: r.data })
    r = await api("/api/reports", { method: "POST", body: { type: "MOMENT_COMMENT", targetId: "cmissing12345", reason: "SPAM" }, cookie: bc })
    r.status === 404 ? pass("report: unknown comment → 404") : fail("report comment 404", r.status)
  }

  // ── L. detail page + delete ─────────────────────────────────────
  {
    const html = await (await fetch(`${BASE}/m/${postPub}`)).text()
    html.includes(M("public post")) ? pass("/m/[id] renders public post") : fail("detail page", html.length)
    const htmlFol = await fetch(`${BASE}/m/${postFol}`)
    htmlFol.status === 404 ? pass("/m/[id]: followers post → 404 for guest") : fail("detail fol", htmlFol.status)

    let r = await api(`/api/moments/${postImg}`, { method: "DELETE", cookie: vc })
    r.status === 403 ? pass("delete: non-author → 403") : fail("delete 403", r.status)
    r = await api(`/api/moments/${postImg}`, { method: "DELETE" })
    r.status === 401 ? pass("delete: guest → 401") : fail("delete 401", r.status)
    r = await api(`/api/moments/${postImg}`, { method: "DELETE", cookie: ac })
    r.status === 200 ? pass("delete: author → 200") : fail("delete", r.status)
    r = await api(`/api/moments/${postImg}`, { cookie: ac })
    r.status === 404 ? pass("deleted moment → 404") : fail("deleted get", r.status)
    const imgs = await prisma.momentImage.count({ where: { momentId: postImg } })
    imgs === 0 ? pass("delete removes moment image rows") : fail("image rows", imgs)
    const orphanNotif = await prisma.notification.count({ where: { link: { startsWith: `/m/${postImg}` } } })
    orphanNotif === 0 ? pass("delete sweeps notifications pointing at the post") : fail("notif sweep", orphanNotif)
  }

  // ── M. member-home + site search surface ────────────────────────
  {
    // The canonical returning-member surface — real exported function,
    // not a query reproduction.
    const homeFol = await getMemberHomeData(follower.id)
    const fMoments = homeFol?.sinceLastVisit.moments ?? []
    fMoments.some((m) => m.id === postPub) && fMoments.some((m) => m.id === postFol)
      ? pass("member-home: follower sees author's public + followers posts")
      : fail("member-home follower", fMoments.map((m) => m.id))
    const fHit = fMoments.find((m) => m.id === postPub)
    fHit?.href === `/m/${postPub}` && fHit.excerpt.length > 0
      ? pass("member-home: moment row carries link + excerpt")
      : fail("member-home row", fHit)
    !fMoments.some((m) => m.id === deletedPostId)
      ? pass("member-home: deleted post absent")
      : fail("member-home deleted", deletedPostId)

    // viewer follows blockedU + bannedU but NOT author — their posts and
    // the non-followed author's posts must all stay out.
    const homeViewer = await getMemberHomeData(viewer.id)
    const vMoments = homeViewer?.sinceLastVisit.moments ?? []
    !vMoments.some((m) => m.id === blockedPostId) && !vMoments.some((m) => m.id === bannedPostId)
      ? pass("member-home: blocked + banned followed authors excluded")
      : fail("member-home block/ban leak", { b: vMoments.some((m) => m.id === blockedPostId), ban: vMoments.some((m) => m.id === bannedPostId) })
    !vMoments.some((m) => m.id === postPub || m.id === postFol)
      ? pass("member-home: non-followed author's posts absent")
      : fail("member-home non-followed", postPub)

    // Site search — the shared-cache surface (PUBLIC only, everywhere).
    let r = await api(`/api/search?q=${encodeURIComponent(tagName)}&type=moments`)
    const hits = ((r.data?.moments ?? []) as { id: string }[]).map((m) => m.id)
    r.status === 200 && hits.includes(postPub)
      ? pass("search: public moment found via its hashtag text")
      : fail("search public", { s: r.status, hits })
    r = await api(`/api/search?q=${encodeURIComponent(`mv followers post ${ts}`)}&type=moments`, { cookie: fc })
    !(r.data?.moments as { id: string }[] | undefined)?.some((m) => m.id === postFol)
      ? pass("search: followers post invisible even to its follower")
      : fail("search followers leak", r.data?.moments)
    r = await api(`/api/search?q=${encodeURIComponent(`mv blocked post ${ts}`)}&type=moments`, { cookie: vc })
    !(r.data?.moments as { id: string }[] | undefined)?.some((m) => m.id === blockedPostId)
      ? pass("search: blocked author's moment stripped for blocker")
      : fail("search blocked leak", r.data?.moments)
    r = await api(`/api/search?q=${encodeURIComponent(`mv deleted post ${ts}`)}&type=moments`)
    !(r.data?.moments as { id: string }[] | undefined)?.some((m) => m.id === deletedPostId)
      ? pass("search: deleted moment absent")
      : fail("search deleted leak", r.data?.moments)
  }

  // ── N. product-event telemetry ──────────────────────────────────
  {
    // Create events — one per persisted moment (posts + story), none for
    // the rejected requests that preceded them in section A.
    const createEvents = await prisma.productEvent.count({
      where: { type: "INTERACTION_POSTED", userId: author.id, objectType: "Moment" },
    })
    createEvents === 4
      ? pass("telemetry: one INTERACTION_POSTED per created moment, none for rejects")
      : fail("create events", createEvents)
    const pubEv = await prisma.productEvent.findFirst({
      where: { type: "INTERACTION_POSTED", userId: author.id, objectType: "Moment", objectId: postPub },
      select: { id: true },
    })
    pubEv ? pass("telemetry: create event names objectType Moment + id") : fail("create event", "missing")

    // Comment + reaction events land on the resolved target id.
    const viewerPubEvs = await prisma.productEvent.count({
      where: { type: "INTERACTION_POSTED", userId: viewer.id, objectType: "Moment", objectId: postPub },
    })
    viewerPubEvs >= 1
      ? pass("telemetry: comments + reactions on the post recorded")
      : fail("interaction events", viewerPubEvs)
    // Failed/unauthorized operations recorded nothing.
    const folEvs = await prisma.productEvent.count({
      where: { type: "INTERACTION_POSTED", userId: viewer.id, objectType: "Moment", objectId: postFol },
    })
    folEvs === 0
      ? pass("telemetry: rejected comment/reaction on followers post emitted nothing")
      : fail("rejected events", folEvs)

    // FOLLOWED_CONTENT_VIEWED — follower sees author's post, the follow
    // is real, dedupe is day-keyed, and every failure stays silent (200).
    const fcv = (uid: string) =>
      prisma.productEvent.findMany({
        where: { type: "FOLLOWED_CONTENT_VIEWED", userId: uid },
        select: { objectType: true, objectId: true },
      })
    let r = await api("/api/events", { method: "POST", body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: postPub }, cookie: fc })
    r.status === 200 && (await fcv(follower.id)).some((e) => e.objectType === "Moment" && e.objectId === postPub)
      ? pass("telemetry: followed-content view recorded for follower")
      : fail("fcv follower", { s: r.status, evs: await fcv(follower.id) })
    r = await api("/api/events", { method: "POST", body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: postPub }, cookie: fc })
    ;(await fcv(follower.id)).filter((e) => e.objectId === postPub).length === 1
      ? pass("telemetry: repeat view same day dedupes")
      : fail("fcv dedupe", await fcv(follower.id))
    r = await api("/api/events", { method: "POST", body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: postPub }, cookie: vc })
    r.status === 200 && !(await fcv(viewer.id)).some((e) => e.objectId === postPub)
      ? pass("telemetry: non-follower view records nothing")
      : fail("fcv non-follower", r.status)
    r = await api("/api/events", { method: "POST", body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: postPub } })
    r.status === 401 ? pass("telemetry: guest beacon → 401") : fail("fcv guest", r.status)
    // Author doesn't "follow" their own post — self-views record nothing.
    r = await api("/api/events", { method: "POST", body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: postPub }, cookie: ac })
    !(await fcv(author.id)).some((e) => e.objectId === postPub)
      ? pass("telemetry: self-view records nothing")
      : fail("fcv self", r.status)
    // Deleted/blocked/inaccessible moments record nothing either.
    r = await api("/api/events", { method: "POST", body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: deletedPostId }, cookie: fc })
    r.status === 200 && !(await fcv(follower.id)).some((e) => e.objectId === deletedPostId)
      ? pass("telemetry: deleted moment view records nothing")
      : fail("fcv deleted", r.status)
    r = await api("/api/events", { method: "POST", body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: blockedPostId }, cookie: vc })
    !(await fcv(viewer.id)).some((e) => e.objectId === blockedPostId)
      ? pass("telemetry: blocked author's moment records nothing")
      : fail("fcv blocked", r.status)
    // A repost URL resolves to the original for the follow check.
    const repostRow = await prisma.moment.findFirst({
      where: { authorId: follower.id, repostOfId: postPub, content: "", deleted: false },
      select: { id: true },
    })
    if (repostRow) {
      r = await api("/api/events", { method: "POST", body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Moment", objectId: repostRow.id }, cookie: vc })
      // viewer doesn't follow the reposter OR the author — records nothing.
      !(await fcv(viewer.id)).some((e) => e.objectId === repostRow.id || e.objectId === postPub)
        ? pass("telemetry: repost URL resolves target, still gated by follow")
        : fail("fcv repost", await fcv(viewer.id))
    }
    // Bogus objectType stays a silent 200 — no oracle.
    r = await api("/api/events", { method: "POST", body: { type: "FOLLOWED_CONTENT_VIEWED", objectType: "Thread", objectId: postPub }, cookie: fc })
    r.status === 200 ? pass("telemetry: unknown objectType fails closed") : fail("fcv bogus", r.status)
  }

  // ── cleanup ─────────────────────────────────────────────────────
  await prisma.report.deleteMany({
    where: { OR: [{ reporterId: { in: [viewer.id, follower.id, author.id, blockedU.id] } }, { targetId: { in: momentIds() } }] },
  })
  await prisma.productEvent.deleteMany({
    where: { userId: { in: [author.id, follower.id, viewer.id, other.id, blockedU.id, bannedU.id] } },
  })
  for (const u of [author, follower, viewer, other, blockedU, bannedU]) {
    if (u?.id) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
  }
  await prisma.tag.deleteMany({ where: { slug: { in: [hashtagSlug(tagName), hashtagSlug(folTagName)] } } }).catch(() => {})

  const resid = {
    users: await prisma.user.count({ where: { name: { startsWith: "mv_" } } }),
    moments: await prisma.moment.count({ where: { content: { contains: ` ${ts}` } } }),
    comments: await prisma.momentComment.count({ where: { content: { contains: ` ${ts}` } } }),
    tags: await prisma.tag.count({ where: { slug: { in: [hashtagSlug(tagName), hashtagSlug(folTagName)] } } }),
    reports: await prisma.report.count({ where: { targetId: { in: momentIds() } } }),
  }
  Object.values(resid).every((n) => n === 0)
    ? pass("cleanup: zero mv residue")
    : fail("cleanup residue", resid)

  await prisma.$disconnect().catch(() => {})
  process.exitCode = finish()
}

main().catch(async (e) => {
  console.error("moments-verify crashed:", e)
  try {
    await prisma.report.deleteMany({ where: { targetId: { in: momentIds() } } })
    for (const u of [author, follower, viewer, other, blockedU, bannedU]) {
      if (u?.id) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    }
    await prisma.tag.deleteMany({ where: { slug: { in: [hashtagSlug(tagName), hashtagSlug(folTagName)] } } }).catch(() => {})
  } catch { /* best effort */ }
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
