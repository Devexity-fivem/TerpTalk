// Velocity-detector regression tests — verifies the abuse detector counts
// member-driven reputation only and ignores system-generated payouts
// (BADGE_BONUS, WEEKLY_AWARD, MILESTONE, ONBOARDING_COMPLETE, quests,
// journeys, staff/migration bookkeeping). Uses disposable __test_vel_ users
// and direct ReputationEvent inserts; cleans up everything it creates.
// Run: npx tsx scripts/velocity-detector-tests.mts   (dev DB only — guarded)
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import {
  detectReputationSignals,
  materializeReputationFlags,
  isMemberDrivenReputationEvent,
  MEMBER_DRIVEN_REP_TYPES,
} from "@/lib/trust-signals"

const tag = Date.now().toString(36)
const results: [string, string][] = []
const pass = (n: string) => { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
const fail = (n: string, i: unknown) => { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }

async function mkUser(name: string) {
  return prisma.user.create({
    data: {
      name: `__test_vel_${name}_${tag}`,
      ageVerified: true,
      password: "x",
      sessionVersion: 1,
      profile: { create: { username: `__test_vel_${name}_${tag}` } },
    },
  })
}

async function addEvent(userId: string, type: string, amount: number, opts: { actorId?: string; reversedAt?: Date; key?: string } = {}) {
  return prisma.reputationEvent.create({
    data: {
      userId, type, amount,
      reason: `__test_vel_${type}`,
      key: opts.key ?? `__test_vel:${type}:${userId}:${tag}:${Math.random().toString(36).slice(2)}`,
      actorId: opts.actorId ?? null,
      reversedAt: opts.reversedAt ?? null,
    },
  })
}

const flaggedIds = async () =>
  new Set((await detectReputationSignals(7)).velocity.map(v => v.userId))

async function main() {
  const users: { id: string }[] = []
  const eventIds: string[] = []
  const flagKeysBefore = new Set(
    (await prisma.abuseFlag.findMany({ select: { key: true } })).map(f => f.key)
  )

  // ── helper assertions over the live detector ───────────────────────────
  const expectFlagged = async (id: string, n: string) => {
    (await flaggedIds()).has(id) ? pass(n) : fail(n, "expected flag, got none")
  }
  const expectClean = async (id: string, n: string) => {
    !(await flaggedIds()).has(id) ? pass(n) : fail(n, "unexpected flag")
  }

  try {
    // TEST 1 — BADGE_BONUS alone must not flag
    {
      const u = await mkUser("badge"); users.push(u)
      eventIds.push((await addEvent(u.id, "BADGE_BONUS", 200)).id)
      await expectClean(u.id, "T1: +200 BADGE_BONUS in 24h → no velocity flag")
    }

    // TEST 2 — WEEKLY_AWARD alone must not flag
    {
      const u = await mkUser("weekly"); users.push(u)
      eventIds.push((await addEvent(u.id, "WEEKLY_AWARD", 200)).id)
      await expectClean(u.id, "T2: +200 WEEKLY_AWARD in 24h → no velocity flag")
    }

    // TEST 3 — MILESTONE / system rewards must not flag
    {
      const u = await mkUser("sys"); users.push(u)
      eventIds.push((await addEvent(u.id, "MILESTONE", 100)).id)
      eventIds.push((await addEvent(u.id, "GROW_MILESTONE", 60)).id)
      eventIds.push((await addEvent(u.id, "JOURNEY_COMPLETE", 40)).id)
      await expectClean(u.id, "T3: +200 MILESTONE/GROW_MILESTONE/JOURNEY_COMPLETE → no flag")
    }

    // TEST 4 — ONBOARDING_COMPLETE must not flag
    {
      const u = await mkUser("onb"); users.push(u)
      eventIds.push((await addEvent(u.id, "ONBOARDING_COMPLETE", 200)).id)
      await expectClean(u.id, "T4: +200 ONBOARDING_COMPLETE → no flag")
    }

    // TEST 5 — genuine member-driven velocity flags HIGH
    {
      const u = await mkUser("grind"); users.push(u)
      const actor = await mkUser("actor"); users.push(actor)
      for (let i = 0; i < 6; i++) {
        eventIds.push((await addEvent(u.id, "HELPFUL_ANSWER", 30, { actorId: actor.id })).id)
      }
      eventIds.push((await addEvent(u.id, "DAILY_LOGIN", 1)).id) // 181 member-driven
      await expectFlagged(u.id, "T5: +181 member-driven in 24h → flagged")
      const { created } = await materializeReputationFlags(7)
      const flag = await prisma.abuseFlag.findFirst({
        where: { userId: u.id, signal: "REP_VELOCITY", key: { notIn: [...flagKeysBefore] } },
      })
      flag && flag.priority === "HIGH"
        ? pass(`T5b: materialized flag is HIGH (created=${created})`)
        : fail("T5b: materialized flag is HIGH", flag)
    }

    // TEST 6 — exactly +150 does not flag (boundary preserved)
    {
      const u = await mkUser("edge"); users.push(u)
      for (let i = 0; i < 15; i++) {
        eventIds.push((await addEvent(u.id, "THREAD_CREATED", 10)).id)
      }
      await expectClean(u.id, "T6: exactly +150 member-driven → no flag (>150 required)")
    }

    // TEST 7 — system + member-driven mix below threshold → no flag
    {
      const u = await mkUser("mix"); users.push(u)
      eventIds.push((await addEvent(u.id, "BADGE_BONUS", 250)).id)
      eventIds.push((await addEvent(u.id, "WEEKLY_AWARD", 50)).id)
      eventIds.push((await addEvent(u.id, "THREAD_CREATED", 10)).id)
      eventIds.push((await addEvent(u.id, "LIKE_RECEIVED", 2)).id)
      await expectClean(u.id, "T7: +300 system + +12 member-driven → no flag")
    }

    // TEST 8 — reversed events don't contribute
    {
      const u = await mkUser("rev"); users.push(u)
      eventIds.push((await addEvent(u.id, "HELPFUL_ANSWER", 200, { reversedAt: new Date() })).id)
      await expectClean(u.id, "T8: +200 member-driven but reversed → no flag")
    }

    // TEST 9 — legacy exclusions still excluded
    {
      const u = await mkUser("excl"); users.push(u)
      for (const t of ["STAFF_ADJUSTMENT", "REFERRAL", "CHALLENGE_WEEKLY", "LEGACY_MIGRATION", "REINSTATE", "CONTEST_WEEKLY_WIN", "CONTEST_MONTHLY_WIN"]) {
        eventIds.push((await addEvent(u.id, t, 50)).id) // 350 total excluded
      }
      await expectClean(u.id, "T9: +350 across legacy-excluded types → no flag")
    }

    // TEST 10 — badge cascade burst doesn't flag
    {
      const u = await mkUser("cascade"); users.push(u)
      for (let i = 0; i < 10; i++) {
        eventIds.push((await addEvent(u.id, "BADGE_BONUS", 40)).id) // 400 burst
      }
      await expectClean(u.id, "T10: 10× BADGE_BONUS cascade (+400) → no flag")
    }

    // TEST 11 — cron self-award (WEEKLY_AWARD + BADGE_BONUS same run) doesn't flag
    {
      const u = await mkUser("gotw"); users.push(u)
      eventIds.push((await addEvent(u.id, "BADGE_BONUS", 100, { key: `badgebonus:Grower of the Week:${u.id}` })).id)
      eventIds.push((await addEvent(u.id, "WEEKLY_AWARD", 50, { key: `weekly:gotw:2099-W01:${u.id}` })).id)
      const { created } = await materializeReputationFlags(7)
      const flag = await prisma.abuseFlag.findFirst({
        where: { userId: u.id, key: { notIn: [...flagKeysBefore] } },
      })
      !flag
        ? pass(`T11: GOTW award + detection same run → no self-generated flag (created=${created})`)
        : fail("T11: GOTW award + detection same run → no flag", flag)
    }

    // TEST 12 — deleted-user flags render as "Deleted user", not "@unknown"
    {
      const queueSrc = readFileSync("src/app/api/moderation/queue/route.ts", "utf8")
      const caseSrc = readFileSync("src/app/moderation/cases/[id]/page.tsx", "utf8")
      const flagsSrc = readFileSync("src/app/api/admin/reputation/flags/route.ts", "utf8")
      const ok =
        queueSrc.includes('?? "Deleted user"') &&
        caseSrc.includes('"Deleted user"') &&
        flagsSrc.includes('"Deleted user"')
      ok ? pass('T12: missing users render "Deleted user" in queue/case/admin views')
         : fail('T12: missing-user label', "expected Deleted user fallbacks")
      !flagsSrc.includes("materializeReputationFlags")
        ? pass("T12b: admin flags GET no longer materializes flags")
        : fail("T12b: admin flags GET read-only", "still calls materializeReputationFlags")
    }

    // Sanity — the allowlist classifies every known event type correctly
    {
      const memberTypes = ["THREAD_CREATED", "POST_CREATED", "DIARY_CREATED", "DIARY_UPDATE", "STRAIN_CREATED", "STRAIN_PHOTO", "SETUP_CREATED", "LIKE_RECEIVED", "HELPFUL_ANSWER", "ACCEPT_MARKED", "HARVEST_LOGGED", "DAILY_LOGIN"]
      const systemTypes = ["BADGE_BONUS", "WEEKLY_AWARD", "MILESTONE", "ONBOARDING_COMPLETE", "QUEST_DAILY", "GROW_MILESTONE", "JOURNEY_COMPLETE", "CHALLENGE_WEEKLY", "STAFF_ADJUSTMENT", "REFERRAL", "LEGACY_MIGRATION", "REINSTATE", "CONTEST_WEEKLY_WIN", "CONTEST_MONTHLY_WIN", "REVERSAL", "BOT_MESSAGE"]
      const badMember = memberTypes.filter(t => !isMemberDrivenReputationEvent(t))
      const badSystem = systemTypes.filter(t => isMemberDrivenReputationEvent(t))
      assert.deepEqual([...MEMBER_DRIVEN_REP_TYPES].sort(), memberTypes.sort())
      badMember.length === 0 && badSystem.length === 0
        ? pass("T13: allowlist classifies all member-driven and system types correctly")
        : fail("T13: allowlist classification", { badMember, badSystem })
    }
  } finally {
    // Cleanup — flags are bare-keyed (no cascade), events cascade with users
    await prisma.abuseFlag.deleteMany({ where: { key: { notIn: [...flagKeysBefore] } } }).catch(() => {})
    await prisma.reputationEvent.deleteMany({ where: { id: { in: eventIds } } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: users.map(u => u.id) } } }).catch(() => {})
    await prisma.$disconnect()
  }

  const failed = results.filter(r => r[0] === "FAIL")
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  if (failed.length) process.exit(1)
}

main()
