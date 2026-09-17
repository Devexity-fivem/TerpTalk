// Pure client-side chat helpers — no Prisma, no next/server, no DOM required.
// The Chat UI and navigation import these; tests exercise them directly with
// a fake storage object.

export interface ChatMessageLite {
  id: string
  roomId: string
  createdAt: string
}

export interface ChatRoomState {
  locked: boolean
  slowModeSeconds: number
}

// Minimal room-state event payload pushed on the room's existing private
// channel. Only fields subscribers are already authorized to see.
export interface RoomStateEvent {
  locked?: boolean
  slowModeSeconds?: number
  cleared?: boolean
}

export const CHAT_MESSAGE_EVENT = "new-message"
export const CHAT_ROOM_STATE_EVENT = "room-state"

// ── Message list merging ────────────────────────────────────────────────

// Canonical append path for every way a message reaches the list — GET
// batches, Pusher pushes, and own-send/command responses. Dedupes on the
// message id so a message arriving via two paths renders exactly once.
export function mergeMessages<T extends ChatMessageLite>(
  prev: T[],
  fresh: T[],
  cap = 100
): T[] {
  if (fresh.length === 0) return prev
  const seen = new Set(prev.map((m) => m.id))
  const added = fresh.filter((m) => !seen.has(m.id))
  if (added.length === 0) return prev
  return [...prev, ...added].slice(-cap)
}

// Room-switch guard: a batch/event is stale when it was fetched for a room
// that is no longer active, or the subscribing effect has been cleaned up.
export function isStaleBatch(
  batchRoomId: string | null | undefined,
  activeRoomId: string | null | undefined,
  cancelled: boolean
): boolean {
  if (cancelled) return true
  if (!activeRoomId) return true
  return batchRoomId !== activeRoomId
}

// Apply a room-state event to the local room object. `cleared` is handled by
// the caller (it empties the message list, not a room field).
export function applyRoomState<T extends ChatRoomState>(room: T, state: RoomStateEvent): T {
  return {
    ...room,
    ...(state.locked !== undefined ? { locked: state.locked } : {}),
    ...(state.slowModeSeconds !== undefined ? { slowModeSeconds: state.slowModeSeconds } : {}),
  }
}

// ── Last-seen / unread state (localStorage) ─────────────────────────────

// localStorage-compatible surface — tests inject a Map-backed fake.
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const SEEN_PREFIX = "terptalk:chat:last-seen:"
const LAST_ROOM_KEY = "terptalk:chat:last-room"
const INIT_KEY = "terptalk:chat:initialized"
// Window event the chat page dispatches after marking rooms seen so other
// components (nav badge) recompute without waiting for the next poll.
export const CHAT_SEEN_EVENT = "tt-chat-seen"

export function getLastSeen(store: StorageLike, roomId: string): string | null {
  return store.getItem(SEEN_PREFIX + roomId)
}

export function markRoomSeen(store: StorageLike, roomId: string, latestAt: string): void {
  const prev = getLastSeen(store, roomId)
  if (prev === null || latestAt > prev) store.setItem(SEEN_PREFIX + roomId, latestAt)
}

export function getLastRoom(store: StorageLike): string | null {
  return store.getItem(LAST_ROOM_KEY)
}

export function setLastRoom(store: StorageLike, slug: string): void {
  store.setItem(LAST_ROOM_KEY, slug)
}

export interface RoomActivity {
  id: string
  latestAt: string | null
}

// Compare per-room latest-activity timestamps against stored last-seen state.
//
// Baseline rule: on the FIRST observation ever (no init sentinel), every
// room's current latestAt is recorded as seen — the dot then means "new
// since you've been around", not "things you never saw". After init, a room
// with messages but no stored last-seen (new room, cleared storage for one
// key) counts as unread.
export function syncUnread(rooms: RoomActivity[], store: StorageLike): Set<string> {
  const initialized = store.getItem(INIT_KEY) !== null
  const unread = new Set<string>()
  for (const room of rooms) {
    const stored = getLastSeen(store, room.id)
    if (stored === null) {
      if (!initialized) {
        if (room.latestAt) markRoomSeen(store, room.id, room.latestAt)
      } else if (room.latestAt) {
        unread.add(room.id)
      }
      continue
    }
    if (room.latestAt && room.latestAt > stored) unread.add(room.id)
  }
  if (!initialized) store.setItem(INIT_KEY, "1")
  return unread
}

// First unread message in a chronologically sorted list, given a last-seen
// timestamp. Null lastSeen means "never visited this room" → everything the
// user can see is new only when they were initialized elsewhere; callers
// pass an explicit baseline instead (see ChatRoom).
export function firstUnreadId<T extends ChatMessageLite>(
  messages: T[],
  lastSeen: string | null
): string | null {
  if (lastSeen === null) return null
  const hit = messages.find((m) => m.createdAt > lastSeen)
  return hit ? hit.id : null
}
