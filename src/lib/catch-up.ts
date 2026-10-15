// Member catch-up — the "past week" rollup behind the /feed Catch up card.
//
// Truthfulness contract: the product has NO reliable last-visit cursor
// (`lastSeenAt` is a 15-minute presence heartbeat — see /api/ping), so this
// module deliberately reports a fixed 7-day window and the UI says
// "the past week", never "since your last visit".
//
// Sources (all canonical, all privacy/block scoped at the query layer):
// - Unread notifications: rows already authorized, block-checked and
//   preference-gated at creation time by notify()/notifyMany().
// - Followed activity: the real "following" feed scope (resolveFeedScope +
//   getFeedPage) — follow-graph scoping, block exclusion, and
//   PUBLIC/UNLISTED-followed diary visibility come free.
// - Open questions: helpWantedForUser — the same evidence-matched,
//   viewer-eligible set the member-home card uses.
//
// Bounded: 4 notices, a 12-row feed page reduced to 4 items, 3 questions.
import { prisma } from "@/lib/prisma"
import { resolveFeedScope, getFeedPage } from "@/lib/feed"
import { helpWantedForUser, helpWantedReasonText } from "@/lib/answer-match"
import type { HelpWantedItem } from "@/lib/answer-match"
import { sanitizeEcho } from "@/lib/terpbot"

export const CATCH_UP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const NOTICE_TAKE = 4
const FOLLOWED_TAKE = 4

export interface CatchUpNotice {
  id: string
  type: string
  title: string
  link: string | null
  createdAt: Date
}

export interface CatchUpActivity {
  href: string
  kind: "update" | "thread" | "harvest"
  /** Display-safe line, e.g. "@alice posted an update on \"OG Kush\"" */
  text: string
}

export interface CatchUpData {
  notices: CatchUpNotice[]
  /** Total unread — the count can exceed notices.length. */
  unreadCount: number
  followed: CatchUpActivity[]
  helpWanted: { total: number; items: (HelpWantedItem & { reasonText: string })[] }
}

export async function catchUpForUser(userId: string, now = new Date()): Promise<CatchUpData> {
  const since = new Date(now.getTime() - CATCH_UP_WINDOW_MS)

  const [unreadCount, notices, scope, helpWanted] = await Promise.all([
    prisma.notification.count({ where: { userId, read: false } }),
    prisma.notification.findMany({
      where: { userId, read: false },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: NOTICE_TAKE,
      select: { id: true, type: true, title: true, link: true, createdAt: true },
    }),
    resolveFeedScope(userId, "following"),
    helpWantedForUser(userId).catch(() => ({ total: 0, items: [] as HelpWantedItem[] })),
  ])

  const followed: CatchUpActivity[] = []
  if (scope.personalized && !scope.coldStart) {
    const page = await getFeedPage({ scope, kinds: ["update", "thread", "harvest"], limit: 12 })
    for (const it of page.items) {
      if (followed.length >= FOLLOWED_TAKE) break
      if (it.sortAt < since) continue
      const author = `@${it.data.author.profile?.username ?? it.data.author.name ?? "member"}`
      if (it.kind === "update") {
        followed.push({ href: it.href, kind: "update", text: `${author} updated "${sanitizeEcho(it.data.diary.title, 50)}"` })
      } else if (it.kind === "thread") {
        followed.push({ href: it.href, kind: "thread", text: `${author} started "${sanitizeEcho(it.data.title, 60)}"` })
      } else if (it.kind === "harvest") {
        followed.push({ href: it.href, kind: "harvest", text: `${author} harvested "${sanitizeEcho(it.data.title, 50)}"` })
      }
    }
  }

  return {
    notices,
    unreadCount,
    followed,
    helpWanted: {
      total: helpWanted.total,
      items: helpWanted.items.map((i) => ({ ...i, reasonText: helpWantedReasonText(i) })),
    },
  }
}

export function catchUpHasContent(d: CatchUpData | null | undefined): boolean {
  return !!d && (d.notices.length > 0 || d.followed.length > 0 || d.helpWanted.items.length > 0)
}
