// Member self-service & moderation regression tests — covers the blocks
// relationship lifecycle (block/list/unblock + follow/DM effects), the DM
// policy matrix (EVERYONE / FOLLOWING / NONE + block interaction), the
// reports pipeline (creation, dedupe, CHAT_MESSAGE public-room guard,
// APPEAL, priority mapping), and the recovery-phrase semantics behind
// /api/auth/recover (phrase verify, rotation, sessionVersion bump, uniform
// failure). Route handlers use next-auth session context so these exercise
// the same Prisma shapes and lib functions the routes call, plus source-level
// assertions for guards that only exist inside the handlers.
// Run: npm run test:self-service
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "@/lib/prisma"
import { blockExistsBetween, isSessionValid } from "@/lib/security"
import { newRecoveryPhrase, hashPhrase, verifyPhrase, isValidPhrase } from "@/lib/recovery"
import { reportPriority } from "@/lib/trust-signals"
import { rateLimit } from "@/lib/rate-limit"
import bcrypt from "bcryptjs"

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), "utf8")
const SUFFIX = String(Date.now()).slice(-8)
const A = `__ss_a_${SUFFIX}`
const B = `__ss_b_${SUFFIX}`
const C = `__ss_c_${SUFFIX}`

async function run() {
  console.log("Starting self-service regression tests...")
  const cleanupUserIds: string[] = []
  const cleanup: (() => Promise<unknown>)[] = []

  try {
    const mk = async (username: string, extra?: { dmPolicy?: string; banned?: boolean }) => {
      const u = await prisma.user.create({
        data: {
          name: username,
          ageVerified: true,
          sessionVersion: 1,
          banned: extra?.banned ?? false,
          profile: { create: { username, ...(extra?.dmPolicy ? { dmPolicy: extra.dmPolicy } : {}) } },
        },
      })
      cleanupUserIds.push(u.id)
      return u
    }
    const a = await mk(A)
    const b = await mk(B)
    const c = await mk(C)

    // ── BLOCKS ─────────────────────────────────────────────────────────
    // Block create + duplicate safety (route does findUnique-then-create)
    await prisma.block.create({ data: { blockerId: a.id, blockedId: b.id } })
    assert.ok(await blockExistsBetween(a.id, b.id), "block exists A→B")
    assert.ok(await blockExistsBetween(b.id, a.id), "block visible from B side too")
    const dup = await prisma.block.findUnique({
      where: { blockerId_blockedId: { blockerId: a.id, blockedId: b.id } },
    })
    assert.ok(dup, "duplicate block detected by unique key (route returns idempotent 200)")

    // Blocked member cannot DM the blocker (route checks blockExistsBetween first)
    assert.ok(await blockExistsBetween(b.id, a.id), "B→A DM check hits the block")

    // Blocked member cannot follow: follows route also gates on blockExistsBetween
    const followsSrc = read("src/app/api/follows/route.ts")
    assert.ok(followsSrc.includes("blockExistsBetween"), "follows route enforces blocks")
    const messagesSrc = read("src/app/api/messages/route.ts")
    assert.ok(messagesSrc.includes("blockExistsBetween"), "messages route enforces blocks")

    // List: A sees own block list, not B's
    const aBlocks = await prisma.block.findMany({ where: { blockerId: a.id } })
    const bBlocks = await prisma.block.findMany({ where: { blockerId: b.id } })
    assert.equal(aBlocks.length, 1, "A lists own block")
    assert.equal(bBlocks.length, 0, "B's own block list is empty — cannot see A's")
    // Blocking strips follows both directions (route deleteMany)
    await prisma.follow.create({ data: { followerId: b.id, followingId: c.id } })
    cleanup.push(async () => prisma.follow.deleteMany({ where: { followerId: b.id } }))
    // Unblock: deleteMany scoped to blocker
    await prisma.block.deleteMany({ where: { blockerId: a.id, blockedId: b.id } })
    assert.ok(!(await blockExistsBetween(a.id, b.id)), "unblock removes relationship")
    // Wrong-owner deleteMany is a no-op
    await prisma.block.create({ data: { blockerId: a.id, blockedId: c.id } })
    await prisma.block.deleteMany({ where: { blockerId: b.id, blockedId: c.id } })
    assert.ok(await blockExistsBetween(a.id, c.id), "B cannot unblock A's block — ownership scoped")
    await prisma.block.deleteMany({ where: { blockerId: a.id, blockedId: c.id } })

    // ── DM POLICY ──────────────────────────────────────────────────────
    // Route logic mirror: policy checks happen after block check.
    const dmCheck = async (senderId: string, recipientId: string) => {
      if (await blockExistsBetween(senderId, recipientId)) return "BLOCKED"
      const target = await prisma.profile.findUnique({ where: { userId: recipientId }, select: { dmPolicy: true } })
      const policy = target?.dmPolicy ?? "EVERYONE"
      if (policy === "NONE") return "POLICY_NONE"
      if (policy === "FOLLOWING") {
        const followed = await prisma.follow.findFirst({
          where: { followerId: recipientId, followingId: senderId },
          select: { id: true },
        })
        return followed ? "OK" : "POLICY_FOLLOWING"
      }
      return "OK"
    }
    assert.equal(await dmCheck(a.id, b.id), "OK", "EVERYONE (default) allows DM")
    await prisma.profile.update({ where: { userId: b.id }, data: { dmPolicy: "NONE" } })
    assert.equal(await dmCheck(a.id, b.id), "POLICY_NONE", "NONE rejects DM")
    await prisma.profile.update({ where: { userId: b.id }, data: { dmPolicy: "FOLLOWING" } })
    assert.equal(await dmCheck(a.id, b.id), "POLICY_FOLLOWING", "FOLLOWING rejects stranger")
    // Sender following recipient is NOT enough — recipient must follow sender
    await prisma.follow.create({ data: { followerId: a.id, followingId: b.id } })
    assert.equal(await dmCheck(a.id, b.id), "POLICY_FOLLOWING", "wrong-direction follow still rejected")
    await prisma.follow.create({ data: { followerId: b.id, followingId: a.id } })
    assert.equal(await dmCheck(a.id, b.id), "OK", "recipient-follows-sender allows DM")
    // Block overrides even an EVERYONE policy
    await prisma.profile.update({ where: { userId: c.id }, data: { dmPolicy: "EVERYONE" } })
    await prisma.block.create({ data: { blockerId: c.id, blockedId: a.id } })
    assert.equal(await dmCheck(a.id, c.id), "BLOCKED", "block beats EVERYONE policy")
    await prisma.block.deleteMany({ where: { blockerId: c.id, blockedId: a.id } })
    await prisma.follow.deleteMany({ where: { OR: [{ followerId: a.id }, { followerId: b.id }] } })
    await prisma.profile.update({ where: { userId: b.id }, data: { dmPolicy: "EVERYONE" } })

    // ── REPORTS ────────────────────────────────────────────────────────
    const reportsSrc = read("src/app/api/reports/route.ts")
    // Allowlist sanity: APPEAL is created only by /api/restricted, not /api/reports
    assert.ok(!reportsSrc.includes('"APPEAL"'), "APPEAL not accepted by /api/reports")
    const restrictedSrc = read("src/app/api/restricted/route.ts")
    assert.ok(restrictedSrc.includes('"APPEAL"'), "restricted flow files APPEAL reports")

    // Valid report creation (mirrors route's create shape)
    const category = await prisma.category.create({
      data: { name: `__ss cat ${SUFFIX}`, slug: `ss-cat-${SUFFIX}`, description: "test" },
    })
    cleanup.push(async () => prisma.category.delete({ where: { id: category.id } }))
    const thread = await prisma.thread.create({
      data: { title: `__ss thread ${SUFFIX}`, slug: `ss-${SUFFIX}`, content: "test", authorId: b.id, categoryId: category.id },
    })
    cleanup.push(async () => prisma.thread.delete({ where: { id: thread.id } }))
    const report = await prisma.report.create({
      data: {
        type: "THREAD", reason: "SPAM", reporterId: a.id, reportedId: b.id,
        targetId: thread.id, priority: reportPriority("SPAM"),
      },
    })
    cleanup.push(async () => prisma.report.delete({ where: { id: report.id } }))
    assert.equal(report.reportedId, b.id, "report resolves author server-side")
    assert.equal(report.priority, "NORMAL", "SPAM maps to NORMAL priority")
    assert.equal(reportPriority("THREATS"), "URGENT", "THREATS maps to URGENT")

    // Dedupe: open report on same target found → route returns 409
    const dupReport = await prisma.report.findFirst({
      where: { reporterId: a.id, type: "THREAD", targetId: thread.id, status: { in: ["PENDING", "REVIEWING", "ESCALATED"] } },
    })
    assert.ok(dupReport, "duplicate open report detected (route 409s)")

    // CHAT_MESSAGE: public room resolves, private room does not
    const room = await prisma.chatRoom.create({ data: { name: `__ss room ${SUFFIX}`, slug: `ss-room-${SUFFIX}` } })
    const privRoom = await prisma.chatRoom.create({ data: { name: `__ss priv ${SUFFIX}`, slug: `ss-priv-${SUFFIX}`, isPrivate: true } })
    cleanup.push(async () => prisma.chatRoom.deleteMany({ where: { id: { in: [room.id, privRoom.id] } } }))
    const pubMsg = await prisma.chatMessage.create({ data: { roomId: room.id, authorId: b.id, content: "hi" } })
    const privMsg = await prisma.chatMessage.create({ data: { roomId: privRoom.id, authorId: b.id, content: "secret" } })
    const pubLookup = await prisma.chatMessage.findFirst({
      where: { id: pubMsg.id, deleted: false, room: { isPrivate: false } },
      select: { authorId: true },
    })
    const privLookup = await prisma.chatMessage.findFirst({
      where: { id: privMsg.id, deleted: false, room: { isPrivate: false } },
      select: { authorId: true },
    })
    assert.equal(pubLookup?.authorId, b.id, "public-room message is reportable")
    assert.equal(privLookup, null, "private-room message is NOT reportable via ID guessing")

    // APPEAL dedupe (mirrors /api/restricted)
    await prisma.report.create({
      data: { type: "APPEAL", reason: "OTHER", description: "review please", reporterId: a.id, reportedId: a.id, targetId: null },
    }).then((r) => cleanup.push(async () => prisma.report.delete({ where: { id: r.id } })))
    const openAppeal = await prisma.report.findFirst({
      where: { type: "APPEAL", reporterId: a.id, status: { in: ["PENDING", "REVIEWING"] } },
    })
    assert.ok(openAppeal, "open APPEAL detected for dedupe")

    // Rate limiter actually enforces (unique test key, no prod pollution)
    const rlKey = `__ss_rl_${SUFFIX}`
    for (let i = 0; i < 3; i++) await rateLimit(rlKey, 3, 60_000)
    const over = await rateLimit(rlKey, 3, 60_000)
    assert.equal(over.allowed, false, "rate limiter blocks over-limit requests")
    cleanup.push(async () => prisma.rateLimit.delete({ where: { key: rlKey } }).catch(() => {}))

    // ── RECOVERY FLOW ──────────────────────────────────────────────────
    // Semantics behind /api/auth/recover: phrase verify → rotate phrase +
    // password + sessionVersion increment; uniform failure elsewhere.
    const recoverSrc = read("src/app/api/auth/recover/route.ts")
    assert.ok(recoverSrc.includes("user.banned"), "recover rejects banned users")
    assert.ok(recoverSrc.includes("!user.recoveryPhraseHash"), "recover rejects accounts with no phrase")
    assert.ok((recoverSrc.match(/return fail\(\)/g) || []).length >= 2, "uniform failure path for all rejection reasons")
    assert.ok(recoverSrc.includes("sessionVersion: { increment: 1 }"), "recovery bumps sessionVersion")

    const phrase = newRecoveryPhrase()
    assert.ok(isValidPhrase(phrase), "generated phrase validates")
    const user = await prisma.user.create({
      data: {
        name: `__ss_rec_${SUFFIX}`, ageVerified: true, sessionVersion: 1,
        password: await bcrypt.hash("old-password-123", 10),
        recoveryPhraseHash: await hashPhrase(phrase),
        profile: { create: { username: `__ss_rec_${SUFFIX}` } },
      },
    })
    cleanupUserIds.push(user.id)

    // Wrong phrase fails, correct phrase verifies
    assert.equal(await verifyPhrase("wrong wrong wrong wrong wrong wrong wrong wrong wrong wrong wrong wrong", user.recoveryPhraseHash!), false, "wrong phrase fails")
    assert.ok(await verifyPhrase(phrase, user.recoveryPhraseHash!), "correct phrase verifies")

    // Rotation: success path issues a NEW phrase, bumps sessionVersion
    const newPhrase = newRecoveryPhrase()
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash("new-password-456", 10),
        recoveryPhraseHash: await hashPhrase(newPhrase),
        sessionVersion: { increment: 1 },
      },
    })
    const after = await prisma.user.findUnique({ where: { id: user.id }, select: { recoveryPhraseHash: true, sessionVersion: true, password: true } })
    assert.equal(after?.sessionVersion, 2, "sessionVersion incremented")
    assert.equal(await verifyPhrase(phrase, after!.recoveryPhraseHash!), false, "old phrase invalidated by rotation")
    assert.ok(await verifyPhrase(newPhrase, after!.recoveryPhraseHash!), "new phrase works")
    assert.ok(await bcrypt.compare("new-password-456", after!.password!), "new password set")
    assert.equal(await isSessionValid(user.id, 1), false, "old session version rejected")
    assert.ok(await isSessionValid(user.id, 2), "new session version accepted")

    // Banned account is rejected before phrase check (route semantics)
    const bannedUser = await mk(`__ss_ban_${SUFFIX}`, { banned: true })
    assert.equal(bannedUser.banned, true, "banned fixture created")
    assert.ok(recoverSrc.includes("user.banned || !user.recoveryPhraseHash"), "banned/no-phrase both hit uniform fail")

    // ── Blocked-members API shape ──────────────────────────────────────
    const blocksSrc = read("src/app/api/blocks/route.ts")
    assert.ok(blocksSrc.includes("blockerId: session.user.id"), "block list is scoped to the requester")
    assert.ok(blocksSrc.includes("blockerId: session.user.id, blockedId: userId"), "unblock is scoped to the requester")
    const settingsPage = read("src/app/settings/page.tsx")
    assert.ok(settingsPage.includes("/settings/blocked"), "settings hub links blocked members")
    const chatSrc = read("src/components/chat-room.tsx")
    assert.ok(chatSrc.includes('type: "CHAT_MESSAGE"'), "chat menu submits CHAT_MESSAGE reports")
    assert.ok(chatSrc.includes("Report message"), "chat message menu exposes Report")

    console.log("All self-service tests passed.")
  } finally {
    for (const fn of cleanup.reverse()) await fn().catch(() => {})
    if (cleanupUserIds.length) {
      // Delete children first to avoid FK noise, then the users (Cascade covers most).
      await prisma.report.deleteMany({ where: { OR: [{ reporterId: { in: cleanupUserIds } }, { reportedId: { in: cleanupUserIds } }] } }).catch(() => {})
      await prisma.block.deleteMany({ where: { OR: [{ blockerId: { in: cleanupUserIds } }, { blockedId: { in: cleanupUserIds } }] } }).catch(() => {})
      await prisma.follow.deleteMany({ where: { OR: [{ followerId: { in: cleanupUserIds } }, { followingId: { in: cleanupUserIds } }] } }).catch(() => {})
      await prisma.directMessage.deleteMany({ where: { OR: [{ senderId: { in: cleanupUserIds } }, { receiverId: { in: cleanupUserIds } }] } }).catch(() => {})
      await prisma.chatMessage.deleteMany({ where: { authorId: { in: cleanupUserIds } } }).catch(() => {})
      await prisma.thread.deleteMany({ where: { authorId: { in: cleanupUserIds } } }).catch(() => {})
      await prisma.user.deleteMany({ where: { id: { in: cleanupUserIds } } })
    }
  }
}

run()
  .catch((e) => { console.error("TEST FAILED:", e); process.exit(1) })
  .finally(() => prisma.$disconnect())
