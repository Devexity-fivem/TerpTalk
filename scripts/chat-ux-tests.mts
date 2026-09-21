import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { prisma } from "@/lib/prisma"
import {
  mergeMessages,
  isStaleBatch,
  applyMessageDeletes,
  filterBlockedAuthors,
  applyRoomState,
  getLastSeen,
  markRoomSeen,
  getLastRoom,
  setLastRoom,
  syncUnread,
  firstUnreadId,
  CHAT_MESSAGE_DELETED_EVENT,
  type StorageLike,
} from "@/lib/chat-client"
import { getChatActivity, getChatTeaser } from "@/lib/chat-activity"
import { SITE_SETTINGS, getSetting } from "@/lib/settings"

const TAG = `__test_chat_${Date.now()}`

let passed = 0
let failed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : e}`)
  }
}

function fakeStore(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

function msg(id: string, roomId: string, createdAt: string) {
  return { id, roomId, createdAt }
}

function src(rel: string) {
  return readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), "utf8")
}

async function run() {
  console.log("Starting chat UX regression tests...")

  // ── Pure helpers: message merging ────────────────────────────────────

  check("merge dedupes a message arriving via POST response AND push", () => {
    const m = msg("m1", "roomA", "2026-01-01T00:00:00Z")
    // Push lands first, then the POST response appends the same id.
    let list = mergeMessages([], [m])
    list = mergeMessages(list, [m])
    assert.equal(list.length, 1, "same id must render once")
    assert.equal(list[0].id, "m1")
  })

  check("merge appends new messages and preserves order", () => {
    const prev = [msg("m1", "r", "2026-01-01T00:00:00Z")]
    const next = mergeMessages(prev, [
      msg("m2", "r", "2026-01-01T00:01:00Z"),
      msg("m3", "r", "2026-01-01T00:02:00Z"),
    ])
    assert.deepEqual(next.map((m) => m.id), ["m1", "m2", "m3"])
  })

  check("merge caps the list at 100", () => {
    const prev = Array.from({ length: 100 }, (_, i) => msg(`m${i}`, "r", `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`))
    const next = mergeMessages(prev, [msg("new", "r", "2026-01-01T01:00:00Z")])
    assert.equal(next.length, 100)
    assert.equal(next[next.length - 1].id, "new")
    assert.equal(next[0].id, "m1", "oldest dropped")
  })

  check("merge with empty batch returns the same list", () => {
    const prev = [msg("m1", "r", "2026-01-01T00:00:00Z")]
    assert.equal(mergeMessages(prev, []), prev)
  })

  // ── Pure helpers: room-switch guard ──────────────────────────────────

  check("isStaleBatch rejects a batch from a previous room", () => {
    assert.equal(isStaleBatch("roomA", "roomB", false), true)
  })

  check("isStaleBatch accepts the active room", () => {
    assert.equal(isStaleBatch("roomA", "roomA", false), false)
  })

  check("isStaleBatch rejects everything after cleanup", () => {
    assert.equal(isStaleBatch("roomA", "roomA", true), true)
  })

  // ── Deletion propagation helpers ───────────────────────────────────

  check("applyMessageDeletes tombstones content in place", () => {
    const list = [
      { id: "m1", content: "keep me" },
      { id: "m2", content: "sensitive body" },
    ]
    const out = applyMessageDeletes(list, new Set(["m2"]))
    assert.equal(out[0].content, "keep me")
    assert.equal(out[1].content, "[deleted]", "deleted message renders as tombstone")
    assert.equal(out[1].id, "m2", "row identity preserved — no reflow")
  })

  check("applyMessageDeletes scrubs reply previews of deleted parents", () => {
    const list = [
      { id: "p1", content: "parent body" },
      { id: "c1", content: "child", replyTo: { id: "p1", content: "parent body" } },
    ]
    const out = applyMessageDeletes(list, new Set(["p1"]))
    assert.equal(out[1].replyTo?.content, "[deleted]", "quoted copy must not outlive the deletion")
  })

  check("applyMessageDeletes with empty/unknown ids is a no-op", () => {
    const list = [{ id: "m1", content: "keep" }]
    assert.equal(applyMessageDeletes(list, new Set()), list)
    const out = applyMessageDeletes(list, new Set(["nope"]))
    assert.equal(out[0].content, "keep")
  })

  check("filterBlockedAuthors drops blocked and keeps unauthored", () => {
    const list = [
      { id: "m1", author: { id: "u1" } },
      { id: "m2", author: { id: "u2" } },
      { id: "m3", author: null }, // system/bot rows carry no author
    ]
    const out = filterBlockedAuthors(list, new Set(["u2"]))
    assert.deepEqual(out.map((m) => m.id), ["m1", "m3"])
  })

  // ── Deletion/block wiring contracts ────────────────────────────────

  check("client binds the message-deleted event and guards the merge", () => {
    const c = src("components/chat-room.tsx")
    assert.ok(c.includes("channel.bind(CHAT_MESSAGE_DELETED_EVENT"), "must bind message-deleted")
    assert.equal(CHAT_MESSAGE_DELETED_EVENT, "message-deleted", "stable wire name")
    assert.ok(c.includes("tombstonesRef.current.has(m.id)"), "delete-before-message ordering guard")
    assert.ok(c.includes("applyMessageDeletes"), "rendered rows tombstone on delete")
  })

  check("tickle refetch cannot advance the incremental cursor", () => {
    const c = src("components/chat-room.tsx")
    const bind = c.slice(
      c.indexOf("channel.bind(CHAT_MESSAGE_EVENT"),
      c.indexOf("channel.bind(CHAT_MESSAGE_DELETED_EVENT")
    )
    assert.ok(bind.includes("void load()"), "tickle triggers a server-filtered load")
    // lastTsRef is written ONLY inside mergeFresh — a tickle alone can never
    // skip messages that arrived between the event and the fetch.
    const mergeBody = c.slice(c.indexOf("const mergeFresh"), c.indexOf("const load ="))
    assert.ok(mergeBody.includes("lastTsRef.current = newest"), "cursor advances inside mergeFresh")
    assert.ok(!bind.includes("lastTsRef.current ="), "tickle path must not move the cursor")
  })

  check("GET returns deletedIds + blockedIds; DELETE emits the event", () => {
    const r = src("app/api/chat/messages/route.ts")
    assert.ok(r.includes("deletedIds"), "polling clients need tombstone ids")
    assert.ok(r.includes("blockedIds"), "server ships the mutual block set")
    assert.ok(r.includes("message-deleted"), "DELETE must emit the pusher event")
    // The delete event payload is ids-only — no message content leak.
    const trig = r.slice(r.indexOf("message-deleted"))
    assert.ok(/\{[^}]*ids[^}]*\}/.test(trig) && !/trigger[^;]*content/i.test(trig), "payload carries ids, not bodies")
  })

  check("GET history filters blocked authors server-side", () => {
    const r = src("app/api/chat/messages/route.ts")
    assert.ok(r.includes("blockedUserIds") || r.includes("notBlockedAuthor"), "history must apply the block filter")
    assert.ok(r.includes("getBotUserId") || r.includes("botUser"), "TerpBot stays exempt from member blocks")
  })

  check("isStaleBatch rejects when no room is active", () => {
    assert.equal(isStaleBatch("roomA", null, false), true)
  })

  // ── Pure helpers: room-state events ──────────────────────────────────

  check("applyRoomState applies lock and slowmode", () => {
    const room = { locked: false, slowModeSeconds: 0 }
    assert.deepEqual(applyRoomState(room, { locked: true }), { locked: true, slowModeSeconds: 0 })
    assert.deepEqual(applyRoomState(room, { slowModeSeconds: 30 }), { locked: false, slowModeSeconds: 30 })
  })

  check("applyRoomState leaves fields untouched when absent (cleared)", () => {
    const room = { locked: true, slowModeSeconds: 10 }
    assert.deepEqual(applyRoomState(room, { cleared: true }), room)
  })

  // ── Pure helpers: last-seen / unread ─────────────────────────────────

  check("first observation baselines — nothing shows as unread", () => {
    const s = fakeStore()
    const unread = syncUnread([{ id: "r1", latestAt: "2026-01-01T00:00:00Z" }], s)
    assert.equal(unread.size, 0)
    assert.equal(getLastSeen(s, "r1"), "2026-01-01T00:00:00Z", "baseline recorded")
  })

  check("new activity after init creates unread", () => {
    const s = fakeStore()
    syncUnread([{ id: "r1", latestAt: "2026-01-01T00:00:00Z" }], s)
    const unread = syncUnread([{ id: "r1", latestAt: "2026-01-01T01:00:00Z" }], s)
    assert.ok(unread.has("r1"))
  })

  check("visiting a room clears its unread", () => {
    const s = fakeStore()
    syncUnread([{ id: "r1", latestAt: "2026-01-01T00:00:00Z" }], s)
    markRoomSeen(s, "r1", "2026-01-01T02:00:00Z")
    const unread = syncUnread([{ id: "r1", latestAt: "2026-01-01T02:00:00Z" }], s)
    assert.equal(unread.size, 0)
  })

  check("unread is independent per room", () => {
    const s = fakeStore()
    syncUnread(
      [
        { id: "r1", latestAt: "2026-01-01T00:00:00Z" },
        { id: "r2", latestAt: "2026-01-01T00:00:00Z" },
      ],
      s
    )
    markRoomSeen(s, "r1", "2026-01-01T03:00:00Z")
    const unread = syncUnread(
      [
        { id: "r1", latestAt: "2026-01-01T03:00:00Z" },
        { id: "r2", latestAt: "2026-01-01T04:00:00Z" },
      ],
      s
    )
    assert.ok(!unread.has("r1"), "visited room stays read")
    assert.ok(unread.has("r2"), "other room flags unread")
  })

  check("last-seen persists across reload (same store)", () => {
    const s = fakeStore()
    syncUnread([{ id: "r1", latestAt: "2026-01-01T00:00:00Z" }], s)
    markRoomSeen(s, "r1", "2026-01-01T05:00:00Z")
    // Simulated reload — fresh sync against the same store.
    const unread = syncUnread([{ id: "r1", latestAt: "2026-01-01T05:00:00Z" }], s)
    assert.equal(unread.size, 0)
  })

  check("a never-seen room with messages is unread for an initialized user", () => {
    const s = fakeStore()
    syncUnread([{ id: "r1", latestAt: "2026-01-01T00:00:00Z" }], s) // init
    const unread = syncUnread([{ id: "rNEW", latestAt: "2026-01-01T01:00:00Z" }], s)
    assert.ok(unread.has("rNEW"))
  })

  check("rooms with no messages never show unread", () => {
    const s = fakeStore()
    syncUnread([], s) // init with nothing
    const unread = syncUnread([{ id: "r1", latestAt: null }], s)
    assert.equal(unread.size, 0)
  })

  check("markRoomSeen never moves the marker backwards", () => {
    const s = fakeStore()
    markRoomSeen(s, "r1", "2026-01-01T05:00:00Z")
    markRoomSeen(s, "r1", "2026-01-01T01:00:00Z")
    assert.equal(getLastSeen(s, "r1"), "2026-01-01T05:00:00Z")
  })

  check("firstUnreadId finds the first post-seen message", () => {
    const msgs = [
      msg("a", "r", "2026-01-01T00:00:00Z"),
      msg("b", "r", "2026-01-01T01:00:00Z"),
      msg("c", "r", "2026-01-01T02:00:00Z"),
    ]
    assert.equal(firstUnreadId(msgs, "2026-01-01T00:30:00Z"), "b")
    assert.equal(firstUnreadId(msgs, "2026-01-01T03:00:00Z"), null, "all read → no boundary")
    assert.equal(firstUnreadId(msgs, null), null, "no last-seen → no boundary")
  })

  check("last-room round-trips through storage", () => {
    const s = fakeStore()
    assert.equal(getLastRoom(s), null)
    setLastRoom(s, "grow-room")
    assert.equal(getLastRoom(s), "grow-room")
  })

  // ── Source wiring ────────────────────────────────────────────────────

  const nav = src("components/navigation.tsx")
  check("navigation uses the shared Pusher singleton", () => {
    assert.ok(nav.includes("getSharedPusher"), "nav must reuse getSharedPusher")
    assert.ok(!nav.includes("new Pusher("), "nav must not construct its own Pusher")
  })

  check("navigation shows an unread dot, not an online count", () => {
    assert.ok(nav.includes("chatUnread"), "nav tracks unread state")
    assert.ok(!nav.includes("chatOnline"), "misleading online-count badge removed")
    assert.ok(!/href="\/chat"[^>]*lg:hidden/.test(nav), "duplicate mobile header chat icon removed")
  })

  const room = src("components/chat-room.tsx")
  check("no composer autofocus on load (mobile keyboard stays down)", () => {
    assert.ok(
      !room.includes("if (room && !room.locked) inputRef.current?.focus()"),
      "autofocus effect must be gone"
    )
  })

  check("every local append goes through mergeMessages (dedupe)", () => {
    assert.ok(
      (room.match(/mergeMessages\(prev, \[data\.message\]\)/g) || []).length >= 2,
      "send + command responses both merge by id"
    )
    assert.ok(!room.includes("[...prev, data.message]"), "no direct response append")
  })

  check("client subscribes to the room-state event", () => {
    assert.ok(room.includes("CHAT_ROOM_STATE_EVENT"), "room-state binding present")
  })

  check("permanent room rail removed", () => {
    assert.ok(!room.includes("w-52"), "208px rail is gone")
    assert.ok(room.includes('role="listbox"'), "room picker present")
  })

  const commands = src("app/api/chat/commands/route.ts")
  check("room-state fans out for lock, unlock, slowmode, and clear", () => {
    const pushes = commands.match(/trigger\(`private-chat-\$\{roomId\}`, "room-state"/g) || []
    assert.ok(pushes.length >= 4, `expected >=4 room-state triggers, found ${pushes.length}`)
  })

  const messagesRoute = src("app/api/chat/messages/route.ts")
  check("message DTO carries roomId for the room-switch guard", () => {
    assert.ok(messagesRoute.includes("roomId: m.roomId"), "roomId in DTO")
  })

  const mobileNav = src("components/mobile-nav.tsx")
  check("mobile bottom nav carries the chat unread dot", () => {
    assert.ok(mobileNav.includes("chatUnread"), "chatUnread prop wired")
  })

  // ── Database-backed: activity visibility boundaries ──────────────────

  const member = await prisma.user.create({
    data: { name: `${TAG}_member`, ageVerified: true, sessionVersion: 1, profile: { create: { username: `${TAG}_member` } } },
    select: { id: true },
  })
  const staff = await prisma.user.create({
    data: { name: `${TAG}_staff`, role: "MODERATOR", ageVerified: true, sessionVersion: 1, profile: { create: { username: `${TAG}_staff` } } },
    select: { id: true },
  })
  const highRep = await prisma.user.create({
    data: { name: `${TAG}_highrep`, ageVerified: true, sessionVersion: 1, profile: { create: { username: `${TAG}_highrep`, reputation: 99999 } } },
    select: { id: true },
  })
  await prisma.reputationEvent.create({
    data: { userId: highRep.id, type: "STAFF_ADJUSTMENT", amount: 99999, reason: "test seed" },
  })

  const publicRoom = await prisma.chatRoom.create({
    data: { name: `${TAG} Public`, slug: `${TAG}-pub`, order: 900 },
  })
  const privateRoom = await prisma.chatRoom.create({
    data: { name: `${TAG} Private`, slug: `${TAG}-priv`, isPrivate: true, order: 901 },
  })
  const gatedRoom = await prisma.chatRoom.create({
    data: { name: `${TAG} Gated`, slug: `${TAG}-gated`, requiredRep: 3500, order: 902 },
  })

  const prevGrowFlag = await getSetting(SITE_SETTINGS.GROW_ROOM_ENABLED)

  try {
    await prisma.chatMessage.createMany({
      data: [
        { roomId: publicRoom.id, authorId: member.id, content: "hello", createdAt: new Date("2026-01-01T02:00:00Z") },
        { roomId: privateRoom.id, authorId: staff.id, content: "staff only", createdAt: new Date("2026-01-01T03:00:00Z") },
        { roomId: gatedRoom.id, authorId: highRep.id, content: "gated talk", createdAt: new Date("2026-01-01T03:00:00Z") },
        // Deleted later than the live message — latestAt must still be the live one.
        { roomId: publicRoom.id, authorId: member.id, content: "deleted one", deleted: true, createdAt: new Date("2026-01-01T04:00:00Z") },
      ],
    })

    const memberActivity = await getChatActivity(member.id)
    const memberIds = memberActivity.rooms.map((r) => r.id)
    assert.ok(memberIds.includes(publicRoom.id), "public room visible")
    assert.ok(!memberIds.includes(privateRoom.id), "private room never leaks")
    assert.ok(!memberIds.includes(gatedRoom.id), "gated room hidden while flag is off")
    console.log("PASS badge activity excludes private + flag-off gated rooms")
    passed++

    const pubRoom = memberActivity.rooms.find((r) => r.id === publicRoom.id)!
    assert.equal(
      pubRoom.latestAt,
      "2026-01-01T02:00:00.000Z",
      "latestAt is the newest NON-deleted message"
    )
    console.log("PASS latestAt ignores deleted messages")
    passed++

    // Flag on → gated room appears for staff + qualified members only.
    await prisma.setting.upsert({
      where: { key: SITE_SETTINGS.GROW_ROOM_ENABLED },
      update: { value: "true" },
      create: { key: SITE_SETTINGS.GROW_ROOM_ENABLED, value: "true" },
    })
    const staffActivity = await getChatActivity(staff.id)
    const highRepActivity = await getChatActivity(highRep.id)
    const lowRepActivity = await getChatActivity(member.id)
    assert.ok(staffActivity.rooms.some((r) => r.id === gatedRoom.id), "staff see gated room")
    assert.ok(highRepActivity.rooms.some((r) => r.id === gatedRoom.id), "qualified member sees gated room")
    assert.ok(!lowRepActivity.rooms.some((r) => r.id === gatedRoom.id), "low-rep member cannot see gated room")
    assert.ok(!staffActivity.rooms.some((r) => r.id === privateRoom.id), "private room hidden even from staff badge")
    console.log("PASS gated room visibility follows reputation + staff boundary")
    passed++
    await prisma.setting.update({
      where: { key: SITE_SETTINGS.GROW_ROOM_ENABLED },
      data: { value: prevGrowFlag ?? "false" },
    })

    // Homepage teaser — public rooms only, metadata only.
    const teaser = await getChatTeaser()
    assert.ok(teaser, "teaser resolves")
    const teaserRoom = await prisma.chatRoom.findFirst({ where: { slug: teaser!.roomSlug } })
    assert.ok(teaserRoom && !teaserRoom.isPrivate && teaserRoom.requiredRep == null,
      "teaser room must be fully public — never gated or private")
    assert.ok(!("content" in teaser!), "teaser exposes no message content")
    console.log("PASS homepage teaser is public-room metadata only")
    passed++
  } finally {
    // Restore flag + wipe fixtures.
    await prisma.setting
      .upsert({
        where: { key: SITE_SETTINGS.GROW_ROOM_ENABLED },
        update: { value: prevGrowFlag ?? "false" },
        create: { key: SITE_SETTINGS.GROW_ROOM_ENABLED, value: prevGrowFlag ?? "false" },
      })
      .catch(() => {})
    await prisma.chatMessage.deleteMany({
      where: { roomId: { in: [publicRoom.id, privateRoom.id, gatedRoom.id] } },
    })
    await prisma.chatRoom.deleteMany({ where: { slug: { startsWith: TAG } } })
    await prisma.user.deleteMany({ where: { name: { startsWith: TAG } } })
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => prisma.$disconnect())
