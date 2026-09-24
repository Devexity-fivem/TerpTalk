import "./db-guard.mjs"
import { strict as assert } from "node:assert"

import { prisma } from "@/lib/prisma"
import { activeAuthor, blockExistsBetween, rankableProfile } from "@/lib/security"

import { escapeLike, strainTypeLabel } from "@/lib/strain-stats"
import {
  parseStrainEffects,
  parseStrainFlavors,
  parseStrainDifficulty,
  parseThc,
  parseFloweringWeeks,
} from "@/lib/strain-fields"
import { strainWhere, type StrainFilters } from "@/lib/strain-filters"
import { normalizeBreederName, breederPath, breederKeyFromSlug } from "@/lib/breeders"
import { latestFeedingNote } from "@/lib/diary-weeks"

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

      // New public destinations from the grower-first sprint.
      assert.ok(urls3.includes("/questions"), "sitemap includes /questions")
      assert.ok(urls3.includes("/growers"), "sitemap includes /growers")

      // Breeder grouping pages get sitemap entries from the real
      // free-text breeder field — no Breeder model involved.
      const sBreeder = await prisma.strain.create({
        data: { name: `__smap-breed-${Date.now().toString(36)}`, breeder: "Sitemap Breeder Co" },
        select: { id: true },
      })
      strainIds.push(sBreeder.id)
      const urlsB = (await buildSitemap()).map((e) => new URL(e.url).pathname)
      assert.ok(
        urlsB.includes("/strains/breeder/sitemap-breeder-co"),
        "sitemap includes the breeder grouping page"
      )
    } finally {
      await prisma.thread.delete({ where: { id: deletedThread.id } }).catch(() => {})
      await prisma.category.delete({ where: { id: hiddenCat.id } }).catch(() => {})
    }

    // ─────────────────────────────────────────────────────────────
    // Strain catalog facets — real parse functions (API validation path)
    // ─────────────────────────────────────────────────────────────
    assert.deepEqual(
      parseStrainEffects(["RELAXED", "HAPPY", "BOGUS", "RELAXED"]),
      ["RELAXED", "HAPPY"],
      "effects: vocab kept, unknown dropped, deduped"
    )
    assert.equal(parseStrainEffects("RELAXED"), null, "non-array effects means 'not sent'")
    assert.deepEqual(parseStrainEffects([]), [], "empty array is a valid explicit clear")
    assert.deepEqual(parseStrainFlavors(["EARTHY", "NOPE"]), ["EARTHY"], "flavors: vocab kept")
    assert.equal(parseStrainFlavors(null), null)
    assert.equal(parseStrainDifficulty("EASY"), "EASY")
    assert.equal(parseStrainDifficulty("MEDIUM"), null, "difficulty rejects non-vocab")
    assert.equal(parseThc(21.5), 21.5)
    assert.equal(parseThc("19"), 19, "numeric strings parse")
    assert.equal(parseThc(50), null, "THC above bound rejected")
    assert.equal(parseThc(-1), null, "negative THC rejected")
    assert.equal(parseThc("high"), null, "non-numeric THC rejected")
    assert.equal(parseFloweringWeeks(8), 8)
    assert.equal(parseFloweringWeeks(3), null, "flowering below bound rejected")
    assert.equal(parseFloweringWeeks(21), null, "flowering above bound rejected")

    // ─────────────────────────────────────────────────────────────
    // strainWhere — the real /strains filter builder against real rows
    // ─────────────────────────────────────────────────────────────
    const sTag = `__sf_${STAMP}`
    const sIndica = await prisma.strain.create({
      data: {
        name: `${sTag}_indica`,
        type: "INDICA",
        breeder: "Test Breeder",
        genetics: "A x B",
        effects: ["RELAXED", "SLEEPY"],
        flavors: ["EARTHY"],
        thcMin: 18,
        thcMax: 24,
        floweringWeeks: 9,
        difficulty: "EASY",
      },
      select: { id: true },
    })
    const sSativa = await prisma.strain.create({
      data: {
        name: `${sTag}_sativa`,
        type: "SATIVA",
        breeder: "Other Co",
        effects: ["ENERGETIC"],
        thcMin: 12,
        thcMax: 14,
        floweringWeeks: 12,
        difficulty: "HARD",
      },
      select: { id: true },
    })
    const sBare = await prisma.strain.create({ data: { name: `${sTag}_bare` }, select: { id: true } })
    strainIds.push(sIndica.id, sSativa.id, sBare.id)

    const base: StrainFilters = { q: "", type: "", effect: "", flavor: "", difficulty: null, thc: "", flower: "", breeder: "", page: 1 }
    const idsOf = async (f: StrainFilters) =>
      (await prisma.strain.findMany({
        where: { AND: [strainWhere(f), { name: { contains: sTag } }] },
        select: { id: true },
      })).map((s) => s.id).sort()
    const all3 = [sIndica.id, sSativa.id, sBare.id].sort()

    assert.deepEqual(await idsOf(base), all3, "no filters → every strain")
    assert.deepEqual(await idsOf({ ...base, type: "INDICA" }), [sIndica.id], "type filter")
    assert.deepEqual(await idsOf({ ...base, effect: "RELAXED" }), [sIndica.id], "effect has-filter")
    assert.deepEqual(await idsOf({ ...base, effect: "ENERGETIC" }), [sSativa.id])
    assert.deepEqual(await idsOf({ ...base, effect: "NOT_AN_EFFECT" }), all3, "unknown effect ignored, not fatal")
    assert.deepEqual(await idsOf({ ...base, flavor: "EARTHY" }), [sIndica.id], "flavor has-filter")
    assert.deepEqual(await idsOf({ ...base, difficulty: "EASY" }), [sIndica.id])
    assert.deepEqual(await idsOf({ ...base, difficulty: "HARD" }), [sSativa.id])

    // THC band overlap — [18,24] overlaps mid(15–20); [12,14] only in low.
    assert.deepEqual(await idsOf({ ...base, thc: "mid" }), [sIndica.id], "THC mid band overlaps 18–24")
    assert.deepEqual(await idsOf({ ...base, thc: "low" }), [sSativa.id], "THC low band catches 12–14")
    assert.deepEqual(await idsOf({ ...base, thc: "ultra" }), [], "no reported 25%+ strain → honest empty")
    // Strain with no THC data never matches a band (not a "zero").
    assert.deepEqual(await idsOf({ ...base, thc: "low", type: "SATIVA" }), [sSativa.id], "facets compose")

    // Flowering bands.
    assert.deepEqual(await idsOf({ ...base, flower: "fast" }), [], "no ≤8wk strain reported")
    assert.deepEqual(await idsOf({ ...base, flower: "mid" }), [sIndica.id], "9wk in mid band")
    assert.deepEqual(await idsOf({ ...base, flower: "long" }), [sSativa.id], "12wk in long band")

    // Breeder filter is case-insensitive; search spans name/genetics/breeder.
    assert.deepEqual(await idsOf({ ...base, breeder: "test breeder" }), [sIndica.id], "breeder filter insensitive")
    assert.deepEqual(await idsOf({ ...base, q: "test breeder" }), [sIndica.id], "q hits breeder text")
    assert.deepEqual(await idsOf({ ...base, q: "a x b" }), [sIndica.id], "q hits genetics")
    assert.deepEqual(await idsOf({ ...base, q: sTag }), all3, "q hits names")
    assert.deepEqual(await idsOf({ ...base, q: "100%" }), [], "wildcard chars in q can't broaden results")

    // ─────────────────────────────────────────────────────────────
    // Breeder grouping lib — normalization, canonical URL, slug resolve
    // ─────────────────────────────────────────────────────────────
    assert.equal(normalizeBreederName("Fast Buds!"), "fastbuds")
    assert.equal(normalizeBreederName("  FAST  BUDS "), "fastbuds", "case + space + punctuation insensitive")
    assert.equal(breederPath("Fast Buds"), "/strains/breeder/fast-buds")
    assert.equal(breederKeyFromSlug("fast-buds"), "fastbuds")
    assert.equal(breederKeyFromSlug("Fast%20Buds"), "fastbuds", "encoded slug resolves")
    // Round-trip: a strain's breeder text resolves to its own page slug.
    assert.equal(breederKeyFromSlug(breederPath("Test Breeder").split("/").pop()!), "testbreeder")

    // ─────────────────────────────────────────────────────────────
    // latestFeedingNote — newest non-empty note wins, by createdAt
    // ─────────────────────────────────────────────────────────────
    const fd1 = new Date("2026-01-01"), fd2 = new Date("2026-01-08"), fd3 = new Date("2026-01-15")
    assert.equal(latestFeedingNote([]), null)
    assert.equal(latestFeedingNote([{ createdAt: fd1, feeding: null }]), null, "empty notes ignored")
    assert.equal(
      latestFeedingNote([
        { createdAt: fd1, feeding: "first feed" },
        { createdAt: fd3, feeding: "   " },
        { createdAt: fd2, feeding: "  second feed  " },
      ]),
      "second feed",
      "skips blank latest, trims the newest real note"
    )

    // ─────────────────────────────────────────────────────────────
    // Growers directory privacy — the real rankableProfile() filter
    // ─────────────────────────────────────────────────────────────
    const optOut = await mkUser(`__t_do_${STAMP}`)
    ids.push(optOut.id)
    await prisma.profile.update({ where: { userId: optOut.id }, data: { publicMilestoneOptOut: true } })
    const rankable = await prisma.profile.findMany({
      where: { ...rankableProfile(), userId: { in: ids } },
      select: { userId: true },
    })
    assert.deepEqual(
      rankable.map((r) => r.userId).sort(),
      [active.id, follower.id].sort(),
      "directory excludes banned, suspended, and milestone opt-outs"
    )

    // Live-grow resolution — the directory's "growing now" card picks one
    // latest PUBLIC unharvested grow per member via distinct on authorId.
    const newerPublic = await prisma.growDiary.create({
      data: {
        authorId: active.id,
        title: "newer live grow",
        strain: "Test",
        growType: "INDOOR",
        description: "",
        startDate: new Date(),
        visibility: "PUBLIC",
        updatedAt: new Date(Date.now() + 60_000),
      },
      select: { id: true },
    })
    diaryIds.push(newerPublic.id)
    const unlisted = await prisma.growDiary.create({
      data: {
        authorId: active.id,
        title: "unlisted grow",
        strain: "Test",
        growType: "INDOOR",
        description: "",
        startDate: new Date(),
        visibility: "UNLISTED",
        updatedAt: new Date(Date.now() + 120_000),
      },
      select: { id: true },
    })
    diaryIds.push(unlisted.id)
    const liveGrows = await prisma.growDiary.findMany({
      where: { authorId: { in: ids }, deleted: false, harvested: false, author: activeAuthor(), visibility: "PUBLIC" },
      orderBy: { updatedAt: "desc" },
      distinct: ["authorId"],
      select: { authorId: true, id: true },
    })
    const activeLive = liveGrows.filter((g) => g.authorId === active.id)
    assert.equal(activeLive.length, 1, "exactly one live grow per member")
    assert.equal(activeLive[0].id, newerPublic.id, "most recently updated PUBLIC grow wins")
    assert.ok(!liveGrows.some((g) => g.id === unlisted.id), "unlisted diary never becomes a live-grow card")
    assert.ok(!liveGrows.some((g) => g.authorId === banned.id || g.authorId === suspended.id), "inactive authors excluded")

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
