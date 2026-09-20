// TerpBot event-driven pipeline regression tests — claim-first dedupe,
// cushion/cap suppression, eligibility gates, self-loop prevention, and the
// dormant-thread scan. Uses disposable __tbp_ users on the real database;
// everything is cleaned up at the end.
// Run: npm run test:terpbot-pipeline
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { claimBotEvent, releaseBotEvent, getBotStats } from "@/lib/terpbot-events"
import {
  botAssist,
  assistWelcome,
  assistFirstDiary,
  notifyOpAcceptedAnswer,
  scanDormantThreads,
  scanStaleDiaries,
} from "@/lib/terpbot-assist"
import { getBotUserId, sanitizeEcho, announceStageTransition, purgeDiaryAnnouncements } from "@/lib/terpbot"
import { runBotCommand } from "@/lib/terpbot-data"
import { buildGrowContext } from "@/lib/terpbot-intel-context"
import { evaluateContext } from "@/lib/terpbot-intel"

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
const setupIds: string[] = []
const chatMessageIds: string[] = []
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

    // ── 10. scanStaleDiaries: eligibility + monthly idempotency ───────
    {
      // m8 is fresh — no prior assists to cushion against.
      const m8 = await mk(`__tbp_h_${SUFFIX}`)
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
      const mkDiary = async (authorId: string, title: string, opts: { stale?: boolean; harvested?: boolean } = {}) => {
        const d = await prisma.growDiary.create({
          data: { title, description: "t", growType: "INDOOR", startDate: sixDaysAgo, authorId, harvested: !!opts.harvested, ...(opts.stale ? { createdAt: sixDaysAgo } : {}) },
        })
        diaryIds.push(d.id)
        if (opts.stale) {
          await prisma.growDiary.update({ where: { id: d.id }, data: { updatedAt: sixDaysAgo } })
        }
        return d
      }

      // Stale, no updates at all → eligible
      const staleOk = await mkDiary(m8.id, `__tbp stale ${SUFFIX}`, { stale: true })
      // Stale diary row, but a fresh update exists → quiet
      const freshUpdate = await mkDiary(m8.id, `__tbp fresh ${SUFFIX}`, { stale: true })
      await prisma.diaryUpdate.create({
        data: { title: "u", content: "u", stage: "VEGETATIVE", diaryId: freshUpdate.id, authorId: m8.id },
      })
      // Harvested → out of scope
      await mkDiary(m8.id, `__tbp harv ${SUFFIX}`, { stale: true, harvested: true })
      // Fresh row → out of scope
      await mkDiary(m8.id, `__tbp ok ${SUFFIX}`)
      // Banned author → excluded
      const bannedDiaryAuthor = await mk(`__tbp_sban_${SUFFIX}`)
      await prisma.user.update({ where: { id: bannedDiaryAuthor.id }, data: { banned: true } })
      await mkDiary(bannedDiaryAuthor.id, `__tbp sban ${SUFFIX}`, { stale: true })

      const monthKey = new Date().toISOString().slice(0, 7)
      botEventKeys.push(`assist:diary-stale:${staleOk.id}:${monthKey}`)
      rateLimitKeys.push(`terpbot:assist:user:${m8.id}`)

      const res = await scanStaleDiaries({ authorIds: [m8.id, bannedDiaryAuthor.id] })
      assert.equal(res.scanned, 2, "only stale non-harvested diaries scanned")
      assert.equal(res.sent, 1, "only the genuinely stale diary nudged")

      const n = await prisma.notification.findFirst({
        where: { userId: m8.id, type: "BOT_ASSIST", link: `/diaries/${staleOk.id}` },
      })
      assert.ok(n, "stale-diary nudge delivered")
      assert.match(n!.title, /waiting for an update/)
      notificationIds.push(n!.id)
      assert.equal(
        await prisma.notification.count({ where: { userId: bannedDiaryAuthor.id } }),
        0, "banned author never nudged"
      )

      const res2 = await scanStaleDiaries({ authorIds: [m8.id, bannedDiaryAuthor.id] })
      assert.equal(res2.sent, 0, "monthly claim key suppresses re-send")
      console.log("✓ scanStaleDiaries eligibility + monthly idempotency")
    }

    // ── 11. Command dispatch: grow/knowledge/community handlers ──────
    {
      const cmd = await mk(`__tbp_cmd_${SUFFIX}`)
      const ctx = (rest = "", args: string[] = []) =>
        ({ userId: cmd.id, role: "MEMBER", displayName: `__tbp_cmd_${SUFFIX}`, args, rest })

      // No-diary member gets the onboarding text, not an error
      const noGrow = await runBotCommand("grow", { userId: m7.id, role: "MEMBER", displayName: M7, args: [], rest: "" })
      assert.ok(noGrow.ok && noGrow.messages[0].includes("don't have a grow diary"), "grow → no-diary guidance")

      const growDiary = await prisma.growDiary.create({
        data: { title: `__tbp grow ${SUFFIX}`, description: "t", growType: "INDOOR", startDate: new Date(), authorId: cmd.id, stage: "FLOWER" },
      })
      diaryIds.push(growDiary.id)
      await prisma.diaryUpdate.create({
        data: { title: "w5", content: "u", stage: "FLOWER", temperature: 77, humidity: 54, ph: 6.1, diaryId: growDiary.id, authorId: cmd.id },
      })
      // A searchable public thread for /related + /ask
      const cat2 = await prisma.category.findFirst({ where: { hidden: false } })
      const gnat = await prisma.thread.create({
        data: { title: `__tbp fungus gnats ${SUFFIX}`, slug: `__tbp-gnat-${SUFFIX}`, content: "x", authorId: cmd.id, categoryId: cat2!.id },
      })
      threadIds.push(gnat.id)

      const r = async (name: string, rest = "", args: string[] = []) => {
        const res = await runBotCommand(name, ctx(rest, args))
        assert.ok(res.ok, `${name} dispatched ok`)
        return res.ok ? res.messages[0] : ""
      }
      assert.match(await r("grow"), /Stage: Flower/, "grow → stage card")
      assert.match(await r("grow"), /Week \d+ · Day \d+/, "grow → week/day")
      assert.match(await r("grows"), new RegExp(`__tbp grow ${SUFFIX}`), "grows → lists diary")
      assert.match(await r("checkin"), /Grow check-in/, "checkin → rule engine")
      assert.match(await r("checkin"), /Updated/, "checkin → recency rule")
      assert.match(await r("growhelp"), /FLOWER|Flower/, "growhelp → stage context")
      assert.match(await r("growhelp"), /fungus gnats|No related discussions/, "growhelp → deterministic routing")
      assert.match(await r("milestones"), /What's next/, "milestones → unified next-step view")
      assert.match(await r("progress"), /rep · Grow Level/, "progress → unified view")
      assert.match(await r("related", "fungus gnats", ["fungus", "gnats"]), /fungus gnats/, "related → finds thread")
      assert.match(await r("ask", "fungus gnats", ["fungus", "gnats"]), /fungus gnats|couldn't find|Try:/i, "ask → result or honest miss")
      assert.match(await r("hot"), /🔥|No /, "hot → bounded engagement list")
      assert.match(await r("new"), /🆕|No /, "new → recent threads")
      assert.match(await r("unanswered"), /❓|No /, "unanswered → public only")
      assert.match(await r("active"), /online|members/i, "active → community snapshot")
      assert.match(await r("weekly"), /week/i, "weekly → real-count summary")

      // mydigest delivers privately via BOT_ASSIST notification
      const md = await r("mydigest")
      assert.match(md, /digest|notifications|enable/i, "mydigest → private delivery or pref guidance")
      const dn = await prisma.notification.findFirst({
        where: { userId: cmd.id, type: "BOT_ASSIST", title: "Your TerpTalk digest" },
      })
      if (dn) {
        assert.equal(dn.actorId, botId, "digest authored by TerpBot")
        notificationIds.push(dn.id)
      }
      console.log("✓ command dispatch: grow/knowledge/community handlers")
    }

    // ── 12. /setup command: owner lookup, search, privacy gates ────────
    {
      const owner = await mk(`__tbp_own_${SUFFIX}`)
      const viewer = await mk(`__tbp_view_${SUFFIX}`)
      const blocker = await mk(`__tbp_blk_${SUFFIX}`)
      const optedOwner = await mk(`__tbp_opt_${SUFFIX}`)
      await prisma.profile.update({ where: { userId: optedOwner.id }, data: { publicMilestoneOptOut: true } })
      const bannedOwner = await mk(`__tbp_sown_${SUFFIX}`)
      await prisma.user.update({ where: { id: bannedOwner.id }, data: { banned: true } })

      const mkSetup = async (authorId: string, data: Record<string, unknown>) => {
        const s = await prisma.growSetup.create({
          data: { title: `__tbp setup ${SUFFIX}`, description: "t", authorId, ...data },
        })
        setupIds.push(s.id)
        return s
      }
      await mkSetup(owner.id, {
        title: `__tbp tent ${SUFFIX}`, slug: `__tbp-tent-${SUFFIX}`,
        tent: "4x4 AC Infinity", lighting: "Mars Hydro TS1000", medium: "coco",
      })
      await mkSetup(owner.id, { title: `__tbp deleted ${SUFFIX}`, tent: "zzdeletedtent", deleted: true })
      await mkSetup(bannedOwner.id, { title: `__tbp banned ${SUFFIX}`, lighting: "zzbannedlight" })
      await mkSetup(owner.id, {
        title: `[x](https://evil.example) __tbp evil ${SUFFIX}`, lighting: "evil.example 1000w",
      })
      await mkSetup(blocker.id, { title: `__tbp blocked ${SUFFIX}`, tent: "zzblockedtent" })
      await mkSetup(optedOwner.id, { title: `__tbp opted ${SUFFIX}` })
      const sNoSlug = await mkSetup(owner.id, { title: `__tbp noslug ${SUFFIX}`, lighting: "zznosluglight" })
      await prisma.block.create({ data: { blockerId: viewer.id, blockedId: blocker.id } })

      const ctx = (userId: string) => (rest = "", args: string[] = []): Parameters<typeof runBotCommand>[1] =>
        ({ userId, role: "MEMBER", displayName: "t", args, rest })
      const res = async (userId: string, rest: string) => {
        const r = await runBotCommand("setup", ctx(userId)(rest, rest ? [rest] : []))
        assert.ok(r.ok, `setup "${rest}" dispatched ok`)
        return r.ok ? r.messages[0] : ""
      }

      // Owner lookup — real member resolves, canonical slug link emitted.
      const own = await res(viewer.id, `@__tbp_own_${SUFFIX}`)
      assert.match(own, new RegExp(`__tbp tent ${SUFFIX}`), "owner lookup returns the setup")
      assert.ok(own.includes(`/setups/__tbp-tent-${SUFFIX}`), "canonical slug link")
      assert.match(own, /@__tbp_own_/, "owner attributed")

      // Self lookup via "me" (from "@terpbot my setup").
      const self = await res(owner.id, "me")
      assert.match(self, new RegExp(`__tbp tent ${SUFFIX}`), "self lookup works")

      // Equipment + tent search hit the stored fields.
      const led = await res(viewer.id, "mars hydro")
      assert.match(led, new RegExp(`__tbp tent ${SUFFIX}`), "lighting search hits")
      const tent = await res(viewer.id, "4x4")
      assert.match(tent, new RegExp(`__tbp tent ${SUFFIX}`), "tent search hits")

      // Deleted setups never surface.
      const del = await res(viewer.id, "zzdeletedtent")
      assert.match(del, /No setups matching/, "deleted setup excluded")
      // Banned author's setups never surface.
      const ban = await res(viewer.id, "zzbannedlight")
      assert.match(ban, /No setups matching/, "banned author excluded")
      // Blocked author's setups filtered for the blocking viewer only.
      const blk = await res(viewer.id, "zzblockedtent")
      assert.match(blk, /No setups matching/, "blocked author filtered for viewer")
      const blkVisible = await res(owner.id, "zzblockedtent")
      assert.match(blkVisible, new RegExp(`__tbp blocked ${SUFFIX}`), "unblocked viewer still sees it")
      // Blocked member via owner lookup resolves like an unknown name.
      const blkLookup = await res(viewer.id, `@__tbp_blk_${SUFFIX}`)
      assert.match(blkLookup, /Couldn't find that member/, "blocked member → couldn't find")
      // Opted-out member via owner lookup also resolves like unknown.
      const optLookup = await res(viewer.id, `@__tbp_opt_${SUFFIX}`)
      assert.match(optLookup, /Couldn't find that member/, "opted-out member → couldn't find")

      // Slug-less setup falls back to the id route.
      const noslug = await res(viewer.id, "zznosluglight")
      assert.ok(noslug.includes(`/setups/${sNoSlug.id}`), "id fallback link when no slug")

      // Sanitization — stored markdown/links can't survive the echo.
      const evil = await res(viewer.id, `__tbp evil ${SUFFIX}`)
      assert.ok(!/evil\.example|\[|\]\(|https?:/.test(evil), `stored markup stripped: ${evil}`)

      // No-result and no-arg paths.
      const none = await res(viewer.id, "zzz-none-zzz")
      assert.match(none, /No setups matching/, "no-result response")
      assert.ok(none.includes("/setups"), "no-result points to /setups")
      const list = await res(viewer.id, "")
      assert.match(list, /Newest grow setups/, "no-arg → newest list")
      assert.ok(!list.includes(`__tbp blocked ${SUFFIX}`), "newest list filters blocked authors")
      assert.ok(!list.includes(`__tbp deleted ${SUFFIX}`), "newest list filters deleted")
      assert.ok(!list.includes(`__tbp banned ${SUFFIX}`), "newest list filters banned authors")
      console.log("✓ /setup command: lookup, search, privacy gates, sanitization")
    }

    // ── 13. announceStageTransition: visibility gates + idempotency ────
    {
      const grower = await mk(`__tbp_stg_${SUFFIX}`)
      const optedGrower = await mk(`__tbp_stgo_${SUFFIX}`)
      await prisma.profile.update({ where: { userId: optedGrower.id }, data: { publicMilestoneOptOut: true } })
      const bannedGrower = await mk(`__tbp_stgb_${SUFFIX}`)
      await prisma.user.update({ where: { id: bannedGrower.id }, data: { banned: true } })

      const general = await prisma.chatRoom.findFirst({
        where: { isPrivate: false },
        orderBy: { createdAt: "asc" },
      })
      assert.ok(general, "a public room exists for announcements")
      rateLimitKeys.push("terpbot:out:global", `terpbot:out:room:${general!.id}`)
      // Earlier suites may have consumed the bot's output budget — reset so
      // a cap hit can't masquerade as a privacy gate.
      await prisma.rateLimit.deleteMany({ where: { key: { in: rateLimitKeys } } }).catch(() => {})
      const since = new Date()
      const msgsFor = async (needle: string) =>
        prisma.chatMessage.findMany({
          where: { roomId: general!.id, authorId: botId, createdAt: { gte: since }, content: { contains: needle } },
          select: { id: true, content: true },
        })

      const mkDiary = async (authorId: string, stage: string, opts: { visibility?: string; deleted?: boolean; slug?: string; title?: string } = {}) => {
        const d = await prisma.growDiary.create({
          data: {
            title: opts.title ?? `__tbp stage ${SUFFIX}`,
            description: "t", growType: "INDOOR", startDate: new Date(),
            authorId, stage, visibility: opts.visibility ?? "PUBLIC",
            deleted: !!opts.deleted, slug: opts.slug,
          },
        })
        diaryIds.push(d.id)
        return d
      }

      // Genuine transition on a PUBLIC diary → one post, claim recorded.
      const d1 = await mkDiary(grower.id, "VEGETATIVE", { slug: `__tbp-stg-${SUFFIX}` })
      const dto = await announceStageTransition(d1.id, "SEEDLING", "VEGETATIVE")
      assert.ok(dto, "PUBLIC transition announces")
      assert.match(dto!.content, new RegExp(`@__tbp_stg_${SUFFIX}`), "grower named")
      assert.ok(dto!.content.includes("Seedling → Vegetative"), "real old→new labels")
      assert.ok(dto!.content.includes(`/diaries/__tbp-stg-${SUFFIX}`), "canonical slug link")
      assert.ok(!dto!.content.includes("@terpbot"), "no self-trigger in output")
      chatMessageIds.push(dto!.id)
      assert.ok(
        await prisma.botEvent.findUnique({ where: { key: `announce:stage:${d1.id}:VEGETATIVE` } }),
        "claim recorded"
      )
      botEventKeys.push(`announce:stage:${d1.id}:VEGETATIVE`)

      // Retry → claim exists, no second post.
      const dup = await announceStageTransition(d1.id, "SEEDLING", "VEGETATIVE")
      assert.equal(dup, null, "same transition cannot announce twice")
      assert.equal((await msgsFor(`__tbp-stg-${SUFFIX}`)).length, 1, "still exactly one post")

      // New stage → new key → announces once more.
      await prisma.growDiary.update({ where: { id: d1.id }, data: { stage: "FLOWER" } })
      const dto2 = await announceStageTransition(d1.id, "VEGETATIVE", "FLOWER")
      assert.ok(dto2, "subsequent transition announces")
      assert.ok(dto2!.content.includes("Vegetative → Flower"), "second transition labels")
      chatMessageIds.push(dto2!.id)
      botEventKeys.push(`announce:stage:${d1.id}:FLOWER`)

      // Stale async state: claimed stage isn't current → silent.
      const stale = await announceStageTransition(d1.id, "FLOWER", "HARVEST")
      assert.equal(stale, null, "stale stage never announces")
      assert.equal(
        await prisma.botEvent.count({ where: { key: `announce:stage:${d1.id}:HARVEST` } }),
        0, "stale attempt leaves no claim"
      )
      assert.equal((await msgsFor(`__tbp-stg-${SUFFIX}`)).length, 2, "no stale post added")

      // Visibility gates — PRIVATE / UNLISTED / deleted / banned / opted-out.
      const dPriv = await mkDiary(grower.id, "FLOWER", { visibility: "PRIVATE", slug: `__tbp-priv-${SUFFIX}` })
      assert.equal(await announceStageTransition(dPriv.id, "VEGETATIVE", "FLOWER"), null, "PRIVATE never announces")
      const dUnl = await mkDiary(grower.id, "FLOWER", { visibility: "UNLISTED", slug: `__tbp-unl-${SUFFIX}` })
      assert.equal(await announceStageTransition(dUnl.id, "VEGETATIVE", "FLOWER"), null, "UNLISTED never announces")
      const dDel = await mkDiary(grower.id, "FLOWER", { deleted: true, slug: `__tbp-del-${SUFFIX}` })
      assert.equal(await announceStageTransition(dDel.id, "VEGETATIVE", "FLOWER"), null, "deleted never announces")
      const dBan = await mkDiary(bannedGrower.id, "FLOWER", { slug: `__tbp-ban-${SUFFIX}` })
      assert.equal(await announceStageTransition(dBan.id, "VEGETATIVE", "FLOWER"), null, "banned author never announces")
      const dOpt = await mkDiary(optedGrower.id, "FLOWER", { slug: `__tbp-opt-${SUFFIX}` })
      assert.equal(await announceStageTransition(dOpt.id, "VEGETATIVE", "FLOWER"), null, "opted-out member never announces")
      for (const [d, s] of [[dPriv, "priv"], [dUnl, "unl"], [dDel, "del"], [dBan, "ban"], [dOpt, "opt"]] as const) {
        assert.equal(
          await prisma.botEvent.count({ where: { key: `announce:stage:${d.id}:FLOWER` } }),
          0, `suppressed transition leaves no claim (${s})`
        )
        assert.equal((await msgsFor(`__tbp-${s}-${SUFFIX}`)).length, 0, `no post (${s})`)
      }

      // Sanitization — attacker-controlled title can't inject markup/links.
      const dEvil = await mkDiary(grower.id, "VEGETATIVE", {
        slug: `__tbp-evilstg-${SUFFIX}`,
        title: `[x](https://evil.example) __tbp evilstg ${SUFFIX}`,
      })
      const dtoE = await announceStageTransition(dEvil.id, "SEEDLING", "VEGETATIVE")
      assert.ok(dtoE, "evil-title diary still announces")
      assert.ok(!/evil\.example|\[|\]\(|https?:/.test(dtoE!.content), `title sanitized: ${dtoE!.content}`)
      chatMessageIds.push(dtoE!.id)
      botEventKeys.push(`announce:stage:${dEvil.id}:VEGETATIVE`)

      // Residue purge — a diary leaving PUBLIC deletes the bot's posts
      // carrying its link (same rule as the notification purge).
      assert.equal((await msgsFor(`__tbp-stg-${SUFFIX}`)).length, 2, "two posts before purge")
      await purgeDiaryAnnouncements(d1)
      assert.equal((await msgsFor(`__tbp-stg-${SUFFIX}`)).length, 0, "purge removes both announce posts")
      assert.equal((await msgsFor(`__tbp-evilstg-${SUFFIX}`)).length, 1, "other diaries' posts untouched")
      console.log("✓ announceStageTransition: visibility gates, idempotency, sanitization, purge")
    }

    // ── 14. sanitizeEcho strips domains/URLs/markup ───────────────────
    {
      const out = sanitizeEcho(`Check [x](https://evil.example) visit evil.example\n@admin`)
      assert.ok(!/https?:|evil\.example|@/.test(out), `sanitizeEcho cleaned: "${out}"`)
      console.log("✓ sanitizeEcho domain stripping")
    }

    // ── 15. getBotStats counts assists ────────────────────────────────
    {
      const stats = await getBotStats()
      assert.ok(stats.assists >= 5, `assists counted in bot stats (got ${stats.assists})`)
      assert.ok(stats.byAssist["first-diary"] >= 1, "per-kind assist breakdown")
      console.log("✓ getBotStats assist metrics")
    }

    // ── 16. Intelligence engine: GrowContext → rules → /checkin ────────
    {
      const intel = await mk(`__tbp_int_${SUFFIX}`)
      const daysAgo = (n: number) => new Date(Date.now() - n * 86400000)
      const diary = await prisma.growDiary.create({
        data: {
          title: `__tbp intel ${SUFFIX}`, description: "t", growType: "INDOOR",
          mediumType: "COCO", lightType: "LED",
          startDate: daysAgo(40), authorId: intel.id, stage: "FLOWER",
        },
      })
      diaryIds.push(diary.id)
      // 4 updates ~5d apart: RH climbing into the flower risk zone, pH
      // drifting out of the coco band, EC rising, and entered VPD running
      // materially below the temp/RH-derived value.
      const upd = [
        { d: 20, temp: 76, rh: 60, vpd: 1.0, ph: 6.0, ec: 1.4, h: 40 },
        { d: 15, temp: 77, rh: 66, vpd: 0.8, ph: 6.2, ec: 1.6, h: 44 },
        { d: 10, temp: 78, rh: 69, vpd: 0.6, ph: 6.6, ec: 1.9, h: 47 },
        { d: 5, temp: 78, rh: 71, vpd: 0.5, ph: 6.9, ec: 2.1, h: 48 },
      ]
      for (const u of upd) {
        await prisma.diaryUpdate.create({
          data: {
            title: `u${u.d}`, content: "x", stage: "FLOWER", diaryId: diary.id, authorId: intel.id,
            createdAt: daysAgo(u.d),
            temperature: u.temp, humidity: u.rh, vpd: u.vpd, ph: u.ph, ec: u.ec, heightCm: u.h,
          },
        })
      }

      const gctx = await buildGrowContext(diary.id, { ownerId: intel.id, scope: "public" })
      assert.ok(gctx, "context builds for a public diary")
      assert.equal(gctx.updateCount, 4, "window holds all 4 updates")
      assert.equal(gctx.diary.stage, "FLOWER")
      assert.equal(gctx.series.temperature.n, 4)
      assert.equal(gctx.series.vpdComputed.n, 4, "VPD derived from temp/RH pairs")
      assert.ok(gctx.series.vpdComputed.latest! > 0.9, `computed VPD sane (${gctx.series.vpdComputed.latest})`)
      assert.equal(gctx.series.humidity.trend, "rising", "RH trend detected from real rows")
      assert.equal(gctx.series.ec.trend, "rising", "EC drift detected")
      assert.ok(gctx.vpdDivergence != null && gctx.vpdDivergence <= -0.3, `entered VPD diverges (${gctx.vpdDivergence})`)
      assert.equal(gctx.stageStartCensored, true, "all-flower window → stage start censored")
      assert.equal(gctx.daysSinceUpdate, 5)
      assert.equal(gctx.envCoverage, 1)
      assert.equal(gctx.missing.length, 0, "all schema metrics recorded")

      const diag = evaluateContext(gctx)
      const byCand = (id: string) => diag.candidates.find((c) => c.id === id)
      const byRule = (id: string) => diag.findings.find((f) => f.ruleId === id)
      assert.equal(byRule("data.vpd-divergence")?.state, "confirmed", "VPD divergence → CONFIRMED finding")
      const risk = byCand("env.moisture-disease-risk")
      assert.ok(risk, "flower RH risk candidate fires")
      assert.equal(risk!.state, "strong", "RH-elevated + rising trend accumulate to STRONG risk")
      assert.equal(byCand("humidity_high")?.state, "strong", "same RH evidence feeds the migrated wizard candidate")
      assert.ok(byCand("ph_lockout"), "pH-out-of-band → lockout candidate")
      assert.ok(byCand("salt_buildup"), "EC drift + pH-out-of-band → salt candidate")
      assert.ok(!byCand("stunted_growth"), "no stall candidate in flower stage")

      // /checkin surfaces the engine through the real command pipeline
      const ci = await runBotCommand("checkin", {
        userId: intel.id, role: "MEMBER", displayName: `__tbp_int_${SUFFIX}`, args: [], rest: "",
      })
      assert.ok(ci.ok, "checkin dispatched")
      const out = ci.messages[0]
      assert.match(out, /Grow check-in/, "existing checkin output intact")
      assert.match(out, /Last update 5 days ago/, "existing recency check intact")
      assert.match(out, /Reading the last 4 updates/, "intelligence header")
      assert.match(out, /Observed: 78°F · 71% RH · pH 6\.9 · EC 2\.1/, "observed = latest logged values")
      assert.match(out, /Calculated: VPD ≈/, "calculated VPD rendered")
      assert.match(out, /leaf temp not logged/, "assumption disclosed")
      assert.match(out, /Worth watching:/, "findings rendered")
      assert.match(out, /Recorded VPD \(0\.5\) differs/, "confirmed divergence surfaced")
      assert.match(out, /Next useful measurement:/, "discriminating measurement suggested")
      assert.ok(out.length <= 1000, `checkin stays inside the chat cap (${out.length})`)

      // Privacy: a PRIVATE diary is invisible to the public-scope context
      // and to room output — but readable in owner scope for private paths.
      const priv = await mk(`__tbp_prv_${SUFFIX}`)
      const pdiary = await prisma.growDiary.create({
        data: { title: `__tbp priv ${SUFFIX}`, description: "t", growType: "INDOOR", startDate: daysAgo(10), authorId: priv.id, stage: "VEGETATIVE", visibility: "PRIVATE" },
      })
      diaryIds.push(pdiary.id)
      await prisma.diaryUpdate.create({
        data: { title: "u", content: "x", stage: "VEGETATIVE", diaryId: pdiary.id, authorId: priv.id, temperature: 75, humidity: 60 },
      })
      assert.equal(
        await buildGrowContext(pdiary.id, { ownerId: priv.id, scope: "public" }),
        null,
        "public scope refuses a PRIVATE diary"
      )
      assert.ok(
        await buildGrowContext(pdiary.id, { ownerId: priv.id, scope: "owner" }),
        "owner scope builds context for private paths"
      )
      const pci = await runBotCommand("checkin", {
        userId: priv.id, role: "MEMBER", displayName: `__tbp_prv_${SUFFIX}`, args: [], rest: "",
      })
      assert.ok(pci.ok && /No active grows/.test(pci.messages[0]), "PRIVATE diary stays out of room checkin")
      assert.ok(!pci.messages[0].includes(`__tbp priv ${SUFFIX}`), "private diary title never echoes")

      // A soft-deleted linked setup is treated as absent — its free text
      // must not leak into capability inference or the context view.
      const delSetup = await prisma.growSetup.create({
        data: { title: `__tbp dsetup ${SUFFIX}`, description: "t", authorId: intel.id, tent: "zzsecrettent", deleted: true },
      })
      setupIds.push(delSetup.id)
      const ddiary = await prisma.growDiary.create({
        data: { title: `__tbp dlink ${SUFFIX}`, description: "t", growType: "INDOOR", startDate: daysAgo(10), authorId: intel.id, stage: "VEGETATIVE", setupId: delSetup.id },
      })
      diaryIds.push(ddiary.id)
      const dctx = await buildGrowContext(ddiary.id, { ownerId: intel.id, scope: "public" })
      assert.ok(dctx, "context still builds with a deleted setup link")
      assert.equal(dctx!.setup.present, false, "soft-deleted setup treated as absent")
      assert.ok(!dctx!.setup.capabilities.length, "deleted setup contributes no capabilities")

      console.log("✓ intelligence engine: context → rules → /checkin")
    }

    console.log("All TerpBot pipeline tests passed.")
  } finally {
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { type: "BOT_ASSIST", userId: { in: ids } } }).catch(() => {})
    await prisma.post.deleteMany({ where: { id: { in: postIds } } }).catch(() => {})
    await prisma.thread.deleteMany({ where: { id: { in: threadIds } } }).catch(() => {})
    await prisma.growDiary.deleteMany({ where: { id: { in: diaryIds } } }).catch(() => {})
    await prisma.growSetup.deleteMany({ where: { id: { in: setupIds } } }).catch(() => {})
    await prisma.chatMessage.deleteMany({ where: { id: { in: chatMessageIds } } }).catch(() => {})
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
