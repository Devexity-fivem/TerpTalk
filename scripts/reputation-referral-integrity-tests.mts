// Reputation & Referral integrity tests — deferred referral payout,
// reconciliation sweep, side-effect isolation, reversalFinal protection,
// and failure observability. Runs against the dev database with disposable
// __test_rr_ users; everything is cascade-cleaned at the end.
// Run: npx tsx scripts/reputation-referral-integrity-tests.mts
import "./db-guard.mjs"
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import {
  applyReputationAward,
  awardReputation,
  reconcileReferralPayouts,
  reverseReputationEvent,
  runEffectStage,
} from "@/lib/reputation"
import { REP_POINTS, REFERRAL_MIN_REP } from "@/lib/reputation-config"

const TS = Date.now()
const P = `__test_rr_${TS}`

let passed = 0
let failed = 0
function ok(cond: boolean, label: string, detail?: unknown) {
  if (cond) {
    passed++
    console.log(`  PASS ${label}`)
  } else {
    failed++
    console.log(`  FAIL ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ""}`)
  }
}

async function makeUser(suffix: string, opts: { ageHours?: number; referredById?: string } = {}) {
  const createdAt = opts.ageHours !== undefined
    ? new Date(Date.now() - opts.ageHours * 3600_000)
    : undefined
  return prisma.user.create({
    data: {
      name: `${P}_${suffix}`,
      password: "x",
      ageVerified: true,
      ...(createdAt ? { createdAt } : {}),
      profile: {
        create: {
          username: `${P}_${suffix}`,
          ...(opts.referredById ? { referredById: opts.referredById } : {}),
        },
      },
    },
    include: { profile: { select: { id: true, reputation: true, referredById: true } } },
  })
}

const referralKey = (refereeUserId: string) => `referral:${refereeUserId}`

async function referralEvent(refereeUserId: string) {
  return prisma.reputationEvent.findUnique({ where: { key: referralKey(refereeUserId) } })
}

async function repOf(userId: string) {
  const p = await prisma.profile.findUnique({ where: { userId }, select: { reputation: true } })
  return p?.reputation ?? -1
}

// Push a referee to an exact balance via a single uncapped ledger write.
// STAFF_ADJUSTMENT has no daily cap and applyReputationAward never runs
// postAwardEffects — so no badge/tier/referral side effects can fire and
// the resulting balance is deterministic (unlike organic award types,
// which can cascade badge bonuses in a small dev database).
async function pushRep(userId: string, target: number, tag: string) {
  const current = await repOf(userId)
  if (current < target) {
    await applyReputationAward(userId, "STAFF_ADJUSTMENT", target - current, "test fixture", {
      key: `${P}:push:${tag}`,
    })
  }
  return repOf(userId)
}

async function run() {
  console.log("Starting reputation/referral integrity tests...")

  // ── Source assertions (wiring, not behavior) ─────────────────────
  const repSrc = readFileSync("src/lib/reputation.ts", "utf8")
  const cronSrc = readFileSync("src/app/api/cron/terpbot/route.ts", "utf8")
  const regSrc = readFileSync("src/app/api/auth/register/route.ts", "utf8")

  ok(!regSrc.includes("awardReputation") && !regSrc.includes("applyReputationAward"), "register route does not award referral rep at signup")
  ok(regSrc.includes('type: "REFERRAL"'), "register still sends the New referral notification")
  ok(regSrc.includes("referredById"), "register still writes referredById")
  ok(repSrc.includes('runEffectStage(userId, "referral"'), "referral payout runs inside an isolated stage")
  ok(repSrc.includes('runEffectStage(userId, "badges"'), "badge check runs inside an isolated stage")
  ok(repSrc.includes("reversalFinal: false"), "reinstate CAS guards reversalFinal")
  ok(cronSrc.includes("reconcileReferralPayouts"), "cron route invokes the reconciliation sweep")

  // ── Fixtures ─────────────────────────────────────────────────────
  // Each test group gets its own referrer: REFERRAL pays out max
  // REFERRAL_MAX_PER_WEEK per rolling week, so a shared referrer would hit
  // the weekly cap mid-suite and produce false failures.
  const referrerSignup = await makeUser("ref0")
  const refereeNew = await makeUser("fresh", { referredById: referrerSignup.profile!.id })

  const referrerLow = await makeUser("reflow")
  const refereeLowRep = await makeUser("lowrep", { referredById: referrerLow.profile!.id, ageHours: 48 })

  const referrerYoung = await makeUser("refyoung")
  const refereeYoung = await makeUser("young", { referredById: referrerYoung.profile!.id, ageHours: 12 })

  const referrerMain = await makeUser("refmain")
  const refereeQual = await makeUser("qual", { referredById: referrerMain.profile!.id, ageHours: 48 })
  const refereeDormant = await makeUser("dorm", { referredById: referrerMain.profile!.id, ageHours: 48 })

  // Signup attribution persisted.
  ok(refereeNew.profile!.referredById === referrerSignup.profile!.id, "signup attribution persists referredById")

  // ── Signup does NOT award immediately ────────────────────────────
  ok((await referralEvent(refereeNew.id)) === null, "no REFERRAL event right after attributed signup")
  ok((await repOf(referrerSignup.id)) === 0, "referrer balance unchanged by signup alone")

  // ── Referee under REFERRAL_MIN_REP does not trigger ─────────────
  // Old enough, but rep below the threshold → not a sweep candidate, and
  // the canonical rep gate blocks the deferred path too (source-asserted).
  // Note: awardReputation can't be used to exercise the rep gate here —
  // badge bonuses from its effects stage could legitimately push the
  // referee over 25 in a small dev database.
  ok(repSrc.includes("refereeRep < REFERRAL_MIN_REP"), "canonical rep gate is in the shared payout path")
  await pushRep(refereeLowRep.id, REFERRAL_MIN_REP - 5, "lowrep")
  await reconcileReferralPayouts()
  ok((await referralEvent(refereeLowRep.id)) === null, "referee below 25 rep does not trigger payout")

  // ── Referee under 24h does not trigger ──────────────────────────
  await pushRep(refereeYoung.id, REFERRAL_MIN_REP, "young")
  // Crossing award through the full pipeline (postAwardEffects runs inline
  // outside a request scope). Badge bonuses may inflate rep further — the
  // age gate still blocks.
  await awardReputation(refereeYoung.id, "POST_CREATED", 2, "test", { key: `${P}:young:cross` })
  ok((await repOf(refereeYoung.id)) >= REFERRAL_MIN_REP, "young referee crossed 25 rep")
  ok((await referralEvent(refereeYoung.id)) === null, "referee under 24h does not trigger payout")
  await reconcileReferralPayouts()
  ok((await referralEvent(refereeYoung.id)) === null, "referee under 24h is not a sweep candidate")

  // ── Qualified referee triggers +25 via the normal award path ────
  await pushRep(refereeQual.id, REFERRAL_MIN_REP, "qual")
  await awardReputation(refereeQual.id, "POST_CREATED", 2, "test", { key: `${P}:qual:cross` })
  const qualEvent = await referralEvent(refereeQual.id)
  ok(!!qualEvent, "qualified referee triggers referral payout")
  ok(qualEvent?.amount === REP_POINTS.REFERRAL, `payout amount is +${REP_POINTS.REFERRAL}`, qualEvent?.amount)
  ok(qualEvent?.userId === referrerMain.id, "payout credited to the referrer")
  ok(qualEvent?.actorId === refereeQual.id, "payout actorId is the referee")
  const mainPayouts = await prisma.reputationEvent.count({
    where: { userId: referrerMain.id, type: "REFERRAL", reversedAt: null },
  })
  ok(mainPayouts === 1, "referrer ledger shows exactly one +25", mainPayouts)

  // ── Dormant qualifying referral discovered by reconciliation ────
  // refereeDormant already has referredById + age; give them rep via direct
  // ledger writes (applyReputationAward does NOT run postAwardEffects, so
  // the organic trigger never fires — simulating a dormant/lost trigger).
  await pushRep(refereeDormant.id, REFERRAL_MIN_REP, "dorm")
  ok((await referralEvent(refereeDormant.id)) === null, "dormant referee has no payout before sweep")

  const sweep1 = await reconcileReferralPayouts()
  ok(sweep1.failed === 0, "first sweep completes", sweep1)
  const dormEvent = await referralEvent(refereeDormant.id)
  ok(!!dormEvent, "reconciliation pays the dormant qualifying referral")
  ok(dormEvent?.userId === referrerMain.id && dormEvent.amount === REP_POINTS.REFERRAL, "sweep payout matches canonical shape")

  // ── Reconciliation is idempotent ─────────────────────────────────
  const sweep2 = await reconcileReferralPayouts()
  const dormEvents = await prisma.reputationEvent.count({ where: { key: referralKey(refereeDormant.id), reversedAt: null } })
  ok(dormEvents === 1, "second sweep does not duplicate the payout", { sweep2, dormEvents })

  // ── Normal award + reconciliation concurrency → one payout ──────
  const referrerRace = await makeUser("refrace")
  const refereeRace = await makeUser("race", { referredById: referrerRace.profile!.id, ageHours: 48 })
  await pushRep(refereeRace.id, REFERRAL_MIN_REP - 2, "race") // sit just under the line
  await Promise.all([
    awardReputation(refereeRace.id, "POST_CREATED", 2, "crossing", { key: `${P}:race:cross` }),
    reconcileReferralPayouts(),
    reconcileReferralPayouts(),
  ])
  const raceEvents = await prisma.reputationEvent.count({ where: { key: referralKey(refereeRace.id), reversedAt: null } })
  ok(raceEvents === 1, "concurrent award+sweep produce exactly one payout", raceEvents)

  // ── Deleted referrer: attribution cleared, no crash, no pay ──────
  const doomedReferrer = await makeUser("doomed")
  const refereeOrphan = await makeUser("orph", { referredById: doomedReferrer.profile!.id, ageHours: 48 })
  await pushRep(refereeOrphan.id, REFERRAL_MIN_REP, "orph")
  await prisma.user.delete({ where: { id: doomedReferrer.id } }) // FK SET NULL wipes referredById
  await reconcileReferralPayouts()
  const orphProfile = await prisma.profile.findUnique({ where: { userId: refereeOrphan.id }, select: { referredById: true } })
  ok(orphProfile?.referredById === null, "deleted referrer clears attribution (SET NULL)")
  ok((await referralEvent(refereeOrphan.id)) === null, "no payout for deleted referrer")

  // ── Suspended referrer is skipped by policy (not an error) ───────
  const bannedReferrer = await makeUser("banned")
  await prisma.user.update({ where: { id: bannedReferrer.id }, data: { banned: true } })
  const refereeToBanned = await makeUser("toban", { referredById: bannedReferrer.profile!.id, ageHours: 48 })
  await pushRep(refereeToBanned.id, REFERRAL_MIN_REP, "toban")
  await reconcileReferralPayouts()
  ok((await referralEvent(refereeToBanned.id)) === null, "banned referrer is not paid")
  // Event key unconsumed — referee can still pay later if referrer is reinstated.
  await prisma.user.update({ where: { id: bannedReferrer.id }, data: { banned: false } })
  await reconcileReferralPayouts()
  ok((await referralEvent(refereeToBanned.id)) !== null, "unbanned referrer is paid on next sweep")

  // ── Weekly cap (3 per rolling 7 days) still enforced ─────────────
  const cappedReferrer = await makeUser("capped")
  for (let i = 0; i < 3; i++) {
    await applyReputationAward(cappedReferrer.id, "REFERRAL", REP_POINTS.REFERRAL, "prior payout", {
      key: `${P}:capped:${i}`,
    })
  }
  const refereeToCapped = await makeUser("tocap", { referredById: cappedReferrer.profile!.id, ageHours: 48 })
  await pushRep(refereeToCapped.id, REFERRAL_MIN_REP, "tocap")
  await reconcileReferralPayouts()
  ok((await referralEvent(refereeToCapped.id)) === null, "referrer at 3/week cap is not paid")
  const cappedCount = await prisma.reputationEvent.count({
    where: { userId: cappedReferrer.id, type: "REFERRAL", reversedAt: null },
  })
  ok(cappedCount === 3, "cap leaves exactly 3 payouts", cappedCount)

  // ── Self-referral protection ──────────────────────────────────────
  const selfish = await makeUser("selfish", { ageHours: 48 })
  await prisma.profile.update({
    where: { userId: selfish.id },
    data: { referredById: selfish.profile!.id },
  })
  await pushRep(selfish.id, REFERRAL_MIN_REP, "selfish")
  await reconcileReferralPayouts()
  ok((await referralEvent(selfish.id)) === null, "self-referral never pays")

  // ── Side-effect isolation ────────────────────────────────────────
  // A throwing stage is logged+swallowed; later stages still run.
  const errors: unknown[] = []
  const origErr = console.error
  console.error = (...a: unknown[]) => { errors.push(a) }
  try {
    let laterRan = false
    await runEffectStage(referrerMain.id, "test-thrower", async () => { throw new Error("boom") })
    await runEffectStage(referrerMain.id, "test-later", async () => { laterRan = true })
    ok(laterRan, "stage after a throwing stage still runs")
  } finally {
    console.error = origErr
  }
  ok(errors.length === 1, "throwing stage failure is logged", errors.length)

  // End-to-end: a referee crossing while badges pipeline is healthy still
  // pays through the isolated "referral" stage (wiring asserted above).
  const referrerIso = await makeUser("refiso")
  const refereeIso = await makeUser("iso", { referredById: referrerIso.profile!.id, ageHours: 48 })
  await pushRep(refereeIso.id, REFERRAL_MIN_REP, "iso")
  await awardReputation(refereeIso.id, "POST_CREATED", 2, "cross", { key: `${P}:iso:cross` })
  ok((await referralEvent(refereeIso.id)) !== null, "isolated referral stage pays end-to-end")

  // ── reversalFinal protection ──────────────────────────────────────
  // Award → final reversal → re-trigger must NOT reinstate.
  const rUser = await makeUser("rev")
  await applyReputationAward(rUser.id, "POST_CREATED", 2, "t", { key: `${P}:final:1` })
  const ev1 = await prisma.reputationEvent.findUnique({ where: { key: `${P}:final:1` } })
  await reverseReputationEvent(ev1!.id, "staff final", "staff", { final: true })
  const relock = await applyReputationAward(rUser.id, "POST_CREATED", 2, "t", { key: `${P}:final:1` })
  ok(relock.awarded === false && relock.skippedReason === "locked", "final reversal blocks reinstatement", relock)
  const ev1After = await prisma.reputationEvent.findUnique({ where: { key: `${P}:final:1` }, select: { reversedAt: true, reversalFinal: true } })
  ok(ev1After !== null && ev1After.reversedAt !== null && ev1After.reversalFinal === true, "final reversal marker is not cleared")

  // Non-final reversal still reinstates on organic re-trigger.
  await applyReputationAward(rUser.id, "POST_CREATED", 2, "t", { key: `${P}:nonfinal:1` })
  const ev2 = await prisma.reputationEvent.findUnique({ where: { key: `${P}:nonfinal:1` } })
  await reverseReputationEvent(ev2!.id, "organic reversal")
  const reinstate = await applyReputationAward(rUser.id, "POST_CREATED", 2, "t", { key: `${P}:nonfinal:1` })
  ok(reinstate.awarded === true && reinstate.reinstated === true, "non-final reversal still reinstates", reinstate)

  // ── Observability: unexpected award failures log + rethrow ───────
  const logged: unknown[] = []
  const origErr2 = console.error
  console.error = (...a: unknown[]) => { logged.push(a) }
  let threw = false
  try {
    // Invalid argument type forces a Prisma validation error inside the tx —
    // exercises the log-then-rethrow path (key is NOT consumed).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await applyReputationAward(referrerMain.id, "POST_CREATED", 2, "t", { key: 12345 as any })
  } catch {
    threw = true
  } finally {
    console.error = origErr2
  }
  ok(threw, "invalid award input rethrows")
  ok(logged.length >= 1, "award failure is logged centrally", logged.length)
  ok((await prisma.reputationEvent.findUnique({ where: { key: "12345" } })) === null, "failed award leaves no event row")

  // Successful awards are not logged as failures.
  const logged2: unknown[] = []
  console.error = (...a: unknown[]) => { logged2.push(a) }
  try {
    await applyReputationAward(referrerMain.id, "POST_CREATED", 2, "t", { key: `${P}:quiet:1` })
  } finally {
    console.error = origErr2
  }
  ok(logged2.length === 0, "successful award produces no error log")

  // ── Reconciliation bound + field minimality ──────────────────────
  const bounded = await reconcileReferralPayouts(1)
  ok(bounded.candidates <= 1, "sweep respects the limit bound", bounded.candidates)

  console.log(`\n${passed} passed, ${failed} failed`)
  return failed
}

run()
  .then(async (f) => {
    process.exitCode = f > 0 ? 1 : 0
  })
  .catch((e) => {
    console.error("Test suite crashed:", e)
    process.exitCode = 1
  })
  .finally(async () => {
    // Cascade-clean every disposable fixture user (profiles, events,
    // notifications ride the user delete cascade).
    await prisma.user.deleteMany({ where: { name: { startsWith: P } } }).catch(() => {})
    await prisma.$disconnect()
  })
