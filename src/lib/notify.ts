import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getPusher } from "@/lib/pusher"
import { blockExistsBetween } from "@/lib/security"

// ─── Notification taxonomy ─────────────────────────────────────────
// `type` stays a free string in the DB (no migration per new type) but
// all values are governed by this allowlist + category/pref maps.

export const NOTIFICATION_TYPES = [
  "FOLLOW",
  "REACTION",
  "REPLY",
  "MENTION",
  "COMMENT",
  "THREAD_ACTIVITY",
  "DIARY_UPDATE",
  "DIRECT_MESSAGE",
  "ACCEPTED_ANSWER",
  "BADGE",
  "REPUTATION",
  "REFERRAL",
  "MODERATOR_ANNOUNCEMENT",
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

// Stable high-level buckets — lets future features (digests, "while you
// were away", settings grouping) work off `category` semantics without
// schema changes.
export const NOTIFICATION_CATEGORIES = {
  SOCIAL: "SOCIAL",
  CONTENT: "CONTENT",
  MILESTONE: "MILESTONE",
  MESSAGING: "MESSAGING",
  MODERATION: "MODERATION",
  SYSTEM: "SYSTEM",
} as const

export const TYPE_CATEGORY: Record<NotificationType, string> = {
  FOLLOW: "SOCIAL",
  REACTION: "SOCIAL",
  MENTION: "SOCIAL",
  REPLY: "CONTENT",
  COMMENT: "CONTENT",
  THREAD_ACTIVITY: "CONTENT",
  DIARY_UPDATE: "CONTENT",
  ACCEPTED_ANSWER: "CONTENT",
  DIRECT_MESSAGE: "MESSAGING",
  BADGE: "MILESTONE",
  REPUTATION: "MILESTONE",
  REFERRAL: "SYSTEM",
  MODERATOR_ANNOUNCEMENT: "MODERATION",
}

// Which Profile preference gates each type. Types absent here are
// security/account-critical and cannot be disabled.
export const TYPE_PREF = {
  REPLY: "notifyOnReply",
  MENTION: "notifyOnMention",
  THREAD_ACTIVITY: "notifyOnCategoryFollow",
  DIRECT_MESSAGE: "notifyOnMessage",
  COMMENT: "notifyOnComment",
  DIARY_UPDATE: "notifyOnComment",
  FOLLOW: "notifyOnFollow",
  REACTION: "notifyOnReaction",
} as const

export type NotifyPrefKey = (typeof TYPE_PREF)[keyof typeof TYPE_PREF]

const PREF_SELECT = {
  notifyOnReply: true,
  notifyOnMention: true,
  notifyOnCategoryFollow: true,
  notifyOnMessage: true,
  notifyOnComment: true,
  notifyOnFollow: true,
  notifyOnReaction: true,
} as const

// Actor fields exposed to the client — username + avatar only.
export const NOTIFICATION_ACTOR_SELECT = {
  id: true,
  name: true,
  image: true,
  profile: {
    select: {
      username: true,
      avatarUrl: true,
    },
  },
} as const

export interface NotifyInput {
  /** Recipient */
  userId: string
  type: NotificationType
  title: string
  content: string
  link?: string | null
  /** User that triggered the notification (omit for system/mod messages) */
  actorId?: string | null
  /** Dedupe/grouping key, e.g. `REACTION:post:abc` or `FOLLOW:a:b` */
  groupKey?: string | null
  metadata?: Prisma.InputJsonValue
  /** If set, suppress creation for this many ms when an identical
   *  (userId, type, actorId, groupKey|link) notification already exists. */
  dedupeMs?: number
  /** Skip realtime push (rarely needed) */
  push?: boolean
}

interface RecipientState {
  banned: boolean
  suspendedUntil: Date | null
  profile: { [K in keyof typeof PREF_SELECT]: boolean } | null
}

function recipientBlocked(s: RecipientState | null): boolean {
  if (!s) return true // unknown user — don't write orphan notifications
  if (s.banned) return true
  if (s.suspendedUntil && s.suspendedUntil > new Date()) return true
  return false
}

async function loadRecipients(userIds: string[]): Promise<Map<string, RecipientState>> {
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      banned: true,
      suspendedUntil: true,
      profile: { select: PREF_SELECT },
    },
  })
  return new Map(users.map((u) => [u.id, u]))
}

function prefAllows(state: RecipientState, type: NotificationType): boolean {
  const key = TYPE_PREF[type as keyof typeof TYPE_PREF]
  if (!key) return true
  return state.profile?.[key] !== false
}

const ACTOR_INCLUDE = { actor: { select: NOTIFICATION_ACTOR_SELECT } } as const

type NotificationWithActor = Prisma.NotificationGetPayload<{ include: typeof ACTOR_INCLUDE }>

function toPushDto(n: NotificationWithActor) {
  const a = n.actor
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    content: n.content,
    link: n.link,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
    actor: a
      ? {
          name: a.name ?? a.profile?.username ?? "Someone",
          username: a.profile?.username ?? null,
          image: a.image ?? a.profile?.avatarUrl ?? null,
        }
      : null,
  }
}

function pushNotification(userId: string, dto: ReturnType<typeof toPushDto>) {
  getPusher()
    ?.trigger(`private-user-${userId}`, "new-notification", dto)
    .catch(() => {})
}

/**
 * Emit the realtime event for a notification created outside `notify()`
 * (e.g. inside a $transaction). Fire-and-forget.
 */
export function emitNotificationPush(
  userId: string,
  n: { id: string; type: string; title: string; content: string; link: string | null; read: boolean; createdAt: Date }
) {
  pushNotification(userId, {
    id: n.id,
    type: n.type,
    title: n.title,
    content: n.content,
    link: n.link,
    read: n.read,
    createdAt: n.createdAt.toISOString(),
    actor: null,
  })
}

/**
 * Create a single notification with built-in safety:
 * self-action guard, recipient banned check, per-user preference check,
 * block check, time-window dedupe, and realtime fan-out.
 */
export async function notify(input: NotifyInput): Promise<NotificationWithActor | null> {
  try {
    if (input.actorId && input.actorId === input.userId) return null

    const recipients = await loadRecipients([input.userId])
    const state = recipients.get(input.userId)
    if (!state || recipientBlocked(state)) return null
    if (!prefAllows(state, input.type)) return null

    if (input.actorId && (await blockExistsBetween(input.actorId, input.userId))) return null

    if (input.dedupeMs) {
      const since = new Date(Date.now() - input.dedupeMs)
      const existing = await prisma.notification.findFirst({
        where: {
          userId: input.userId,
          type: input.type,
          actorId: input.actorId ?? null,
          createdAt: { gte: since },
          ...(input.groupKey ? { groupKey: input.groupKey } : { link: input.link ?? null }),
        },
        select: { id: true },
      })
      if (existing) return null
    }

    const notification = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        content: input.content.slice(0, 500),
        link: input.link ?? null,
        actorId: input.actorId ?? null,
        groupKey: input.groupKey ?? null,
        metadata: input.metadata,
      },
      include: ACTOR_INCLUDE,
    })

    if (input.push !== false) pushNotification(input.userId, toPushDto(notification))
    return notification
  } catch {
    return null
  }
}

/**
 * Batch version of `notify` for fan-out (category followers, diary
 * followers, mentions, broadcasts). Applies the same recipient filters
 * in bulk, then createMany + per-user realtime events.
 */
export async function notifyMany(inputs: NotifyInput[]): Promise<number> {
  try {
    if (inputs.length === 0) return 0

    const recipientIds = [...new Set(inputs.map((i) => i.userId))]
    const recipients = await loadRecipients(recipientIds)

    // Collect block relationships for all distinct actors in one query.
    const actorIds = [...new Set(inputs.map((i) => i.actorId).filter((a): a is string => !!a))]
    const blockedPairs = new Set<string>()
    if (actorIds.length > 0) {
      const blocks = await prisma.block.findMany({
        where: {
          OR: [
            { blockerId: { in: actorIds }, blockedId: { in: recipientIds } },
            { blockerId: { in: recipientIds }, blockedId: { in: actorIds } },
          ],
        },
        select: { blockerId: true, blockedId: true },
      })
      for (const b of blocks) {
        blockedPairs.add(`${b.blockerId}:${b.blockedId}`)
        blockedPairs.add(`${b.blockedId}:${b.blockerId}`)
      }
    }

    const allowed = inputs.filter((i) => {
      if (i.actorId && i.actorId === i.userId) return false
      const state = recipients.get(i.userId)
      if (!state || recipientBlocked(state) || !prefAllows(state, i.type)) return false
      if (i.actorId && blockedPairs.has(`${i.actorId}:${i.userId}`)) return false
      return true
    })
    if (allowed.length === 0) return 0

    const result = await prisma.notification.createMany({
      data: allowed.map((i) => ({
        userId: i.userId,
        type: i.type,
        title: i.title.slice(0, 200),
        content: i.content.slice(0, 500),
        link: i.link ?? null,
        actorId: i.actorId ?? null,
        groupKey: i.groupKey ?? null,
        metadata: i.metadata,
      })),
    })

    // Realtime fan-out — best effort, DB is source of truth.
    const pusher = getPusher()
    if (pusher) {
      const dtoBase = (i: NotifyInput) => ({
        type: i.type,
        title: i.title.slice(0, 200),
        content: i.content.slice(0, 500),
        link: i.link ?? null,
        read: false,
      })
      await Promise.allSettled(
        allowed
          .filter((i) => i.push !== false)
          .map((i) => pusher.trigger(`private-user-${i.userId}`, "new-notification", dtoBase(i)))
      )
    }

    return result.count
  } catch {
    return 0
  }
}

/**
 * Remove notifications that link to a deleted target so users never see
 * a live link to removed content. Called from content soft-delete paths.
 */
export async function invalidateNotificationsForLink(link: string): Promise<void> {
  try {
    await prisma.notification.deleteMany({ where: { link } })
  } catch {
    // non-fatal
  }
}
