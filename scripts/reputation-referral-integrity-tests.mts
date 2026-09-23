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
  reverseReputationByActor,
  reverseReputationBySource,
  reverseReputationEvent,
  runEffectStage,
} from "@/lib/reputation"
import { enqueueReversal, drainOne, drainPendingReversals } from "@/lib/reputation-outbox"
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

// Ledger row + profile credit in one tx — mirrors applyReputationAward's
// invariant so a fixture never produces ledger-vs-balance drift.
async function mkEvent(userId: string, over: Record<string, unknown>) {
  const amount = (over.amount as number | undefined) ?? 5
  return prisma.$transaction(async (tx) => {
    const ev = await tx.reputationEvent.create({
      data: { userId, type: "POST_CREATED", amount, reason: "test fixture", ...over } as never,
    })
    await tx.profile.update({ where: { userId }, data: { reputation: { increment: amount } } })
    return ev
  })
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
  const qualNotif = await prisma.notification.findFirst({
    where: { userId: referrerMain.id, type: "REPUTATION", title: "Referral bonus" },
    orderBy: { createdAt: "desc" },
    select: { content: true },
  })
  ok(!!qualNotif, "payout notification is delivered")
  ok(!!qualNotif?.content?.includes(`@${P}_qual`), "payout notification names the actual invitee", qualNotif?.content)
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

  // ── Legacy unkeyed payout blocks double-pay ──────────────────────
  // Pre-ledger signups paid the instant bonus as an unkeyed REFERRAL event
  // stamped inside the registration request (key:null, createdAt ≈ referee
  // signup). The keyed idempotency cannot see those rows — without the
  // legacy check the sweep re-pays every referral that predates the ledger.
  const referrerLegacy = await makeUser("refleg")
  const refereeLegacy = await makeUser("leg", { referredById: referrerLegacy.profile!.id, ageHours: 48 })
  await pushRep(refereeLegacy.id, REFERRAL_MIN_REP, "leg")
  await prisma.reputationEvent.create({
    data: {
      userId: referrerLegacy.id,
      type: "REFERRAL",
      amount: 15,
      reason: `Referred new member ${refereeLegacy.name}`,
      createdAt: refereeLegacy.createdAt,
    },
  })
  await reconcileReferralPayouts()
  ok((await referralEvent(refereeLegacy.id)) === null, "legacy unkeyed payout blocks sweep double-pay")
  const legCount = await prisma.reputationEvent.count({
    where: { userId: referrerLegacy.id, type: "REFERRAL", reversedAt: null },
  })
  ok(legCount === 1, "legacy referrer keeps exactly one referral event", legCount)

  // Negative: an unrelated unkeyed event in the same window must NOT satisfy
  // legacy detection — only type REFERRAL counts.
  const referrerNoise = await makeUser("refnoise")
  const refereeNoise = await makeUser("noise", { referredById: referrerNoise.profile!.id, ageHours: 48 })
  await pushRep(refereeNoise.id, REFERRAL_MIN_REP, "noise")
  await prisma.reputationEvent.create({
    data: {
      userId: referrerNoise.id,
      type: "STAFF_ADJUSTMENT",
      amount: 25,
      reason: "unrelated unkeyed adjustment",
      createdAt: refereeNoise.createdAt,
    },
  })
  await reconcileReferralPayouts()
  ok((await referralEvent(refereeNoise.id)) !== null, "unrelated unkeyed event does not block payout")

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

  // ── reverseReputationByActor scope ────────────────────────────────
  // Canonical invariant (callsite comments): an account takedown voids
  // reputation the account *granted others* — likes cast, answers
  // accepted, referral payouts their qualification triggered. Events
  // where actorId is audit or incidental attribution (STAFF_ADJUSTMENT's
  // issuing staff member, ACCEPT_MARKED's answerer) are out of scope.
  ok(repSrc.includes("ACTOR_GRANTED_TYPES"), "byActor scope is an explicit granted-type allowlist")

  const granter = await makeUser("granter")   // the account being taken down
  const bystander = await makeUser("bystand") // unrelated third party

  // Positive: events the account granted are reversed.
  const likeTarget = await makeUser("liked")
  await applyReputationAward(likeTarget.id, "LIKE_RECEIVED", 2, "t", {
    key: `${P}:scope:like1`, actorId: granter.id, sourceType: "POST", sourceId: "sp1",
  })
  const answerer = await makeUser("answerer")
  await applyReputationAward(answerer.id, "HELPFUL_ANSWER", REP_POINTS.HELPFUL_ANSWER, "t", {
    key: `${P}:scope:accept`, actorId: granter.id, sourceType: "POST", sourceId: "sp2",
  })
  const scopeReferrer = await makeUser("scoperef")
  const scopeReferee = granter // granter's qualification paid the referrer
  await applyReputationAward(scopeReferrer.id, "REFERRAL", REP_POINTS.REFERRAL, "t", {
    key: `${P}:scope:ref`, actorId: scopeReferee.id,
  })
  const likeTarget2 = await makeUser("liked2")
  await applyReputationAward(likeTarget2.id, "LIKE_RECEIVED", 2, "t", {
    key: `${P}:scope:like2`, actorId: granter.id, sourceType: "POST", sourceId: "sp3",
  })

  const likeRepBefore = await repOf(likeTarget.id)
  const swept = await reverseReputationByActor(granter.id, "Granting account permanently banned")
  ok(swept === 4, "byActor reverses all granted events (like, accept, referral, like)", swept)
  ok((await repOf(likeTarget.id)) === likeRepBefore - 2, "like recipient loses exactly the granted rep")
  ok((await repOf(answerer.id)) === 0, "accepted-answer rep clawed back from answerer")
  ok((await repOf(scopeReferrer.id)) === 0, "referral payout clawed back from referrer")

  // Negative: non-grant actorId attributions are NOT swept.
  const staffUser = await makeUser("staffish") // acts as the issuing staff account
  const adjTarget = await makeUser("adjtarget")
  await applyReputationAward(adjTarget.id, "STAFF_ADJUSTMENT", 50, "staff note", {
    key: `${P}:scope:adj`, actorId: staffUser.id,
  })
  const opUser = await makeUser("op")
  // ACCEPT_MARKED: recipient is the OP, actorId is the answerer involved.
  await applyReputationAward(opUser.id, "ACCEPT_MARKED", REP_POINTS.ACCEPT_MARKED, "t", {
    key: `${P}:scope:acceptop`, actorId: staffUser.id, sourceType: "THREAD", sourceId: "st1",
  })
  // The account's own earned rep (no actorId) and rep granted TO it by
  // others must also be untouched.
  await pushRep(staffUser.id, 30, "staffish-earned")
  await applyReputationAward(staffUser.id, "LIKE_RECEIVED", 2, "t", {
    key: `${P}:scope:like-in`, actorId: bystander.id, sourceType: "POST", sourceId: "sp9",
  })
  // A bystander event whose sourceId coincidentally equals the account id —
  // sourceId is never actor attribution.
  await applyReputationAward(bystander.id, "POST_CREATED", 2, "t", {
    key: `${P}:scope:coincide`, sourceType: "POST", sourceId: staffUser.id,
  })

  const staffSwept = await reverseReputationByActor(staffUser.id, "Granting account permanently banned")
  ok(staffSwept === 0, "byActor does not touch staff-issued adjustments or incidental attribution", staffSwept)
  ok((await repOf(adjTarget.id)) === 50, "staff adjustment on a third party survives the issuer's ban")
  ok((await repOf(opUser.id)) === REP_POINTS.ACCEPT_MARKED, "OP keeps ACCEPT_MARKED when the answerer is banned")
  ok((await repOf(staffUser.id)) === 32, "account's own earned + received rep untouched")
  ok((await repOf(bystander.id)) === 2, "coincidental sourceId match is not actor attribution")

  // Idempotent: a second sweep has nothing left to do.
  ok((await reverseReputationByActor(granter.id, "again")) === 0, "byActor is idempotent — no double reversal")

  // Descendants are never selected: pre-reverse one granted event, then the
  // sweep must not count the REVERSAL row or deduct twice.
  const granter2 = await makeUser("granter2")
  const liked3 = await makeUser("liked3")
  await applyReputationAward(liked3.id, "LIKE_RECEIVED", 2, "t", {
    key: `${P}:scope:like3`, actorId: granter2.id, sourceType: "POST", sourceId: "sp4",
  })
  await applyReputationAward(liked3.id, "LIKE_RECEIVED", 2, "t", {
    key: `${P}:scope:like4`, actorId: granter2.id, sourceType: "POST", sourceId: "sp5",
  })
  const evLike3 = await prisma.reputationEvent.findUnique({ where: { key: `${P}:scope:like3` } })
  await reverseReputationEvent(evLike3!.id, "pre-reversed", granter2.id) // descendant carries actorId too
  const liked3RepBefore = await repOf(liked3.id)
  const swept2 = await reverseReputationByActor(granter2.id, "Granting account permanently banned")
  ok(swept2 === 1, "already-reversed event and its REVERSAL descendant are skipped", swept2)
  ok((await repOf(liked3.id)) === liked3RepBefore - 2, "no double deduction through the descendant path")

  // Non-final byActor reversal can still be organically reinstated —
  // unchanged semantics (a reinstated member's re-like re-awards).
  const reinstateRes = await applyReputationAward(liked3.id, "LIKE_RECEIVED", 2, "t", {
    key: `${P}:scope:like4`, actorId: granter2.id, sourceType: "POST", sourceId: "sp5",
  })
  ok(reinstateRes.awarded === true && reinstateRes.reinstated === true, "non-final byActor reversal reinstates on re-grant", reinstateRes)

  // Final reversal stays locked even when the granting account is later swept.
  const granter3 = await makeUser("granter3")
  const liked5 = await makeUser("liked5")
  await applyReputationAward(liked5.id, "LIKE_RECEIVED", 2, "t", {
    key: `${P}:scope:like5`, actorId: granter3.id, sourceType: "POST", sourceId: "sp6",
  })
  const evLike5 = await prisma.reputationEvent.findUnique({ where: { key: `${P}:scope:like5` } })
  await reverseReputationEvent(evLike5!.id, "staff final", "staff", { final: true })
  const liked5Rep = await repOf(liked5.id)
  await reverseReputationByActor(granter3.id, "Granting account permanently banned")
  const evLike5After = await prisma.reputationEvent.findUnique({
    where: { key: `${P}:scope:like5` },
    select: { reversedAt: true, reversalFinal: true },
  })
  ok(evLike5After?.reversalFinal === true && evLike5After.reversedAt !== null, "final reversal survives a byActor sweep")
  ok((await repOf(liked5.id)) === liked5Rep, "final-reversed event is not re-deducted")

  // ── Account deletion: third-party rep on cascade-deleted content ──
  // prisma.user.delete cascades the member's threads — and every other
  // member's posts inside them (Post.threadId Cascade). The DELETE route
  // must run the same bySource sweep as owner/staff thread removal before
  // the cascade, or third parties keep rep for content that no longer
  // exists. This simulates the route's exact sequence against real rows.
  const profileRouteSrc = readFileSync("src/app/api/profile/route.ts", "utf8")
  ok(
    profileRouteSrc.includes("enqueueReversal") &&
    profileRouteSrc.includes('sourceType: "POST"') &&
    profileRouteSrc.includes("thread: { authorId: user.id }") &&
    profileRouteSrc.includes("drainOne"),
    "account deletion enqueues durable rep sweeps on third-party posts inside owned threads"
  )
  ok(
    !/reverseReputationBy\w+\([^)]*\)\.catch\(\(\)\s*=>/.test(profileRouteSrc),
    "no swallowed fire-and-forget reversals in the delete path"
  )

  const delUser = await makeUser("del")
  const replier = await makeUser("replier")
  const likerUser = await makeUser("liker")
  const delReferrer = await makeUser("delref")
  const cat = await prisma.category.create({ data: { name: `${P} cat`, slug: `${P}-cat`, description: "test" } })
  const thread = await prisma.thread.create({
    data: { title: `${P} thread`, slug: `${P}-thread`, content: "x", categoryId: cat.id, authorId: delUser.id },
  })
  const reply = await prisma.post.create({
    data: { content: "third-party reply", threadId: thread.id, authorId: replier.id },
  })

  // Replier's rep on the doomed post + one unrelated event that must survive.
  await applyReputationAward(replier.id, "POST_CREATED", 2, "t", {
    key: `${P}:del:post1`, sourceType: "POST", sourceId: reply.id,
  })
  await applyReputationAward(replier.id, "LIKE_RECEIVED", 2, "t", {
    key: `${P}:del:like1`, actorId: likerUser.id, sourceType: "POST", sourceId: reply.id,
  })
  await applyReputationAward(replier.id, "SETUP_CREATED", REP_POINTS.SETUP_CREATED, "t", {
    key: `${P}:del:setup`, sourceType: "SETUP", sourceId: "unrelated",
  })
  // A staff-final reversal on the same post — must not be re-deducted.
  await applyReputationAward(replier.id, "LIKE_RECEIVED", 2, "t", {
    key: `${P}:del:like2`, actorId: likerUser.id, sourceType: "POST", sourceId: reply.id,
  })
  const evLike2 = await prisma.reputationEvent.findUnique({ where: { key: `${P}:del:like2` } })
  await reverseReputationEvent(evLike2!.id, "staff final", "staff", { final: true })

  // The deleter's own earned rep (own ledger — cascades with the account).
  await applyReputationAward(delUser.id, "THREAD_CREATED", 10, "t", {
    key: `${P}:del:thread`, sourceType: "THREAD", sourceId: thread.id,
  })
  // The deleter previously qualified → paid a referral to another member.
  await applyReputationAward(delReferrer.id, "REFERRAL", REP_POINTS.REFERRAL, "t", {
    key: `referral:${delUser.id}`, actorId: delUser.id,
  })

  const replierBefore = await repOf(replier.id) // 2+2+8+2-2 = 12
  const delRefBefore = await repOf(delReferrer.id) // 25

  // The route's exact sequence: durable intents inside the SAME transaction
  // as the cascade, then post-commit drains.
  const ownedThreads = await prisma.thread.findMany({ where: { authorId: delUser.id }, select: { id: true } })
  const threadPosts = await prisma.post.findMany({ where: { thread: { authorId: delUser.id } }, select: { id: true } })
  const reversalIds: string[] = []
  await prisma.$transaction(async (tx) => {
    reversalIds.push(await enqueueReversal(tx, { kind: "ACTOR", actorId: delUser.id, reason: "Granting account deleted", requestedBy: delUser.id }))
    for (const t of ownedThreads) {
      reversalIds.push(await enqueueReversal(tx, { kind: "SOURCE", sourceType: "THREAD", sourceId: t.id, reason: "Thread removed", requestedBy: delUser.id }))
    }
    for (const p of threadPosts) {
      reversalIds.push(await enqueueReversal(tx, { kind: "SOURCE", sourceType: "POST", sourceId: p.id, reason: "Thread removed", requestedBy: delUser.id }))
    }
    await tx.user.delete({ where: { id: delUser.id } })
  })
  for (const rid of reversalIds) await drainOne(rid)

  ok((await prisma.post.findUnique({ where: { id: reply.id } })) === null, "thread cascade removes the third-party reply")
  ok((await prisma.user.findUnique({ where: { id: replier.id } })) !== null, "third-party member survives the deletion")
  ok((await repOf(replier.id)) === replierBefore - 4, "replier loses only the rep tied to the deleted post", await repOf(replier.id))
  ok((await repOf(delReferrer.id)) === delRefBefore - REP_POINTS.REFERRAL, "referrer loses the payout the deleted referee caused")
  const evPost1 = await prisma.reputationEvent.findUnique({ where: { key: `${P}:del:post1` } })
  const evLike1 = await prisma.reputationEvent.findUnique({ where: { key: `${P}:del:like1` } })
  const evSetup = await prisma.reputationEvent.findUnique({ where: { key: `${P}:del:setup` } })
  const evLike2After = await prisma.reputationEvent.findUnique({
    where: { key: `${P}:del:like2` },
    select: { reversedAt: true, reversalFinal: true },
  })
  ok(evPost1?.reversedAt !== null && evPost1 !== null, "POST_CREATED on deleted post is reversed")
  ok(evLike1?.reversedAt !== null, "LIKE_RECEIVED on deleted post is reversed")
  ok(evSetup?.reversedAt === null, "unrelated rep on the same member survives")
  ok(evLike2After?.reversalFinal === true, "final reversal stays final through the deletion sweep")
  ok((await prisma.reputationEvent.count({ where: { userId: delUser.id } })) === 0, "deleted member's own ledger is cascade-removed")
  // Reversal counter-entries live on the replier's ledger, keyed and linked.
  const revRows = await prisma.reputationEvent.count({
    where: { userId: replier.id, type: "REVERSAL", reversalOfId: { in: [evPost1!.id, evLike1!.id] } },
  })
  ok(revRows === 2, "reversal counter-entries recorded on the third-party ledger", revRows)

  // Re-running the sequence post-delete is a no-op (posts already gone).
  const replierMid = await repOf(replier.id)
  const threadPosts2 = await prisma.post.findMany({ where: { thread: { authorId: delUser.id } }, select: { id: true } })
  for (const p of threadPosts2) {
    await reverseReputationBySource("POST", p.id, "Thread removed", delUser.id)
  }
  ok((await repOf(replier.id)) === replierMid, "re-running the deletion sweep is a no-op")

  // ── Outbox edge cases ────────────────────────────────────────────
  // A fresh RUNNING claim must not be stealable by another drain.
  {
    const id = await enqueueReversal(prisma, { kind: "KEY", eventKey: `${P}:cas`, reason: "outbox-edge" })
    await prisma.pendingReversal.update({ where: { id }, data: { status: "RUNNING", claimedAt: new Date() } })
    ok((await drainOne(id)) === false, "fresh RUNNING claim is not stealable")
    const row = await prisma.pendingReversal.findUnique({ where: { id } })
    ok(row?.status === "RUNNING", "fresh claim still marked RUNNING")
    await prisma.pendingReversal.delete({ where: { id } }).catch(() => {})
  }

  // An ACTOR sweep is bounded to grants made before the intent was enqueued.
  {
    const granter = await makeUser("actgrant")
    const target = await makeUser("acttgt")
    const oldEv = await mkEvent(target.id, {
      type: "LIKE_RECEIVED", actorId: granter.id, key: `${P}:old`,
      createdAt: new Date(Date.now() - 60000),
    })
    const id = await enqueueReversal(prisma, { kind: "ACTOR", actorId: granter.id, reason: "outbox-edge" })
    // Grant AFTER the intent was enqueued — must survive the sweep.
    const newEv = await mkEvent(target.id, {
      type: "LIKE_RECEIVED", actorId: granter.id, key: `${P}:new`,
      createdAt: new Date(Date.now() + 60000),
    })
    ok(await drainOne(id), "ACTOR intent drains")
    const old = await prisma.reputationEvent.findUnique({ where: { id: oldEv.id }, select: { reversedAt: true } })
    const fresh = await prisma.reputationEvent.findUnique({ where: { id: newEv.id }, select: { reversedAt: true } })
    ok(old?.reversedAt !== null && old?.reversedAt !== undefined, "pre-enqueue grant reversed")
    ok(fresh?.reversedAt === null, "post-enqueue grant survives")
    await prisma.pendingReversal.delete({ where: { id } }).catch(() => {})
  }

  // A successful drainOne removes its outbox row — nothing is left to
  // retry once the reversal lands.
  {
    const tgt = await makeUser("srcdel")
    await mkEvent(tgt.id, { sourceType: "THREAD", sourceId: `__rr_sd_${P}`, key: `__rr_sdk_${P}` })
    const id = await enqueueReversal(prisma, { kind: "SOURCE", sourceType: "THREAD", sourceId: `__rr_sd_${P}`, reason: "outbox-edge" })
    ok(await drainOne(id), "SOURCE intent drains")
    ok((await prisma.pendingReversal.findUnique({ where: { id } })) === null, "SOURCE intent row self-deletes after drainOne")
    await prisma.pendingReversal.delete({ where: { id } }).catch(() => {})
  }

  // A KEY intent whose event no longer exists completes cleanly.
  {
    const id = await enqueueReversal(prisma, { kind: "KEY", eventKey: `__rr_nokey_${P}`, reason: "outbox-edge" })
    ok((await drainOne(id)) === true, "KEY intent on a missing event completes")
    await prisma.pendingReversal.delete({ where: { id } }).catch(() => {})
  }

  // drainPendingReversals consumes a backlog batch.
  {
    const u = await makeUser("outback")
    const ev = await mkEvent(u.id, { sourceType: "THREAD", sourceId: `__rr_backlog_${P}`, key: `__rr_backlogk_${P}` })
    const id = await enqueueReversal(prisma, { kind: "SOURCE", sourceType: "THREAD", sourceId: `__rr_backlog_${P}`, reason: "outbox-edge" })
    const r = await drainPendingReversals(50)
    ok(r.drained >= 1, `backlog drain consumes pending intents (drained=${r.drained})`)
    const after = await prisma.reputationEvent.findUnique({ where: { id: ev.id }, select: { reversedAt: true } })
    ok(after?.reversedAt !== null && after?.reversedAt !== undefined, "backlog-drained event is reversed")
    ok((await prisma.pendingReversal.findUnique({ where: { id } })) === null, "drained backlog intent is gone")
    await prisma.pendingReversal.delete({ where: { id } }).catch(() => {})
  }

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
    // notifications ride the user delete cascade). The test category has
    // no user FK — delete it directly (its threads cascade).
    await prisma.user.deleteMany({ where: { name: { startsWith: P } } }).catch(() => {})
    await prisma.category.deleteMany({ where: { slug: { startsWith: P } } }).catch(() => {})
    await prisma.$disconnect()
  })
