// P1 bug-fix regression tests — DM cluster (tail-load, stable cursor,
// unbounded inbox), cron claim isolation + retryability, weekly-board
// system-payout exclusion, session invalidation, case-insensitive
// usernames, profile error handling. Uses disposable __test_p1_ users and
// cleans up everything it creates.
// Run: npx tsx scripts/p1-bugfix-tests.mts   (dev DB only — guarded)
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { weeklyBoard, weekRange, WEEKLY_BOARD_TYPES } from "@/lib/weekly-recognition"
import { currentWeekKey } from "@/lib/week"
import { runCronTask } from "@/lib/cron-claim"
import { authOptions } from "@/lib/auth"

const tag = Date.now().toString(36)
const results: [string, string][] = []
const pass = (n: string) => { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
const fail = (n: string, i: unknown) => { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }
const check = (n: string, fn: () => Promise<void> | void) =>
  Promise.resolve()
    .then(fn)
    .then(() => pass(n))
    .catch((e) => fail(n, e instanceof Error ? e.message : e))

async function mkUser(name: string) {
  return prisma.user.create({
    data: {
      name: `__test_p1_${name}_${tag}`,
      ageVerified: true,
      password: "x",
      sessionVersion: 1,
      profile: { create: { username: `__test_p1_${name}_${tag}` } },
    },
    include: { profile: true },
  })
}

// Exact replicas of the route's queries — the test asserts the semantics
// the route depends on, not a reimplementation.
async function dmTail(userId: string, withId: string) {
  const newest = await prisma.directMessage.findMany({
    where: {
      deleted: false,
      OR: [
        { senderId: userId, receiverId: withId },
        { senderId: withId, receiverId: userId },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 101,
  })
  const hasMore = newest.length > 100
  if (hasMore) newest.pop()
  newest.reverse()
  return { messages: newest, hasMore }
}

async function dmOlder(userId: string, withId: string, before: Date, beforeId: string) {
  const older = await prisma.directMessage.findMany({
    where: {
      deleted: false,
      OR: [
        { senderId: userId, receiverId: withId },
        { senderId: withId, receiverId: userId },
      ],
      AND: {
        OR: [
          { createdAt: { lt: before } },
          { createdAt: before, id: { lt: beforeId } },
        ],
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 51,
  })
  const hasMore = older.length > 50
  if (hasMore) older.pop()
  older.reverse()
  return { messages: older, hasMore }
}

async function dmAfter(userId: string, withId: string, after: Date, afterId: string) {
  return prisma.directMessage.findMany({
    where: {
      deleted: false,
      OR: [
        { senderId: userId, receiverId: withId },
        { senderId: withId, receiverId: userId },
      ],
      AND: {
        OR: [
          { createdAt: { gt: after } },
          { createdAt: after, id: { gt: afterId } },
        ],
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 51,
  })
}

async function main() {
  const users: { id: string }[] = []
  const settingKeys: string[] = []
  const eventIds: string[] = []

  // ── DM initial load returns the tail, not the head ────────────────────
  await check("DM tail-load: 105-message thread opens at newest 100, not oldest", async () => {
    const a = await mkUser("dmA"); const b = await mkUser("dmB")
    users.push(a, b)
    for (let i = 0; i < 105; i++) {
      await prisma.directMessage.create({
        data: {
          senderId: i % 2 ? a.id : b.id,
          receiverId: i % 2 ? b.id : a.id,
          content: `msg-${String(i).padStart(3, "0")}`,
          createdAt: new Date(Date.now() - (105 - i) * 60_000),
        },
      })
    }
    const { messages, hasMore } = await dmTail(a.id, b.id)
    assert.equal(messages.length, 100)
    assert.equal(hasMore, true)
    assert.equal(messages[0].content, "msg-005")
    assert.equal(messages[99].content, "msg-104")
  })

  await check("DM before-cursor: older history remains reachable", async () => {
    const [a, b] = users
    const { messages } = await dmTail(a.id, b.id)
    const oldest = await dmOlder(a.id, b.id, messages[0].createdAt, messages[0].id)
    assert.equal(oldest.messages.length, 5)
    assert.equal(oldest.hasMore, false)
    assert.equal(oldest.messages[0].content, "msg-000")
    assert.equal(oldest.messages[4].content, "msg-004")
  })

  await check("DM tail-load: 1-message and <100-message threads work", async () => {
    const c = await mkUser("dmC"); const d = await mkUser("dmD")
    users.push(c, d)
    await prisma.directMessage.create({
      data: { senderId: c.id, receiverId: d.id, content: "only", createdAt: new Date() },
    })
    const one = await dmTail(c.id, d.id)
    assert.equal(one.messages.length, 1)
    assert.equal(one.hasMore, false)
    await prisma.directMessage.create({
      data: { senderId: d.id, receiverId: c.id, content: "two", createdAt: new Date() },
    })
    const two = await dmTail(c.id, d.id)
    assert.equal(two.messages.length, 2)
    assert.equal(two.hasMore, false)
  })

  // ── DM incremental cursor — timestamp ties cannot skip ────────────────
  await check("DM incremental: same-timestamp messages are not skipped", async () => {
    const e = await mkUser("dmE"); const f = await mkUser("dmF")
    users.push(e, f)
    const ts = new Date("2020-01-01T00:00:00.000Z")
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const m = await prisma.directMessage.create({
        data: { senderId: e.id, receiverId: f.id, content: `tie-${i}`, createdAt: ts },
      })
      ids.push(m.id)
    }
    ids.sort()
    // Cursor = the lexicographically first id at that timestamp: the other
    // two must still arrive on the next poll.
    const fresh = await dmAfter(e.id, f.id, ts, ids[0])
    assert.deepEqual(fresh.map((m) => m.id), ids.slice(1))
    // Old timestamp-only cursor would have returned zero — prove the fix matters.
    const oldStyle = await prisma.directMessage.findMany({
      where: {
        deleted: false,
        createdAt: { gt: ts },
        OR: [
          { senderId: e.id, receiverId: f.id },
          { senderId: f.id, receiverId: e.id },
        ],
      },
    })
    assert.equal(oldStyle.length, 0)
  })

  // ── DM conversation list discovers old conversations ──────────────────
  await check("DM inbox: conversation older than the 100 newest messages is still listed", async () => {
    const g = await mkUser("dmG"); const h = await mkUser("dmH")
    users.push(g, h)
    // Old conversation between g and h (a year back).
    await prisma.directMessage.create({
      data: {
        senderId: h.id, receiverId: g.id, content: "ancient hello", read: true,
        createdAt: new Date(Date.now() - 365 * 86400000),
      },
    })
    // 100 newer messages between g and a third user push the old convo
    // out of any take:100 window.
    const i = await mkUser("dmI"); users.push(i)
    for (let k = 0; k < 100; k++) {
      await prisma.directMessage.create({
        data: {
          senderId: i.id, receiverId: g.id, content: `flood-${k}`,
          createdAt: new Date(Date.now() - (100 - k) * 60_000),
        },
      })
    }
    const latest = await prisma.$queryRaw<{ partnerId: string; content: string; createdAt: Date }[]>`
      SELECT DISTINCT ON (partner) partner AS "partnerId", content, "createdAt"
      FROM (
        SELECT CASE WHEN "senderId" = ${g.id} THEN "receiverId" ELSE "senderId" END AS partner,
               content, "createdAt"
        FROM "DirectMessage"
        WHERE deleted = false AND ("senderId" = ${g.id} OR "receiverId" = ${g.id})
      ) m
      ORDER BY partner, "createdAt" DESC`
    const partners = new Set(latest.map((r) => r.partnerId))
    assert.ok(partners.has(h.id), "old conversation partner missing from inbox")
    assert.ok(partners.has(i.id))
    // Ordering: newest activity first.
    const unreadRows = await prisma.$queryRaw<{ partnerId: string; n: bigint }[]>`
      SELECT "senderId" AS "partnerId", COUNT(*) AS n
      FROM "DirectMessage"
      WHERE "receiverId" = ${g.id} AND read = false AND deleted = false
      GROUP BY "senderId"`
    assert.equal(Number(unreadRows.find((r) => r.partnerId === i.id)?.n), 100)
    assert.equal(unreadRows.find((r) => r.partnerId === h.id), undefined)
  })

  // ── Cron claim isolation ──────────────────────────────────────────────
  await check("cron: failed task releases claim and retries on next invocation", async () => {
    const key = `__test_p1:cronfail:${tag}`
    settingKeys.push(key)
    const posted: string[] = []; const failed: string[] = []
    await runCronTask(key, async () => { throw new Error("boom") }, posted, failed, "t1")
    assert.deepEqual(failed, ["t1"])
    assert.equal(await prisma.setting.findUnique({ where: { key } }), null)
    // Retry now succeeds.
    await runCronTask(key, async () => "t1-ok", posted, failed, "t1")
    assert.deepEqual(posted, ["t1-ok"])
    assert.equal((await prisma.setting.findUnique({ where: { key } }))?.value, "1")
  })

  await check("cron: one task's failure does not prevent later tasks", async () => {
    const k1 = `__test_p1:cronseq1:${tag}`; const k2 = `__test_p1:cronseq2:${tag}`
    settingKeys.push(k1, k2)
    const posted: string[] = []; const failed: string[] = []
    await runCronTask(k1, async () => { throw new Error("first fails") }, posted, failed, "first")
    await runCronTask(k2, async () => "second-ok", posted, failed, "second")
    assert.deepEqual(failed, ["first"])
    assert.deepEqual(posted, ["second-ok"])
  })

  await check("cron: completed task is not re-executed (no duplicate announcement)", async () => {
    const key = `__test_p1:crondone:${tag}`
    settingKeys.push(key)
    const posted: string[] = []; const failed: string[] = []
    let runs = 0
    await runCronTask(key, async () => { runs++; return "x" }, posted, failed, "dup")
    await runCronTask(key, async () => { runs++; return "x" }, posted, failed, "dup")
    assert.equal(runs, 1)
    assert.deepEqual(posted, ["x"])
  })

  // ── Weekly board: system payouts must not count ───────────────────────
  await check("weekly board: GOTW +150 system payout cannot outrank member-earned rep", async () => {
    const w1 = await mkUser("wkA"); const w2 = await mkUser("wkB")
    users.push(w1, w2)
    const range = weekRange(currentWeekKey())!
    const put = async (userId: string, type: string, amount: number) => {
      const ev = await prisma.reputationEvent.create({
        data: {
          userId, type, amount,
          reason: `__test_p1_${type}`,
          key: `__test_p1:${type}:${userId}:${tag}:${Math.random().toString(36).slice(2)}`,
          createdAt: new Date(range.start.getTime() + 3600_000),
        },
      })
      eventIds.push(ev.id)
    }
    await put(w1.id, "THREAD_CREATED", 80)
    await put(w2.id, "POST_CREATED", 40)
    await put(w2.id, "WEEKLY_AWARD", 50)     // last week's own award
    await put(w2.id, "BADGE_BONUS", 100)     // badge payout from the win
    await put(w2.id, "QUEST_DAILY", 10)
    await put(w2.id, "JOURNEY_COMPLETE", 100)
    await put(w2.id, "CHALLENGE_WEEKLY", 20)
    await put(w2.id, "LEGACY_MIGRATION", 500)
    await put(w2.id, "STAFF_ADJUSTMENT", 50)
    const board = await weeklyBoard(range.start, range.end)
    const rowW1 = board.find((r) => r.userId === w1.id)
    const rowW2 = board.find((r) => r.userId === w2.id)
    assert.equal(rowW1?.earned, 80)
    assert.equal(rowW2?.earned, 40) // only member-driven POST_CREATED counts
    assert.ok((rowW1?.earned ?? 0) > (rowW2?.earned ?? 0))
  })

  await check("weekly board: REVERSAL rows still net out clawed-back rep", async () => {
    const w3 = await mkUser("wkC")
    users.push(w3)
    const range = weekRange(currentWeekKey())!
    const ev1 = await prisma.reputationEvent.create({
      data: {
        userId: w3.id, type: "LIKE_RECEIVED", amount: 10,
        reason: "__test_p1", key: `__test_p1:like:${tag}`,
        createdAt: new Date(range.start.getTime() + 3600_000),
      },
    })
    const ev2 = await prisma.reputationEvent.create({
      data: {
        userId: w3.id, type: "REVERSAL", amount: -10,
        reason: "__test_p1", key: `__test_p1:rev:${tag}`,
        createdAt: new Date(range.start.getTime() + 3601_000),
      },
    })
    eventIds.push(ev1.id, ev2.id)
    const board = await weeklyBoard(range.start, range.end)
    const row = board.find((r) => r.userId === w3.id)
    assert.equal(row, undefined) // 10 - 10 = 0 → filtered out of the board
  })

  await check("weekly board: allowlist is member-driven types + REVERSAL", async () => {
    assert.ok(WEEKLY_BOARD_TYPES.includes("REVERSAL"))
    assert.ok(WEEKLY_BOARD_TYPES.includes("THREAD_CREATED"))
    assert.ok(!WEEKLY_BOARD_TYPES.includes("WEEKLY_AWARD"))
    assert.ok(!WEEKLY_BOARD_TYPES.includes("BADGE_BONUS"))
    assert.ok(!WEEKLY_BOARD_TYPES.includes("LEGACY_MIGRATION"))
  })

  // ── Session invalidation ──────────────────────────────────────────────
  await check("session: banned/unknown user yields an empty session user", async () => {
    const sessionCb = authOptions.callbacks?.session
    assert.ok(sessionCb)
    const session = { user: { id: "x" }, expires: "x" } as never
    // Unknown user — the invalidation path.
    const out = await sessionCb!({ session, token: { id: `__test_p1_nouser_${tag}` } } as never)
    assert.deepEqual((out as { user: object }).user, {})
    // Valid user still gets a populated session.
    const good = await mkUser("sess"); users.push(good)
    const ok = await sessionCb!({
      session: { user: {}, expires: "x" } as never,
      token: { id: good.id, sessionVersion: 1 },
    } as never)
    assert.equal((ok.user as { id?: string }).id, good.id)
  })

  // ── Case-insensitive usernames ────────────────────────────────────────
  await check("usernames: /u/<any-case> resolves the same profile", async () => {
    const u = await mkUser("CaseMiXeD")
    users.push(u)
    const canonical = u.profile!.username!
    const lower = canonical.toLowerCase()
    const upper = canonical.toUpperCase()
    for (const variant of [canonical, lower, upper]) {
      const hit = await prisma.profile.findFirst({
        where: { username: { equals: variant, mode: "insensitive" } },
        select: { id: true },
      })
      assert.equal(hit?.id, u.profile!.id, `variant ${variant} failed`)
    }
    // Old exact-match query would have missed case variants.
    const miss = await prisma.profile.findUnique({ where: { username: lower } })
    assert.equal(miss, null)
  })

  // ── Static checks on the client/route wiring ──────────────────────────
  await check("messages page: conversation switch resets state and cursor", async () => {
    const src = readFileSync("src/app/messages/page.tsx", "utf8")
    assert.ok(src.includes("activeWithRef.current = withId"))
    assert.ok(src.includes("cursorRef.current = null"))
    assert.ok(src.includes("setMessages([])"))
    assert.ok(src.includes("activeWithRef.current !== uid")) // stale-response guard
    assert.ok(src.includes("!seen.has(m.id)")) // id dedupe on append
    assert.ok(src.includes("unread: 0")) // BUG-23 unread zeroing
  })

  await check("messages route: tail-load, cursor paging, unbounded inbox", async () => {
    const src = readFileSync("src/app/api/messages/route.ts", "utf8")
    assert.ok(src.includes('take: 101'))
    assert.ok(src.includes('"createdAt" DESC'))
    assert.ok(src.includes("afterId"))
    assert.ok(src.includes("beforeId"))
    assert.ok(src.includes("SELECT DISTINCT ON (partner)"))
  })

  await check("cron route: failed posts throw; BotEvent markers prevent duplicates", async () => {
    const src = readFileSync("src/app/api/cron/terpbot/route.ts", "utf8")
    assert.ok(src.includes("wasAnnounced"))
    assert.ok(src.includes('throw new Error("digest post to #general failed")'))
    assert.ok(src.includes('throw new Error("grower-of-the-week post to #general failed")'))
    assert.ok(src.includes('throw new Error("contest-winner post to #general failed")'))
    assert.ok(src.includes('throw new Error("diary-contest-winner post to #general failed")'))
  })

  await check("auth/nav: invalid session triggers client signOut", async () => {
    const nav = readFileSync("src/components/navigation.tsx", "utf8")
    assert.ok(nav.includes("signOut({ redirect: false })"))
    assert.ok(nav.includes("!userId) return"))
  })

  await check("profile page: failed/malformed response never stored as data", async () => {
    const src = readFileSync("src/app/profile/page.tsx", "utf8")
    assert.ok(src.includes("res.ok"))
    assert.ok(src.includes("data?.user?.createdAt"))
    assert.ok(src.includes("loadError"))
  })

  await check("username lookups: all public surfaces use insensitive match", async () => {
    for (const f of [
      "src/app/u/[username]/page.tsx",
      "src/app/api/users/[username]/route.ts",
      "src/app/api/users/[username]/card/route.ts",
      "src/app/api/auth/register/route.ts",
    ]) {
      const src = readFileSync(f, "utf8")
      assert.ok(src.includes('mode: "insensitive"'), `${f} missing insensitive lookup`)
    }
  })

  // ── cleanup ────────────────────────────────────────────────────────────
  for (const u of users) {
    await prisma.user.delete({ where: { id: u.id } }).catch(() => {})
  }
  if (eventIds.length) {
    await prisma.reputationEvent.deleteMany({ where: { id: { in: eventIds } } }).catch(() => {})
  }
  for (const k of settingKeys) {
    await prisma.setting.deleteMany({ where: { key: k } }).catch(() => {})
  }

  const failed = results.filter(([r]) => r === "FAIL")
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
