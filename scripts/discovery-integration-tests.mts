import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { prisma } from "@/lib/prisma"
import { activeAuthor, blockExistsBetween } from "@/lib/security"
import { notify, notifyMany } from "@/lib/notify"
import { escapeLike, strainTypeLabel } from "@/lib/strain-stats"

// Discovery & Community Experience P0 integration tests.
// Two layers:
//   1. Live-DB behavior — activeAuthor filtering, escapeLike, the new
//      FOLLOWED_CONTENT / harvest / DM-unread notification plumbing.
//   2. Source assertions — cross-links, nav/chat wiring, pagination, and
//      mobile touch fixes that live in React server/client components and
//      can't be exercised without a browser.

const STAMP = Date.now().toString(36)

const src = (p: string) =>
  readFileSync(fileURLToPath(new URL(`../src/${p}`, import.meta.url)), "utf8")

function assertSource(file: string, needles: string[], label: string) {
  const content = src(file)
  for (const needle of needles) {
    assert.ok(
      content.includes(needle),
      `${label}: expected ${file} to contain ${JSON.stringify(needle)}`
    )
  }
}

async function mkUser(username: string, extra: { banned?: boolean; suspendedUntil?: Date | null } = {}) {
  return prisma.user.create({
    data: {
      name: username,
      banned: extra.banned ?? false,
      suspendedUntil: extra.suspendedUntil ?? null,
      ageVerified: true,
      sessionVersion: 1,
      profile: { create: { username } },
    },
  })
}

const notifCount = (userId: string) =>
  prisma.notification.count({ where: { userId } })

async function run() {
  console.log("Starting Discovery P0 integration tests...")

  const ids: string[] = []
  const diaryIds: string[] = []
  const strainIds: string[] = []

  try {
    // ─────────────────────────────────────────────────────────────
    // P0-B — live DB: activeAuthor() filtering
    // ─────────────────────────────────────────────────────────────
    const active = await mkUser(`__t_da_${STAMP}`)
    const banned = await mkUser(`__t_db_${STAMP}`, { banned: true })
    const suspended = await mkUser(`__t_ds_${STAMP}`, {
      suspendedUntil: new Date(Date.now() + 60 * 60 * 1000),
    })
    const follower = await mkUser(`__t_df_${STAMP}`)
    ids.push(active.id, banned.id, suspended.id, follower.id)

    const [dActive, dBanned, dSuspended] = await Promise.all([
      prisma.growDiary.create({
        data: { authorId: active.id, title: "active diary", strain: "Test", growType: "INDOOR", description: "", startDate: new Date() },
      }),
      prisma.growDiary.create({
        data: { authorId: banned.id, title: "banned diary", strain: "Test", growType: "INDOOR", description: "", startDate: new Date() },
      }),
      prisma.growDiary.create({
        data: { authorId: suspended.id, title: "suspended diary", strain: "Test", growType: "INDOOR", description: "", startDate: new Date() },
      }),
    ])
    diaryIds.push(dActive.id, dBanned.id, dSuspended.id)

    const visible = await prisma.growDiary.findMany({
      where: { deleted: false, author: activeAuthor(), id: { in: diaryIds } },
      select: { id: true },
    })
    assert.deepEqual(visible.map((d) => d.id), [dActive.id], "banned/suspended diaries must be excluded")

    const activeUserIds = await prisma.user.findMany({
      where: { id: { in: ids }, ...activeAuthor() },
      select: { id: true },
    })
    assert.deepEqual(
      activeUserIds.map((u) => u.id).sort(),
      [active.id, follower.id].sort(),
      "banned and suspended users must fail activeAuthor()"
    )

    // ─────────────────────────────────────────────────────────────
    // P0-B — escapeLike wildcard safety
    // ─────────────────────────────────────────────────────────────
    assert.equal(escapeLike("100%"), "100\\%", "% must be escaped")
    assert.equal(escapeLike("a_b"), "a\\_b", "_ must be escaped")
    assert.equal(escapeLike("back\\slash"), "back\\\\slash", "\\ must be escaped")
    assert.equal(escapeLike("plain"), "plain", "plain input unchanged")

    // Strain-type humanization (AUTO_FLOWER etc.)
    assert.equal(strainTypeLabel("AUTO_FLOWER"), "Auto Flower")
    assert.equal(strainTypeLabel("SATIVA"), "Sativa")
    assert.equal(strainTypeLabel("SOMETHING_ELSE"), "SOMETHING_ELSE", "unknown types pass through")
    assert.equal(strainTypeLabel(""), "", "empty type stays empty")

    // ─────────────────────────────────────────────────────────────
    // P0-B — block helper (used by the new forum-reply guard)
    // ─────────────────────────────────────────────────────────────
    assert.equal(await blockExistsBetween(active.id, follower.id), false)
    await prisma.block.create({ data: { blockerId: follower.id, blockedId: active.id } })
    assert.equal(await blockExistsBetween(active.id, follower.id), true, "block must be detected")
    assert.equal(await blockExistsBetween(follower.id, active.id), true, "block must work in both directions")
    await prisma.block.deleteMany({ where: { blockerId: follower.id, blockedId: active.id } })

    // ─────────────────────────────────────────────────────────────
    // P0-D — FOLLOWED_CONTENT notifications
    // ─────────────────────────────────────────────────────────────
    const n1 = await notify({
      userId: follower.id,
      type: "FOLLOWED_CONTENT",
      title: "New diary from someone you follow",
      content: "t",
      link: `/diaries/${dActive.id}`,
      actorId: active.id,
      groupKey: `followed-content:diary:${dActive.id}`,
      dedupeMs: 24 * 60 * 60 * 1000,
    })
    assert.ok(n1, "FOLLOWED_CONTENT should be created")
    assert.equal(n1!.link, `/diaries/${dActive.id}`, "root-relative link should persist")

    // Dedupe on the same groupKey
    const n2 = await notify({
      userId: follower.id,
      type: "FOLLOWED_CONTENT",
      title: "t", content: "t",
      link: `/diaries/${dActive.id}`,
      actorId: active.id,
      groupKey: `followed-content:diary:${dActive.id}`,
      dedupeMs: 24 * 60 * 60 * 1000,
    })
    assert.equal(n2, null, "same groupKey within window must dedupe")

    // Self-notification guard
    const selfN = await notify({
      userId: active.id, type: "FOLLOWED_CONTENT", title: "t", content: "t",
      link: `/diaries/${dActive.id}`, actorId: active.id,
    })
    assert.equal(selfN, null, "author must never be notified about own content")

    // Preference gate — FOLLOWED_CONTENT maps to notifyOnCategoryFollow
    await prisma.profile.update({ where: { userId: follower.id }, data: { notifyOnCategoryFollow: false } })
    const prefN = await notify({
      userId: follower.id, type: "FOLLOWED_CONTENT", title: "t", content: "t",
      link: `/diaries/${dActive.id}`, actorId: active.id,
      groupKey: "followed-content:pref", dedupeMs: 60_000,
    })
    assert.equal(prefN, null, "opted-out follower must not be notified")
    await prisma.profile.update({ where: { userId: follower.id }, data: { notifyOnCategoryFollow: true } })

    // Block suppression through notifyMany (the fan-out path both routes use)
    await prisma.block.create({ data: { blockerId: follower.id, blockedId: active.id } })
    const beforeBlock = await notifCount(follower.id)
    await notifyMany([{
      userId: follower.id, type: "FOLLOWED_CONTENT", title: "t", content: "t",
      link: `/diaries/${dActive.id}`, actorId: active.id,
      groupKey: "followed-content:block", dedupeMs: 60_000,
    }])
    assert.equal(await notifCount(follower.id), beforeBlock, "blocked actor fan-out must be suppressed")
    await prisma.block.deleteMany({ where: { blockerId: follower.id, blockedId: active.id } })

    // Banned recipient skipped
    const bannedN = await notify({
      userId: banned.id, type: "FOLLOWED_CONTENT", title: "t", content: "t",
      link: "/forum", actorId: active.id,
    })
    assert.equal(bannedN, null, "banned recipient must not be notified")

    // ─────────────────────────────────────────────────────────────
    // P0-D — harvest fan-out payload shape + dedupe plumbing
    // (the route-level fan-out is source-asserted below; here we
    // exercise the exact notifyMany contract it depends on)
    // ─────────────────────────────────────────────────────────────
    await prisma.diaryFollow.create({ data: { diaryId: dActive.id, userId: follower.id } })
    const harvestBefore = await notifCount(follower.id)
    const harvestPayload = {
      userId: follower.id,
      type: "DIARY_UPDATE" as const,
      title: "Diary harvested",
      content: `@${"x"} harvested "active diary"`,
      link: `/diaries/${dActive.id}`,
      actorId: active.id,
      groupKey: `diary-harvest:${dActive.id}`,
      dedupeMs: 24 * 60 * 60 * 1000,
    }
    await notifyMany([harvestPayload])
    assert.equal(await notifCount(follower.id), harvestBefore + 1, "harvest fan-out should deliver")
    await notifyMany([harvestPayload])
    assert.equal(await notifCount(follower.id), harvestBefore + 1, "re-harvest must dedupe on groupKey")

    // ─────────────────────────────────────────────────────────────
    // P0-D — DM unread count semantics (same where as ?unread=1)
    // ─────────────────────────────────────────────────────────────
    await prisma.directMessage.createMany({
      data: [
        { senderId: active.id, receiverId: follower.id, content: "one", read: false },
        { senderId: active.id, receiverId: follower.id, content: "two", read: false },
        { senderId: active.id, receiverId: follower.id, content: "old", read: true },
        { senderId: active.id, receiverId: follower.id, content: "gone", read: false, deleted: true },
      ],
    })
    const unread = await prisma.directMessage.count({
      where: { receiverId: follower.id, read: false, deleted: false },
    })
    assert.equal(unread, 2, "unread count must exclude read and deleted messages")

    // ─────────────────────────────────────────────────────────────
    // P0-E — pagination semantics (query-level)
    // ─────────────────────────────────────────────────────────────
    const pageWhere = { deleted: false, author: activeAuthor(), id: { in: diaryIds } }
    const page1 = await prisma.growDiary.findMany({
      where: pageWhere,
      skip: 0,
      take: 24,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true },
    })
    const page2 = await prisma.growDiary.findMany({
      where: pageWhere,
      skip: 24,
      take: 24,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select: { id: true },
    })
    assert.deepEqual(page1.map((d) => d.id), [dActive.id], "page 1 shows only the active author's diary")
    assert.equal(page2.length, 0, "out-of-range page returns empty safely")

    // Page-param clamp (mirrors the three index pages)
    const clamp = (raw: string | undefined, max = 50) => {
      const n = Number.parseInt(raw ?? "1", 10)
      return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : 1
    }
    assert.equal(clamp(undefined), 1)
    assert.equal(clamp("2"), 2)
    assert.equal(clamp("-5"), 1, "negative page clamps to 1")
    assert.equal(clamp("abc"), 1, "non-numeric page clamps to 1")
    assert.equal(clamp("99999"), 50, "absurd page clamps to MAX_PAGE")
    assert.equal(clamp("0"), 1)

    // ─────────────────────────────────────────────────────────────
    // Source assertions — P0-A cross-linking
    // ─────────────────────────────────────────────────────────────
    assertSource("app/diaries/[id]/page.tsx", [
      "/u/${", "More from this grower", "Similar grows", "flex-wrap",
    ], "diary detail cross-links + wrapping")
    assertSource("app/guides/[slug]/page.tsx", [
      "/u/${", "relatedGuides", "relatedThreads", "TOPIC_TO_CATEGORY_SLUGS",
    ], "guide author link + related content")
    assertSource("app/strains/[id]/page.tsx", [
      "/diaries/new?strain=", "creatorActive", "activeAuthor()", "escapeLike",
    ], "strain creator gate + grow CTA + escaping")
    assertSource("app/diaries/new/page.tsx", [
      "searchParams", "strain", "NewDiaryClient",
    ], "diary-new strain prefill server resolution")
    assertSource("app/diaries/new/new-diary-client.tsx", [
      "prefill", "strainId",
    ], "diary-new prefill client")
    assertSource("app/messages/page.tsx", ["/u/${"], "messages profile links")
    assertSource("app/api/users/[username]/route.ts", ["growSetups"], "profile setups API")
    assertSource("app/discover/page.tsx", [
      "activeAuthor()", "Sign in to see your following feed",
    ], "discover filters + honest guest state")

    // ─────────────────────────────────────────────────────────────
    // Source assertions — P0-B privacy/status/block
    // ─────────────────────────────────────────────────────────────
    assertSource("app/(home)/page.tsx", ["author: activeAuthor()", "activeAuthor()"], "homepage filters")
    assertSource("app/forum/category/[slug]/page.tsx", ["activeAuthor()"], "category page filter")
    assertSource("app/forum/tags/[slug]/page.tsx", ["activeAuthor()"], "tag page filter")
    assertSource("app/forum/thread/[slug]/page.tsx", ["activeAuthor()"], "thread page filter")
    assertSource("app/api/forum/threads/similar/route.ts", ["activeAuthor()"], "similar threads")
    assertSource("app/api/search/suggest/route.ts", ["activeAuthor()"], "search suggest")
    assertSource("app/api/forum/posts/route.ts", ["blockExistsBetween"], "forum reply block guard")
    assertSource("app/api/strains/route.ts", ["escapeLike"], "strain API escaping")
    assertSource("app/setups/[id]/page.tsx", ["activeAuthor()", "comment-"], "setup comments filter + anchors")
    assertSource("app/youtubers/page.tsx", ["activeAuthor()"], "youtubers filter")
    assertSource("app/api/stats/route.ts", ["activeAuthor()"], "public stats filter")

    // ─────────────────────────────────────────────────────────────
    // Source assertions — P0-C chat discoverability
    // ─────────────────────────────────────────────────────────────
    assertSource("components/navigation.tsx", [
      'href: "/chat"',
      "/api/messages?unread=1",
      'href="/search"',
      'href="/messages"',
    ], "nav chat routing + DM badge + mobile search/messages")
    // The chat activity badge poll lives in the panel provider (single
    // owner) — the nav consumes chatOnline/chatUnread via context.
    assertSource("components/chat-panel.tsx", [
      "/api/chat/rooms?badge=1",
      "chatUnread",
    ], "chat badge poll owned by panel provider")
    // Footer chat lives in a session-aware client component: members open
    // the persistent panel in place; guests keep the real /chat link.
    assertSource("components/footer.tsx", ["FooterChatLink"], "footer delegates chat link")
    assertSource("components/footer-chat-link.tsx", ['href="/chat"', "openPanel"], "footer chat link + panel open")
    assertSource("components/user-menu.tsx", ['href: "/chat"'], "user menu chat link")
    assertSource("components/onboarding-stepper.tsx", ['href="/chat"', "live chat"], "onboarding chat mention")
    assertSource("app/(home)/page.tsx", ['href: "/chat"'], "homepage chat explore card")
    assertSource("app/api/chat/messages/route.ts", ["/chat?room="], "chat mention deep link")
    assertSource("app/chat/chat-client.tsx", ['signInHref("/chat")'], "chat guest sign-in targets /chat")

    // ─────────────────────────────────────────────────────────────
    // Source assertions — P0-D notifications
    // ─────────────────────────────────────────────────────────────
    assertSource("app/api/diaries/[id]/harvest/route.ts", [
      "diaryFollow", "DIARY_UPDATE", "diary-harvest:",
    ], "harvest follower fan-out")
    assertSource("app/api/diaries/route.ts", ["FOLLOWED_CONTENT", "followed-content:diary:"], "new diary fan-out")
    assertSource("app/api/forum/threads/route.ts", ["FOLLOWED_CONTENT", "followed-content:thread:"], "new thread fan-out")
    assertSource("app/api/moderation/actions/route.ts", ['link: "/rules"'], "moderation notification link")
    assertSource("app/api/setups/comments/route.ts", ["#comment-"], "setup comment deep link")
    assertSource("app/api/diaries/updates/route.ts", ["#week-"], "diary update deep link")
    assertSource("app/api/messages/route.ts", ["unread"], "DM unread endpoint")
    assertSource("lib/notify.ts", ["FOLLOWED_CONTENT"], "notification type registered")
    assertSource("app/notifications/page.tsx", ["FOLLOWED_CONTENT"], "notification icon mapping")

    // ─────────────────────────────────────────────────────────────
    // Source assertions — P0-E pagination
    // ─────────────────────────────────────────────────────────────
    for (const p of ["app/diaries/(index)/page.tsx", "app/setups/page.tsx", "app/strains/(index)/page.tsx"]) {
      assertSource(p, ["PAGE_SIZE", "MAX_PAGE", "skip:", "Number.parseInt", "pageHref"], `pagination in ${p}`)
    }
    assertSource("app/strains/(index)/page.tsx", ["escapeLike", "strainTypeLabel", "No strains match"], "strain search + labels")
    assertSource("lib/strain-stats.ts", ["strainTypeLabel"], "strain label helper")

    // ─────────────────────────────────────────────────────────────
    // Source assertions — P0-F mobile
    // ─────────────────────────────────────────────────────────────
    assertSource("app/strains/[id]/page.tsx", [
      "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
    ], "touch-safe strain photo overlays")
    assertSource("app/setups/[id]/page.tsx", ["ImageGallery", "flex-wrap"], "setup gallery + wrap")
    assertSource("components/image-gallery.tsx", ["openIndex"], "shared gallery exists")
    assertSource("components/mobile-nav.tsx", ['href: "/chat"'], "mobile bottom-nav chat")

    // ─────────────────────────────────────────────────────────────
    // Live DB — sitemap generation end to end. Runs the real
    // src/app/sitemap.ts default export against fixtures so a gated
    // route or an ineligible record can never re-enter the sitemap
    // silently.
    // ─────────────────────────────────────────────────────────────
    const { default: buildSitemap } = await import("@/app/sitemap")
    const urls = (await buildSitemap()).map((e) => e.url)
    const pathOf = (u: string) => new URL(u).pathname

    // Gated/personalized routes are never sitemap destinations.
    const gatedPaths = urls.map(pathOf)
    for (const gated of ["/feed", "/profile", "/settings", "/messages", "/notifications", "/admin", "/moderation"]) {
      assert.ok(!gatedPaths.includes(gated), `sitemap must not include gated route ${gated}`)
    }

    // Real public content is present.
    assert.ok(urls.some((u) => pathOf(u) === "/forum"), "sitemap includes /forum")
    assert.ok(urls.some((u) => /\/forum\/thread\/.+/.test(pathOf(u))), "sitemap includes thread URLs")
    assert.ok(urls.some((u) => /\/guides\/.+/.test(pathOf(u))), "sitemap includes guide URLs")

    // Hidden categories stay out: create one, verify, clean up.
    const hiddenSlug = `__hidden-cat-${Date.now().toString(36)}`
    const hiddenCat = await prisma.category.create({
      data: { name: "Hidden Fixture", slug: hiddenSlug, description: "fixture", hidden: true },
      select: { id: true },
    })
    const bannedName = `__sitemap-banned-${Date.now().toString(36)}`
    const bannedAuthor = await mkUser(bannedName, { banned: true })
    ids.push(bannedAuthor.id)
    const visibleCat = await prisma.category.findFirst({ where: { hidden: false }, select: { id: true, slug: true } })
    const deletedThread = await prisma.thread.create({
      data: { title: "Deleted sitemap fixture", slug: `__deleted-${Date.now().toString(36)}`, content: "x", authorId: bannedAuthor.id, categoryId: visibleCat!.id, deleted: true },
      select: { id: true, slug: true },
    })
    try {
      const urls2 = (await buildSitemap()).map((e) => new URL(e.url).pathname)
      assert.ok(!urls2.includes(`/forum/category/${hiddenSlug}`), "sitemap excludes hidden categories")
      assert.ok(!urls2.includes(`/forum/thread/${deletedThread.slug}`), "sitemap excludes deleted threads")
      assert.ok(!urls2.includes(`/u/${bannedName}`), "sitemap excludes banned-author profiles")
      assert.ok(!urls2.includes("/u/terpbot"), "sitemap excludes TerpBot profile")
      if (visibleCat) assert.ok(urls2.includes(`/forum/category/${visibleCat.slug}`), "sitemap includes a visible category")
    } finally {
      await prisma.thread.delete({ where: { id: deletedThread.id } }).catch(() => {})
      await prisma.category.delete({ where: { id: hiddenCat.id } }).catch(() => {})
    }

    console.log("All Discovery P0 integration tests passed.")
  } finally {
    for (const id of diaryIds) {
      await prisma.growDiary.delete({ where: { id } }).catch(() => {})
    }
    for (const id of strainIds) {
      await prisma.strain.delete({ where: { id } }).catch(() => {})
    }
    for (const id of ids) {
      await prisma.user.delete({ where: { id } }).catch(() => {})
    }
    await prisma.$disconnect().catch(() => {})
  }
}

run().catch((err) => {
  console.error("Discovery P0 integration tests failed:", err)
  process.exit(1)
})
