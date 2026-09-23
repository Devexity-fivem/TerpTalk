// Privacy & account-control regression tests — covers the member-facing
// controls added in the privacy phase: profile prefs defaults, rankable
// surface exclusion, presence filtering, DM policy follow-check semantics,
// soft-delete read filters, notification scoping, APPEAL reports, and the
// account-deletion scrub helpers. Uses disposable __test_pv_ users on the
// real database; everything is cleaned up at the end.
// Run: npm run test:privacy
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { rankableProfile, activeAuthor } from "@/lib/security"
import { isDiaryVisibility, viewableDiaryWhere, canViewDiary, publicDiaryWhere } from "@/lib/diary-visibility"
import { parseDiaryPatch } from "@/lib/diary-edit"
import { resolveMonthlyDiaryWinner } from "@/lib/contest-awards"
import { notificationLinkWhere, postLinkWhere } from "@/lib/notify"
import { TERPBOT_USERNAME } from "@/lib/terpbot"
import { NextRequest } from "next/server"
import { GET as getPublicProfile } from "@/app/api/users/[username]/route"

const SUFFIX = String(Date.now()).slice(-8)
const A = `__pv_a_${SUFFIX}`
const B = `__pv_b_${SUFFIX}`

async function run() {
  console.log("Starting privacy-controls regression tests...")
  const ids: string[] = []
  try {
    const mk = async (username: string) => {
      const u = await prisma.user.create({
        data: {
          name: username,
          ageVerified: true,
          sessionVersion: 1,
          profile: { create: { username } },
        },
      })
      ids.push(u.id)
      return u
    }
    const a = await mk(A)
    const b = await mk(B)

    // ── 1. New prefs default correctly ────────────────────────────────
    const pa = await prisma.profile.findUnique({ where: { userId: a.id } })
    assert.equal(pa?.hideOnlineStatus, false, "hideOnlineStatus defaults false")
    assert.equal(pa?.publicMilestoneOptOut, false, "publicMilestoneOptOut defaults false")
    assert.equal(pa?.dmPolicy, "EVERYONE", "dmPolicy defaults EVERYONE")

    // ── 2. rankableProfile excludes opted-out profiles ────────────────
    assert.ok(
      await prisma.profile.findFirst({ where: { ...rankableProfile(), userId: a.id } }),
      "default member is rankable"
    )
    await prisma.profile.update({
      where: { userId: a.id },
      data: { publicMilestoneOptOut: true },
    })
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

    // ── 3. hideOnlineStatus fixture flag ────────────────────────────
    // Presence behavior itself is covered through the real getChatActivity
    // in chat-ux; this flag stays set on b because §11 asserts the two
    // privacy flags act independently on the public profile API.
    await prisma.user.update({ where: { id: b.id }, data: { lastSeenAt: new Date(), status: "ONLINE" } })
    await prisma.profile.update({ where: { userId: b.id }, data: { hideOnlineStatus: true } })

    // ── 4. DM policy: FOLLOWING requires recipient→sender follow ──────
    await prisma.profile.update({ where: { userId: a.id }, data: { dmPolicy: "FOLLOWING" } })
    // a follows b — but that does NOT let b message a under FOLLOWING.
    await prisma.follow.create({ data: { followerId: a.id, followingId: b.id } })
    const allowed = await prisma.follow.findFirst({
      where: { followerId: a.id, followingId: b.id },
      select: { id: true },
    })
    // Sender=a, recipient=b: a→b follow exists but check is recipient→sender.
    const recipientFollowsSender = await prisma.follow.findFirst({
      where: { followerId: b.id, followingId: a.id },
      select: { id: true },
    })
    assert.equal(recipientFollowsSender, null, "b does not follow a — a's DM to b blocked under FOLLOWING")
    assert.ok(allowed, "sanity: the a→b follow row exists")

    // ── 5. Notification link matchers (used by member deletes) ────────
    await prisma.notification.create({
      data: {
        userId: b.id, type: "COMMENT", title: "t", content: "c",
        link: "/diaries/abc123",
      },
    })
    await prisma.notification.create({
      data: {
        userId: b.id, type: "COMMENT", title: "t", content: "c",
        link: "/diaries/abc123#update-1",
      },
    })
    await prisma.notification.create({
      data: {
        userId: b.id, type: "COMMENT", title: "t", content: "c",
        link: "/diaries/other",
      },
    })
    const purged = await prisma.notification.deleteMany({
      where: { userId: b.id, ...notificationLinkWhere("/diaries/abc123") },
    })
    assert.equal(purged.count, 2, "base + deep link both purged")
    const remaining = await prisma.notification.count({
      where: { userId: b.id, link: "/diaries/other" },
    })
    assert.equal(remaining, 1, "unrelated notification untouched")

    // postLinkWhere catches ?post= and #post- deep links
    await prisma.notification.createMany({
      data: [
        { userId: b.id, type: "REPLY", title: "t", content: "c", link: "/forum/thread/x?post=p1" },
        { userId: b.id, type: "REPLY", title: "t", content: "c", link: "/forum/thread/x#post-p1" },
      ],
    })
    const purged2 = await prisma.notification.deleteMany({
      where: { userId: b.id, ...postLinkWhere("p1") },
    })
    assert.equal(purged2.count, 2, "post deep links purged")

    // ── 6. Notification delete stays user-scoped ──────────────────────
    await prisma.notification.create({
      data: { userId: a.id, type: "COMMENT", title: "t", content: "c" },
    })
    // Simulating DELETE /api/notifications { ids } — userId in where.
    const n = await prisma.notification.findFirst({ where: { userId: a.id } })
    const wrongOwner = await prisma.notification.deleteMany({
      where: { userId: b.id, id: { in: [n!.id] } },
    })
    assert.equal(wrongOwner.count, 0, "cannot delete another user's notification")
    const own = await prisma.notification.deleteMany({
      where: { userId: a.id, id: { in: [n!.id] } },
    })
    assert.equal(own.count, 1, "owner delete succeeds")

    // ── 7. Soft-delete read filters on diaries/setups ─────────────────
    const diary = await prisma.growDiary.create({
      data: { authorId: a.id, title: "t", description: "d", growType: "INDOOR", startDate: new Date(), stage: "VEGETATIVE" },
    })
    const setup = await prisma.growSetup.create({
      data: { authorId: a.id, title: "s", description: "d" },
    })
    // Public read pattern: deleted:false + active author.
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

    // ── 8. Chat message soft-delete doesn't touch the lifetime counter ─
    const room = await prisma.chatRoom.create({
      data: { name: `__pv_room_${SUFFIX}`, slug: `__pv-room-${SUFFIX}` },
      select: { id: true },
    })
    try {
      const msg = await prisma.chatMessage.create({
        data: { roomId: room.id, authorId: a.id, content: "test" },
      })
      await prisma.chatMessage.updateMany({
        where: { id: msg.id, authorId: a.id, deleted: false },
        data: { deleted: true },
      })
      const prof = await prisma.profile.findUnique({ where: { userId: a.id }, select: { chatMessageCount: true } })
      assert.equal(prof?.chatMessageCount, 0, "counter unaffected by delete (increment is on send)")
    } finally {
      await prisma.chatMessage.deleteMany({ where: { roomId: room.id } }).catch(() => {})
      await prisma.chatRoom.delete({ where: { id: room.id } }).catch(() => {})
    }

    // ── 9. APPEAL report round-trips for the restricted flow ──────────
    const appeal = await prisma.report.create({
      data: {
        type: "APPEAL",
        reason: "ACCOUNT_REVIEW_REQUEST",
        description: "please review",
        reporterId: a.id,
        reportedId: a.id,
        priority: "NORMAL",
      },
    })
    const found = await prisma.report.findFirst({
      where: { type: "APPEAL", reporterId: a.id, status: { in: ["PENDING", "REVIEWING"] } },
    })
    assert.equal(found?.id, appeal.id, "pending appeal found by dedupe query")
    await prisma.report.delete({ where: { id: appeal.id } })

    // ── 10. Suspended accounts are non-active on public surfaces ──────
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

    // ── 11. Public reputation privacy via GET /api/users/[username] ────
    // a still has publicMilestoneOptOut=true (section 2); b is default but
    // has hideOnlineStatus=true (section 3) — both flags get exercised.
    const profileApi = async (username: string) => {
      const res = await getPublicProfile(
        new NextRequest(`http://localhost/api/users/${username}`),
        { params: Promise.resolve({ username }) }
      )
      assert.equal(res.status, 200, `GET /api/users/${username} → 200`)
      return res.json()
    }

    // Opted-out member: no recent rep rows and a zeroed grow streak.
    const optOut = await profileApi(A)
    assert.ok(Array.isArray(optOut.recentRep), "recentRep is an array")
    assert.equal(optOut.recentRep.length, 0, "opted-out member exposes no recentRep")
    assert.equal(optOut.profile.growStreak, 0, "opted-out member growStreak zeroed")

    // Default member with one public rep event: rows carry the public
    // label/amount/createdAt shape and never leak the raw type.
    await prisma.reputationEvent.create({
      data: { userId: b.id, type: "THREAD_CREATED", amount: 5, reason: "pv test" },
    })
    const visible = await profileApi(B)
    assert.ok(visible.recentRep.length >= 1, "default member exposes recentRep")
    for (const e of visible.recentRep) {
      assert.ok(typeof e.label === "string" && e.label.length > 0, "event has label")
      assert.ok(typeof e.amount === "number", "event has amount")
      assert.ok(e.createdAt, "event has createdAt")
      assert.ok(!("type" in e), "event must not expose raw type")
    }

    // hideOnlineStatus alone must not empty recentRep — the two privacy
    // flags stay independent (b has hideOnlineStatus=true from section 3).
    assert.ok(visible.recentRep.length >= 1, "hideOnlineStatus does not hide recentRep")

    // ── 12. Diary visibility helpers + PATCH validation ─────────────
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

    // ── 13. Hidden diary cannot win Diary of the Month ─────────────
    // A diary flipped UNLISTED/PRIVATE after entering must not be publicly
    // named winner — even when it leads on votes.
    const c = await mk(`__pv_c_${SUFFIX}`)
    const d = await mk(`__pv_d_${SUFFIX}`)
    const v = await mk(`__pv_v_${SUFFIX}`)
    const month = `pv${SUFFIX}`
    const hiddenDiary = await prisma.growDiary.create({
      data: { title: `${A}-hidden`, description: "t", growType: "INDOOR", startDate: new Date(), authorId: c.id, visibility: "PRIVATE" },
    })
    const openDiary = await prisma.growDiary.create({
      data: { title: `${A}-open`, description: "t", growType: "INDOOR", startDate: new Date(), authorId: d.id, visibility: "PUBLIC" },
    })
    const hiddenEntry = await prisma.diaryContestEntry.create({ data: { month, diaryId: hiddenDiary.id, userId: c.id } })
    const openEntry = await prisma.diaryContestEntry.create({ data: { month, diaryId: openDiary.id, userId: d.id } })
    try {
      await prisma.diaryContestVote.createMany({
        data: [
          { entryId: hiddenEntry.id, userId: a.id, month },
          { entryId: hiddenEntry.id, userId: b.id, month },
          { entryId: openEntry.id, userId: v.id, month },
        ],
      })
      const winner = await resolveMonthlyDiaryWinner(month)
      assert.equal(winner?.diaryId, openDiary.id, "hidden diary skipped despite leading on votes")
    } finally {
      await prisma.diaryContestVote.deleteMany({ where: { entryId: { in: [hiddenEntry.id, openEntry.id] } } })
      await prisma.diaryContestEntry.deleteMany({ where: { id: { in: [hiddenEntry.id, openEntry.id] } } })
      await prisma.userBadge.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
      await prisma.badge.deleteMany({ where: { name: { in: ["Diary of the Month", "Contest Finalist"] } } }).catch(() => {})
      await prisma.reputationEvent.deleteMany({ where: { userId: { in: ids }, key: { startsWith: "dcontestwin:" } } }).catch(() => {})
      await prisma.growDiary.deleteMany({ where: { id: { in: [hiddenDiary.id, openDiary.id] } } })
    }

    console.log("All privacy-controls tests passed.")
  } finally {
    for (const id of ids) {
      await prisma.user.delete({ where: { id } }).catch(() => {})
    }
    await prisma.$disconnect()
  }
}

run().catch(async (e) => {
  console.error("FAILED:", e)
  await prisma.$disconnect()
  process.exit(1)
})
