import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { isBanned, isSessionValid, isAdmin, isModerator, isStaff, isSupport, hashIp, getTrustLevel } from "@/lib/security"
import { isValidImageDataUri, storeImage } from "@/lib/blob"
import sharp from "sharp"
import { isTrustedForLinks, containsExternalLink, enforceLinkTrust } from "@/lib/security"
import { safeCallbackUrl, signInHref } from "@/lib/callback-url"
import { ADMIN_ONLY_MOD_ACTIONS } from "@/lib/require-staff"
import { recoveryPhraseUpdateData, newRecoveryPhrase, hashPhrase, verifyPhrase } from "@/lib/recovery"
import { notifyMany } from "@/lib/notify"
import { getSuggestedUsers } from "@/lib/onboarding"

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
      assert.equal(created, 2, "notifyMany should create 2 notifications and drop the self-action")
      const rows = await prisma.notification.findMany({ where: { userId: { in: [userId, otherUser.id] } } })
      assert.equal(rows.length, 2, "exactly 2 notification rows should exist")

      // Preference gate — disabling notifyOnFollow must still suppress.
      await prisma.profile.update({ where: { userId: otherUser.id }, data: { notifyOnFollow: false } })
      const suppressed = await notifyMany([
        { userId: otherUser.id, type: "FOLLOW", title: "t", content: "c", actorId: userId },
      ])
      assert.equal(suppressed, 0, "notifyMany must still honor notification preferences")
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
