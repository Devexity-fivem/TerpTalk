import { strict as assert } from "node:assert"
import { prisma } from "@/lib/prisma"
import { notify, notifyMany, invalidateNotificationsForLink } from "@/lib/notify"
import { notifyMentions } from "@/lib/mentions"

// Keep usernames ≤20 chars — that is the real username limit, and the
// mention notifier/renderer only match valid handles.
const STAMP = Date.now().toString(36)
const ACTOR_USERNAME = `__t_n2a_${STAMP}`
const RECIP_USERNAME = `__t_n2r_${STAMP}`
const THIRD_USERNAME = `__t_n2t_${STAMP}`

async function mkUser(username: string, banned = false) {
  return prisma.user.create({
    data: {
      name: username,
      banned,
      ageVerified: true,
      sessionVersion: 1,
      profile: { create: { username } },
    },
  })
}

const count = (userId: string) => prisma.notification.count({ where: { userId } })

async function run() {
  console.log("Starting Notification 2.0 regression tests...")

  const ids: string[] = []
  try {
    const actor = await mkUser(ACTOR_USERNAME)
    const recip = await mkUser(RECIP_USERNAME)
    const third = await mkUser(THIRD_USERNAME, true) // banned
    ids.push(actor.id, recip.id, third.id)

    // 1. Basic create with actor attribution
    const n1 = await notify({
      userId: recip.id,
      type: "FOLLOW",
      title: "New follower",
      content: `@${ACTOR_USERNAME} started following you`,
      link: `/u/${ACTOR_USERNAME}`,
      actorId: actor.id,
    })
    assert.ok(n1, "notification should be created")
    assert.equal(n1!.actorId, actor.id, "actorId should be stored")
    assert.equal(n1!.actor?.profile?.username, ACTOR_USERNAME, "actor include should resolve")

    // 2. Self-action guard
    const self = await notify({
      userId: actor.id, type: "REPLY", title: "t", content: "c", actorId: actor.id,
    })
    assert.equal(self, null, "self-action should not notify")

    // 3. Preference opt-out
    await prisma.profile.update({
      where: { userId: recip.id },
      data: { notifyOnReply: false },
    })
    const opted = await notify({
      userId: recip.id, type: "REPLY", title: "t", content: "c", actorId: actor.id,
    })
    assert.equal(opted, null, "opted-out type should not notify")
    await prisma.profile.update({
      where: { userId: recip.id },
      data: { notifyOnReply: true },
    })

    // 4. Security-critical types are not gated by prefs
    await prisma.profile.update({
      where: { userId: recip.id },
      data: { notifyOnReply: false, notifyOnMention: false, notifyOnComment: false, notifyOnFollow: false, notifyOnReaction: false },
    })
    const mod = await notify({
      userId: recip.id, type: "MODERATOR_ANNOUNCEMENT", title: "mod", content: "c",
    })
    assert.ok(mod, "MODERATOR_ANNOUNCEMENT should bypass prefs")
    await prisma.profile.update({
      where: { userId: recip.id },
      data: { notifyOnReply: true, notifyOnMention: true, notifyOnComment: true, notifyOnFollow: true, notifyOnReaction: true },
    })

    // 5. Banned recipient is skipped
    const toBanned = await notify({
      userId: third.id, type: "FOLLOW", title: "t", content: "c", actorId: actor.id,
    })
    assert.equal(toBanned, null, "banned recipient should not be notified")

    // 6. Unknown recipient is skipped
    const ghost = await notify({
      userId: "nonexistent-user", type: "FOLLOW", title: "t", content: "c", actorId: actor.id,
    })
    assert.equal(ghost, null, "unknown recipient should not be notified")

    // 7. Block suppresses notifications in both directions
    await prisma.block.create({ data: { blockerId: recip.id, blockedId: actor.id } })
    const blocked = await notify({
      userId: recip.id, type: "REACTION", title: "t", content: "c", actorId: actor.id,
    })
    assert.equal(blocked, null, "blocked actor should not notify")
    const before = await count(recip.id)
    await notifyMany([
      { userId: recip.id, type: "MENTION", title: "t", content: "c", actorId: actor.id },
      { userId: actor.id, type: "MENTION", title: "t", content: "c", actorId: recip.id }, // reciprocal block also suppressed
    ])
    assert.equal(await count(recip.id), before, "notifyMany should skip blocked recipients")
    const actorCountBefore = await count(actor.id)
    assert.equal(actorCountBefore, await count(actor.id), "reciprocal block should be suppressed")
    await prisma.block.deleteMany({ where: { blockerId: recip.id, blockedId: actor.id } })

    // 8. Dedupe window — same actor/type/groupKey within window is suppressed
    const d1 = await notify({
      userId: recip.id, type: "REACTION", title: "r", content: "c",
      actorId: actor.id, groupKey: "REACTION:post:xyz", dedupeMs: 60_000,
    })
    const d2 = await notify({
      userId: recip.id, type: "REACTION", title: "r", content: "c",
      actorId: actor.id, groupKey: "REACTION:post:xyz", dedupeMs: 60_000,
    })
    assert.ok(d1, "first dedupe-window notification should be created")
    assert.equal(d2, null, "duplicate within dedupe window should be skipped")

    // 9. Different actor is NOT deduped
    const other = await mkUser(`__test_n2_other_${STAMP}`)
    ids.push(other.id)
    const d3 = await notify({
      userId: recip.id, type: "REACTION", title: "r", content: "c",
      actorId: other.id, groupKey: "REACTION:post:xyz", dedupeMs: 60_000,
    })
    assert.ok(d3, "different actor should not be deduped")

    // 10. notifyMentions — dedupe handles, block + pref respected
    const mentionCountBefore = await count(recip.id)
    await notifyMentions(
      `hey @${RECIP_USERNAME} @${RECIP_USERNAME} @nonexistent_handle`,
      actor.id,
      ACTOR_USERNAME,
      "/forum/thread/x",
      "a test post"
    )
    assert.equal(
      await count(recip.id), mentionCountBefore + 1,
      "duplicate mentions should produce exactly one notification"
    )

    // 11. Link invalidation removes notifications pointing at deleted content
    await invalidateNotificationsForLink("/forum/thread/x")
    const stale = await prisma.notification.count({ where: { link: "/forum/thread/x" } })
    assert.equal(stale, 0, "invalidated links should remove notifications")

    // 11b. Decorated deep links (?post=/#post-) are caught by base-path
    // invalidation, and a prefix-similar slug (/forum/thread/xyz) is not.
    const deep = await notify({ userId: recip.id, type: "MENTION", title: "t", content: "c", link: "/forum/thread/x?page=2#post-abc", actorId: actor.id })
    assert.equal(deep?.link, "/forum/thread/x?page=2#post-abc", "deep link should persist through the sanitizer")
    const neighbour = await notify({ userId: recip.id, type: "MENTION", title: "t", content: "c", link: "/forum/thread/xyz", actorId: actor.id })
    assert.equal(neighbour?.link, "/forum/thread/xyz", "prefix-similar link should persist")
    await invalidateNotificationsForLink("/forum/thread/x")
    assert.equal(await prisma.notification.count({ where: { link: { contains: "post-abc" } } }), 0, "invalidation should catch decorated links")
    assert.equal(await prisma.notification.count({ where: { link: "/forum/thread/xyz" } }), 1, "invalidation must not hit prefix-similar slugs")

    // 12. Link sanitization — external, javascript:, and protocol-relative
    // links are dropped to null; only root-relative paths persist.
    const lExt = await notify({ userId: recip.id, type: "REACTION", title: "t", content: "c", link: "https://evil.example/x", actorId: actor.id })
    assert.equal(lExt?.link, null, "external link should be dropped")
    const lJs = await notify({ userId: recip.id, type: "REACTION", title: "t", content: "c", link: "javascript:alert(1)", actorId: actor.id })
    assert.equal(lJs?.link, null, "javascript: link should be dropped")
    const lProto = await notify({ userId: recip.id, type: "REACTION", title: "t", content: "c", link: "//evil.example/x", actorId: actor.id })
    assert.equal(lProto?.link, null, "protocol-relative link should be dropped")
    const lBack = await notify({ userId: recip.id, type: "REACTION", title: "t", content: "c", link: "/\\evil.example/x", actorId: actor.id })
    assert.equal(lBack?.link, null, "backslash link should be dropped")
    const lOk = await notify({ userId: recip.id, type: "REACTION", title: "t", content: "c", link: "/forum/thread/ok", actorId: actor.id })
    assert.equal(lOk?.link, "/forum/thread/ok", "root-relative link should persist")
    await notifyMany([
      { userId: recip.id, type: "REACTION", title: "t", content: "c", link: "//evil.example/batch", actorId: actor.id },
      { userId: recip.id, type: "REACTION", title: "t", content: "c", link: "/forum/thread/batch-ok", actorId: actor.id },
    ])
    const badLink = await prisma.notification.count({ where: { link: "//evil.example/batch" } })
    assert.equal(badLink, 0, "notifyMany should drop protocol-relative links")
    const goodLink = await prisma.notification.count({ where: { link: "/forum/thread/batch-ok" } })
    assert.equal(goodLink, 1, "notifyMany should persist root-relative links")

    console.log("All Notification 2.0 regression tests passed.")
  } finally {
    for (const id of ids) {
      await prisma.user.delete({ where: { id } }).catch(() => {})
    }
    await prisma.$disconnect().catch(() => {})
  }
}

run().catch((err) => {
  console.error("Notification 2.0 regression tests failed:", err)
  process.exit(1)
})
