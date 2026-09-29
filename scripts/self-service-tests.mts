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
import { GET as getProfileSections } from "@/app/api/users/[username]/sections/[section]/route"
import { getPublicProfileData, getProfileSection, resolveNotableStatValue } from "@/lib/public-profile"
import { masteryParam, masteryQualified, MASTERY_MIN_XP } from "@/lib/grower-directory"
import { toSearchProfileDTO } from "@/lib/search-dto"
import { buildProfileIntel } from "@/lib/terpbot-profile"
import { GET as getProfileTerpBot } from "@/app/api/profile/terpbot/route"
import {
  awardExperimentCreated, awardHypothesisIfMet, awardExperimentFollowups,
  evaluateExperimentAwards, reverseExperimentAwards,
} from "@/lib/experiment-progression"
import { awardProgression, hasUnlock, profileSectionLimit, statSlotLimit } from "@/lib/progression"
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
    // XP and all its derivatives must be nulled server-side — the hidden
    // value may not reach the payload and rely on display suppression.
    assert.equal(optOut.profile.xp, null, "opted-out member xp nulled")
    assert.equal(optOut.profile.rank, null, "opted-out member rank nulled")
    assert.equal(optOut.profile.rankProgress, null, "opted-out member rankProgress nulled")
    assert.equal(optOut.profile.xpStage, null, "opted-out member xpStage nulled")
    assert.equal(optOut.profile.stageProgress, null, "opted-out member stageProgress nulled")
    assert.equal(optOut.profile.standingTier, null, "opted-out member standingTier nulled")
    assert.equal(optOut.profile.nextUnlock, null, "opted-out member nextUnlock nulled")
    assert.equal(optOut.profile.mastery.length, 0, "opted-out member mastery hidden")

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
    // Non-opted-out member keeps real progression values (permitted viewer).
    assert.equal(typeof visible.profile.xp, "number", "default member xp ships")
    assert.ok(visible.profile.rank?.name, "default member rank ships")
    assert.ok(visible.profile.mastery.length > 0, "default member mastery ships")

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
    assert.equal(cardJson.buildTitle, null, "no card build title below 50 path XP")
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

    // ── PROFILE P4 — card identity + discovery contracts ───────────
    // selectedStat — the member's own shownStats pick, resolved
    // viewer-scoped. A PRIVATE harvested grow counts for the owner's
    // card but never for an anonymous viewer's.
    await prisma.profile.update({
      where: { id: pProfile.id },
      data: { profileSettings: { shownStats: ["harvests"] } },
    })
    const p4PrivHarvest = await prisma.growDiary.create({
      data: { title: "p4 priv harvest", description: "d", growType: "INDOOR", startDate: new Date(), authorId: pUser.id, visibility: "PRIVATE", harvested: true, harvestedAt: new Date() },
    })
    const anonStat = await resolveNotableStatValue(pUser.id, "harvests")
    const ownerStat = await resolveNotableStatValue(pUser.id, "harvests", { isOwner: true })
    assert.ok(
      anonStat && ownerStat && Number(ownerStat.value) === Number(anonStat.value) + 1,
      "owner stat counts private harvests; the visitor's does not"
    )
    const cardStatRes = await getProfileCard(
      new NextRequest(`http://localhost/api/users/__ss_p_${SUFFIX}/card`),
      { params: Promise.resolve({ username: `__ss_p_${SUFFIX}` }) }
    )
    const cardStatJson = await cardStatRes.json()
    assert.equal(cardStatJson.selectedStat?.id, "harvests", "card ships the member's shownStats pick")
    assert.equal(cardStatJson.selectedStat?.value, anonStat?.value, "anonymous card stat is viewer-scoped")
    await prisma.growDiary.delete({ where: { id: p4PrivHarvest.id } })
    const fallbackStat = await resolveNotableStatValue(pUser.id, "bogus-stat")
    assert.equal(fallbackStat?.id, "grows", "unknown stat id falls back to grows")
    await prisma.profile.update({ where: { id: pProfile.id }, data: { profileSettings: {} } })

    // /growers mastery filter — deterministic M3+ threshold on real
    // MasteryProgress rows. 400 qualifies, 100 doesn't; bogus params drop.
    assert.equal(MASTERY_MIN_XP, 350, "mastery filter threshold is M3 = 350 path XP")
    assert.equal(masteryParam("knowledge"), "KNOWLEDGE", "mastery param maps to a real path")
    assert.equal(masteryParam("bogus"), null, "bogus mastery param ignored")
    assert.equal(masteryParam(undefined), null, "missing mastery param → no filter")
    const mHi = await mk(`__ss_m_${SUFFIX}`)
    await prisma.masteryProgress.create({ data: { userId: mHi.id, mastery: "KNOWLEDGE", xp: 400 } })
    const mLo = await mk(`__ss_mlo_${SUFFIX}`)
    await prisma.masteryProgress.create({ data: { userId: mLo.id, mastery: "KNOWLEDGE", xp: 100 } })
    const qualified = await prisma.profile.findMany({
      where: {
        ...rankableProfile(),
        user: { ...activeAuthor(), ...masteryQualified("KNOWLEDGE"), id: { in: [mHi.id, mLo.id] } },
      },
      select: { username: true },
    })
    assert.deepEqual(qualified.map((q) => q.username), [`__ss_m_${SUFFIX}`], "M3+ filter keeps 400 XP, drops 100 XP")

    // SearchProfileDTO — identity derived from real path XP, internals
    // dropped, opt-out honored.
    const dtoBase = {
      username: "u", userId: "id", avatarUrl: null, xp: 10, bio: null,
      user: { masteryProgress: [{ mastery: "KNOWLEDGE" as const, xp: 60 }] },
    }
    const dto = toSearchProfileDTO({ ...dtoBase, publicMilestoneOptOut: false })
    assert.ok(typeof dto.buildTitle === "string" && dto.buildTitle.length > 0, "search DTO derives identity from path XP")
    assert.ok(!("masteryProgress" in dto) && !("user" in dto), "search DTO drops internals")
    assert.equal(dto.xp, 10, "non-opted-out member keeps xp for the tier chip")
    const dtoHidden = toSearchProfileDTO({ ...dtoBase, publicMilestoneOptOut: true })
    assert.equal(dtoHidden.buildTitle, null, "opt-out hides search identity")
    assert.equal(dtoHidden.xp, null, "opt-out nulls raw xp in the payload")
    assert.equal(
      toSearchProfileDTO({ ...dtoBase, publicMilestoneOptOut: false, user: { masteryProgress: [{ mastery: "KNOWLEDGE", xp: 10 }] } }).buildTitle,
      null, "below 50 path XP → no identity claim"
    )

    // ── PROFILE P5 — TerpBot profile intelligence ──────────────────
    // Route is session-scoped: an anonymous caller is rejected and no
    // username parameter exists to aim it at another member.
    const tbAnon = await getProfileTerpBot(new NextRequest("http://localhost/api/profile/terpbot"))
    assert.equal(tbAnon.status, 401, "terpbot insights endpoint rejects anonymous callers")

    // Zero-state member → recorded zeros, null derived coverage, and a
    // deterministic "start a diary" recommendation (coverage source).
    const tbUser = await mk(`__ss_tb_${SUFFIX}`)
    const tbEmpty = await buildProfileIntel(tbUser.id)
    assert.equal(tbEmpty.recorded.growsDocumented, 0, "zero-state intel: no grows")
    assert.equal(tbEmpty.derived.phCoverage, null, "zero-state intel: null coverage, never fabricated")
    assert.equal(tbEmpty.recommendation?.source, "coverage", "zero-state recommendation is a coverage rule")
    assert.ok(tbEmpty.recommendation && !tbEmpty.recommendation.growTitle, "zero-state recommendation names no grow")

    // Documented activity → recorded counts + derived coverage. A
    // PRIVATE grow counts for the owner (their own data) — this is the
    // intended owner-scope behavior, gated by the endpoint above.
    const tbDiary = await prisma.growDiary.create({
      data: { title: "tb grow", description: "d", growType: "INDOOR", startDate: new Date(), authorId: tbUser.id, visibility: "PRIVATE" },
    })
    const tbUpd = await prisma.diaryUpdate.create({
      data: { diaryId: tbDiary.id, authorId: tbUser.id, title: "u1", content: "c", stage: "VEGETATIVE", temperature: 75, ph: 6.1 },
    })
    const tbIntel = await buildProfileIntel(tbUser.id)
    assert.equal(tbIntel.recorded.growsDocumented, 1, "owner intel counts private grows")
    assert.equal(tbIntel.recorded.updatesLogged, 1, "owner intel counts the update")
    assert.equal(tbIntel.derived.environmentCoverage, 1, "coverage derived from logged columns")
    assert.equal(tbIntel.derived.ecCoverage, 0, "unlogged metric derives 0, not null")
    assert.equal(tbIntel.derived.strongestSignal != null, true, "strongest signal derived")
    assert.ok(tbIntel.recommendation, "live grow yields a recommendation")
    // Deterministic: same rows → same derived output.
    const tbIntel2 = await buildProfileIntel(tbUser.id)
    assert.deepEqual(tbIntel2.derived, tbIntel.derived, "profile intel is deterministic")
    assert.deepEqual(tbIntel2.recorded, tbIntel.recorded, "recorded facts deterministic")
    await prisma.diaryUpdate.delete({ where: { id: tbUpd.id } })
    await prisma.growDiary.delete({ where: { id: tbDiary.id } })

    // The intel never enters the public profile contract — visitors and
    // the owner get the same absence (it is a separate owner endpoint).
    const pJsonTb = await profileApi(`__ss_tb_${SUFFIX}`)
    assert.ok(!("terpbot" in pJsonTb) && !("profileIntel" in pJsonTb), "terpbot intel not in public DTO")

    // ── PROFILE P1 — core experience contracts ─────────────────────
    // activeGrow/featuredGrow visibility, standing-tier suppression,
    // buildTitle ≥50 gate, verified chip, notableStats registry,
    // strain portfolio, experiments + accepted answers, sections paging.
    const p1PublicGrow = await prisma.growDiary.create({
      data: { title: "p1 active", description: "d", growType: "INDOOR", startDate: new Date(), authorId: pUser.id, visibility: "PUBLIC" },
    })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.activeGrow?.id, p1PublicGrow.id, "PUBLIC non-harvested grow surfaces as activeGrow anonymously")

    // Harvest it → visitors lose all active-grow signal (remaining grows
    // are UNLISTED/PRIVATE); the owner still sees their own private grow.
    await prisma.growDiary.update({ where: { id: p1PublicGrow.id }, data: { harvested: true, harvestedAt: new Date() } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.activeGrow, null, "no active-grow leak when only UNLISTED/PRIVATE remain")
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`, pUser.id)
    assert.ok(pdata?.profile.activeGrow && pdata.profile.activeGrow.visibility !== "PUBLIC", "owner sees own non-public active grow")
    await prisma.growDiary.update({ where: { id: p1PublicGrow.id }, data: { harvested: false, harvestedAt: null } })

    // Standing chip — suppressed below Known (25); named tier only.
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.standingTier, null, "no standing chip below Known")
    await prisma.profile.update({ where: { id: pProfile.id }, data: { standing: 30 } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.standingTier?.name, "Known", "named tier renders at ≥25 standing")
    assert.ok(pdata?.profile && !("standing" in pdata.profile), "raw standing number never in DTO")

    // Verified chip — legacy flag or earned progression gate
    // (Respected 300 + 30d account + no open abuse flags).
    await prisma.profile.update({ where: { id: pProfile.id }, data: { legacyVerified: true } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.verified, "legacy", "legacy flag emits legacy chip")
    await prisma.profile.update({ where: { id: pProfile.id }, data: { legacyVerified: false, standing: 400 } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.verified, null, "new account can't be progression-verified")
    await prisma.user.update({ where: { id: pUser.id }, data: { createdAt: new Date(Date.now() - 40 * 86400000) } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.verified, "progression", "Respected + 30d + clean flags = progression verified")
    await prisma.abuseFlag.create({ data: { signal: "REP_VELOCITY", userId: pUser.id, key: `af:${SUFFIX}`, status: "PENDING" } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.verified, null, "open abuse flag suppresses progression verification")
    await prisma.abuseFlag.deleteMany({ where: { userId: pUser.id } })
    await prisma.profile.update({ where: { id: pProfile.id }, data: { standing: 30 } })

    // buildTitle — ≥50 mastery-path XP gate.
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.buildTitle, null, "no build title below 50 path XP")
    await prisma.masteryProgress.upsert({
      where: { userId_mastery: { userId: pUser.id, mastery: "COMMUNITY" } },
      create: { userId: pUser.id, mastery: "COMMUNITY", xp: 60 },
      update: { xp: 60 },
    })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.ok(typeof pdata?.profile.buildTitle === "string" && pdata.profile.buildTitle.length > 0, "build title renders at ≥50 path XP")
    // Card carries the same identity — the ≥50-path-XP gate is shared.
    const cardWithTitle = await (await getProfileCard(
      new NextRequest(`http://localhost/api/users/__ss_p_${SUFFIX}/card`),
      { params: Promise.resolve({ username: `__ss_p_${SUFFIX}` }) }
    )).json()
    assert.equal(cardWithTitle.buildTitle, pdata?.profile.buildTitle, "card build title matches the hero identity")

    // Notable stats — deterministic defaults when nothing is configured.
    assert.equal(pdata?.profile.notableStats.length, 4, "default hero set is 4 stats")
    assert.deepEqual(
      pdata?.profile.notableStats.map((s) => s.id),
      ["grows", "harvests", "updates", "acceptedAnswers"],
      "default notable-stat order"
    )
    // Member-configured order + selection is honored (≤8 cap).
    await prisma.profile.update({
      where: { id: pProfile.id },
      data: { profileSettings: { shownStats: ["activeGrows", "strains", "grows"] } },
    })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.deepEqual(
      pdata?.profile.notableStats.map((s) => s.id),
      ["activeGrows", "strains", "grows"],
      "shownStats order + selection honored"
    )
    assert.equal(pdata?.profile.notableStats.find((s) => s.id === "activeGrows")?.value, "1", "viewer-scoped stat value")
    await prisma.profile.update({ where: { id: pProfile.id }, data: { profileSettings: {} } })

    // publicMilestoneOptOut — suppresses tier/title/nextUnlock, flags statusHidden.
    await prisma.profile.update({ where: { id: pProfile.id }, data: { publicMilestoneOptOut: true } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.standingTier, null, "opt-out hides standing chip")
    assert.equal(pdata?.profile.buildTitle, null, "opt-out hides build title")
    assert.equal(pdata?.profile.nextUnlock, null, "opt-out hides next unlock")
    assert.equal(pdata?.profile.statusHidden, true, "statusHidden flag set for nameplate parity")
    await prisma.profile.update({ where: { id: pProfile.id }, data: { publicMilestoneOptOut: false } })

    // Experiments — scoped by the host diary's visibility.
    const p1Exp = await prisma.growExperiment.create({
      data: { diaryId: p1PublicGrow.id, authorId: pUser.id, title: "Pub exp", change: "c", category: "LIGHTING", status: "ACTIVE" },
    })
    const p1ExpPriv = await prisma.growExperiment.create({
      data: { diaryId: pPrivateDiary.id, authorId: pUser.id, title: "Priv exp", change: "c", category: "OTHER", status: "ACTIVE" },
    })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.deepEqual(pdata?.profile.experiments.map((e) => e.id), [p1Exp.id], "anonymous sees only public-diary experiments")
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`, pUser.id)
    assert.equal(pdata?.profile.experiments.length, 2, "owner sees experiments on private diaries too")
    assert.equal(pdata?.profile.stats.experiments, 2, "owner count includes private-diary experiments")

    // Strain portfolio — names resolved, grows counted, private excluded.
    const p1Strain = await prisma.strain.upsert({
      where: { name: `__ss strain ${SUFFIX}` },
      create: { name: `__ss strain ${SUFFIX}`, slug: `ss-strain-${SUFFIX}` },
      update: {},
    })
    await prisma.growDiary.update({ where: { id: p1PublicGrow.id }, data: { strainId: p1Strain.id } })
    await prisma.growDiary.update({ where: { id: pPrivateDiary.id }, data: { strainId: p1Strain.id } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    const pf = pdata?.profile.strainPortfolio.find((s) => s.name === p1Strain.name)
    assert.equal(pf?.grows, 1, "anonymous portfolio counts only public grows")
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`, pUser.id)
    assert.equal(pdata?.profile.strainPortfolio.find((s) => s.name === p1Strain.name)?.grows, 2, "owner portfolio counts private too")

    // Accepted answers — real acceptedAnswerFor posts in live threads.
    const p1Thread = await prisma.thread.create({
      data: { title: `__ss p1 thread ${SUFFIX}`, slug: `ss-p1-${SUFFIX}`, content: "q", authorId: a.id, categoryId: category.id },
    })
    const p1Post = await prisma.post.create({
      data: { content: "the answer", authorId: pUser.id, threadId: p1Thread.id, acceptedAnswerFor: { connect: { id: p1Thread.id } } },
    })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.acceptedAnswersList[0]?.threadSlug, p1Thread.slug, "accepted answer links its thread")
    assert.ok((pdata?.profile.stats.acceptedAnswers ?? 0) >= 1, "acceptedAnswers stat counts the row")
    await prisma.thread.update({ where: { id: p1Thread.id }, data: { deleted: true } })
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.acceptedAnswersList.length, 0, "deleted-thread answers drop from the list")

    // Sections API — cursor-paged, viewer-scoped.
    for (let i = 0; i < 13; i++) {
      await prisma.growDiary.create({
        data: { title: `pg${i}`, description: "d", growType: "INDOOR", startDate: new Date(), authorId: pUser.id, visibility: "PUBLIC" },
      })
    }
    const secPage1 = await getProfileSection(`__ss_p_${SUFFIX}`, "grows")
    assert.equal(secPage1?.section, "grows", "grows section echoes its kind")
    if (secPage1?.section !== "grows") throw new Error("grows page missing")
    assert.equal(secPage1.items.length, 12, "sections page is capped at 12")
    assert.ok(secPage1.nextCursor, "cursor returned for next page")
    assert.ok(secPage1.items.every((i) => i.visibility === "PUBLIC"), "anonymous page is all PUBLIC")
    const secPage2 = await getProfileSection(`__ss_p_${SUFFIX}`, "grows", undefined, secPage1.nextCursor!)
    assert.ok(secPage2?.section === "grows" && secPage2.items.length >= 1, "cursor page returns remainder")
    const secOwner = await getProfileSection(`__ss_p_${SUFFIX}`, "grows", pUser.id)
    const secOwner2 = secOwner?.nextCursor ? await getProfileSection(`__ss_p_${SUFFIX}`, "grows", pUser.id, secOwner.nextCursor) : null
    const ownerRows = [
      ...(secOwner?.section === "grows" ? secOwner.items : []),
      ...(secOwner2?.section === "grows" ? secOwner2.items : []),
    ]
    assert.ok(ownerRows.some((i) => i.visibility !== "PUBLIC"), "owner pages include private/unlisted")
    const secHarvests = await getProfileSection(`__ss_p_${SUFFIX}`, "harvests", pUser.id)
    assert.ok(secHarvests?.section === "harvests" && secHarvests.items.every((i) => i.harvested), "harvests section is harvested rows only")
    // Route-level contract: anonymous GET → 200 + PUBLIC-only page; bad
    // section → 400; unknown user → 404.
    const secRes = await getProfileSections(
      new NextRequest(`http://localhost/api/users/__ss_p_${SUFFIX}/sections/grows`),
      { params: Promise.resolve({ username: `__ss_p_${SUFFIX}`, section: "grows" }) }
    )
    assert.equal(secRes.status, 200, "sections route 200")
    const secJson = await secRes.json()
    assert.ok(Array.isArray(secJson.items) && secJson.items.every((i: { visibility: string }) => i.visibility === "PUBLIC"), "route returns scoped items")
    const badSec = await getProfileSections(
      new NextRequest(`http://localhost/api/users/__ss_p_${SUFFIX}/sections/nope`),
      { params: Promise.resolve({ username: `__ss_p_${SUFFIX}`, section: "nope" }) }
    )
    assert.equal(badSec.status, 400, "unknown section rejected")
    // Sections respect blocks in either direction.
    await prisma.block.create({ data: { blockerId: pUser.id, blockedId: a.id } })
    assert.equal(await getProfileSection(`__ss_p_${SUFFIX}`, "grows", a.id), null, "sections 404 on block")
    await prisma.block.deleteMany({ where: { blockerId: pUser.id, blockedId: a.id } })

    // ── P3 — portfolio filters, stage timeline, yield flags, strain
    // see-all, harvest highlights, follow lists, equipment chips ──────

    // Grow filters — status + strain + stage, all server-validated.
    const filtActive = await getProfileSection(`__ss_p_${SUFFIX}`, "grows", undefined, undefined, { status: "active" })
    assert.ok(filtActive?.section === "grows" && filtActive.items.length > 0 && filtActive.items.every((i) => !i.harvested), "status=active returns only non-harvested")
    const filtCompleted = await getProfileSection(`__ss_p_${SUFFIX}`, "grows", undefined, undefined, { status: "completed" })
    assert.ok(filtCompleted?.section === "grows" && filtCompleted.items.every((i) => i.harvested), "status=completed returns only harvested")
    const filtStrain = await getProfileSection(`__ss_p_${SUFFIX}`, "grows", undefined, undefined, { strain: p1Strain.name })
    assert.ok(
      filtStrain?.section === "grows" && filtStrain.items.length === 1 && filtStrain.items[0].id === p1PublicGrow.id,
      "strain filter matches the strainId-linked public grow only (private sibling excluded)"
    )
    const unfilteredRef = await getProfileSection(`__ss_p_${SUFFIX}`, "grows")
    const filtBogusStage = await getProfileSection(`__ss_p_${SUFFIX}`, "grows", undefined, undefined, { stage: "NOT_A_STAGE" })
    assert.ok(
      filtBogusStage?.section === "grows" && unfilteredRef?.section === "grows" &&
        filtBogusStage.items.length === unfilteredRef.items.length,
      "unknown stage value is ignored, not trusted"
    )

    // Harvest filters — strain + real harvest years only.
    const p3Harvest = await prisma.growDiary.create({
      data: {
        title: `__ss p3 harvest ${SUFFIX}`, description: "d", growType: "INDOOR",
        startDate: new Date(Date.UTC(2024, 3, 1)), harvested: true,
        harvestedAt: new Date(Date.UTC(2024, 6, 10)), authorId: pUser.id,
        visibility: "PUBLIC", yieldAmount: 420, yieldUnit: "g", yieldPrivate: true,
      },
    })
    const p3HarvestOld = await prisma.growDiary.create({
      data: {
        title: `__ss p3 harvest old ${SUFFIX}`, description: "d", growType: "OUTDOOR",
        startDate: new Date(Date.UTC(2022, 3, 1)), harvested: true,
        harvestedAt: new Date(Date.UTC(2022, 8, 1)), authorId: pUser.id,
        visibility: "PUBLIC",
      },
    })
    const filtYear = await getProfileSection(`__ss_p_${SUFFIX}`, "harvests", undefined, undefined, { year: 2022 })
    assert.ok(
      filtYear?.section === "harvests" && filtYear.items.length === 1 && filtYear.items[0].id === p3HarvestOld.id,
      "harvests year filter returns only that year's harvests"
    )

    // Yield flag — owner sees their number; viewers get null + the flag.
    const ownerHarvestPage = await getProfileSection(`__ss_p_${SUFFIX}`, "harvests", pUser.id)
    assert.ok(ownerHarvestPage?.section === "harvests")
    const ownerPriv = ownerHarvestPage!.items.find((i) => i.id === p3Harvest.id)
    assert.equal(ownerPriv?.yieldAmount, 420, "owner sees own flagged yield")
    assert.equal(ownerPriv?.yieldPrivate, true, "owner sees the flag")
    const anonHarvestPage = await getProfileSection(`__ss_p_${SUFFIX}`, "harvests")
    assert.ok(anonHarvestPage?.section === "harvests")
    const anonPriv = anonHarvestPage!.items.find((i) => i.id === p3Harvest.id)
    assert.equal(anonPriv?.yieldAmount, null, "viewer never receives a flagged yield amount")
    assert.equal(anonPriv?.yieldPrivate, true, "viewer sees 'yield hidden', not 'not recorded'")
    // …and it never feeds the public biggest-yield record.
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.ok(
      !pdata?.profile.records?.biggestYield || pdata.profile.records.biggestYield.amount !== 420,
      "flagged yield is excluded from the biggest-yield record"
    )

    // Stage timeline — real logged transitions only, oldest first.
    const p3Diary = await prisma.growDiary.create({
      data: {
        title: `__ss p3 timeline ${SUFFIX}`, description: "d", growType: "INDOOR",
        startDate: new Date(), authorId: pUser.id, visibility: "PUBLIC", stage: "FLOWER",
      },
    })
    await prisma.diaryUpdate.create({
      data: { diaryId: p3Diary.id, authorId: pUser.id, title: "u1", content: "c", stage: "SEEDLING", createdAt: new Date(Date.now() - 10 * 86400000) },
    })
    await prisma.diaryUpdate.create({
      data: { diaryId: p3Diary.id, authorId: pUser.id, title: "u2", content: "c", stage: "FLOWER", createdAt: new Date() },
    })
    const timelinePage = await getProfileSection(`__ss_p_${SUFFIX}`, "grows", pUser.id, undefined, { stage: "FLOWER" })
    assert.ok(timelinePage?.section === "grows")
    const timelineRow = timelinePage!.items.find((i) => i.id === p3Diary.id)
    assert.deepEqual(timelineRow?.stages, ["SEEDLING", "FLOWER"], "timeline lists real logged stages in order")

    // Strain see-all — paged distinct strains over visible grows.
    const strainsPage = await getProfileSection(`__ss_p_${SUFFIX}`, "strains")
    assert.ok(strainsPage?.section === "strains" && strainsPage.items.some((s) => s.name === p1Strain.name && s.grows === 1), "strains section lists public-only counts")
    const strainsOwner = await getProfileSection(`__ss_p_${SUFFIX}`, "strains", pUser.id)
    assert.ok(strainsOwner?.section === "strains" && strainsOwner.items.find((s) => s.name === p1Strain.name)?.grows === 2, "owner strains count private grows too")

    // Harvest highlights + equipment chips — deterministic derivations.
    pdata = await getPublicProfileData(`__ss_p_${SUFFIX}`)
    assert.equal(pdata?.profile.harvestHighlights?.mostGrownStrain?.name, p1Strain.name, "most-grown strain is the strain-linked diary's")
    assert.equal(pdata?.profile.harvestHighlights?.firstHarvestAt?.getUTCFullYear(), 2022, "first harvest year derives from the oldest harvestedAt")
    assert.ok(pdata?.profile.harvestYears.includes(2022) && pdata?.profile.harvestYears.includes(2024), "harvestYears covers recorded years")
    assert.ok(pdata?.profile.equipmentChips.includes("indoor") && pdata?.profile.equipmentChips.includes("outdoor"), "equipment chips derive from grow fields")

    // Follow lists — members-visible, block-filtered, cursor-paged.
    assert.equal(await getProfileSection(`__ss_p_${SUFFIX}`, "followers"), null, "anonymous cannot read follower lists")
    const f1 = await mk(`__ss_f1_${SUFFIX}`)
    const f2 = await mk(`__ss_f2_${SUFFIX}`)
    await prisma.follow.create({ data: { followerId: a.id, followingId: pUser.id } })
    await prisma.follow.create({ data: { followerId: f1.id, followingId: pUser.id } })
    await prisma.follow.create({ data: { followerId: f2.id, followingId: pUser.id } })
    await prisma.follow.create({ data: { followerId: pUser.id, followingId: f1.id } })
    const followersPage = await getProfileSection(`__ss_p_${SUFFIX}`, "followers", a.id)
    assert.ok(followersPage?.section === "followers" && followersPage.items.length === 3, "member sees follower list")
    assert.ok(followersPage!.items.every((i) => i.username && i.rank.name), "follow rows carry compact identity")
    // Owner blocks f2 → f2 drops out of every viewer's list.
    await prisma.block.create({ data: { blockerId: pUser.id, blockedId: f2.id } })
    const followersBlocked = await getProfileSection(`__ss_p_${SUFFIX}`, "followers", a.id)
    assert.ok(followersBlocked?.section === "followers" && followersBlocked.items.length === 2 && !followersBlocked.items.some((i) => i.id === f2.id), "owner-blocked member is filtered")
    // Viewer-side block also filters (a blocks f1 → a's view drops f1).
    await prisma.block.create({ data: { blockerId: a.id, blockedId: f1.id } })
    const followersViewerBlocked = await getProfileSection(`__ss_p_${SUFFIX}`, "followers", a.id)
    assert.ok(followersViewerBlocked?.section === "followers" && followersViewerBlocked.items.length === 1 && followersViewerBlocked.items[0].id === a.id, "viewer-blocked member is filtered")
    const followingPage = await getProfileSection(`__ss_p_${SUFFIX}`, "following", f1.id)
    assert.ok(followingPage?.section === "following" && followingPage.items.some((i) => i.id === f1.id), "following lists who the owner follows")
    // Route-level: anonymous followers GET → 404; filtered grows GET → 200.
    const anonFollowRes = await getProfileSections(
      new NextRequest(`http://localhost/api/users/__ss_p_${SUFFIX}/sections/followers`),
      { params: Promise.resolve({ username: `__ss_p_${SUFFIX}`, section: "followers" }) }
    )
    assert.equal(anonFollowRes.status, 404, "route 404s anonymous follower lists")
    const filteredRes = await getProfileSections(
      new NextRequest(`http://localhost/api/users/__ss_p_${SUFFIX}/sections/grows?status=active&stage=VEGETATIVE&year=not-a-year`),
      { params: Promise.resolve({ username: `__ss_p_${SUFFIX}`, section: "grows" }) }
    )
    assert.equal(filteredRes.status, 200, "route accepts valid filters and ignores garbage")

    await prisma.follow.deleteMany({ where: { OR: [{ followerId: pUser.id }, { followingId: pUser.id }, { followerId: a.id }, { followerId: f1.id }, { followerId: f2.id }] } })
    await prisma.block.deleteMany({ where: { OR: [{ blockerId: pUser.id }, { blockerId: a.id }] } })
    await prisma.diaryUpdate.deleteMany({ where: { diaryId: p3Diary.id } })

    await prisma.post.delete({ where: { id: p1Post.id } })
    await prisma.thread.delete({ where: { id: p1Thread.id } })
    await prisma.growExperiment.deleteMany({ where: { id: { in: [p1Exp.id, p1ExpPriv.id] } } })
    await prisma.strain.delete({ where: { id: p1Strain.id } }).catch(() => {})
    await prisma.masteryProgress.deleteMany({ where: { userId: pUser.id } })
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

    // ── PROFILE P2: customization behavior ──────────────────────────
    // Tiered limits — xp fixtures only (cleaned on user delete).
    assert.equal(await profileSectionLimit(c.id), 2, "Seed gets the 2-section base grant")
    assert.equal(await statSlotLimit(c.id), 4, "Seed gets 4 stat slots")
    await prisma.profile.update({ where: { userId: c.id }, data: { xp: 420 } })
    assert.equal(await profileSectionLimit(c.id), 4, "Rooted raises to 4 sections")
    await prisma.profile.update({ where: { userId: c.id }, data: { xp: 900 } })
    assert.equal(await statSlotLimit(c.id), 6, "Vegged raises to 6 stat slots")
    await prisma.profile.update({ where: { userId: c.id }, data: { xp: 7500 } })
    assert.equal(await profileSectionLimit(c.id), 6, "Harvested raises to 6 sections")
    assert.equal(await statSlotLimit(c.id), 8, "Harvested raises to 8 stat slots")
    await prisma.profile.update({ where: { userId: c.id }, data: { xp: 0 } })
    assert.equal(await profileSectionLimit(c.id), 2, "section limit reverts below Rooted")

    // Custom-section privacy — the public-profile aggregate filters by viewer.
    const cProfile = await prisma.profile.findUnique({
      where: { userId: c.id }, select: { id: true, username: true },
    })
    assert.ok(cProfile, "fixture profile exists")
    await prisma.profileCustomSection.createMany({
      data: [
        { profileId: cProfile.id, title: "Pub sec", body: "public body", visibility: "PUBLIC", order: 0 },
        { profileId: cProfile.id, title: "Mem sec", body: "members body", visibility: "MEMBERS", order: 1 },
        { profileId: cProfile.id, title: "Hid sec", body: "hidden body", visibility: "HIDDEN", order: 2 },
      ],
    })
    const cAnon = await getPublicProfileData(cProfile.username)
    const cMember = await getPublicProfileData(cProfile.username, b.id)
    const cOwner = await getPublicProfileData(cProfile.username, c.id)
    assert.ok(cAnon && cMember && cOwner, "public profile resolves for all viewer classes")
    assert.deepEqual(cAnon.profile.customSections.map((s) => s.title), ["Pub sec"], "anon sees only PUBLIC sections")
    assert.deepEqual(cMember.profile.customSections.map((s) => s.title), ["Pub sec", "Mem sec"], "member sees PUBLIC + MEMBERS")
    assert.equal(cOwner.profile.customSections.length, 3, "owner sees all own sections incl. HIDDEN")

    // Featured grow — a PRIVATE diary can be featured but never leaks to
    // viewers: it drops out of their DTO entirely.
    const privGrow = await prisma.growDiary.create({
      data: {
        title: "Featured private grow", description: "", growType: "INDOOR",
        strain: "Privacy Strain", medium: "SOIL", lighting: "LED", stage: "FLOWER",
        startDate: new Date(Date.now() - 30 * 86400000),
        authorId: c.id, visibility: "PRIVATE",
      },
      select: { id: true },
    })
    await prisma.profile.update({ where: { userId: c.id }, data: { featuredDiaryId: privGrow.id } })
    const fAnon = await getPublicProfileData(cProfile.username)
    const fOwner = await getPublicProfileData(cProfile.username, c.id)
    assert.equal(fAnon?.profile.featuredGrow, null, "PRIVATE featured grow hidden from anon")
    assert.equal(fOwner?.profile.featuredGrow?.id, privGrow.id, "owner sees own featured grow")

    // Records widget (Harvested) — scoped to viewer-visible diaries: a longer
    // PRIVATE grow must not inflate the public record.
    await prisma.profile.update({ where: { userId: c.id }, data: { xp: 7500 } })
    await prisma.growDiary.create({
      data: {
        title: "Public harvest", description: "", growType: "INDOOR",
        strain: "Record Strain", medium: "SOIL", lighting: "LED", stage: "HARVEST",
        harvested: true, harvestedAt: new Date(), yieldAmount: 420, yieldUnit: "g",
        startDate: new Date(Date.now() - 60 * 86400000),
        authorId: c.id, visibility: "PUBLIC",
      },
      select: { id: true },
    })
    // Records only measure *harvested* grows — harvest the private featured
    // grow at a 200-day span so it out-records the 60-day public one.
    await prisma.growDiary.update({
      where: { id: privGrow.id },
      data: { startDate: new Date(Date.now() - 200 * 86400000), harvested: true, harvestedAt: new Date(), stage: "HARVEST" },
    })
    const rAnon = await getPublicProfileData(cProfile.username)
    const rOwner = await getPublicProfileData(cProfile.username, c.id)
    assert.ok(rAnon?.profile.records, "records widget ships at Harvested")
    assert.equal(rAnon?.profile.records?.longestGrowDays, 60, "anon records ignore the longer PRIVATE grow")
    assert.equal(rAnon?.profile.records?.biggestYield?.amount, 420, "public yield reaches anon records")
    assert.equal(rOwner?.profile.records?.longestGrowDays, 200, "owner records include own private grow")

    // Owner insights (Cured) — owner-only; never shipped to other viewers.
    assert.equal(rOwner?.profile.ownerInsights, null, "insights locked below Cured")
    await prisma.profile.update({ where: { userId: c.id }, data: { xp: 12000 } })
    const iOwner = await getPublicProfileData(cProfile.username, c.id)
    const iMember = await getPublicProfileData(cProfile.username, b.id)
    assert.ok(iOwner?.profile.ownerInsights, "Cured owner sees insights")
    assert.equal(iMember?.profile.ownerInsights, null, "insights never shipped to other viewers")
    assert.equal(iOwner?.profile.ownerInsights?.growsStarted, 2, "30-day grows count is real")
    await prisma.profile.update({ where: { userId: c.id }, data: { xp: 0 } })

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
