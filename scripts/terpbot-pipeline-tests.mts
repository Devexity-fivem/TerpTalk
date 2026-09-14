// TerpBot event-driven pipeline regression tests — claim-first dedupe,
// cushion/cap suppression, eligibility gates, self-loop prevention, and the
// dormant-thread scan. Uses disposable __tbp_ users on the real database;
// everything is cleaned up at the end.
// Run: npm run test:terpbot-pipeline
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { claimBotEvent, releaseBotEvent, getBotStats } from "@/lib/terpbot-events"
import {
  botAssist,
  assistWelcome,
  assistFirstDiary,
  notifyOpAcceptedAnswer,
  scanDormantThreads,
} from "@/lib/terpbot-assist"
import { getBotUserId, sanitizeEcho } from "@/lib/terpbot"

const SUFFIX = String(Date.now()).slice(-8)
const M1 = `__tbp_a_${SUFFIX}`
const M2 = `__tbp_b_${SUFFIX}`
const M3 = `__tbp_c_${SUFFIX}`
const M4 = `__tbp_d_${SUFFIX}`
const M5 = `__tbp_e_${SUFFIX}`
const M6 = `__tbp_f_${SUFFIX}`
const M7 = `__tbp_g_${SUFFIX}`

const botEventKeys: string[] = []
const notificationIds: string[] = []
const threadIds: string[] = []
const postIds: string[] = []
const diaryIds: string[] = []
const rateLimitKeys: string[] = []

async function run() {
  console.log("Starting TerpBot pipeline regression tests...")
  const ids: string[] = []
  try {
    const mk = async (username: string) => {
      const u = await prisma.user.create({
        data: {
          name: username,
          ageVerified: true,
          sessionVersion: 1,
          role: "MEMBER",
          profile: { create: { username } },
        },
      })
      ids.push(u.id)
      return u
    }
    const m1 = await mk(M1)
    const m2 = await mk(M2)
    const m3 = await mk(M3)
    const m4 = await mk(M4)
    const m5 = await mk(M5)
    const m6 = await mk(M6)
    const m7 = await mk(M7)
    const botId = await getBotUserId()

    // ── 1. claimBotEvent: sequential + concurrent dedupe ─────────────
    {
      const key = `test:claim:${SUFFIX}`
      botEventKeys.push(key)
      assert.equal(await claimBotEvent({ type: "ASSIST", key, command: "test" }), true)
      assert.equal(await claimBotEvent({ type: "ASSIST", key, command: "test" }), false)
      const k2 = `test:claim2:${SUFFIX}`
      botEventKeys.push(k2)
      const results = await Promise.all(
        Array.from({ length: 5 }, () => claimBotEvent({ type: "ASSIST", key: k2 }))
      )
      assert.equal(results.filter(Boolean).length, 1, "concurrent claims: exactly one winner")
      assert.equal(
        await prisma.botEvent.count({ where: { key: k2 } }), 1, "one BotEvent row per key"
      )
      await releaseBotEvent(k2)
      assert.equal(await prisma.botEvent.count({ where: { key: k2 } }), 0, "release removes claim")
      await claimBotEvent({ type: "ASSIST", key: k2 })
      console.log("✓ claimBotEvent dedupe + release")
    }

    // ── 2. botAssist happy path: notification + ASSIST event ─────────
    {
      const key = `assist:test:${m1.id}:${SUFFIX}`
      botEventKeys.push(key)
      rateLimitKeys.push(`terpbot:assist:user:${m1.id}`)
      const r = await botAssist({
        key,
        kind: "test",
        userId: m1.id,
        title: "Test assist",
        content: "Hello",
        link: "/guides",
        noCushion: true,
      })
      assert.equal(r, "sent")
      const n = await prisma.notification.findFirst({ where: { userId: m1.id, type: "BOT_ASSIST" } })
      assert.ok(n, "BOT_ASSIST notification created")
      assert.equal(n!.actorId, botId, "notification authored by TerpBot")
      assert.equal(n!.link, "/guides")
      notificationIds.push(n!.id)
      assert.ok(await prisma.botEvent.findUnique({ where: { key } }), "ASSIST BotEvent recorded")

      // Duplicate same key → skipped, no second notification
      const r2 = await botAssist({ key, kind: "test", userId: m1.id, title: "x", content: "y", noCushion: true })
      assert.equal(r2, "skipped", "same key cannot deliver twice")
      assert.equal(
        await prisma.notification.count({ where: { userId: m1.id, type: "BOT_ASSIST" } }),
        1, "still exactly one notification"
      )
      console.log("✓ botAssist delivery + once-ever key")
    }

    // ── 3. Cushion: cross-kind 7-day suppression; noCushion bypass ───
    {
      rateLimitKeys.push(`terpbot:assist:user:${m2.id}`)
      const kA = `assist:cushion-a:${m2.id}:${SUFFIX}`
      const kB = `assist:cushion-b:${m2.id}:${SUFFIX}`
      botEventKeys.push(kA, kB)
      const rA = await botAssist({ key: kA, kind: "a", userId: m2.id, title: "t", content: "c" })
      assert.equal(rA, "sent")
      const rB = await botAssist({ key: kB, kind: "b", userId: m2.id, title: "t", content: "c" })
      assert.equal(rB, "skipped", "cushion suppresses second assist within 7d")
      assert.equal(await prisma.botEvent.count({ where: { key: kB } }), 0, "cushioned assist does NOT burn its claim")

      const rC = await botAssist({ key: `assist:cushion-c:${m2.id}:${SUFFIX}`, kind: "c", userId: m2.id, title: "t", content: "c", noCushion: true })
      botEventKeys.push(`assist:cushion-c:${m2.id}:${SUFFIX}`)
      assert.equal(rC, "sent", "noCushion bypasses the cushion")
      console.log("✓ cushion window + noCushion bypass")
    }

    // ── 4. Eligibility: banned / suspended / self / pref-off ─────────
    {
      await prisma.user.update({ where: { id: m3.id }, data: { banned: true } })
      const rB = await botAssist({ key: `assist:banned:${SUFFIX}`, kind: "x", userId: m3.id, title: "t", content: "c" })
      assert.equal(rB, "skipped", "banned user never assisted")
      assert.equal(await prisma.botEvent.count({ where: { key: `assist:banned:${SUFFIX}` } }), 0)

      await prisma.user.update({ where: { id: m3.id }, data: { banned: false, suspendedUntil: new Date(Date.now() + 86400000) } })
      const rS = await botAssist({ key: `assist:susp:${SUFFIX}`, kind: "x", userId: m3.id, title: "t", content: "c" })
      assert.equal(rS, "skipped", "suspended user never assisted")
      await prisma.user.update({ where: { id: m3.id }, data: { suspendedUntil: new Date(Date.now() - 1000) } })

      const rSelf = await botAssist({ key: `assist:self:${SUFFIX}`, kind: "x", userId: botId, title: "t", content: "c" })
      assert.equal(rSelf, "skipped", "bot never assists itself")
      assert.equal(
        await prisma.notification.count({ where: { userId: botId, type: "BOT_ASSIST" } }),
        0, "bot gets no assist notifications"
      )

      // Pref off → claimed (once-ever kept) but nothing delivered
      await prisma.profile.update({ where: { userId: m3.id }, data: { notifyOnBotAssist: false } })
      const kP = `assist:pref:${m3.id}:${SUFFIX}`
      botEventKeys.push(kP)
      rateLimitKeys.push(`terpbot:assist:user:${m3.id}`)
      const rP = await botAssist({ key: kP, kind: "x", userId: m3.id, title: "t", content: "c" })
      assert.equal(rP, "claimed", "pref-off keeps the claim without delivering")
      assert.equal(await prisma.notification.count({ where: { userId: m3.id, type: "BOT_ASSIST" } }), 0)
      await prisma.profile.update({ where: { userId: m3.id }, data: { notifyOnBotAssist: true } })
      console.log("✓ eligibility: banned / suspended / self / pref-off")
    }

    // ── 5. Per-user daily cap ─────────────────────────────────────────
    {
      rateLimitKeys.push(`terpbot:assist:user:${m4.id}`)
      for (let i = 0; i < 3; i++) {
        const k = `assist:cap:${i}:${m4.id}:${SUFFIX}`
        botEventKeys.push(k)
        const r = await botAssist({ key: k, kind: `cap${i}`, userId: m4.id, title: "t", content: "c", noCushion: true })
        assert.equal(r, "sent", `assist ${i} within daily cap`)
      }
      const kOver = `assist:cap:3:${m4.id}:${SUFFIX}`
      const rOver = await botAssist({ key: kOver, kind: "cap3", userId: m4.id, title: "t", content: "c", noCushion: true })
      assert.equal(rOver, "skipped", "4th assist in a day capped")
      assert.equal(await prisma.botEvent.count({ where: { key: kOver } }), 0)
      console.log("✓ per-user daily cap")
    }

    // ── 6. assistWelcome: once-ever, noCushion ────────────────────────
    {
      botEventKeys.push(`assist:welcome:${m1.id}`)
      const r1 = await assistWelcome(m1.id)
      assert.equal(r1, "sent")
      const r2 = await assistWelcome(m1.id)
      assert.equal(r2, "skipped", "welcome fires once ever")
      const n = await prisma.notification.findFirst({ where: { userId: m1.id, link: "/welcome" } })
      assert.ok(n, "welcome links /welcome")
      notificationIds.push(n!.id)
      console.log("✓ assistWelcome")
    }

    // ── 7. assistFirstDiary: only on genuinely first diary ────────────
    {
      // m6 is untouched — earlier members already carry assists/caps
      const r0 = await assistFirstDiary(m6.id, "nonexistent")
      assert.equal(r0, "skipped", "no diary → no assist")
      assert.equal(await prisma.botEvent.count({ where: { key: `assist:first-diary:${m6.id}` } }), 0)

      const d1 = await prisma.growDiary.create({
        data: { title: "t", description: "t", growType: "INDOOR", startDate: new Date(), authorId: m6.id },
      })
      diaryIds.push(d1.id)
      botEventKeys.push(`assist:first-diary:${m6.id}`)
      const r1 = await assistFirstDiary(m6.id, d1.id)
      assert.equal(r1, "sent", "first diary triggers assist")
      const d2 = await prisma.growDiary.create({
        data: { title: "t2", description: "t", growType: "INDOOR", startDate: new Date(), authorId: m6.id },
      })
      diaryIds.push(d2.id)
      const r2 = await assistFirstDiary(m6.id, d2.id)
      assert.equal(r2, "skipped", "second diary does not assist")
      console.log("✓ assistFirstDiary")
    }

    // ── 8. notifyOpAcceptedAnswer: once per post, ACCEPTED_ANSWER type ─
    {
      const cat = await prisma.category.findFirst({ where: { hidden: false } }) ??
        await prisma.category.create({
          data: { name: `__tbp_cat_${SUFFIX}`, slug: `__tbp-cat-${SUFFIX}`, order: 999, description: "t" },
        })
      const thread = await prisma.thread.create({
        data: { title: `__tbp_t_${SUFFIX}`, slug: `__tbp-t-${SUFFIX}`, content: "x", authorId: m1.id, categoryId: cat.id },
      })
      threadIds.push(thread.id)
      const post = await prisma.post.create({
        data: { content: "answer", threadId: thread.id, authorId: m2.id },
      })
      postIds.push(post.id)
      botEventKeys.push(`assist:accept-op:${post.id}`)

      await notifyOpAcceptedAnswer({ opUserId: m1.id, threadSlug: thread.slug, threadTitle: thread.title, postId: post.id })
      const n = await prisma.notification.findFirst({
        where: { userId: m1.id, type: "ACCEPTED_ANSWER" },
        orderBy: { createdAt: "desc" },
      })
      assert.ok(n, "OP notified of accepted answer")
      assert.equal(n!.actorId, botId, "OP notice authored by TerpBot")
      notificationIds.push(n!.id)

      await notifyOpAcceptedAnswer({ opUserId: m1.id, threadSlug: thread.slug, threadTitle: thread.title, postId: post.id })
      assert.equal(
        await prisma.notification.count({ where: { userId: m1.id, type: "ACCEPTED_ANSWER" } }),
        1, "re-accept cycle cannot re-ping the OP"
      )
      console.log("✓ notifyOpAcceptedAnswer")
    }

    // ── 9. scanDormantThreads: eligibility + idempotency ─────────────
    {
      const cat = await prisma.category.findFirst({ where: { hidden: false } }) ??
        await prisma.category.create({
          data: { name: `__tbp_cat2_${SUFFIX}`, slug: `__tbp-cat2-${SUFFIX}`, order: 999, description: "t" },
        })
      const hiddenCat = await prisma.category.create({
        data: { name: `__tbp_hid_${SUFFIX}`, slug: `__tbp-hid-${SUFFIX}`, order: 999, hidden: true, description: "t" },
      })
      const nineDaysAgo = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000)

      const mkThread = async (authorId: string, slug: string, categoryId: string, opts: { deleted?: boolean; backdate?: boolean } = {}) => {
        const t = await prisma.thread.create({
          data: { title: `__tbp_${slug}`, slug: `__tbp-${slug}-${SUFFIX}`, content: "x", authorId, categoryId, deleted: !!opts.deleted },
        })
        threadIds.push(t.id)
        if (opts.backdate !== false) {
          await prisma.thread.update({ where: { id: t.id }, data: { createdAt: nineDaysAgo, lastActivityAt: nineDaysAgo } })
        }
        return t
      }

      // Eligible: 9d old, 0 replies, public category, active author.
      // m5 is fresh — m4 already exhausted its daily assist cap above.
      const dormantOk = await mkThread(m5.id, "dok", cat.id)
      // Fresh thread (not dormant yet)
      await mkThread(m5.id, "fresh", cat.id, { backdate: false })
      // Deleted
      await mkThread(m5.id, "del", cat.id, { deleted: true })
      // Hidden category
      await mkThread(m5.id, "hid", hiddenCat.id)
      // Old, has replies, no accepted answer, stale activity → unresolved.
      // Different author — the cross-kind cushion suppresses a second assist
      // to the same user within one scan.
      const unresolvedOk = await mkThread(m7.id, "unr", cat.id)
      const reply = await prisma.post.create({ data: { content: "r", threadId: unresolvedOk.id, authorId: m1.id } })
      postIds.push(reply.id)
      await prisma.thread.update({ where: { id: unresolvedOk.id }, data: { replyCount: 1, lastActivityAt: nineDaysAgo } })

      // Banned author's thread is excluded
      const bannedAuthor = await mk(`__tbp_ban_${SUFFIX}`)
      await prisma.user.update({ where: { id: bannedAuthor.id }, data: { banned: true } })
      await mkThread(bannedAuthor.id, "ban", cat.id)

      botEventKeys.push(`assist:dormant:${dormantOk.id}`, `assist:unresolved:${unresolvedOk.id}`)
      const res = await scanDormantThreads({ authorIds: [m5.id, m7.id, bannedAuthor.id] })
      assert.equal(res.dormant, 1, "exactly one dormant nudge")
      assert.equal(res.unresolved, 1, "exactly one unresolved nudge")

      const dormN = await prisma.notification.findFirst({
        where: { userId: m5.id, type: "BOT_ASSIST", link: `/forum/thread/${dormantOk.slug}` },
      })
      assert.ok(dormN, "dormant nudge delivered to OP")
      assert.match(dormN!.title, /No replies yet/)
      notificationIds.push(dormN!.id)
      const unrN = await prisma.notification.findFirst({
        where: { userId: m7.id, type: "BOT_ASSIST", link: `/forum/thread/${unresolvedOk.slug}` },
      })
      assert.ok(unrN, "unresolved nudge delivered to OP")
      assert.match(unrN!.title, /solve it/)
      notificationIds.push(unrN!.id)
      assert.equal(
        await prisma.notification.count({ where: { userId: bannedAuthor.id } }),
        0, "banned author never nudged"
      )

      // Re-run: claims exist → zero additional deliveries
      const res2 = await scanDormantThreads({ authorIds: [m5.id, m7.id, bannedAuthor.id] })
      assert.equal(res2.dormant, 0, "second scan sends nothing")
      assert.equal(res2.unresolved, 0, "second scan sends nothing")
      console.log("✓ scanDormantThreads eligibility + idempotency")
    }

    // ── 10. sanitizeEcho strips domains/URLs/markup ───────────────────
    {
      const out = sanitizeEcho(`Check [x](https://evil.example) visit evil.example\n@admin`)
      assert.ok(!/https?:|evil\.example|@/.test(out), `sanitizeEcho cleaned: "${out}"`)
      console.log("✓ sanitizeEcho domain stripping")
    }

    // ── 11. getBotStats counts assists ────────────────────────────────
    {
      const stats = await getBotStats()
      assert.ok(stats.assists >= 5, `assists counted in bot stats (got ${stats.assists})`)
      assert.ok(stats.byAssist["first-diary"] >= 1, "per-kind assist breakdown")
      console.log("✓ getBotStats assist metrics")
    }

    console.log("All TerpBot pipeline tests passed.")
  } finally {
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { type: "BOT_ASSIST", userId: { in: ids } } }).catch(() => {})
    await prisma.post.deleteMany({ where: { id: { in: postIds } } }).catch(() => {})
    await prisma.thread.deleteMany({ where: { id: { in: threadIds } } }).catch(() => {})
    await prisma.growDiary.deleteMany({ where: { id: { in: diaryIds } } }).catch(() => {})
    await prisma.botEvent.deleteMany({ where: { key: { in: botEventKeys } } }).catch(() => {})
    await prisma.botEvent.deleteMany({ where: { key: { startsWith: "assist:" }, userId: { in: ids } } }).catch(() => {})
    await prisma.rateLimit.deleteMany({ where: { key: { in: rateLimitKeys } } }).catch(() => {})
    await prisma.category.deleteMany({ where: { slug: { startsWith: `__tbp-` } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: ids } } }).catch(() => {})
    await prisma.$disconnect()
  }
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
