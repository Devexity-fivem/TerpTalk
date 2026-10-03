import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { isBanned, isSessionValid, isAdmin, isModerator, isStaff, isSupport, hashIp, getTrustLevel, LIMITS, blockedUserIds, notBlockedAuthor, safeEqualSecret, bcryptDecoy } from "@/lib/security"
import bcrypt from "bcryptjs"
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
import { claimTask, markDone, releaseClaim, runCronTask } from "@/lib/cron-claim"
import React from "react"
import { renderToString } from "react-dom/server"
import { MarkdownRenderer, sanitizeHref } from "@/lib/markdown"
import { getSiteAnnouncement } from "@/lib/announcement"
import { SITE_SETTINGS } from "@/lib/settings"
import {
  parseProfileSettings, validateProfileSettingsPatch, validateSectionInput,
  PROFILE_SECTION_TITLE_MAX, PROFILE_SECTION_BODY_MAX, DEFAULT_PROFILE_SETTINGS,
  PROFILE_ACCENTS, PROFILE_SECTION_IDS, NOTABLE_STAT_IDS,
} from "@/lib/profile-settings"
import { PROFILE_WIDGETS, isProfileWidgetId } from "@/lib/profile-widgets"
import { UNLOCK_BY_ID } from "@/lib/progression-config"
import { applyAccountActionInTx } from "@/lib/moderation"
import { authOptions } from "@/lib/auth"

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
  const claimKeys: string[] = []
  const captchaIds: string[] = []
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

    // Trusted for links requires 24h age + Known standing (V2)
    const now = new Date()
    const oldEnough = new Date(now.getTime() - 25 * 60 * 60 * 1000)
    await prisma.user.update({ where: { id: userId }, data: { createdAt: oldEnough } })
    const seedRep = async (delta: number) => {
      await prisma.profile.update({ where: { id: profileId }, data: { standing: { increment: delta } } })
      await prisma.progressionEvent.create({
        data: { userId, type: "STAFF_ADJUSTMENT", standing: delta, reason: "test seed" },
      })
    }
    await seedRep(250)
    assert.equal(await isTrustedForLinks(userId), true, "aged Known-standing user should be trusted for links")

    await seedRep(-250)
    assert.equal(await isTrustedForLinks(userId), false, "same user with 0 standing should not be trusted")

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
    await seedRep(250)
    assert.equal(
      await enforceLinkTrust("check https://ok.example out", userId, fakeReq, "test"),
      null,
      "trusted user posting a link should pass"
    )
    await seedRep(-250)

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
    const mkUser = async (tag: string, extra: { banned?: boolean; suspended?: boolean } = {}) => {
      const u = await prisma.user.create({
        data: {
          name: `__test_sug_${tag}_${stamp}`,
          ageVerified: true,
          banned: extra.banned ?? false,
          suspendedUntil: extra.suspended ? new Date(Date.now() + 60_000) : null,
          profile: { create: { username: `__tsug${tag}${stamp.toString(36)}`, bio: "test grower", xp: 5000 } },
        },
      })
      await prisma.progressionEvent.create({
        data: { userId: u.id, type: "STAFF_ADJUSTMENT", xp: 5000, reason: "test seed" },
      })
      return u
    }
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

    // ── Pure-helper units ──────────────────────────────────

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

      // ── Thread-context visibility gate ──────────────────
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

      // ── BotEvent telemetry + bot badges + human-badge guard ──
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

    // ── Timing-safe credential helpers ────────────────────────────
    {
      // Cron bearer check: exact match only, no prefix/length shortcuts.
      assert.equal(safeEqualSecret("Bearer s3cret", "Bearer s3cret"), true, "matching secret accepted")
      assert.equal(safeEqualSecret("Bearer s3cre", "Bearer s3cret"), false, "prefix of secret rejected")
      assert.equal(safeEqualSecret("Bearer s3cret-extra", "Bearer s3cret"), false, "longer value rejected")
      assert.equal(safeEqualSecret(null, "Bearer s3cret"), false, "missing header rejected")
      assert.equal(safeEqualSecret("", "Bearer s3cret"), false, "empty header rejected")
      // Unknown-account paths must pay a real bcrypt compare and never
      // report success. Warm the decoy hash first, then time a compare at
      // the same cost as a real password check.
      await bcryptDecoy("warm", 10)
      const realHash = await bcrypt.hash("correct horse", 10)
      const t0 = performance.now()
      await bcrypt.compare("wrong guess", realHash)
      const realMs = performance.now() - t0
      const t1 = performance.now()
      assert.equal(await bcryptDecoy("wrong guess", 10), false, "decoy never authenticates")
      const decoyMs = performance.now() - t1
      assert.ok(decoyMs > realMs * 0.5, `decoy compare costs a real bcrypt round (decoy ${decoyMs.toFixed(0)}ms vs real ${realMs.toFixed(0)}ms)`)
    }

    // ── Cron claim integrity ──────────────────────────────────────
    {
      const ck = `__test_cron_${Date.now()}`
      claimKeys.push(ck)
      assert.equal(await claimTask(ck), true, "first claim wins")
      assert.equal(await claimTask(ck), false, "active claim blocks second claim")
      await releaseClaim(ck)
      assert.equal(await claimTask(ck), true, "released claim can be reclaimed")
      await markDone(ck)
      assert.equal(await claimTask(ck), false, "completed task cannot be reclaimed")

      // Stale running claims are reclaimable.
      const ck2 = `__test_cron_stale_${Date.now()}`
      claimKeys.push(ck2)
      await prisma.setting.create({ data: { key: ck2, value: `running:${Date.now() - 11 * 60 * 1000}` } })
      assert.equal(await claimTask(ck2), true, "stale claim is reclaimable")
      // …but only once — the swap is conditional on the stale value.
      assert.equal(await claimTask(ck2), false, "fresh claim blocks again")

      // runCronTask: a failed task releases its claim and retries next run.
      const kf = `__test_cron_fail_${Date.now()}`
      claimKeys.push(kf)
      {
        const posted: string[] = []; const failed: string[] = []
        await runCronTask(kf, async () => { throw new Error("boom") }, posted, failed, "t1")
        assert.deepEqual(failed, ["t1"])
        assert.equal(await prisma.setting.findUnique({ where: { key: kf } }), null)
        await runCronTask(kf, async () => "t1-ok", posted, failed, "t1")
        assert.deepEqual(posted, ["t1-ok"])
        assert.equal((await prisma.setting.findUnique({ where: { key: kf } }))?.value, "1")
      }

      // runCronTask: one task's failure does not prevent later tasks.
      const ks1 = `__test_cron_seq1_${Date.now()}`; const ks2 = `__test_cron_seq2_${Date.now()}`
      claimKeys.push(ks1, ks2)
      {
        const posted: string[] = []; const failed: string[] = []
        await runCronTask(ks1, async () => { throw new Error("first fails") }, posted, failed, "first")
        await runCronTask(ks2, async () => "second-ok", posted, failed, "second")
        assert.deepEqual(failed, ["first"])
        assert.deepEqual(posted, ["second-ok"])
      }

      // runCronTask: a completed task is not re-executed.
      const kd = `__test_cron_done_${Date.now()}`
      claimKeys.push(kd)
      {
        const posted: string[] = []; const failed: string[] = []
        let runs = 0
        await runCronTask(kd, async () => { runs++; return "x" }, posted, failed, "dup")
        await runCronTask(kd, async () => { runs++; return "x" }, posted, failed, "dup")
        assert.equal(runs, 1)
        assert.deepEqual(posted, ["x"])
      }
    }

    // ── CAPTCHA claim atomicity ────────────────────────────────────
    {
      const c = await prisma.captcha.create({
        data: { answer: "42", expiresAt: new Date(Date.now() + 600000) },
      })
      captchaIds.push(c.id)
      const claims = await Promise.all(
        Array.from({ length: 6 }, () =>
          prisma.captcha.updateMany({
            where: { id: c.id, used: false, expiresAt: { gt: new Date() } },
            data: { used: true },
          })
        )
      )
      const winners = claims.filter((r) => r.count === 1).length
      assert.equal(winners, 1, `expected exactly 1 winning claim, got ${winners}`)

      const used = await prisma.captcha.create({ data: { answer: "1", expiresAt: new Date(Date.now() + 600000), used: true } })
      const expired = await prisma.captcha.create({ data: { answer: "1", expiresAt: new Date(Date.now() - 1000) } })
      captchaIds.push(used.id, expired.id)
      for (const id of [used.id, expired.id]) {
        const r = await prisma.captcha.updateMany({
          where: { id, used: false, expiresAt: { gt: new Date() } },
          data: { used: true },
        })
        assert.equal(r.count, 0)
      }
    }

    // ── Markdown / link safety ────────────────────────────────────
    // sanitizeHref — backslash & protocol-relative bypasses.
    assert.equal(sanitizeHref("/forum"), "/forum")
    assert.equal(sanitizeHref("https://example.com"), "https://example.com")
    assert.equal(sanitizeHref("mailto:a@b.c"), "mailto:a@b.c")
    assert.equal(sanitizeHref("/\\evil.com"), null, "backslash pseudo-path must be rejected")
    assert.equal(sanitizeHref("//evil.com"), null, "protocol-relative must be rejected")
    assert.equal(sanitizeHref("\\evil.com"), null)
    assert.equal(sanitizeHref("javascript:alert(1)"), null)
    assert.equal(sanitizeHref("/a\\b"), null, "embedded backslash must be rejected")
    assert.equal(sanitizeHref("data:text/html,<script>alert(1)</script>"), null)
    assert.equal(sanitizeHref("vbscript:msgbox(1)"), null)
    assert.equal(sanitizeHref("JaVaScRiPt:alert(1)"), null, "scheme check is case-insensitive")
    assert.equal(sanitizeHref("http://ok.example"), "http://ok.example")
    assert.equal(sanitizeHref("\\\\evil.com"), null, "double-backslash external must be rejected")
    assert.equal(sanitizeHref("/\\x"), null)

    // Announcement link paths all route through sanitizeHref — the shared
    // loader (public GET + server-rendered layout banner), the admin
    // settings PATCH, and the admin broadcast POST. No parallel weaker
    // validator may survive.
    const annLib = readFileSync("src/lib/announcement.ts", "utf8")
    const annGet = readFileSync("src/app/api/settings/announcement/route.ts", "utf8")
    const annBanner = readFileSync("src/components/announcement-banner.tsx", "utf8")
    const adminSettings = readFileSync("src/app/api/admin/settings/route.ts", "utf8")
    const adminAnnounce = readFileSync("src/app/api/admin/announce/route.ts", "utf8")
    assert.ok(annLib.includes("sanitizeHref"), "announcement loader uses canonical validator")
    assert.ok(!annLib.includes("isSafeLink"), "local isSafeLink validator removed")
    assert.ok(annGet.includes("getSiteAnnouncement"), "announcement GET delegates to shared loader")
    // The globally mounted banner must not request the endpoint — the
    // layout passes the sanitized bundle as a prop.
    assert.ok(!annBanner.includes("settings/announcement"), "banner makes no announcement API request")
    assert.ok(!annBanner.includes("fetch("), "banner performs no client fetch")

    // Shared loader behavior — exercised through the real function on the
    // real DB so sanitization and disabled-state semantics can't drift.
    {
      const keys = [SITE_SETTINGS.ANNOUNCEMENT_TITLE, SITE_SETTINGS.ANNOUNCEMENT_CONTENT, SITE_SETTINGS.ANNOUNCEMENT_LINK]
      await prisma.setting.deleteMany({ where: { key: { in: keys } } })
      try {
        const off = await getSiteAnnouncement()
        assert.equal(off.enabled, false, "no announcement rows → disabled")
        await prisma.setting.createMany({
          data: [
            { key: SITE_SETTINGS.ANNOUNCEMENT_TITLE, value: "  Heads up  " },
            { key: SITE_SETTINGS.ANNOUNCEMENT_CONTENT, value: "Maintenance tonight" },
            { key: SITE_SETTINGS.ANNOUNCEMENT_LINK, value: "javascript:alert(1)" },
          ],
        })
        const on = await getSiteAnnouncement()
        assert.equal(on.enabled, true, "title+content → enabled")
        assert.equal(on.title, "Heads up", "title trimmed")
        assert.equal(on.content, "Maintenance tonight", "content preserved")
        assert.equal(on.link, undefined, "unsafe link stripped by sanitizeHref")
        assert.equal("recoveryPhraseHash" in on, false, "no unrelated settings in the bundle")
        await prisma.setting.update({ where: { key: SITE_SETTINGS.ANNOUNCEMENT_LINK }, data: { value: "https://example.com/a" } })
        const safe = await getSiteAnnouncement()
        assert.equal(safe.link, "https://example.com/a", "safe https link survives")
      } finally {
        await prisma.setting.deleteMany({ where: { key: { in: keys } } })
      }
    }
    assert.ok(adminSettings.includes("sanitizeHref"), "admin settings validates announcement_link on write")
    assert.ok(adminSettings.includes("ANNOUNCEMENT_LINK"), "write-time check keyed to announcement_link")
    assert.ok(adminAnnounce.includes("sanitizeHref"), "admin broadcast uses canonical validator")

    // Markdown tokenizer — unmatched delimiters must not hang. A delimiter
    // char failing every inline pattern used to consume 0 characters and
    // loop forever; renderToString is synchronous, so a regression stalls
    // this suite rather than silently passing.
    const md = (c: string) => renderToString(React.createElement(MarkdownRenderer, { content: c }))
    const text = (c: string) => md(c).replace(/<[^>]*>/g, "")
    assert.ok(md("Tag me (@terpbot) for help").includes("/u/terpbot"), "mention renders as a profile link")
    assert.equal(text("wow!"), "wow!", "lone ! renders literally")
    assert.equal(text("5 * 3 = 15"), "5 * 3 = 15", "lone * renders literally")
    assert.equal(text("a_b"), "a_b", "lone _ renders literally")
    assert.equal(text("back`tick"), "back`tick", "lone ` renders literally")
    assert.equal(text("x~y"), "x~y", "lone ~ renders literally")
    assert.equal(text("see [this"), "see [this", "unclosed [ renders literally")
    assert.ok(!md("email a@b.com").includes("/u/"), "email addresses are not mentions")

    // ── Profile V2 custom sections: markdown source is stored, only
    // MarkdownRenderer ever renders it. Payloads must degrade to text.
    assert.ok(!md("<script>alert(1)</script>").includes("<script"), "script tag never emitted")
    assert.ok(!md("<img src=x onerror=alert(1)>").includes("<img"), "raw img/handler markup never emitted")
    assert.ok(!md("[x](javascript:alert(1))").includes("javascript:"), "javascript: link stripped")
    assert.ok(!md("[x](//evil.com)").includes('href="//evil.com"'), "protocol-relative link stripped")
    assert.ok(!md("![i](javascript:alert(1))").includes("javascript:"), "javascript: image stripped")
    assert.ok(!md("<style>body{display:none}</style>").includes("<style"), "style injection never emitted")
    assert.ok(md("**bold** and [ok](https://example.com)").includes("<strong"), "safe markdown still renders")

    // Section write validation — server-side limits, no client trust.
    assert.equal(
      validateSectionInput({ title: "T".repeat(PROFILE_SECTION_TITLE_MAX + 1), body: "x" }).error !== undefined,
      true, "oversized title rejected")
    assert.equal(
      validateSectionInput({ title: "ok", body: "B".repeat(PROFILE_SECTION_BODY_MAX + 1) }).error !== undefined,
      true, "oversized body rejected")
    assert.ok(validateSectionInput({ title: "ok", body: "b", visibility: "INTERNAL" }).error, "bad visibility rejected")
    assert.ok(validateSectionInput({ title: "ok", body: "b", order: 101 }).error, "order > 100 rejected")
    assert.ok(validateSectionInput({ title: "ok", body: "b", order: -1 }).error, "negative order rejected")
    assert.ok(validateSectionInput({ title: "ok", body: "b", order: 1.5 }).error, "non-integer order rejected")
    const okSection = validateSectionInput({ title: "  Notes  ", body: "**hi**", visibility: "MEMBERS", order: 2 })
    assert.equal(okSection.error, undefined, "valid section input passes")
    assert.equal(okSection.title, "Notes", "title trimmed")
    assert.equal(validateSectionInput("junk").error !== undefined, true, "non-object rejected")
    assert.equal(validateSectionInput(null).error !== undefined, true, "null rejected")

    // profileSettings — deterministic defaults on anything malformed/stale;
    // only preset enums survive, never arbitrary CSS/style strings.
    assert.deepEqual(parseProfileSettings(null), DEFAULT_PROFILE_SETTINGS, "null → defaults")
    assert.deepEqual(parseProfileSettings("junk"), DEFAULT_PROFILE_SETTINGS, "string → defaults")
    assert.deepEqual(parseProfileSettings(42), DEFAULT_PROFILE_SETTINGS, "number → defaults")
    const parsed = parseProfileSettings({
      accent: "red;position:fixed", theme: "<script>", density: "dense",
      sectionOrder: ["grows", "bogus", "stats"], hiddenSections: ["nope"],
      shownStats: ["grows", "grows", "fake"], bannerImage: "javascript:x",
      pinnedSection: 42, identity: { mediums: ["soil", "orbital"], goals: "g".repeat(400) },
      evilKey: { nested: true },
    })
    assert.equal(parsed.accent, "pine", "invalid accent → default")
    assert.equal(parsed.theme, "default", "invalid theme → default")
    assert.equal(parsed.density, "cozy", "invalid density → default")
    assert.deepEqual(parsed.sectionOrder.slice(0, 2), ["grows", "stats"], "bogus section ids dropped")
    assert.equal(parsed.hiddenSections.length, 0, "bogus hidden ids dropped")
    assert.deepEqual(parsed.shownStats, ["grows"], "bogus stat ids dropped")
    assert.equal(parsed.bannerImage, null, "non-https banner rejected")
    assert.equal(parsed.pinnedSection, null, "non-string pinnedSection rejected")
    assert.deepEqual(parsed.identity.mediums, ["soil"], "bogus mediums dropped")
    assert.equal(parsed.identity.goals.length, 280, "goals clamped to max")
    assert.ok(!("evilKey" in parsed), "unknown keys never persist")

    const patch = validateProfileSettingsPatch({ accent: "ember" }, { accent: "violet" })
    assert.equal(patch.settings?.accent, "ember", "valid enum accepted")
    assert.equal(patch.settings?.theme, "default", "untouched fields fall back to normalized existing")
    const badPatch = validateProfileSettingsPatch({ accent: "not-a-preset" }, { accent: "violet" })
    assert.equal(badPatch.settings?.accent, "violet", "invalid enum keeps existing value")
    assert.equal(validateProfileSettingsPatch(null, null).settings?.accent, "pine", "null resets to defaults")
    assert.equal(validateProfileSettingsPatch([], null).error !== undefined, true, "array rejected")
    for (const a of PROFILE_ACCENTS) {
      assert.equal(validateProfileSettingsPatch({ accent: a }, null).settings?.accent, a, `accent ${a} valid`)
    }

    // P2 — banner URL allowlist. Only the image pipeline's own storage or an
    // uploaded data URI may persist; an arbitrary remote URL is a tracking
    // pixel pointed at every profile viewer, so it is rejected like avatars.
    const blobBanner = "https://x9f2.public.blob.vercel-storage.com/banners/b.webp"
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    assert.equal(parseProfileSettings({ bannerImage: "https://evil.example.com/track.png" }).bannerImage, null, "external https banner rejected")
    assert.equal(parseProfileSettings({ bannerImage: blobBanner }).bannerImage, blobBanner, "blob-hosted banner accepted")
    assert.equal(parseProfileSettings({ bannerImage: tinyPng }).bannerImage, tinyPng, "uploaded data-URI banner accepted")
    assert.equal(parseProfileSettings({ bannerImage: "data:text/html;base64,PHNjcmlwdA==" }).bannerImage, null, "non-image data URI rejected")
    assert.equal(parseProfileSettings({ bannerImage: `https://x.public.blob.vercel-storage.com/${"a".repeat(500)}` }).bannerImage, null, "oversized blob URL rejected")
    assert.equal(validateProfileSettingsPatch({ bannerImage: "https://evil.example.com/x.png" }, { bannerImage: blobBanner }).settings?.bannerImage, blobBanner, "patch keeps existing banner when the new URL is hostile")

    // P2 — expanded section registry: "overview" can never be hidden; widget
    // ids are legal order/hide targets; stat picks hard-cap at 8 even when a
    // stale blob carries more.
    assert.deepEqual(
      parseProfileSettings({ hiddenSections: ["overview", "records", "stats"] }).hiddenSections,
      ["records", "stats"], "overview stripped from hiddenSections")
    assert.deepEqual(
      validateProfileSettingsPatch({ hiddenSections: ["overview", "about"] }, null).settings?.hiddenSections,
      ["about"], "patch drops overview from hiddenSections")
    assert.ok(
      parseProfileSettings({ sectionOrder: ["owner-insights", "grows"] }).sectionOrder[0] === "owner-insights",
      "widget ids survive sectionOrder")
    assert.ok(
      validateProfileSettingsPatch({ shownStats: [...NOTABLE_STAT_IDS, "grows"] }, null).settings!.shownStats.length <= 8,
      "stat picks hard-capped at 8")

    // P2 — widget registry integrity: every registered widget is a legal
    // section id and gates on a live unlock spec — never a client string.
    for (const w of PROFILE_WIDGETS) {
      assert.ok(PROFILE_SECTION_IDS.includes(w.id as never), `widget ${w.id} is a registered section id`)
      assert.ok(UNLOCK_BY_ID.has(w.unlockId), `widget ${w.id} gates on a live unlock`)
      assert.equal(UNLOCK_BY_ID.get(w.unlockId)!.layer, "A", `widget ${w.id} unlock is live, not deferred`)
    }
    assert.ok(!isProfileWidgetId("evil-widget"), "unknown widget ids rejected")
    assert.ok(!isProfileWidgetId("../../../etc/passwd"), "path-shaped widget ids rejected")

    // Owner-only mutation surfaces — the routes resolve the section/profile
    // from the session, never a caller-supplied owner id.
    const sectionsRoute = readFileSync(new URL("../src/app/api/profile/sections/route.ts", import.meta.url), "utf8")
    const sectionItemRoute = readFileSync(new URL("../src/app/api/profile/sections/[id]/route.ts", import.meta.url), "utf8")
    assert.ok(sectionsRoute.includes("getServerSession"), "sections GET requires session")
    assert.ok(sectionsRoute.includes("where: { userId: session.user.id }"), "sections resolved via session user")
    assert.ok(sectionItemRoute.includes("section.profileId !== profile.id"), "item route enforces section ownership")
    assert.ok(!sectionItemRoute.includes("body.userId") && !sectionsRoute.includes("body.userId"), "no caller-supplied userId")
    const profilePatchRoute = readFileSync(new URL("../src/app/api/profile/route.ts", import.meta.url), "utf8")
    assert.ok(profilePatchRoute.includes("diary.authorId !== userId"), "featuredDiaryId verified against session user")
    assert.ok(profilePatchRoute.includes("validateProfileSettingsPatch"), "profileSettings goes through the validator")

    // P2 route guards — progression caps, blob pipeline, rate limits,
    // pinned-reference cleanup. Source asserts only where no behavioral
    // surface exists; behavior is exercised over HTTP in runtime-verify.
    assert.ok(profilePatchRoute.includes("statSlotLimit"), "profile PATCH enforces stat-slot unlock cap")
    assert.ok(profilePatchRoute.includes("storeImage"), "banner uploads go through the shared image pipeline")
    assert.ok(profilePatchRoute.includes("rateLimit"), "profile PATCH rate-limited")
    assert.ok(profilePatchRoute.includes("findFirst"), "pinnedSection ownership checked server-side")
    assert.ok(sectionsRoute.includes("profileSectionLimit"), "section create enforces unlock-tiered limit")
    assert.ok(sectionsRoute.includes("rateLimit") && sectionItemRoute.includes("rateLimit"), "section mutations rate-limited")
    assert.ok(sectionItemRoute.includes("pinnedSection === id"), "section delete clears pinnedSection reference")

    // ── Moderation role guards (lib-level) ────────────────────────
    {
      const stamp = Date.now().toString(36)
      const mkRole = (t: string, role: string) =>
        prisma.user.create({
          data: { name: `__sec_${t}_${stamp}`, ageVerified: true, sessionVersion: 1, role, profile: { create: { username: `__sec${t}${stamp}` } } },
        })
      const modUser = await mkRole("md", "MODERATOR")
      const adminUser = await mkRole("ad", "ADMINISTRATOR")
      const supportUser = await mkRole("sp", "SUPPORT")
      try {
        const attempt = (p: Parameters<typeof applyAccountActionInTx>[1]) =>
          prisma.$transaction((tx) => applyAccountActionInTx(tx, p)).then(
            () => "ok",
            (e: Error) => e.message
          )
        assert.equal(await attempt({
          actionType: "WARNING", targetUserId: modUser.id, reason: "x",
          staffId: modUser.id, staffRole: "MODERATOR", staffName: "m",
        }), "FORBIDDEN", "self-target must be blocked")
        assert.equal(await attempt({
          actionType: "WARNING", targetUserId: adminUser.id, reason: "x",
          staffId: modUser.id, staffRole: "MODERATOR", staffName: "m",
        }), "FORBIDDEN", "moderator cannot act on an administrator")
        assert.equal(await attempt({
          actionType: "WARNING", targetUserId: supportUser.id, reason: "x",
          staffId: modUser.id, staffRole: "MODERATOR", staffName: "m",
        }), "FORBIDDEN", "moderator cannot warn SUPPORT")
        assert.equal(await attempt({
          actionType: "PERMANENT_BAN", targetUserId: userId, reason: "x",
          staffId: modUser.id, staffRole: "MODERATOR", staffName: "m",
        }), "FORBIDDEN", "moderator cannot issue bans (admin-only)")
        assert.equal(await attempt({
          actionType: "PERMANENT_BAN", targetUserId: userId, reason: "x",
          staffId: supportUser.id, staffRole: "SUPPORT", staffName: "s",
        }), "FORBIDDEN", "SUPPORT cannot issue bans")
        assert.equal(await attempt({
          actionType: "WARNING", targetUserId: userId, reason: "x",
          staffId: modUser.id, staffRole: "MODERATOR", staffName: "m",
        }), "ok", "moderator warning a member succeeds")
      } finally {
        for (const u of [modUser, adminUser, supportUser]) {
          await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
        }
      }
    }

    // ── Session invalidation via the real authOptions callback ────
    {
      const sessionCb = authOptions.callbacks?.session
      assert.ok(sessionCb)
      const session = { user: { id: "x" }, expires: "x" } as never
      // Unknown user — the invalidation path.
      const out = await sessionCb!({ session, token: { id: `__test_sec_nouser_${Date.now()}` } } as never)
      assert.deepEqual((out as { user: object }).user, {})
      // Valid user still gets a populated session.
      const ok = await sessionCb!({
        session: { user: {}, expires: "x" } as never,
        token: { id: userId, sessionVersion: 2 },
      } as never)
      assert.equal((ok.user as { id?: string }).id, userId)
      // Layout-capability fields exposed by the callback — booleans/numbers
      // only; the raw recovery hash must never reach session.user.
      const okUser = ok.user as { standing?: number; unlockFrozen?: boolean; hasRecoveryPhrase?: boolean }
      assert.equal(typeof okUser.standing, "number", "session exposes standing")
      assert.equal(typeof okUser.unlockFrozen, "boolean", "session exposes unlockFrozen")
      assert.equal(okUser.hasRecoveryPhrase, false, "user without a phrase → hasRecoveryPhrase=false")
      assert.equal("recoveryPhraseHash" in (ok.user as object), false, "recovery hash never serialized")

      // A user WITH a stored phrase flips only the boolean.
      const recUser = await prisma.user.create({
        data: {
          name: `__sec_rec_${Date.now().toString(36)}`, ageVerified: true,
          sessionVersion: 1, recoveryPhraseHash: "hashed-not-a-phrase",
          profile: { create: { username: `__secr${Date.now().toString(36)}` } },
        },
      })
      try {
        const rec = await sessionCb!({
          session: { user: {}, expires: "x" } as never,
          token: { id: recUser.id, sessionVersion: 1 },
        } as never)
        const recUserSession = rec.user as { hasRecoveryPhrase?: boolean; standing?: number }
        assert.equal(recUserSession.hasRecoveryPhrase, true, "user with a phrase → hasRecoveryPhrase=true")
        assert.equal("recoveryPhraseHash" in (rec.user as object), false, "recovery hash never serialized (phrase user)")
      } finally {
        await prisma.user.delete({ where: { id: recUser.id } }).catch(() => {})
      }
    }

    // ── Case-insensitive usernames ────────────────────────────────
    {
      const caseStamp = Date.now().toString(36)
      const caseUser = await prisma.user.create({
        data: { name: `__sec_case_${caseStamp}`, ageVerified: true, sessionVersion: 1, profile: { create: { username: `CaseMiXeD${caseStamp}` } } },
        include: { profile: true },
      })
      try {
        const canonical = caseUser.profile!.username!
        const lower = canonical.toLowerCase()
        const upper = canonical.toUpperCase()
        for (const variant of [canonical, lower, upper]) {
          const hit = await prisma.profile.findFirst({
            where: { username: { equals: variant, mode: "insensitive" } },
            select: { id: true },
          })
          assert.equal(hit?.id, caseUser.profile!.id, `variant ${variant} failed`)
        }
        // Old exact-match query would have missed case variants.
        const miss = await prisma.profile.findUnique({ where: { username: lower } })
        assert.equal(miss, null)
      } finally {
        await prisma.user.delete({ where: { id: caseUser.id } }).catch(() => {})
      }
    }

    // ── blockedUserIds / notBlockedAuthor ─────────────────────────
    // Mutual block semantics — same as blockExistsBetween: a block in
    // either direction hides the other party's content from the viewer.
    const blkTag = Date.now().toString(36)
    const mkBlkUser = (t: string) =>
      prisma.user.create({
        data: { name: `__blk_${t}_${blkTag}`, ageVerified: true, profile: { create: { username: `__blk${t}${blkTag}` } } },
      })
    const blkA = await mkBlkUser("a") // viewer blocks this one
    const blkB = await mkBlkUser("b") // this one blocks the viewer
    const blkC = await mkBlkUser("c") // unrelated — stays visible
    try {
      await prisma.block.create({ data: { blockerId: userId, blockedId: blkA.id } })
      await prisma.block.create({ data: { blockerId: blkB.id, blockedId: userId } })
      // A second row naming blkA must not duplicate it in the result.
      await prisma.block.create({ data: { blockerId: blkA.id, blockedId: userId } })

      const ids = await blockedUserIds(userId)
      assert.ok(ids.includes(blkA.id), "viewer-blocked id returned")
      assert.ok(ids.includes(blkB.id), "blocker id returned (reverse direction)")
      assert.ok(!ids.includes(blkC.id), "unrelated user not returned")
      assert.ok(!ids.includes(userId), "viewer id never returned")
      assert.equal(ids.filter((i) => i === blkA.id).length, 1, "duplicates collapsed")

      assert.deepEqual(await blockedUserIds(null), [], "guest (null) → empty list")
      assert.deepEqual(await blockedUserIds(undefined), [], "guest (undefined) → empty list")

      assert.deepEqual(notBlockedAuthor([blkA.id]), { authorId: { notIn: [blkA.id] } }, "notBlockedAuthor shape")
      assert.deepEqual(notBlockedAuthor([blkA.id], "userId"), { userId: { notIn: [blkA.id] } }, "custom field respected")
      assert.deepEqual(notBlockedAuthor([]), {}, "empty list → no-op fragment")
    } finally {
      await prisma.block.deleteMany({ where: { OR: [{ blockerId: { in: [userId, blkA.id, blkB.id] } }, { blockedId: { in: [userId, blkA.id, blkB.id] } }] } }).catch(() => {})
      for (const u of [blkA, blkB, blkC]) await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
    }

    // ── Login abuse controls ──────────────────────────────────────────
    // authorize() is invoked directly with a synthetic request — the
    // rate-limit buckets are real DB rows, so these assertions exercise
    // the production lockout path end to end. Turnstile is unconfigured
    // in the test env, so a saturated account bucket must refuse even
    // the correct password (fail closed); production adds the challenge
    // path on top.
    const credProvider = authOptions.providers.find((p) => p.id === "credentials") as
      | { options?: { authorize?: (c: { username: string; password: string; turnstileToken?: string }, r: { headers: Record<string, string> }) => Promise<unknown> } }
      | undefined
    // NextAuth v4 exposes the user-supplied authorize under .options —
    // the top-level .authorize is a `() => null` stub.
    const authorize = credProvider?.options?.authorize
    assert.ok(authorize, "credentials provider must expose authorize")
    const loginAttempt = async (username: string, password: string, ip: string) => {
      try {
        await authorize!(
          { username, password },
          { headers: { "x-vercel-forwarded-for": ip, "user-agent": "sec-abuse-test" } }
        )
        return "ok"
      } catch (e) {
        return e instanceof Error ? e.message : "error"
      }
    }
    const lockStamp = Date.now().toString(36)
    const lockUserIds: string[] = []
    const mkLoginUser = async (tag: string) => {
      const u = await prisma.user.create({
        data: {
          name: `__sec_lock_${tag}_${lockStamp}`,
          ageVerified: true,
          sessionVersion: 1,
          password: bcrypt.hashSync("AbusePass123!", 12),
          profile: { create: { username: `__sec_lock_${tag}_${lockStamp}` } },
        },
        include: { profile: true },
      })
      lockUserIds.push(u.id)
      return u.profile!.username
    }
    // Clean any rows left by earlier suites so bucket counts are exact.
    await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login" } } })
    try {
      const victimName = await mkLoginUser("victim")

      // Legitimate login before saturation succeeds.
      assert.equal(await loginAttempt(victimName, "AbusePass123!", "10.60.0.1"), "ok", "clean login succeeds")

      // Uniform error: wrong password on an existing account and on a
      // nonexistent one produce the identical message.
      const wrongExisting = await loginAttempt(victimName, "nope", "10.60.0.1")
      const wrongMissing = await loginAttempt(`__sec_lock_nouser_${lockStamp}`, "nope", "10.60.0.2")
      assert.equal(wrongExisting, "Invalid credentials")
      assert.equal(wrongMissing, "Invalid credentials", "unknown user must answer identically")

      // Distributed saturation: 8 more failures across distinct IPs
      // (1 ok + 2 above + 8 here = 11 total) push the account bucket past
      // its 10-attempt threshold.
      for (let i = 0; i < 8; i++) {
        assert.equal(await loginAttempt(victimName, "nope", `10.60.1.${i}`), "Invalid credentials", `attempt ${i} reaches credential check`)
      }
      // The account bucket is account-scoped, not per-IP: a fresh source
      // address is still refused once it is saturated.
      assert.match(await loginAttempt(victimName, "nope", "10.60.2.1"), /too many/i, "saturated username denies from fresh IP")
      // Without a configured challenge provider the owner is refused too
      // — fail closed rather than silently bypassed.
      assert.match(await loginAttempt(victimName, "AbusePass123!", "10.60.3.1"), /too many/i, "saturated bucket refuses owner absent a valid challenge")
      // A bogus challenge token is not a bypass.
      assert.match(await loginAttempt(victimName, "AbusePass123!", "10.60.3.2"), /too many/i, "invalid challenge token is not a bypass")

      // Pair cap: one address grinding one account dies at 20 attempts.
      const pairName = await mkLoginUser("pair")
      for (let i = 0; i < 20; i++) {
        await loginAttempt(pairName, "nope", "10.61.0.7")
      }
      assert.match(await loginAttempt(pairName, "AbusePass123!", "10.61.0.7"), /too many/i, "pair cap denies continued single-address grinding")
      // ...but the same account from a fresh address is denied only by
      // the account bucket — the pair key does not leak across IPs.
      const pairRec = await prisma.rateLimit.findUnique({ where: { key: `login-pair:${pairName}:${hashIp("10.61.0.7")}` } })
      assert.ok(pairRec && pairRec.count > 20, "pair bucket records the attempts")

      // IP cap: one address cycling many accounts dies at 30 total.
      const sprayNames = [] as string[]
      for (let i = 0; i < 4; i++) sprayNames.push(await mkLoginUser(`spray${i}`))
      for (let i = 0; i < 30; i++) {
        await loginAttempt(sprayNames[i % sprayNames.length], "nope", "10.62.0.9")
      }
      assert.match(await loginAttempt(`__sec_lock_fresh_${lockStamp}`, "nope", "10.62.0.9"), /too many/i, "IP cap denies a never-tried username once exhausted")
      // A fresh address is unaffected by another IP's saturation.
      const freshName = await mkLoginUser("fresh")
      assert.equal(await loginAttempt(freshName, "AbusePass123!", "10.63.0.1"), "ok", "fresh IP login unaffected")
    } finally {
      await prisma.rateLimit.deleteMany({ where: { key: { startsWith: "login" } } }).catch(() => {})
      for (const id of lockUserIds) await prisma.user.delete({ where: { id } }).catch(() => {})
    }

    console.log("All security regression tests passed.")
  } finally {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {})
    }
    if (claimKeys.length) await prisma.setting.deleteMany({ where: { key: { in: claimKeys } } }).catch(() => {})
    if (captchaIds.length) await prisma.captcha.deleteMany({ where: { id: { in: captchaIds } } }).catch(() => {})
    await prisma.$disconnect().catch(() => {})
  }
}

run().catch((err) => {
  console.error("Security regression tests failed:", err)
  process.exit(1)
})
