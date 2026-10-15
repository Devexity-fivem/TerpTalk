// Grow-loop diary reminders — server-only.
//
// Daily cron lane (/api/cron/diary-reminders) that finds ACTIVE grow
// diaries with no real DiaryUpdate in the last REMINDER_WINDOW_MS and
// sends the owner ONE aggregated DIARY_REMINDER notification.
//
// Contract:
// - Eligibility is canonical: deleted:false, harvested:false, stage not
//   HARVESTED/COMPLETE, author not banned/suspended. Staleness is judged
//   on the latest DiaryUpdate.createdAt — NOT the diary's updatedAt,
//   which any parent-row edit would touch. A diary with no updates falls
//   back to its createdAt.
// - One notification per member per window. Several stale diaries
//   aggregate into a single reminder pointing at the stalest one.
// - Throttle is durable and doubles as idempotency: a DIARY_REMINDER row
//   for the member inside the window suppresses the send, so repeated or
//   retried cron invocations cannot duplicate. The per-member weekly
//   Setting claim additionally collapses concurrent invocations.
// - Preference: notifyOnDiaryReminder gates creation inside notify()
//   (TYPE_PREF), so opting out blocks both in-app and push delivery.
// - Push: DIARY_REMINDER is allowlisted in web-push.pushCategory — the
//   notification goes to the owner's own subscriptions only; the link is
//   a root-relative diary path, so no private content leaves the device.
// - Bounded: CANDIDATE_CAP diaries per run, SEND_CAP sends per run, one
//   grouped query for latest-update dates (no N+1).
import { prisma } from "@/lib/prisma"
import { notify } from "@/lib/notify"
import { activeAuthor } from "@/lib/security"
import { diaryPath } from "@/lib/slugs"
import { sanitizeEcho } from "@/lib/terpbot"
import { claimTask, markDone, releaseClaim } from "@/lib/cron-claim"
import { currentWeekKey } from "@/lib/week"

export const DIARY_REMINDER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const CANDIDATE_CAP = 200
const SEND_CAP = 100

export async function sendDiaryReminders(opts: {
  /** Test seam: restrict the scan to these author ids. Omit in production. */
  authorIds?: string[]
  now?: Date
} = {}): Promise<{ scanned: number; reminded: number }> {
  const now = opts.now ?? new Date()
  const cutoff = new Date(now.getTime() - DIARY_REMINDER_WINDOW_MS)

  const diaries = await prisma.growDiary.findMany({
    where: {
      deleted: false,
      harvested: false,
      stage: { notIn: ["HARVESTED", "COMPLETE"] },
      updatedAt: { lt: cutoff },
      author: activeAuthor(),
      ...(opts.authorIds ? { authorId: { in: opts.authorIds } } : {}),
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: CANDIDATE_CAP,
    select: { id: true, slug: true, title: true, authorId: true, createdAt: true },
  })
  if (!diaries.length) return { scanned: 0, reminded: 0 }

  // Latest real update per candidate — one grouped query, not N+1.
  const latestRows = await prisma.diaryUpdate.groupBy({
    by: ["diaryId"],
    where: { diaryId: { in: diaries.map((d) => d.id) } },
    _max: { createdAt: true },
  })
  const lastAt = new Map(latestRows.map((r) => [r.diaryId, r._max.createdAt]))
  const lastActivityAt = (d: (typeof diaries)[number]) => lastAt.get(d.id) ?? d.createdAt

  const stale = diaries.filter((d) => lastActivityAt(d) < cutoff)
  if (!stale.length) return { scanned: diaries.length, reminded: 0 }

  // One reminder per member — aggregate their stale diaries, stalest first.
  const byMember = new Map<string, typeof stale>()
  for (const d of stale) {
    const list = byMember.get(d.authorId) ?? []
    list.push(d)
    byMember.set(d.authorId, list)
  }

  // Durable throttle: any DIARY_REMINDER for this member inside the
  // window suppresses the send. Doubles as retry/re-invocation idempotency.
  const throttledRows = await prisma.notification.findMany({
    where: { userId: { in: [...byMember.keys()] }, type: "DIARY_REMINDER", createdAt: { gte: cutoff } },
    select: { userId: true },
    distinct: ["userId"],
  })
  const throttled = new Set(throttledRows.map((r) => r.userId))

  const weekKey = currentWeekKey(now)
  let reminded = 0
  for (const [userId, list] of byMember) {
    if (reminded >= SEND_CAP) break
    if (throttled.has(userId)) continue
    list.sort((a, b) => lastActivityAt(a).getTime() - lastActivityAt(b).getTime())

    // Atomic per-member weekly claim — concurrent invocations collapse to
    // one sender. Released on a failed/policy-dropped send so the member
    // stays retryable; marked done on success.
    const claimKey = `diary-reminder:${userId}:${weekKey}`
    if (!(await claimTask(claimKey))) continue

    const target = list[0]
    const days = Math.max(1, Math.floor((now.getTime() - lastActivityAt(target).getTime()) / 86400000))
    const extra = list.length - 1
    const n = await notify({
      userId,
      type: "DIARY_REMINDER",
      title: "Your grow is waiting for an update",
      content:
        `"${sanitizeEcho(target.title, 60)}" hasn't been updated in ${days} day${days === 1 ? "" : "s"}.` +
        (extra > 0 ? ` ${extra} more active grow${extra === 1 ? "" : "s"} could use one too.` : "") +
        " A quick photo or note keeps the record alive.",
      link: diaryPath(target),
      groupKey: "diary-reminder",
      dedupeMs: DIARY_REMINDER_WINDOW_MS,
    })
    if (n) {
      await markDone(claimKey).catch(() => {})
      reminded++
    } else {
      await releaseClaim(claimKey).catch(() => {})
    }
  }
  return { scanned: diaries.length, reminded }
}
