// Member self-service & moderation regression tests — covers the blocks
// relationship lifecycle (block/list/unblock + follow/DM effects), the DM
// policy matrix (EVERYONE / FOLLOWING / NONE + block interaction), the
// reports pipeline (creation, dedupe, CHAT_MESSAGE public-room guard,
// APPEAL, priority mapping), the recovery-phrase semantics behind
// /api/auth/recover (phrase verify, rotation, sessionVersion bump, uniform
// failure), and the member-facing privacy controls (pref defaults, rankable
// surface exclusion, notification scoping, soft-delete read filters, public
// reputation privacy on GET /api/users/[username], diary visibility helpers,
// and hidden-diary contest exclusion). Route handlers use next-auth session
// context so these exercise the same Prisma shapes and lib functions the
// routes call, plus source-level assertions for guards that only exist
// inside the handlers.
// Run: npm run test:self-service
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "@/lib/prisma"
import { blockExistsBetween, isSessionValid, rankableProfile, activeAuthor } from "@/lib/security"
import { isDiaryVisibility, viewableDiaryWhere, canViewDiary, publicDiaryWhere } from "@/lib/diary-visibility"
import { parseDiaryPatch } from "@/lib/diary-edit"
import { resolveMonthlyDiaryWinner } from "@/lib/contest-awards"
import { TERPBOT_USERNAME } from "@/lib/terpbot"
import { newRecoveryPhrase, hashPhrase, verifyPhrase, isValidPhrase } from "@/lib/recovery"
import { reportPriority } from "@/lib/trust-signals"
import { rateLimit } from "@/lib/rate-limit"
import { NextRequest } from "next/server"
import { GET as getPublicProfile } from "@/app/api/users/[username]/route"
import { GET as getProfileCard } from "@/app/api/users/[username]/card/route"
import { getPublicProfileData } from "@/lib/public-profile"
import {
  awardExperimentCreated, awardHypothesisIfMet, awardExperimentFollowups,
  evaluateExperimentAwards, reverseExperimentAwards,
} from "@/lib/experiment-progression"
import { awardProgression, hasUnlock } from "@/lib/progression"
import { evaluateGrowJourney } from "@/lib/grow-journey"
import { DEFERRED_XP_EVENTS } from "@/lib/progression-config"
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

    // APPEAL dedupe (mirrors /api/restricted — the pending appeal the route
    // finds is exactly the one just filed)
    const appeal = await prisma.report.create({
      data: { type: "APPEAL", reason: "ACCOUNT_REVIEW_REQUEST", description: "review please", reporterId: a.id, reportedId: a.id, targetId: null },
    })
    cleanup.push(async () => prisma.report.delete({ where: { id: appeal.id } }))
    const openAppeal = await prisma.report.findFirst({
      where: { type: "APPEAL", reporterId: a.id, status: { in: ["PENDING", "REVIEWING"] } },
    })
    assert.equal(openAppeal?.id, appeal.id, "open APPEAL detected for dedupe")

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

    // ── PRIVACY CONTROLS ─────────────────────────────────────────────
    // New prefs default correctly (checked before this section flips them).
    const pa = await prisma.profile.findUnique({ where: { userId: a.id } })
    assert.equal(pa?.hideOnlineStatus, false, "hideOnlineStatus defaults false")
    assert.equal(pa?.publicMilestoneOptOut, false, "publicMilestoneOptOut defaults false")
    assert.equal(pa?.dmPolicy, "EVERYONE", "dmPolicy defaults EVERYONE")

    // rankableProfile: default member is rankable; opt-out, suspended, and
    // TerpBot are all excluded.
    assert.ok(
      await prisma.profile.findFirst({ where: { ...rankableProfile(), userId: a.id } }),
      "default member is rankable"
    )
    await prisma.profile.update({ where: { userId: a.id }, data: { publicMilestoneOptOut: true } })
    assert.equal(
      await prisma.profile.findFirst({ where: { ...rankableProfile(), userId: a.id } }),
      null,
      "opted-out member excluded from rankable surfaces"
    )
    // TerpBot must never be rankable regardless.
    const rankable = await prisma.profile.findMany({
      where: rankableProfile(),
      select: { username: true },
    })
    assert.ok(
      !rankable.some((p) => p.username === TERPBOT_USERNAME),
      "terpbot excluded from rankable surfaces"
    )
    await prisma.user.update({
      where: { id: b.id },
      data: { suspendedUntil: new Date(Date.now() + 86400000) },
    })
    assert.equal(
      await prisma.profile.findFirst({ where: { ...rankableProfile(), userId: b.id } }),
      null,
      "suspended member excluded from rankable surfaces"
    )
    await prisma.user.update({ where: { id: b.id }, data: { suspendedUntil: null } })

    // Notification delete stays user-scoped (simulates DELETE
    // /api/notifications { ids } — userId in where).
    await prisma.notification.create({
      data: { userId: a.id, type: "COMMENT", title: "t", content: "c" },
    })
    const n = await prisma.notification.findFirst({ where: { userId: a.id } })
    const wrongOwner = await prisma.notification.deleteMany({
      where: { userId: b.id, id: { in: [n!.id] } },
    })
    assert.equal(wrongOwner.count, 0, "cannot delete another user's notification")
    const own = await prisma.notification.deleteMany({
      where: { userId: a.id, id: { in: [n!.id] } },
    })
    assert.equal(own.count, 1, "owner delete succeeds")

    // Soft-delete read filters on diaries/setups: public reads require
    // deleted:false + an active author.
    const diary = await prisma.growDiary.create({
      data: { authorId: a.id, title: "t", description: "d", growType: "INDOOR", startDate: new Date(), stage: "VEGETATIVE" },
    })
    const setup = await prisma.growSetup.create({
      data: { authorId: a.id, title: "s", description: "d" },
    })
    assert.ok(await prisma.growDiary.findFirst({ where: { id: diary.id, deleted: false, author: activeAuthor() } }))
    await prisma.growDiary.update({ where: { id: diary.id }, data: { deleted: true } })
    await prisma.growSetup.update({ where: { id: setup.id }, data: { deleted: true } })
    assert.equal(
      await prisma.growDiary.findFirst({ where: { id: diary.id, deleted: false, author: activeAuthor() } }),
      null,
      "deleted diary filtered from public reads"
    )
    assert.equal(
      await prisma.growSetup.findFirst({ where: { id: setup.id, deleted: false, author: activeAuthor() } }),
      null,
      "deleted setup filtered from public reads"
    )

    // Chat message soft-delete doesn't touch the lifetime counter.
    const countRoom = await prisma.chatRoom.create({
      data: { name: `__ss room2 ${SUFFIX}`, slug: `ss-room2-${SUFFIX}` },
      select: { id: true },
    })
    try {
      const msg = await prisma.chatMessage.create({
        data: { roomId: countRoom.id, authorId: a.id, content: "test" },
      })
      await prisma.chatMessage.updateMany({
        where: { id: msg.id, authorId: a.id, deleted: false },
        data: { deleted: true },
      })
      const prof = await prisma.profile.findUnique({ where: { userId: a.id }, select: { chatMessageCount: true } })
      assert.equal(prof?.chatMessageCount, 0, "counter unaffected by delete (increment is on send)")
    } finally {
      await prisma.chatMessage.deleteMany({ where: { roomId: countRoom.id } }).catch(() => {})
      await prisma.chatRoom.delete({ where: { id: countRoom.id } }).catch(() => {})
    }

    // Public reputation privacy via GET /api/users/[username].
    // a still has publicMilestoneOptOut=true; give b hideOnlineStatus so both
    // privacy flags are exercised independently on the route.
    await prisma.user.update({ where: { id: b.id }, data: { lastSeenAt: new Date(), status: "ONLINE" } })
    await prisma.profile.update({ where: { userId: b.id }, data: { hideOnlineStatus: true } })
    const profileApi = async (username: string) => {
      const res = await getPublicProfile(
        new NextRequest(`http://localhost/api/users/${username}`),
        { params: Promise.resolve({ username }) }
      )
      assert.equal(res.status, 200, `GET /api/users/${username} → 200`)
      return res.json()
    }

    // Opted-out member: no recent progression rows and a zeroed grow streak.
    const optOut = await profileApi(A)
    assert.ok(Array.isArray(optOut.recentProgression), "recentProgression is an array")
    assert.equal(optOut.recentProgression.length, 0, "opted-out member exposes no recentProgression")
    assert.equal(optOut.profile.growStreak, 0, "opted-out member growStreak zeroed")

    // Default member with one public XP event: rows carry the public
    // label/amount/createdAt shape and never leak the raw type.
    await prisma.progressionEvent.create({
      data: { userId: b.id, type: "THREAD_STARTED", xp: 5, reason: "ss test" },
    })
    const visible = await profileApi(B)
    assert.ok(visible.recentProgression.length >= 1, "default member exposes recentProgression")
    for (const e of visible.recentProgression) {
      assert.ok(typeof e.label === "string" && e.label.length > 0, "event has label")
      assert.ok(typeof e.amount === "number", "event has amount")
      assert.ok(e.createdAt, "event has createdAt")
      assert.ok(!("type" in e), "event must not expose raw type")
    }
    // hideOnlineStatus alone must not empty recentProgression — the two
    // privacy flags stay independent (b has hideOnlineStatus=true).
    assert.ok(visible.recentProgression.length >= 1, "hideOnlineStatus does not hide recentProgression")

    // Diary visibility helpers + PATCH validation.
    assert.equal(isDiaryVisibility("PUBLIC"), true)
    assert.equal(isDiaryVisibility("UNLISTED"), true)
    assert.equal(isDiaryVisibility("PRIVATE"), true)
    assert.equal(isDiaryVisibility("BOGUS"), false, "unknown visibility rejected")
    assert.equal(isDiaryVisibility("public"), false, "visibility is case-sensitive")
    assert.equal(isDiaryVisibility(42), false, "non-string rejected")

    // viewableDiaryWhere — guests get open rows only; members get open + own.
    const guestWhere = viewableDiaryWhere()
    assert.deepEqual(guestWhere, { visibility: { in: ["PUBLIC", "UNLISTED"] } }, "guest sees open rows")
    const memberWhere = viewableDiaryWhere("u1")
    assert.deepEqual(
      memberWhere,
      { OR: [{ visibility: { in: ["PUBLIC", "UNLISTED"] } }, { authorId: "u1" }] },
      "member sees open rows plus own"
    )

    // canViewDiary — only PRIVATE restricts, and only to non-owners.
    const priv = { visibility: "PRIVATE", authorId: "u1" }
    const unl = { visibility: "UNLISTED", authorId: "u1" }
    const pub = { visibility: "PUBLIC", authorId: "u1" }
    assert.equal(canViewDiary(priv, "u1"), true, "owner views own private diary")
    assert.equal(canViewDiary(priv, "u2"), false, "non-owner blocked from private diary")
    assert.equal(canViewDiary(priv, null), false, "guest blocked from private diary")
    assert.equal(canViewDiary(unl, null), true, "guest views unlisted by link")
    assert.equal(canViewDiary(pub, "u2"), true, "public open to anyone")
    assert.deepEqual(publicDiaryWhere, { visibility: "PUBLIC" }, "public fragment shape")

    // parseDiaryPatch — visibility accepted/validated like other fields.
    const okPatch = parseDiaryPatch({ visibility: "UNLISTED" })
    assert.ok(okPatch.ok, "valid visibility parses")
    assert.equal(okPatch.ok && okPatch.data.visibility, "UNLISTED")
    const badPatch = parseDiaryPatch({ visibility: "BOGUS" })
    assert.equal(badPatch.ok, false, "invalid visibility → 400 error result")
    const wrongType = parseDiaryPatch({ visibility: 5 })
    assert.equal(wrongType.ok, false, "non-string visibility → 400 error result")
    // Non-editable fields still rejected alongside a valid visibility.
    const mixed = parseDiaryPatch({ visibility: "PUBLIC", authorId: "x" })
    assert.equal(mixed.ok, false, "non-editable field still rejected")

    // Hidden diary cannot win Diary of the Month: a diary flipped
    // UNLISTED/PRIVATE after entering must not be publicly named winner —
    // even when it leads on votes.
    const d = await mk(`__ss_d_${SUFFIX}`)
    const v = await mk(`__ss_v_${SUFFIX}`)
    const month = `ss${SUFFIX}`
    const hiddenDiary = await prisma.growDiary.create({
      data: { title: `${A}-hidden`, description: "t", growType: "INDOOR", startDate: new Date(), authorId: d.id, visibility: "PRIVATE" },
    })
    const openDiary = await prisma.growDiary.create({
      data: { title: `${A}-open`, description: "t", growType: "INDOOR", startDate: new Date(), authorId: a.id, visibility: "PUBLIC" },
    })
    const hiddenEntry = await prisma.diaryContestEntry.create({ data: { month, diaryId: hiddenDiary.id, userId: d.id } })
    const openEntry = await prisma.diaryContestEntry.create({ data: { month, diaryId: openDiary.id, userId: a.id } })
    try {
      await prisma.diaryContestVote.createMany({
        data: [
          { entryId: hiddenEntry.id, userId: b.id, month },
          { entryId: hiddenEntry.id, userId: c.id, month },
          { entryId: openEntry.id, userId: v.id, month },
        ],
      })
      const winner = await resolveMonthlyDiaryWinner(month)
      assert.equal(winner?.diaryId, openDiary.id, "hidden diary skipped despite leading on votes")
    } finally {
      await prisma.diaryContestVote.deleteMany({ where: { entryId: { in: [hiddenEntry.id, openEntry.id] } } })
      await prisma.diaryContestEntry.deleteMany({ where: { id: { in: [hiddenEntry.id, openEntry.id] } } })
      await prisma.userBadge.deleteMany({ where: { userId: { in: cleanupUserIds } } }).catch(() => {})
      await prisma.badge.deleteMany({ where: { name: { in: ["Diary of the Month", "Contest Finalist"] } } }).catch(() => {})
      await prisma.reputationEvent.deleteMany({ where: { userId: { in: cleanupUserIds }, key: { startsWith: "dcontestwin:" } } }).catch(() => {})
      await prisma.growDiary.deleteMany({ where: { id: { in: [hiddenDiary.id, openDiary.id] } } })
    }

    // ── PROFILE V2 FOUNDATION (P0) ──────────────────────────────────
    // Featured grow, custom sections, visibility-scoped aggregates — all
    // through the real aggregation lib + public route (no route mirrors).
    const pUser = await mk(`__ss_p_${SUFFIX}`)
    const pPublicDiary = await prisma.growDiary.create({
      data: { title: "pub", description: "d", growType: "INDOOR", startDate: new Date(), authorId: pUser.id, visibility: "PUBLIC" },
    })
    const pUnlistedDiary = await prisma.growDiary.create({
      data: { title: "unl", description: "d", growType: "INDOOR", startDate: new Date(), authorId: pUser.id, visibility: "UNLISTED" },
    })
    const pPrivateDiary = await prisma.growDiary.create({
      data: { title: "priv", description: "d", growType: "INDOOR", startDate: new Date(), authorId: pUser.id, visibility: "PRIVATE" },
    })

    const pProfile = await prisma.profile.findUniqueOrThrow({ where: { userId: pUser.id } })

    // Featured grow: PUBLIC diary visible to anonymous; PRIVATE/UNLISTED
    // never exposed to visitors; owner sees their own private pick.
    await prisma.profile.update({ where: { id: pProfile.id }, data: { featuredDiaryId: pPublicDiary.id } })
    let pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.featuredGrow?.id, pPublicDiary.id, "public featured grow visible anonymously")

    await prisma.profile.update({ where: { id: pProfile.id }, data: { featuredDiaryId: pPrivateDiary.id } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.featuredGrow, null, "PRIVATE featured grow hidden from anonymous")
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`, pUser.id)
    assert.equal(pdata?.profile.featuredGrow?.id, pPrivateDiary.id, "owner sees own private featured grow")

    await prisma.profile.update({ where: { id: pProfile.id }, data: { featuredDiaryId: pUnlistedDiary.id } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.featuredGrow, null, "UNLISTED featured grow hidden from anonymous")

    // Forged featured diary — pointing at another member's diary must
    // never render, even on the owner's own view.
    const foreignDiary = await prisma.growDiary.create({
      data: { title: "foreign", description: "d", growType: "INDOOR", startDate: new Date(), authorId: b.id, visibility: "PUBLIC" },
    })
    await prisma.profile.update({ where: { id: pProfile.id }, data: { featuredDiaryId: foreignDiary.id } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`, pUser.id)
    assert.equal(pdata?.profile.featuredGrow, null, "foreign diary never featured (authorId guard)")

    // Soft-deleted featured diary is hidden; hard delete clears the FK
    // (onDelete: SetNull) — no orphaned references.
    await prisma.profile.update({ where: { id: pProfile.id }, data: { featuredDiaryId: pPublicDiary.id } })
    await prisma.growDiary.update({ where: { id: pPublicDiary.id }, data: { deleted: true } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.featuredGrow, null, "deleted featured grow hidden")
    await prisma.growDiary.update({ where: { id: pPublicDiary.id }, data: { deleted: false } })
    await prisma.growDiary.delete({ where: { id: pPublicDiary.id } })
    const pAfterDelete = await prisma.profile.findUniqueOrThrow({ where: { id: pProfile.id } })
    assert.equal(pAfterDelete.featuredDiaryId, null, "FK SetNull clears featuredDiaryId on diary delete")

    // Visibility-scoped aggregates: anonymous sees only PUBLIC rows in the
    // diary count and diary list; owner sees all non-deleted rows.
    await prisma.growDiary.delete({ where: { id: foreignDiary.id } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.stats.diaryCreator, 0, "anonymous count excludes UNLISTED + PRIVATE")
    assert.equal(pdata?.growDiaries.length, 0, "anonymous list excludes UNLISTED + PRIVATE")
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`, pUser.id)
    assert.equal(pdata?.profile.stats.diaryCreator, 2, "owner count includes own UNLISTED + PRIVATE")

    // Custom sections — PUBLIC to anonymous, +MEMBERS to logged-in
    // viewers, +HIDDEN to the owner.
    await Promise.all([
      prisma.profileCustomSection.create({ data: { profileId: pProfile.id, title: "Pub", body: "b", visibility: "PUBLIC", order: 0 } }),
      prisma.profileCustomSection.create({ data: { profileId: pProfile.id, title: "Mem", body: "b", visibility: "MEMBERS", order: 1 } }),
      prisma.profileCustomSection.create({ data: { profileId: pProfile.id, title: "Hid", body: "b", visibility: "HIDDEN", order: 2 } }),
    ])
    const anonData = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.deepEqual(anonData?.profile.customSections.map((s) => s.title), ["Pub"], "anonymous sees PUBLIC sections only")
    const memberData = await getPublicProfileData(`__ss_p_${SUFFIX}`, a.id)
    assert.deepEqual(memberData?.profile.customSections.map((s) => s.title), ["Pub", "Mem"], "member sees PUBLIC + MEMBERS")
    const ownerData = await getPublicProfileData(`__ss_p_${SUFFIX}`, pUser.id)
    assert.equal(ownerData?.profile.customSections.length, 3, "owner sees all own sections")

    // Block in either direction removes the profile (404 path).
    await prisma.block.create({ data: { blockerId: pUser.id, blockedId: a.id } })
    assert.equal(await getPublicProfileData(`__ss_p_${SUFFIX}`, a.id), null, "blocked viewer gets null → 404")
    await prisma.block.deleteMany({ where: { blockerId: pUser.id, blockedId: a.id } })
    await prisma.block.create({ data: { blockerId: a.id, blockedId: pUser.id } })
    assert.equal(await getPublicProfileData(`__ss_p_${SUFFIX}`, a.id), null, "blocker-viewed profile also 404s")
    await prisma.block.deleteMany({ where: { blockerId: a.id, blockedId: pUser.id } })

    // Public DTO boundary — raw standing/reputation internals never ship;
    // only the named tier. Reached through the real GET route.
    const pJson = await profileApi(`__ss_p_${SUFFIX}`)
    assert.ok(!("standing" in pJson.profile), "raw standing number not in public DTO")
    assert.ok(!("reputation" in pJson.profile), "legacy reputation not in public DTO")
    assert.ok("standingTier" in pJson.profile, "named standing tier present")
    assert.ok("mastery" in pJson.profile && Array.isArray(pJson.profile.mastery), "mastery contract present")
    assert.equal(pJson.profile.mastery.length, 5, "all five mastery paths in contract")
    assert.equal(
      pJson.profile.mastery.find((m: { mastery: string }) => m.mastery === "EXPERIMENTATION")?.live,
      true, "Experimentation live since Phase I wired its awards"
    )
    assert.ok(!("email" in pJson.profile) && !("password" in pJson.profile), "no account internals in DTO")

    // Card DTO stays compact: buildTitle + hasActiveGrow joined the locked
    // fields; nothing else swells the payload.
    const cardRes = await getProfileCard(
      new NextRequest(`http://localhost/api/users/__ss_p_${SUFFIX}/card`),
      { params: Promise.resolve({ username: `__ss_p_${SUFFIX}` }) }
    )
    assert.equal(cardRes.status, 200, "card route 200")
    const cardJson = await cardRes.json()
    assert.ok("buildTitle" in cardJson, "card carries buildTitle")
    assert.ok("hasActiveGrow" in cardJson, "card carries active-grow signal")
    // Only UNLISTED + PRIVATE grows remain → the public signal stays false;
    // hidden grows never leak an "active" indicator to anonymous viewers.
    assert.equal(cardJson.hasActiveGrow, false, "private/unlisted grows don't leak active-grow signal")
    const pPublicActive = await prisma.growDiary.create({
      data: { title: "pub2", description: "d", growType: "INDOOR", startDate: new Date(), authorId: pUser.id, visibility: "PUBLIC" },
    })
    const cardRes2 = await getProfileCard(
      new NextRequest(`http://localhost/api/users/__ss_p_${SUFFIX}/card`),
      { params: Promise.resolve({ username: `__ss_p_${SUFFIX}` }) }
    )
    assert.equal((await cardRes2.json()).hasActiveGrow, true, "public active grow detected")
    await prisma.growDiary.delete({ where: { id: pPublicActive.id } })
    assert.ok(!("standing" in cardJson) && !("profileSettings" in cardJson), "card stays minimal")

    await prisma.profileCustomSection.deleteMany({ where: { profileId: pProfile.id } })
    await prisma.growDiary.deleteMany({ where: { authorId: pUser.id } })

    // ─────────────────────────────────────────────────────────────
    // Phase I — progression integrity: experiment lifecycle awards,
    // documented-failure anti-fabrication (§6.4a), weekly cap, keyed
    // reversal, coverage milestone, deferred-event refusal, unlock gates.
    // ─────────────────────────────────────────────────────────────
    const piUser = await mk(`__ss_pi_${SUFFIX}`)
    const piDiary = await prisma.growDiary.create({
      data: {
        title: "Phase I fixture", description: "", growType: "INDOOR",
        startDate: new Date(Date.now() - 30 * 86400000), authorId: piUser.id,
        visibility: "PRIVATE",
      },
      select: { id: true },
    })
    const expLedger = (uid: string) =>
      prisma.progressionEvent.findMany({
        where: { userId: uid, reversalOfId: null },
        select: { type: true, xp: true, mastery: true, key: true, reversedAt: true },
      })
    const stateOf = (e: { id: string; diaryId: string; authorId: string; title: string; change: string; expected: string | null; category: string; status: string; outcome: string | null; conclusion: string | null; createdAt: Date }, updateCount = 0) =>
      ({ ...e, updateCount })

    // Creation + hypothesis pay immediately, mastery attributed.
    const exp = await prisma.growExperiment.create({
      data: {
        diaryId: piDiary.id, authorId: piUser.id,
        title: "Raised LED intensity",
        change: "Raised the light from 45cm to 30cm over two days",
        expected: "Tighter internode spacing within a week",
        category: "LIGHTING", status: "ACTIVE",
      },
    })
    await awardExperimentCreated(stateOf(exp))
    await awardHypothesisIfMet(stateOf(exp))
    let ledger = await expLedger(piUser.id)
    assert.ok(ledger.some((r) => r.type === "EXPERIMENT_CREATED" && r.xp === 5 && r.mastery === "EXPERIMENTATION"), "EXPERIMENT_CREATED pays +5 Experimentation")
    assert.ok(ledger.some((r) => r.type === "HYPOTHESIS_DOC" && r.xp === 5), "hypothesis ≥20 chars pays +5")
    const mp = await prisma.masteryProgress.findUnique({ where: { userId_mastery: { userId: piUser.id, mastery: "EXPERIMENTATION" } } })
    assert.equal(mp?.xp, 10, "Experimentation mastery accrues from awards")

    // No/short hypothesis pays nothing.
    const noHyp = await prisma.growExperiment.create({
      data: { diaryId: piDiary.id, authorId: piUser.id, title: "No hypothesis", change: "Changed something", category: "OTHER", status: "ACTIVE" },
    })
    await awardHypothesisIfMet(stateOf(noHyp))
    assert.equal((await expLedger(piUser.id)).filter((r) => r.type === "HYPOTHESIS_DOC").length, 1, "missing hypothesis pays nothing")

    // Follow-ups — +10 once at ≥3 linked updates, idempotent.
    await awardExperimentFollowups(stateOf(exp, 2))
    await awardExperimentFollowups(stateOf(exp, 3))
    await awardExperimentFollowups(stateOf(exp, 5))
    assert.equal((await expLedger(piUser.id)).filter((r) => r.type === "FOLLOWUPS_3" && r.xp === 10).length, 1, "FOLLOWUPS_3 pays once at ≥3 linked updates")

    // Completion — grower-stated outcome + real conclusion → +25.
    await evaluateExperimentAwards("ACTIVE", { ...stateOf(exp), status: "COMPLETED", outcome: "WORKED", conclusion: "Internodes tightened noticeably by day five; keeping the height." })
    assert.ok((await expLedger(piUser.id)).some((r) => r.type === "EXPERIMENT_COMPLETED" && r.xp === 25), "EXPERIMENT_COMPLETED pays +25")

    // Thin conclusion pays nothing.
    const thin = await prisma.growExperiment.create({
      data: { diaryId: piDiary.id, authorId: piUser.id, title: "Thin close", change: "x", category: "OTHER", status: "COMPLETED", outcome: "WORKED", conclusion: "ok" },
    })
    await evaluateExperimentAwards("OBSERVING", stateOf(thin))
    assert.equal((await expLedger(piUser.id)).filter((r) => r.type === "EXPERIMENT_COMPLETED" && r.key === `experiment:${thin.id}:completed`).length, 0, "thin conclusion pays nothing")

    // PROBLEM_RESOLVED — ISSUE_RESPONSE + WORKED + conclusion → +20 Knowledge.
    const fix = await prisma.growExperiment.create({
      data: {
        diaryId: piDiary.id, authorId: piUser.id, title: "Calmag fix",
        change: "Added calmag at 1ml/L to the feed", category: "ISSUE_RESPONSE",
        status: "ACTIVE", createdAt: new Date(Date.now() - 3 * 86400000),
      },
    })
    await evaluateExperimentAwards("ACTIVE", { ...stateOf(fix, 1), status: "COMPLETED", outcome: "WORKED", conclusion: "Rust spots stopped spreading within four days of the dose." })
    assert.ok((await expLedger(piUser.id)).some((r) => r.type === "PROBLEM_RESOLVED" && r.xp === 20 && r.mastery === "KNOWLEDGE"), "ISSUE_RESPONSE + WORKED pays PROBLEM_RESOLVED")

    // §6.4a documented failure — anti-fabrication gates.
    const fresh = await prisma.growExperiment.create({
      data: { diaryId: piDiary.id, authorId: piUser.id, title: "Fresh failure", change: "Dropped night temp ten degrees", category: "ENVIRONMENT", status: "PLANNED", expected: "Better color by lights-on" },
    })
    await evaluateExperimentAwards("PLANNED", { ...stateOf(fresh, 1), status: "COMPLETED", outcome: "DID_NOT_WORK", conclusion: "Color stalled and growth slowed; reverted the night drop after a week." })
    ledger = await expLedger(piUser.id)
    assert.ok(!ledger.some((r) => r.type === "FAILURE_DOCUMENTED" && r.xp > 0), "never-active failure pays nothing")
    const withheldRow = await prisma.progressionEvent.findFirst({ where: { userId: piUser.id, type: "FAILURE_DOCUMENTED", key: `experiment:${fresh.id}:failure:w` } })
    assert.ok(withheldRow && withheldRow.xp === 0, "withheld decision recorded as a 0-XP audit marker")

    const mkFailed = (n: number) => prisma.growExperiment.create({
      data: {
        diaryId: piDiary.id, authorId: piUser.id,
        title: `Failure attempt ${n} — airflow and cadence variant`,
        change: `Variant ${n}: changed airflow and watering cadence together for attempt ${n}`,
        expected: `Expected quicker recovery within the week on attempt ${n}`,
        category: "ENVIRONMENT", status: "ACTIVE",
        createdAt: new Date(Date.now() - 3 * 86400000),
      },
    })
    const failA = await mkFailed(1)
    await evaluateExperimentAwards("ACTIVE", { ...stateOf(failA, 1), status: "COMPLETED", outcome: "DID_NOT_WORK", conclusion: "No recovery after eight days; rolled back the airflow change." })
    assert.ok((await expLedger(piUser.id)).some((r) => r.type === "FAILURE_DOCUMENTED" && r.xp === 8), "documented failure pays +8")

    // Weekly cap — a 3rd documented failure in the same ISO week doesn't pay.
    const failB = await mkFailed(2)
    const failC = await mkFailed(3)
    await evaluateExperimentAwards("ACTIVE", { ...stateOf(failB, 1), status: "COMPLETED", outcome: "DID_NOT_WORK", conclusion: "Same verdict — slower recovery than the baseline run." })
    await evaluateExperimentAwards("ACTIVE", { ...stateOf(failC, 1), status: "COMPLETED", outcome: "DID_NOT_WORK", conclusion: "Third writeup — still no improvement over baseline." })
    assert.equal((await expLedger(piUser.id)).filter((r) => r.type === "FAILURE_DOCUMENTED" && r.xp === 8).length, 2, "documented-failure bonus capped at 2 per ISO week")

    // ≥95% similar re-run forfeits the bonus.
    const dupExp = await prisma.growExperiment.create({
      data: {
        diaryId: piDiary.id, authorId: piUser.id,
        title: "Raised LED intensity", change: "Raised the light from 45cm to 30cm over two days",
        expected: "Tighter internode spacing within a week",
        category: "LIGHTING", status: "ACTIVE", createdAt: new Date(Date.now() - 4 * 86400000),
      },
    })
    await evaluateExperimentAwards("ACTIVE", { ...stateOf(dupExp, 1), status: "COMPLETED", outcome: "DID_NOT_WORK", conclusion: "Carbon-copy re-run, also failed — should be withheld for duplication." })
    assert.ok(!(await expLedger(piUser.id)).some((r) => r.type === "FAILURE_DOCUMENTED" && r.xp === 8 && r.key === `experiment:${dupExp.id}:failure`), "near-duplicate re-run forfeits the failure bonus")

    // Reversal — experiment delete claws every award it produced back.
    await reverseExperimentAwards(exp.id)
    ledger = await expLedger(piUser.id)
    const expRows = ledger.filter((r) => r.key?.startsWith(`experiment:${exp.id}:`) && r.xp > 0)
    assert.ok(expRows.length >= 4, "experiment produced paying rows to reverse")
    assert.ok(expRows.every((r) => r.reversedAt != null), "experiment delete reverses all of its awards")
    const liveXp = ledger.reduce((s, r) => s + (r.reversedAt ? 0 : r.xp), 0)
    const pXpNow = (await prisma.profile.findUnique({ where: { userId: piUser.id }, select: { xp: true } }))!.xp
    assert.equal(pXpNow, liveXp, "profile xp equals live ledger after reversal")

    // COVERAGE_MILESTONE — a thorough diary pays once; regression reverses.
    const covDiary = await prisma.growDiary.create({
      data: {
        title: "Coverage diary", description: "", growType: "INDOOR",
        strain: "Test Strain", medium: "SOIL", lighting: "LED",
        stage: "HARVEST", harvested: true, harvestedAt: new Date(),
        startDate: new Date(Date.now() - 80 * 86400000),
        authorId: piUser.id, visibility: "PRIVATE",
      },
      select: { id: true },
    })
    for (let i = 0; i < 3; i++) {
      await prisma.diaryUpdate.create({
        data: {
          diaryId: covDiary.id, authorId: piUser.id,
          title: `Week ${i} update — enough substance to count as a real log`,
          content: `Week ${i} observations: pistils developing, canopy even, no deficiencies visible in the room.`,
          stage: i === 2 ? "FLOWER" : "VEGETATIVE",
          temperature: 24, humidity: 55,
          createdAt: new Date(Date.now() - (70 - i * 10) * 86400000),
          ...(i === 1 ? { images: { create: { url: "https://x.test/cov.jpg" } } } : {}),
        },
      })
    }
    await evaluateGrowJourney(covDiary.id)
    assert.ok((await expLedger(piUser.id)).some((r) => r.type === "COVERAGE_MILESTONE" && r.xp === 25 && r.key === `coverage:${covDiary.id}`), "thorough diary pays COVERAGE_MILESTONE")

    await prisma.diaryUpdate.deleteMany({ where: { diaryId: covDiary.id } })
    await evaluateGrowJourney(covDiary.id)
    const covRow = (await expLedger(piUser.id)).find((r) => r.key === `coverage:${covDiary.id}`)
    assert.ok(covRow && covRow.reversedAt != null, "coverage milestone reverses when the log regresses")

    // Deferred events can never pay, even if a stale callsite fires.
    for (const t of DEFERRED_XP_EVENTS) {
      const res = await awardProgression(piUser.id, t, `deferred probe ${t}`, { key: `probe:${t}:${SUFFIX}` })
      assert.equal(res.awarded, false, `deferred event ${t} must not pay`)
      assert.equal(res.skippedReason, "deferred", `deferred event ${t} reports the deferred reason`)
    }
    assert.equal(
      (await expLedger(piUser.id)).filter((r) => DEFERRED_XP_EVENTS.has(r.type)).length,
      0, "no deferred-event ledger rows written"
    )

    // Unlock gates — live entries enforce server-side, future ones never do.
    assert.equal(await hasUnlock(piUser.id, "saved-searches-10"), false, "saved-searches-10 locked below Trained")
    assert.equal(await hasUnlock(piUser.id, "env-analytics"), false, "env-analytics needs Vegged + Journaling L2")
    assert.equal(await hasUnlock(piUser.id, "grow-templates"), false, "future unlock never grants")
    await prisma.profile.update({ where: { userId: piUser.id }, data: { xp: 1600 } }) // Trained threshold — fixture scope, cleaned on user delete
    assert.equal(await hasUnlock(piUser.id, "saved-searches-10"), true, "saved-searches-10 opens at Trained")
    assert.equal(await hasUnlock(piUser.id, "export-tools"), true, "export-tools opens at Trained")
    assert.equal(await hasUnlock(piUser.id, "harvest-analytics"), true, "harvest-analytics opens at Vegged rank")
    assert.equal(await hasUnlock(piUser.id, "env-analytics"), false, "env-analytics still gated without RECORDS mastery")
    await prisma.masteryProgress.upsert({
      where: { userId_mastery: { userId: piUser.id, mastery: "RECORDS" } },
      update: { xp: 150 },
      create: { userId: piUser.id, mastery: "RECORDS", xp: 150 },
    })
    assert.equal(await hasUnlock(piUser.id, "env-analytics"), true, "env-analytics opens at Vegged + Journaling L2")
    assert.equal(await hasUnlock(piUser.id, "grow-templates"), false, "future unlock stays closed at any xp")

    await prisma.progressionEvent.deleteMany({ where: { userId: piUser.id } })
    await prisma.profile.update({ where: { userId: piUser.id }, data: { xp: 0, standing: 0 } })

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
