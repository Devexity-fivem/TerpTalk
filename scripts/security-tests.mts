import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { isBanned, isSessionValid, isAdmin, isModerator, isStaff, isSupport, hashIp, getTrustLevel, LIMITS } from "@/lib/security"
import { isValidImageDataUri, storeImage } from "@/lib/blob"
import sharp from "sharp"
import { isTrustedForLinks, containsExternalLink, enforceLinkTrust } from "@/lib/security"
import { safeCallbackUrl, signInHref } from "@/lib/callback-url"
import { ADMIN_ONLY_MOD_ACTIONS } from "@/lib/require-staff"
import { recoveryPhraseUpdateData, newRecoveryPhrase, hashPhrase, verifyPhrase } from "@/lib/recovery"
import { notifyMany } from "@/lib/notify"
import { getSuggestedUsers } from "@/lib/onboarding"
import { escapeLike, normalizeStrain, strainFieldMatches } from "@/lib/strain-stats"
import { toGrams, toOz, VALID_YIELD_UNITS } from "@/lib/yield"
import { diaryDay, diaryWeek, groupUpdatesByWeek, buildHarvestReport, diaryCompleteness, STAGE_ORDER } from "@/lib/diary-weeks"
import { currentMonthKey, monthRange, previousMonthKey } from "@/lib/week"
import { postBotMessage, TERPBOT_USERNAME } from "@/lib/terpbot"
import { runBotCommand } from "@/lib/terpbot-data"
import { recordBotEvent, getBotStats } from "@/lib/terpbot-events"
import { BADGE_REGISTRY, BOT_BADGE_REGISTRY, isBotBadge } from "@/lib/badge-registry"
import { checkBadges, BADGE_RULES } from "@/lib/reputation"
import { notifyMentions } from "@/lib/mentions"

const TEST_USERNAME = `__test_security_${Date.now()}`
const TEST_NAME = `__test_security_name_${Date.now()}`

function tinyPngDataUri(): string {
  // 1x1 transparent PNG
  const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
  return `data:image/png;base64,${b64}`
}

async function run() {
  console.log("Starting security regression tests...")

  let userId = ""
  try {
    const user = await prisma.user.create({
      data: {
        name: TEST_NAME,
        ageVerified: true,
        sessionVersion: 1,
        profile: { create: { username: TEST_USERNAME } },
      },
      include: { profile: true },
    })
    userId = user.id
    const profileId = user.profile?.id

    // Session validity
    assert.equal(await isSessionValid(userId, 1), true, "valid session should pass")
    assert.equal(await isSessionValid(userId, 0), false, "stale sessionVersion should fail")
    assert.equal(await isSessionValid("nonexistent", 1), false, "unknown user should fail")

    // Banned user
    await prisma.user.update({ where: { id: userId }, data: { banned: true } })
    assert.equal(await isBanned(userId), true, "banned user should be banned")
    assert.equal(await isSessionValid(userId, 1), false, "banned session should fail")

    // Suspended user
    await prisma.user.update({ where: { id: userId }, data: { banned: false, suspendedUntil: new Date(Date.now() + 60_000) } })
    assert.equal(await isBanned(userId), true, "suspended user should be banned")
    assert.equal(await isSessionValid(userId, 1), false, "suspended session should fail")

    // Restored user
    await prisma.user.update({ where: { id: userId }, data: { suspendedUntil: null, sessionVersion: 2 } })
    assert.equal(await isBanned(userId), false, "restored user should not be banned")
    assert.equal(await isSessionValid(userId, 2), true, "restored user with matching version should pass")

    // Role helpers
    assert.equal(isAdmin("ADMINISTRATOR"), true)
    assert.equal(isAdmin("MODERATOR"), false)
    assert.equal(isModerator("MODERATOR"), true)
    assert.equal(isModerator("ADMINISTRATOR"), true)
    assert.equal(isStaff("SUPPORT"), true)
    assert.equal(isStaff("MEMBER"), false)
    assert.equal(isSupport("SUPPORT"), true)
    assert.equal(isSupport("MODERATOR"), false)

    // Trust levels
    assert.equal(getTrustLevel(new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), 150), "Member")
    assert.equal(getTrustLevel(new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), 150), "Established")
    assert.equal(getTrustLevel(new Date(Date.now() - 31 * 24 * 60 * 60 * 1000), 600), "Veteran")
    assert.equal(getTrustLevel(new Date(Date.now() - 91 * 24 * 60 * 60 * 1000), 1100), "Expert")

    // IP hashing
    const originalSalt = process.env.NEXTAUTH_SECRET
    process.env.NEXTAUTH_SECRET = "test-salt"
    const h1 = hashIp("127.0.0.1")
    const h2 = hashIp("127.0.0.1")
    const h3 = hashIp("127.0.0.2")
    assert.equal(h1, h2, "same IP with same salt should hash identically")
    assert.notEqual(h1, h3, "different IPs should hash differently")
    process.env.NEXTAUTH_SECRET = originalSalt

    // Image data URI validation
    assert.equal(isValidImageDataUri(tinyPngDataUri()), true, "valid PNG data URI should pass")
    assert.equal(isValidImageDataUri("data:text/html;base64,SGVsbG8="), false, "non-image data URI should fail")
    assert.equal(isValidImageDataUri("not a data uri"), false, "malformed data URI should fail")

    // Pixel-bomb guard: a format-valid image with extreme dimensions must be
    // rejected by the sharp input-pixel cap before it reaches Blob storage.
    const originalBlobToken = process.env.BLOB_READ_WRITE_TOKEN
    process.env.BLOB_READ_WRITE_TOKEN = "test-token-pixel-limit"
    try {
      const bigBuf = await sharp({
        create: { width: 4500, height: 4500, channels: 3, background: { r: 200, g: 0, b: 0 } },
      })
        .png()
        .toBuffer()
      const bigUri = `data:image/png;base64,${bigBuf.toString("base64")}`
      assert.equal(isValidImageDataUri(bigUri), true, "oversized-pixel PNG should pass format checks")
      await assert.rejects(
        () => storeImage(bigUri, "test"),
        /Image could not be sanitized/,
        "storeImage should reject images exceeding the input pixel limit"
      )
    } finally {
      if (originalBlobToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN
      else process.env.BLOB_READ_WRITE_TOKEN = originalBlobToken
    }

    // External link detection
    assert.equal(containsExternalLink("visit example.com"), true, "should detect domain link")
    assert.equal(containsExternalLink("plain text no links"), false, "plain text should not be flagged")

    // Trusted for links requires 24h age + Sprout reputation
    const now = new Date()
    const oldEnough = new Date(now.getTime() - 25 * 60 * 60 * 1000)
    await prisma.user.update({ where: { id: userId }, data: { createdAt: oldEnough } })
    await prisma.profile.update({ where: { id: profileId }, data: { reputation: 250 } })
    assert.equal(await isTrustedForLinks(userId), true, "aged Sprout user should be trusted for links")

    await prisma.profile.update({ where: { id: profileId }, data: { reputation: 0 } })
    assert.equal(await isTrustedForLinks(userId), false, "same user with 0 rep should not be trusted")

    // enforceLinkTrust — the shared policy used by posts, edits, chat, DMs,
    // comments, diaries, setups, strains, contests, and profile fields.
    const fakeReq = { headers: {} as Record<string, string | undefined> }
    const blocked = await enforceLinkTrust("check https://spam.example out", userId, fakeReq, "test")
    assert.equal(blocked?.status, 403, "untrusted user posting a link should get 403")
    assert.equal(
      await enforceLinkTrust("plain text with no links", userId, fakeReq, "test"),
      null,
      "untrusted user posting plain text should pass"
    )
    await prisma.profile.update({ where: { id: profileId }, data: { reputation: 250 } })
    assert.equal(
      await enforceLinkTrust("check https://ok.example out", userId, fakeReq, "test"),
      null,
      "trusted user posting a link should pass"
    )
    await prisma.profile.update({ where: { id: profileId }, data: { reputation: 0 } })

    // Admin-only moderation actions — REMOVE_SUSPENSION must stay in this set
    // so a MODERATOR can never clear ban/suspension state.
    assert.equal(ADMIN_ONLY_MOD_ACTIONS.has("TEMPORARY_BAN"), true)
    assert.equal(ADMIN_ONLY_MOD_ACTIONS.has("PERMANENT_BAN"), true)
    assert.equal(ADMIN_ONLY_MOD_ACTIONS.has("UNBAN"), true)
    assert.equal(ADMIN_ONLY_MOD_ACTIONS.has("REMOVE_SUSPENSION"), true, "REMOVE_SUSPENSION must require ADMINISTRATOR")
    assert.equal(ADMIN_ONLY_MOD_ACTIONS.has("WARNING"), false, "WARNING stays moderator-level")
    assert.equal(ADMIN_ONLY_MOD_ACTIONS.has("CONTENT_DELETION"), false, "CONTENT_DELETION stays moderator-level")

    // Callback URL safety — only root-relative internal paths survive.
    assert.equal(safeCallbackUrl("/forum/thread/abc"), "/forum/thread/abc")
    assert.equal(safeCallbackUrl("/feed?tab=following"), "/feed?tab=following")
    assert.equal(safeCallbackUrl("https://evil.example"), null, "external URL must be rejected")
    assert.equal(safeCallbackUrl("//evil.example"), null, "protocol-relative URL must be rejected")
    assert.equal(safeCallbackUrl("javascript:alert(1)"), null, "javascript: URL must be rejected")
    assert.equal(safeCallbackUrl("/\\evil.example"), null, "backslash trick must be rejected")
    assert.equal(safeCallbackUrl("/auth/signin"), null, "auth paths must be rejected")
    assert.equal(safeCallbackUrl("/profile/complete"), null, "onboarding route must be rejected")
    assert.equal(safeCallbackUrl("/profile/complete?x=1"), null, "onboarding route with query must be rejected")
    assert.equal(safeCallbackUrl("/welcome"), null, "welcome route must be rejected")
    assert.equal(safeCallbackUrl("/welcome/step2"), null, "welcome subpaths must be rejected")
    assert.equal(safeCallbackUrl("/profile/alice"), "/profile/alice", "legit profile paths still allowed")
    assert.equal(safeCallbackUrl(null), null)
    assert.equal(safeCallbackUrl(""), null)
    assert.equal(safeCallbackUrl("not-a-path"), null, "bare strings without a leading slash must be rejected")
    assert.equal(
      signInHref("/forum"),
      `/auth/signin?callbackUrl=${encodeURIComponent("/forum")}`,
      "sign-in href should carry the callback"
    )
    assert.equal(signInHref("https://evil.example"), "/auth/signin", "unsafe callback falls back to plain sign-in")
    assert.equal(signInHref("/profile/complete"), "/auth/signin", "onboarding callback falls back to plain sign-in")

    // Onboarding state — new accounts default to null (pending); completing
    // writes a timestamp; nothing else changes about the account.
    const freshUser = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingCompletedAt: true } })
    assert.equal(freshUser?.onboardingCompletedAt, null, "new account should start with null onboardingCompletedAt")
    await prisma.user.update({ where: { id: userId }, data: { onboardingCompletedAt: new Date() } })
    const completed = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingCompletedAt: true } })
    assert.ok(completed?.onboardingCompletedAt instanceof Date, "completed onboarding should store a timestamp")
    await prisma.user.update({ where: { id: userId }, data: { onboardingCompletedAt: null } })

    // Recovery phrase — first-time generation must NOT invalidate the current
    // session; replacing an existing phrase must keep the old behavior.
    const phrase = newRecoveryPhrase()
    const hash = await hashPhrase(phrase)
    assert.equal(await verifyPhrase(phrase, hash), true, "phrase should verify against its hash")
    const firstTime = recoveryPhraseUpdateData(hash, false)
    assert.equal("sessionVersion" in firstTime, false, "first-time generation must not bump sessionVersion")
    assert.equal(firstTime.recoveryPhraseHash, hash)
    const replacing = recoveryPhraseUpdateData(hash, true)
    assert.deepEqual(replacing.sessionVersion, { increment: 1 }, "regeneration must still bump sessionVersion")

    // notifyMany — creates the right rows and honors filters; the Pusher
    // batching change must not alter recipients or semantics.
    const otherUser = await prisma.user.create({
      data: { name: `__test_notify_${Date.now()}`, ageVerified: true, profile: { create: { username: `__tnotify${Date.now().toString(36)}` } } },
    })
    try {
      const created = await notifyMany([
        { userId, type: "FOLLOW", title: "t", content: "c", actorId: otherUser.id },
        { userId: otherUser.id, type: "FOLLOW", title: "t", content: "c", actorId: userId },
        { userId, type: "FOLLOW", title: "t", content: "c", actorId: userId }, // self-action — must be dropped
      ])
      assert.equal(created.sent, 2, "notifyMany should create 2 notifications and drop the self-action")
      assert.equal(created.deliveredUserIds.length, 2, "deliveredUserIds should list both recipients")
      const rows = await prisma.notification.findMany({ where: { userId: { in: [userId, otherUser.id] } } })
      assert.equal(rows.length, 2, "exactly 2 notification rows should exist")

      // Preference gate — disabling notifyOnFollow must still suppress.
      await prisma.profile.update({ where: { userId: otherUser.id }, data: { notifyOnFollow: false } })
      const suppressed = await notifyMany([
        { userId: otherUser.id, type: "FOLLOW", title: "t", content: "c", actorId: userId },
      ])
      assert.equal(suppressed.sent, 0, "notifyMany must still honor notification preferences")
      assert.equal(suppressed.deliveredUserIds.length, 0, "suppressed recipients must not be reported as delivered")
    } finally {
      await prisma.user.delete({ where: { id: otherUser.id } }).catch(() => {})
    }

    // Suggested growers — exclusion rules: self, already-followed, blocked
    // (either direction), banned/suspended, TerpBot.
    const stamp = Date.now()
    const mkUser = async (tag: string, extra: { banned?: boolean; suspended?: boolean } = {}) =>
      prisma.user.create({
        data: {
          name: `__test_sug_${tag}_${stamp}`,
          ageVerified: true,
          banned: extra.banned ?? false,
          suspendedUntil: extra.suspended ? new Date(Date.now() + 60_000) : null,
          profile: { create: { username: `__tsug${tag}${stamp.toString(36)}`, bio: "test grower", reputation: 5000 } },
        },
      })
    const sugVisible = await mkUser("v")
    const sugFollowed = await mkUser("f")
    const sugBanned = await mkUser("b", { banned: true })
    const sugSuspended = await mkUser("s", { suspended: true })
    const sugBlocked = await mkUser("x")
    try {
      await prisma.follow.create({ data: { followerId: userId, followingId: sugFollowed.id } })
      await prisma.block.create({ data: { blockerId: sugBlocked.id, blockedId: userId } })

      const suggestions = await getSuggestedUsers(userId, 50)
      const ids = new Set(suggestions.map((s) => s.id))
      assert.equal(ids.has(sugVisible.id), true, "visible grower should be suggested")
      assert.equal(ids.has(sugFollowed.id), false, "already-followed user must be excluded")
      assert.equal(ids.has(sugBanned.id), false, "banned user must be excluded")
      assert.equal(ids.has(sugSuspended.id), false, "suspended user must be excluded")
      assert.equal(ids.has(sugBlocked.id), false, "blocker must be excluded")
      assert.equal(ids.has(userId), false, "self must be excluded")
      const bot = await prisma.profile.findUnique({ where: { username: "terpbot" }, select: { userId: true } })
      if (bot) assert.equal(ids.has(bot.userId), false, "TerpBot must be excluded")
    } finally {
      for (const id of [sugVisible.id, sugFollowed.id, sugBanned.id, sugSuspended.id, sugBlocked.id]) {
        await prisma.user.delete({ where: { id } }).catch(() => {})
      }
    }

    // ── Phase 6 pure-helper units ──────────────────────────────────

    // LIKE escaping — user-created strain names must not inject wildcards
    assert.equal(escapeLike("Blue%"), "Blue\\%", "% wildcard escaped")
    assert.equal(escapeLike("_auto"), "\\_auto", "_ wildcard escaped")
    assert.equal(escapeLike("a\\b"), "a\\\\b", "backslash escaped first")

    // Strain field matching — precision over recall
    assert.equal(normalizeStrain("Blue Dream!"), "blue dream")
    assert.equal(strainFieldMatches("Blue Dream", "Blue Dream"), true)
    assert.equal(strainFieldMatches("Blue Dream Auto", "Blue Dream"), true, "descriptor suffix counts")
    assert.equal(strainFieldMatches("Blue Cheese", "Cheese"), false, "word-substring must not match")
    assert.equal(strainFieldMatches("Blue Dream", "Blue Dream Auto"), false, "reverse direction rejected")
    assert.equal(strainFieldMatches(null, "Blue Dream"), false)
    assert.equal(strainFieldMatches("OG", "Blue Dream"), false)

    // Yield conversions
    assert.equal((VALID_YIELD_UNITS as readonly string[]).includes("oz"), true)
    assert.equal((VALID_YIELD_UNITS as readonly string[]).includes("stone"), false, "arbitrary units not allowed")
    assert.equal(Math.round(toGrams(4, "oz")), 113)
    assert.equal(Math.round(toOz(453.592) * 10) / 10, 16, "1 lb = 16 oz")
    assert.equal(toGrams(10, "bogus"), 10, "unknown unit falls back to grams")
    assert.equal(toGrams(10, null), 10)

    // Month keys + ranges (UTC-safe)
    assert.match(currentMonthKey(), /^\d{4}-\d{2}$/)
    assert.match(previousMonthKey(), /^\d{4}-\d{2}$/)
    const mr = monthRange("2026-03")
    assert.equal(mr.start.toISOString(), "2026-03-01T00:00:00.000Z")
    assert.equal(mr.end.toISOString(), "2026-04-01T00:00:00.000Z")

    // Diary day/week derivation — 1-based, derived from createdAt
    const start = "2026-01-01T00:00:00.000Z"
    assert.equal(diaryDay(start, start), 1)
    assert.equal(diaryWeek(start, start), 1)
    assert.equal(diaryDay(start, "2026-01-08T00:00:00.000Z"), 8)
    assert.equal(diaryWeek(start, "2026-01-08T00:00:00.000Z"), 2)
    assert.equal(diaryDay(start, "2025-12-31T00:00:00.000Z"), 1, "pre-start clamps to day 1")

    // Week grouping — chronological, stage = furthest reached, sparse weeks skipped
    const mkUpd = (id: string, day: number, stage: string, extra: Record<string, unknown> = {}) => ({
      id, stage,
      createdAt: new Date(new Date(start).getTime() + (day - 1) * 86400000),
      ...extra,
    })
    const grouped = groupUpdatesByWeek([
      mkUpd("a", 2, "SEEDLING"),
      mkUpd("b", 5, "VEGETATIVE", { temperature: 75, images: [{ id: "i1" }] }),
      mkUpd("c", 20, "FLOWER"),
      mkUpd("d", 21, "VEGETATIVE"), // re-veg — week stage stays FLOWER
    ], start)
    assert.equal(grouped.length, 2, "empty weeks between updates collapse")
    assert.equal(grouped[0].week, 1)
    assert.equal(grouped[0].stage, "VEGETATIVE", "week 1 stage = furthest reached")
    assert.equal(grouped[0].dayStart, 2)
    assert.equal(grouped[0].dayEnd, 5)
    assert.equal(grouped[0].photoCount, 1)
    assert.equal(grouped[0].hasEnv, true)
    assert.equal(grouped[1].week, 3)
    assert.equal(grouped[1].stage, "FLOWER", "re-veg within week doesn't regress stage")
    assert.equal(grouped[1].updates.length, 2)

    // Harvest report — only when harvested; veg/flower split off first FLOWER update
    assert.equal(buildHarvestReport({ startDate: start, harvested: false }, []), null)
    const report = buildHarvestReport(
      {
        startDate: start, harvested: true,
        harvestedAt: "2026-02-20T00:00:00.000Z",
        yieldAmount: 100, yieldUnit: "g",
      },
      [
        mkUpd("a", 10, "VEGETATIVE", { temperature: 72 }),
        mkUpd("b", 30, "FLOWER", { temperature: 78 }),
        mkUpd("c", 45, "FLOWER", { training: "LST, topping" }),
      ]
    )
    assert.ok(report, "harvested diary produces a report")
    assert.equal(report!.totalDays, 50)
    assert.equal(report!.vegDays, 29, "veg = days until first FLOWER update")
    assert.equal(report!.flowerDays, 21)
    assert.equal(report!.updateCount, 3)
    assert.equal(report!.avgTemp, 75)
    assert.deepEqual(report!.trainingTechniques, ["LST", "topping"])
    assert.ok(report!.stageDays.find((s) => s.stage === "FLOWER")!.days === 2)

    // Completeness — rewards documented grows, never blocks anything
    const full = diaryCompleteness(
      { startDate: start, harvested: true, strain: "x", medium: "coco", stage: "COMPLETED" },
      [mkUpd("a", 1, "FLOWER", { images: [{ id: "i" }], temperature: 70 }),
       mkUpd("b", 2, "FLOWER"), mkUpd("c", 3, "FLOWER")]
    )
    assert.equal(full.percent, 100)
    assert.equal(full.missing.length, 0)
    const empty = diaryCompleteness({ startDate: start, harvested: false }, [])
    assert.equal(empty.percent, 0)
    assert.ok(empty.missing.length > 0 && empty.missing.length <= 4, "missing list stays short")

    // Stage order sanity — every stage the API accepts is in the order list
    for (const s of ["GERMINATION", "SEEDLING", "VEGETATIVE", "FLOWER", "HARVEST", "DRYING", "CURING", "COMPLETED"]) {
      assert.ok((STAGE_ORDER as readonly string[]).includes(s), `${s} in STAGE_ORDER`)
    }

    // ── TerpBot boundary ───────────────────────────────────────────
    // The bot is a least-privileged MEMBER. postBotMessage must refuse
    // private rooms, post in public rooms, and self-heal must pin MEMBER.
    const botRoomTag = `__bot_test_${Date.now()}`
    const privateRoom = await prisma.chatRoom.create({
      data: { name: botRoomTag, slug: botRoomTag, isPrivate: true },
    })
    const publicRoom = await prisma.chatRoom.create({
      data: { name: `${botRoomTag}_pub`, slug: `${botRoomTag}_pub`, isPrivate: false },
    })
    try {
      assert.equal(
        await postBotMessage(privateRoom.id, "should not post"),
        null,
        "postBotMessage must refuse private rooms"
      )
      assert.equal(
        await postBotMessage("nonexistent-room-id", "should not post"),
        null,
        "postBotMessage must refuse unknown rooms"
      )

      const repBefore = (
        await prisma.profile.findUnique({ where: { username: TERPBOT_USERNAME }, select: { reputation: true } })
      )?.reputation ?? 0
      const dto = await postBotMessage(publicRoom.id, "bot boundary test")
      assert.ok(dto, "postBotMessage should post in a public room")
      assert.equal(dto!.author.username, TERPBOT_USERNAME, "bot message authored by terpbot")

      // Bot output must never contain its own trigger — a stored "@terpbot"
      // could self-ping if any future path re-scans bot output.
      const triggerDto = await postBotMessage(publicRoom.id, "ping @terpbot back")
      assert.ok(triggerDto, "bot post with trigger text should still post")
      assert.ok(!/@terpbot/i.test(triggerDto!.content), "bot output must strip @terpbot trigger")

      // Bot output is capped at the same message limit as users.
      const longDto = await postBotMessage(publicRoom.id, "x".repeat(LIMITS.CHAT_MESSAGE_MAX + 500))
      assert.ok(longDto, "oversized bot post should still post")
      assert.equal(longDto!.content.length, LIMITS.CHAT_MESSAGE_MAX, "bot output capped at CHAT_MESSAGE_MAX")

      const botUser = await prisma.user.findUnique({
        where: { id: dto!.author.id },
        select: { role: true, password: true, recoveryPhraseHash: true },
      })
      assert.equal(botUser?.role, "MEMBER", "TerpBot must be pinned to MEMBER")
      assert.equal(botUser?.password, null, "TerpBot must stay passwordless")
      assert.equal(botUser?.recoveryPhraseHash, null, "TerpBot must have no recovery credential")

      // Bot posts must never earn reputation — compare against whatever the
      // account already holds (historical rep isn't reset by this suite).
      const repAfter = (
        await prisma.profile.findUnique({ where: { username: TERPBOT_USERNAME }, select: { reputation: true } })
      )?.reputation ?? 0
      assert.equal(repAfter, repBefore, "posting must not change bot reputation")

      // @terpbot must never produce a MENTION notification to the bot.
      // Positive control uses a valid-length handle (3–20 chars).
      const mentionableName = `m${Date.now().toString(36)}`
      const mentionable = await prisma.user.create({
        data: { name: `__test_ment_${Date.now()}`, ageVerified: true, profile: { create: { username: mentionableName } } },
      })
      try {
        await notifyMentions(`hi @${TERPBOT_USERNAME} and @${mentionableName}`, userId, "tester", "/x", "test")
        const botId = dto!.author.id
        const mentionRows = await prisma.notification.findMany({
          where: { userId: botId, type: "MENTION", createdAt: { gte: new Date(Date.now() - 60_000) } },
        })
        assert.equal(mentionRows.length, 0, "bot must not receive mention notifications")
        const userMention = await prisma.notification.findFirst({
          where: { userId: mentionable.id, type: "MENTION", createdAt: { gte: new Date(Date.now() - 60_000) } },
        })
        assert.ok(userMention, "real user still gets the mention notification")
      } finally {
        await prisma.user.delete({ where: { id: mentionable.id } }).catch(() => {})
      }

      // ── Phase 3: thread-context visibility gate ──────────────────
      // Hidden-category, deleted, and nonexistent threads must produce
      // the SAME refusal — the bot is never an existence oracle.
      const tag = Date.now()
      const visCat = await prisma.category.create({
        data: { name: `__bc_vis_${tag}`, slug: `__bc-vis-${tag}`, description: "t" },
      })
      const hidCat = await prisma.category.create({
        data: { name: `__bc_hid_${tag}`, slug: `__bc-hid-${tag}`, description: "t", hidden: true },
      })
      const visThread = await prisma.thread.create({
        data: {
          title: `botctx visible ${tag}`, slug: `botctx-vis-${tag}`,
          content: "opening post body for the context test",
          categoryId: visCat.id, authorId: userId, replyCount: 1,
        },
      })
      const visReply = await prisma.post.create({
        data: { content: "accepted reply body", threadId: visThread.id, authorId: userId },
      })
      await prisma.thread.update({
        where: { id: visThread.id },
        data: { acceptedAnswerId: visReply.id },
      })
      const hidThread = await prisma.thread.create({
        data: { title: "secret", slug: `botctx-hid-${tag}`, content: "hidden", categoryId: hidCat.id, authorId: userId },
      })
      const delThread = await prisma.thread.create({
        data: { title: "gone", slug: `botctx-del-${tag}`, content: "deleted", categoryId: visCat.id, authorId: userId, deleted: true },
      })
      const ctxBase = {
        userId, role: "MEMBER", displayName: TEST_USERNAME,
        args: [] as string[], rest: "", roomId: publicRoom.id,
      }
      try {
        // Visible thread summarizes with its accepted answer.
        const okRes = await runBotCommand("summarize", { ...ctxBase, rawContent: `look /forum/thread/${visThread.slug}` })
        assert.ok(okRes.ok, "summarize should succeed for a public thread")
        assert.ok(okRes.messages[0].includes(visThread.title), "summary includes the thread title")
        assert.ok(okRes.messages[0].includes("Accepted answer"), "summary includes the accepted answer")
        assert.ok(okRes.messages[0].includes(`/forum/thread/${visThread.slug}`), "summary links the thread")

        // Hidden, deleted, and nonexistent → identical refusal.
        const refusals = await Promise.all([
          runBotCommand("summarize", { ...ctxBase, rawContent: `/forum/thread/${hidThread.slug}` }),
          runBotCommand("summarize", { ...ctxBase, rawContent: `/forum/thread/${delThread.slug}` }),
          runBotCommand("summarize", { ...ctxBase, rawContent: `/forum/thread/botctx-nope-${tag}` }),
        ])
        for (const r of refusals) {
          assert.ok(r.ok, "refusal is an ok result, not an error")
          assert.ok(r.ok && r.messages[0].includes("couldn't pull up"), "uniform not-found text — no existence oracle")
        }
        // No context at all → the hint, not a crash.
        const none = await runBotCommand("summarize", ctxBase)
        assert.ok(none.ok && none.messages[0].includes("Which thread"), "no context → hint to paste a link")

        // answered reports the accepted answer on the visible thread.
        const ans = await runBotCommand("answered", { ...ctxBase, replyToContent: `see /forum/thread/${visThread.slug}` })
        assert.ok(ans.ok && ans.messages[0].includes("Yes"), "answered resolves via replied-to message and reports the answer")

        // Excerpts must strip @mentions and external URLs.
        const leaky = await prisma.thread.create({
          data: {
            title: `leaky ${tag}`, slug: `botctx-leak-${tag}`,
            content: "ping @someone visit https://evil.example/steal for details",
            categoryId: visCat.id, authorId: userId,
          },
        })
        try {
          const leakRes = await runBotCommand("summarize", { ...ctxBase, rawContent: `/forum/thread/${leaky.slug}` })
          assert.ok(leakRes.ok, "leak-test summarize succeeds")
          assert.ok(leakRes.ok && !/@someone/.test(leakRes.messages[0]), "excerpt strips @mentions")
          assert.ok(leakRes.ok && !/evil\.example|https:/.test(leakRes.messages[0]), "excerpt strips external URLs")
        } finally {
          await prisma.thread.delete({ where: { id: leaky.id } }).catch(() => {})
        }
      } finally {
        await prisma.post.deleteMany({ where: { threadId: { in: [visThread.id, hidThread.id, delThread.id] } } }).catch(() => {})
        await prisma.thread.deleteMany({ where: { id: { in: [visThread.id, hidThread.id, delThread.id] } } }).catch(() => {})
        await prisma.category.deleteMany({ where: { id: { in: [visCat.id, hidCat.id] } } }).catch(() => {})
      }

      // ── Phase 3: BotEvent telemetry + bot badges + human-badge guard ──
      const evKey = `__test:${tag}`
      await recordBotEvent({ type: "COMMAND_SLASH", key: evKey, userId, command: "summarize", entities: 1 })
      await recordBotEvent({ type: "COMMAND_SLASH", key: evKey, userId, command: "summarize", entities: 1 })
      assert.equal(
        await prisma.botEvent.count({ where: { key: evKey } }),
        1,
        "duplicate idempotency keys must not double-count"
      )
      const stats = await getBotStats()
      assert.ok(stats.commands >= 1, "recorded command counts toward bot stats")
      assert.ok(stats.entityLinks >= 1, "entity links are counted")
      assert.ok(stats.daysActive >= 1, "DAY_ACTIVE stamp recorded")

      // The bot never counts itself as an assisted member.
      const botProfile = await prisma.profile.findUnique({ where: { username: TERPBOT_USERNAME }, select: { userId: true } })
      await recordBotEvent({ type: "COMMAND_MENTION", key: `__test-self:${tag}`, userId: botProfile!.userId, command: "rep" })
      const selfRow = await prisma.botEvent.findUnique({ where: { key: `__test-self:${tag}` } })
      assert.equal(selfRow!.userId, null, "bot self-events must not store bot as assisted member")

      // "First Light" (>=1 answered command) is granted by real events only.
      const firstLight = await prisma.userBadge.findFirst({
        where: { userId: botProfile!.userId, badge: { name: "First Light" } },
      })
      assert.ok(firstLight, "First Light bot badge awarded after a real command event")

      // checkBadges must never award the bot a human badge — even though the
      // bot's chat volume would satisfy human chat-badge rules.
      const badgeCountBefore = await prisma.userBadge.count({ where: { userId: botProfile!.userId } })
      await checkBadges(botProfile!.userId)
      assert.equal(
        await prisma.userBadge.count({ where: { userId: botProfile!.userId } }),
        badgeCountBefore,
        "checkBadges must early-return for the bot"
      )

      // Bot badges are unreachable by humans: absent from BADGE_REGISTRY
      // AND absent from BADGE_RULES (the auto-award map).
      const humanNames = new Set(BADGE_REGISTRY.map((b) => b.name))
      for (const def of BOT_BADGE_REGISTRY) {
        assert.ok(!humanNames.has(def.name), `bot badge "${def.name}" must not collide with human registry`)
        assert.ok(!(def.name in BADGE_RULES), `bot badge "${def.name}" must have no human award rule`)
        assert.ok(isBotBadge(def.name), `isBotBadge("${def.name}")`)
      }

      // Cleanup test events — they were real at write time but must not
      // permanently inflate the public stats.
      await prisma.botEvent.deleteMany({ where: { key: { in: [evKey, `__test-self:${tag}`] } } })
    } finally {
      await prisma.chatMessage.deleteMany({ where: { roomId: { in: [privateRoom.id, publicRoom.id] } } }).catch(() => {})
      await prisma.chatRoom.deleteMany({ where: { id: { in: [privateRoom.id, publicRoom.id] } } }).catch(() => {})
    }

    console.log("All security regression tests passed.")
  } finally {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {})
    }
    await prisma.$disconnect().catch(() => {})
  }
}

run().catch((err) => {
  console.error("Security regression tests failed:", err)
  process.exit(1)
})
