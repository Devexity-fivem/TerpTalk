// Stabilization regression tests — covers the fixes from the production
// audit: reversal-cycle ledger integrity, final staff reversals, cron
// claim/dedupe semantics, markdown href sanitization, shared moderation
// guards, and mention dedupe. Uses disposable __test_stab_ users on the
// real database; everything is cleaned up at the end.
// Run: npm run test:stabilization
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import {
  applyReputationAward,
  reverseReputationEvent,
  reverseReputationBySource,
} from "@/lib/reputation"
import { claimTask, markDone, releaseClaim } from "@/lib/cron-claim"
import { sanitizeHref } from "@/lib/markdown"
import { applyAccountActionInTx } from "@/lib/moderation"
import { notifyMentions } from "@/lib/mentions"

// Handles are capped at 20 chars by the mention regex — keep them short.
const SUFFIX = String(Date.now()).slice(-8)
const MEMBER = `__stb_m_${SUFFIX}`
const MOD = `__stb_md_${SUFFIX}`
const ADMIN = `__stb_ad_${SUFFIX}`
const SUPPORT_U = `__stb_sp_${SUFFIX}`

async function ledgerSum(userId: string) {
  const rows = await prisma.reputationEvent.findMany({ where: { userId }, select: { amount: true } })
  return rows.reduce((s, r) => s + r.amount, 0)
}
async function balance(userId: string) {
  const p = await prisma.profile.findUnique({ where: { userId }, select: { reputation: true } })
  return p?.reputation ?? -1
}

async function run() {
  console.log("Starting stabilization regression tests...")
  const ids: string[] = []
  const claimKeys: string[] = []
  try {
    const mk = async (username: string, role: string) => {
      const u = await prisma.user.create({
        data: {
          name: username,
          ageVerified: true,
          sessionVersion: 1,
          role,
          profile: { create: { username } },
        },
      })
      ids.push(u.id)
      return u
    }
    const member = await mk(MEMBER, "MEMBER")
    const member2 = await mk(`${MEMBER}_2`, "MEMBER")
    const mod = await mk(MOD, "MODERATOR")
    const admin = await mk(ADMIN, "ADMINISTRATOR")
    const support = await mk(SUPPORT_U, "SUPPORT")

    // ── 1. Reversal-cycle ledger: no double-deduction ────────────────
    // award(+10 keyed, source POST:x) → unlike (reverse) → re-like
    // (reinstate) → source deleted (reverse by source). Final balance
    // must equal SUM(ledger) and reflect exactly one deduction.
    const srcId = `post_test_${SUFFIX}`
    const key = `like:${member2.id}:post:${srcId}`
    const a1 = await applyReputationAward(member.id, "LIKE_RECEIVED", 10, "t", {
      key, actorId: member2.id, sourceType: "POST", sourceId: srcId,
    })
    assert.equal(a1.awarded, true)
    assert.equal(await balance(member.id), 10)

    const ev = await prisma.reputationEvent.findUnique({ where: { key }, select: { id: true } })
    assert.ok(ev)
    const r1 = await reverseReputationEvent(ev!.id, "unlike", member2.id)
    assert.equal(r1.reversed, true)
    assert.equal(await balance(member.id), 0)

    // Re-like reinstates the original (restore == -sum(counter-entries)).
    const a2 = await applyReputationAward(member.id, "LIKE_RECEIVED", 10, "t", {
      key, actorId: member2.id, sourceType: "POST", sourceId: srcId,
    })
    assert.equal(a2.awarded, true)
    assert.equal(a2.reinstated, true)
    assert.equal(await balance(member.id), 10)

    // Post deleted — must deduct exactly once even though a REINSTATE row
    // shares the sourceType/sourceId.
    const n = await reverseReputationBySource("POST", srcId, "content removed")
    assert.equal(n, 1, "only the root award may be reversed")
    assert.equal(await balance(member.id), 0)
    assert.equal(await ledgerSum(member.id), 0, "balance must equal SUM(ledger)")

    // ── 2. Final staff reversal blocks organic re-trigger ────────────
    const srcId2 = `post_test2_${SUFFIX}`
    const key2 = `like:${member2.id}:post:${srcId2}`
    await applyReputationAward(member.id, "LIKE_RECEIVED", 10, "t", {
      key: key2, actorId: member2.id, sourceType: "POST", sourceId: srcId2,
    })
    const ev2 = await prisma.reputationEvent.findUnique({ where: { key: key2 }, select: { id: true } })
    await reverseReputationEvent(ev2!.id, "staff reversal", mod.id, { final: true })
    assert.equal(await balance(member.id), 0)
    const a3 = await applyReputationAward(member.id, "LIKE_RECEIVED", 10, "t", {
      key: key2, actorId: member2.id, sourceType: "POST", sourceId: srcId2,
    })
    assert.equal(a3.awarded, false)
    assert.equal(a3.skippedReason, "locked", "final reversal must refuse reinstatement")
    assert.equal(await balance(member.id), 0)

    // ── 3. Cron claim semantics ──────────────────────────────────────
    const ck = `__test_cron_${SUFFIX}`
    claimKeys.push(ck)
    assert.equal(await claimTask(ck), true, "first claim wins")
    assert.equal(await claimTask(ck), false, "active claim blocks second claim")
    await releaseClaim(ck)
    assert.equal(await claimTask(ck), true, "released claim can be reclaimed")
    await markDone(ck)
    assert.equal(await claimTask(ck), false, "completed task cannot be reclaimed")

    // Stale running claims are reclaimable.
    const ck2 = `__test_cron_stale_${SUFFIX}`
    claimKeys.push(ck2)
    await prisma.setting.create({ data: { key: ck2, value: `running:${Date.now() - 11 * 60 * 1000}` } })
    assert.equal(await claimTask(ck2), true, "stale claim is reclaimable")
    // …but only once — the swap is conditional on the stale value.
    assert.equal(await claimTask(ck2), false, "fresh claim blocks again")

    // ── 4. sanitizeHref — backslash & protocol-relative bypasses ─────
    assert.equal(sanitizeHref("/forum"), "/forum")
    assert.equal(sanitizeHref("https://example.com"), "https://example.com")
    assert.equal(sanitizeHref("mailto:a@b.c"), "mailto:a@b.c")
    assert.equal(sanitizeHref("/\\evil.com"), null, "backslash pseudo-path must be rejected")
    assert.equal(sanitizeHref("//evil.com"), null, "protocol-relative must be rejected")
    assert.equal(sanitizeHref("\\evil.com"), null)
    assert.equal(sanitizeHref("javascript:alert(1)"), null)
    assert.equal(sanitizeHref("/a\\b"), null, "embedded backslash must be rejected")

    // ── 5. Shared moderation guards ──────────────────────────────────
    const attempt = (p: Parameters<typeof applyAccountActionInTx>[1]) =>
      prisma.$transaction((tx) => applyAccountActionInTx(tx, p)).then(
        () => "ok",
        (e: Error) => e.message
      )
    assert.equal(await attempt({
      actionType: "WARNING", targetUserId: mod.id, reason: "x",
      staffId: mod.id, staffRole: "MODERATOR", staffName: "m",
    }), "FORBIDDEN", "self-target must be blocked")
    assert.equal(await attempt({
      actionType: "WARNING", targetUserId: admin.id, reason: "x",
      staffId: mod.id, staffRole: "MODERATOR", staffName: "m",
    }), "FORBIDDEN", "moderator cannot act on an administrator")
    assert.equal(await attempt({
      actionType: "WARNING", targetUserId: support.id, reason: "x",
      staffId: mod.id, staffRole: "MODERATOR", staffName: "m",
    }), "FORBIDDEN", "moderator cannot warn SUPPORT")
    assert.equal(await attempt({
      actionType: "PERMANENT_BAN", targetUserId: member2.id, reason: "x",
      staffId: mod.id, staffRole: "MODERATOR", staffName: "m",
    }), "FORBIDDEN", "moderator cannot issue bans (admin-only)")
    assert.equal(await attempt({
      actionType: "PERMANENT_BAN", targetUserId: member2.id, reason: "x",
      staffId: support.id, staffRole: "SUPPORT", staffName: "s",
    }), "FORBIDDEN", "SUPPORT cannot issue bans")
    assert.equal(await attempt({
      actionType: "WARNING", targetUserId: member2.id, reason: "x",
      staffId: mod.id, staffRole: "MODERATOR", staffName: "m",
    }), "ok", "moderator warning a member succeeds")

    // ── 6. Mention dedupe ────────────────────────────────────────────
    const link = `/chat#t${SUFFIX}`
    await notifyMentions(`hi @${MEMBER}`, member2.id, "tester", link, "chat")
    await notifyMentions(`again @${MEMBER}`, member2.id, "tester", link, "chat")
    const mentions = await prisma.notification.count({
      where: { userId: member.id, type: "MENTION", link },
    })
    assert.equal(mentions, 1, "same actor+link mention within the window dedupes")

    console.log("All stabilization tests passed.")
  } finally {
    for (const key of claimKeys) await prisma.setting.deleteMany({ where: { key } }).catch(() => {})
    if (ids.length) await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
    await prisma.$disconnect()
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
