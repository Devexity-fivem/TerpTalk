import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { isBanned, isSessionValid, isAdmin, isModerator, isStaff, isSupport, hashIp, getTrustLevel } from "@/lib/security"
import { isValidImageDataUri, storeImage } from "@/lib/blob"
import sharp from "sharp"
import { isTrustedForLinks, containsExternalLink, enforceLinkTrust } from "@/lib/security"
import { safeCallbackUrl, signInHref } from "@/lib/callback-url"
import { ADMIN_ONLY_MOD_ACTIONS } from "@/lib/require-staff"

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
    assert.equal(safeCallbackUrl(null), null)
    assert.equal(safeCallbackUrl(""), null)
    assert.equal(safeCallbackUrl("not-a-path"), null, "bare strings without a leading slash must be rejected")
    assert.equal(
      signInHref("/forum"),
      `/auth/signin?callbackUrl=${encodeURIComponent("/forum")}`,
      "sign-in href should carry the callback"
    )
    assert.equal(signInHref("https://evil.example"), "/auth/signin", "unsafe callback falls back to plain sign-in")

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
