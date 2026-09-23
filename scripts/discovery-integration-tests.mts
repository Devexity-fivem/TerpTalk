import "./db-guard.mjs"
import { strict as assert } from "node:assert"

import { prisma } from "@/lib/prisma"
import { activeAuthor, blockExistsBetween } from "@/lib/security"

import { escapeLike, strainTypeLabel } from "@/lib/strain-stats"

// Discovery filters + sitemap: live-DB behavior for activeAuthor()
// filtering, escapeLike wildcard safety, block detection, pagination
// clamps, and end-to-end buildSitemap() eligibility.

const STAMP = Date.now().toString(36)

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

async function run() {
  console.log("Starting Discovery filters + sitemap tests...")

  const ids: string[] = []
  const diaryIds: string[] = []
  const strainIds: string[] = []

  try {
    // ─────────────────────────────────────────────────────────────
    // Live DB: activeAuthor() filtering
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
    // escapeLike wildcard safety
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
    // blockExistsBetween helper (used by the forum-reply guard)
    // ─────────────────────────────────────────────────────────────
    assert.equal(await blockExistsBetween(active.id, follower.id), false)
    await prisma.block.create({ data: { blockerId: follower.id, blockedId: active.id } })
    assert.equal(await blockExistsBetween(active.id, follower.id), true, "block must be detected")
    assert.equal(await blockExistsBetween(follower.id, active.id), true, "block must work in both directions")
    await prisma.block.deleteMany({ where: { blockerId: follower.id, blockedId: active.id } })

    // ─────────────────────────────────────────────────────────────
    // Pagination semantics (query-level)
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

      // Diary visibility: only PUBLIC diaries are sitemap destinations.
      const visToken = `__smap-vis-${Date.now().toString(36)}`
      const visDiaries = await Promise.all(
        (["PUBLIC", "UNLISTED", "PRIVATE"] as const).map((visibility) =>
          prisma.growDiary.create({
            data: {
              title: `${visToken}-${visibility}`,
              description: "",
              growType: "INDOOR",
              startDate: new Date(),
              authorId: active.id,
              visibility,
            },
            select: { id: true },
          }),
        ),
      )
      diaryIds.push(...visDiaries.map((d) => d.id))
      const urls3 = (await buildSitemap()).map((e) => new URL(e.url).pathname)
      assert.ok(urls3.includes(`/diaries/${visDiaries[0].id}`), "sitemap includes PUBLIC diary")
      assert.ok(!urls3.includes(`/diaries/${visDiaries[1].id}`), "sitemap excludes UNLISTED diary")
      assert.ok(!urls3.includes(`/diaries/${visDiaries[2].id}`), "sitemap excludes PRIVATE diary")
    } finally {
      await prisma.thread.delete({ where: { id: deletedThread.id } }).catch(() => {})
      await prisma.category.delete({ where: { id: hiddenCat.id } }).catch(() => {})
    }

    console.log("All Discovery filters + sitemap tests passed.")
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
  console.error("Discovery filters + sitemap tests failed:", err)
  process.exit(1)
})
