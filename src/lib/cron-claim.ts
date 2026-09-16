import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"

// Atomic period-task claiming for cron jobs. Each task is claimed with a
// Setting row (unique key). The claim value is `running:<ts>` while work
// executes and `1` once it succeeds. A crash or failure leaves a claim that
// either goes stale (reclaimed by a later run) or is released immediately on
// failure — so a failed task retries on the next invocation instead of
// being silently marked complete for the whole period.

const CLAIM_STALE_MS = 10 * 60 * 1000

// Atomically claim a period task. Returns false when the task is already
// done or actively running under a non-stale claim.
export async function claimTask(key: string): Promise<boolean> {
  try {
    await prisma.setting.create({ data: { key, value: `running:${Date.now()}` } })
    return true
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e
  }
  const existing = await prisma.setting.findUnique({ where: { key }, select: { value: true } })
  if (!existing || existing.value === "1") return false
  const m = /^running:(\d+)$/.exec(existing.value)
  const claimedAt = m ? Number(m[1]) : 0
  if (Date.now() - claimedAt < CLAIM_STALE_MS) return false // another runner is active
  // Conditional swap — only reclaim if the row is still the stale value we read.
  const { count } = await prisma.setting.updateMany({
    where: { key, value: existing.value },
    data: { value: `running:${Date.now()}` },
  })
  return count === 1
}

export async function markDone(key: string) {
  await prisma.setting.update({
    where: { key },
    data: { value: "1" },
  })
}

// Release a claim after a failed run so the next invocation retries.
export async function releaseClaim(key: string) {
  await prisma.setting.deleteMany({ where: { key } })
}

// Run one period task under an atomic claim; done only after success.
// Every failure mode is isolated to this task — a throwing claim layer or a
// bookkeeping error must never abort the route's remaining tasks.
export async function runCronTask(
  key: string,
  work: () => Promise<string | null>,
  posted: string[],
  failed: string[],
  label: string
) {
  let claimed: boolean
  try {
    claimed = await claimTask(key)
  } catch (e) {
    console.error(`[cron] ${label} claim failed:`, e)
    failed.push(label)
    return
  }
  if (!claimed) return
  try {
    const result = await work()
    try {
      await markDone(key)
    } catch (e) {
      // Work succeeded but bookkeeping failed. Retrying the mark once
      // covers a transient write error; if it still fails we deliberately
      // leave the claim in place — it goes stale after CLAIM_STALE_MS and a
      // later run re-checks, rather than releasing it into a guaranteed
      // immediate duplicate execution.
      console.error(`[cron] ${label} markDone failed after successful work — retrying once:`, e)
      try {
        await markDone(key)
        if (result) posted.push(result)
      } catch (e2) {
        console.error(`[cron] ${label} markDone retry failed — claim left in place:`, e2)
        failed.push(`${label}:bookkeeping`)
      }
      return
    }
    if (result) posted.push(result)
  } catch (e) {
    console.error(`[cron] ${label} failed:`, e)
    await releaseClaim(key).catch(() => {})
    failed.push(label)
  }
}
