// Launch-hardening regression tests — the P1 fixes from the security audit.
// Covers: reputation-reversal outbox durability, CAPTCHA atomic claim,
// meaningful-update gating (streak + journey), quest payout reconciliation,
// reply reputation floor, backdated startDate cap, and the tooltip/nameplate
// accessibility contracts. Dev DB only — db-guarded.
// Run: npx tsx scripts/launch-hardening-tests.mts
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync } from "node:fs"
import { prisma } from "@/lib/prisma"
import { isMeaningfulUpdate, MIN_UPDATE_LENGTH } from "@/lib/meaningful-update"
import { getGrowStreak } from "@/lib/grow-streak"
import { enqueueReversal, drainOne, drainPendingReversals } from "@/lib/reputation-outbox"
import { reconcileQuestPayouts } from "@/lib/quests"
import { reconcileChallengePayouts } from "@/lib/challenges"
import { POST_MIN_PAID_LENGTH } from "@/lib/reputation-config"

const tag = Date.now().toString(36)
const results: [string, string][] = []
const pass = (n: string) => { results.push(["PASS", n]); console.log(`  ✓ ${n}`) }
const fail = (n: string, i: unknown) => { results.push(["FAIL", n]); console.log(`  ✗ ${n} — ${JSON.stringify(i)?.slice(0, 300)}`) }
const check = (n: string, fn: () => Promise<void> | void) =>
  Promise.resolve()
    .then(fn)
    .then(() => pass(n))
    .catch((e) => fail(n, e instanceof Error ? e.message : e))

const cleanup = { userIds: [] as string[], diaryIds: [] as string[], captchaIds: [] as string[], eventIds: [] as string[] }

async function mkUser(name: string) {
  const u = await prisma.user.create({
    data: {
      name: `__test_lh_${name}_${tag}`,
      ageVerified: true,
      password: "x",
      sessionVersion: 1,
      role: "MEMBER",
      profile: { create: { username: `__test_lh_${name}_${tag}` } },
    },
  })
  cleanup.userIds.push(u.id)
  return u
}

async function mkEvent(userId: string, over: Record<string, unknown>) {
  // Mirror applyReputationAward: ledger row and profile credit move together —
  // a fixture that skips the balance produces real ledger-vs-balance drift.
  const amount = (over.amount as number | undefined) ?? 5
  const e = await prisma.$transaction(async (tx) => {
    const ev = await tx.reputationEvent.create({
      data: { userId, type: "POST_CREATED", amount, reason: "test fixture", ...over } as never,
    })
    await tx.profile.update({ where: { userId }, data: { reputation: { increment: amount } } })
    return ev
  })
  cleanup.eventIds.push(e.id)
  return e
}

// ─── Meaningful update predicate ─────────────────────────────────────
const blank = {
  content: "", images: [] as { id: string }[],
  temperature: null, humidity: null, vpd: null, ph: null, ec: null,
  feeding: null, training: null,
}

await check("meaningful: junk content does not qualify", () => {
  for (const junk of ["", "x", "         x", "123456789"]) {
    assert.equal(isMeaningfulUpdate({ ...blank, content: junk }), false, JSON.stringify(junk))
  }
})

await check("meaningful: real text, images, and env readings qualify", () => {
  assert.ok(isMeaningfulUpdate({ ...blank, content: "x".repeat(MIN_UPDATE_LENGTH) }))
  assert.ok(isMeaningfulUpdate({ ...blank, images: [{ id: "i1" }] }))
  for (const f of ["temperature", "humidity", "vpd", "ph", "ec", "feeding", "training"] as const) {
    assert.ok(isMeaningfulUpdate({ ...blank, [f]: f === "feeding" || f === "training" ? "x" : 1 }), f)
  }
})

await check("streak: a junk-update day does not count", async () => {
  const u = await mkUser("streak")
  const dr = await prisma.growDiary.create({
    data: { title: `__test_lh_d_${tag}`, description: "", growType: "INDOOR", startDate: new Date(), authorId: u.id },
  })
  cleanup.diaryIds.push(dr.id)
  const DAY = 86400000
  const today = new Date(Math.floor(Date.now() / DAY) * DAY)
  // Junk today, meaningful yesterday → streak must be 1, not 2.
  await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: u.id, title: "j", content: "x", stage: "VEGETATIVE", createdAt: today, dayNumber: 1, weekNumber: 1 },
  })
  await prisma.diaryUpdate.create({
    data: { diaryId: dr.id, authorId: u.id, title: "m", content: "real grow log entry here", stage: "VEGETATIVE", createdAt: new Date(today.getTime() - DAY), dayNumber: 1, weekNumber: 1 },
  })
  const s = await getGrowStreak(u.id)
  assert.equal(s.streak, 1, `junk day must not extend streak (got ${s.streak})`)
  assert.equal(s.totalUpdates, 2, "raw update count unchanged — predicate only gates streaks")
})

// ─── CAPTCHA atomic claim ────────────────────────────────────────────
await check("captcha: concurrent claims — exactly one winner", async () => {
  const c = await prisma.captcha.create({
    data: { answer: "42", expiresAt: new Date(Date.now() + 600000) },
  })
  cleanup.captchaIds.push(c.id)
  const claims = await Promise.all(
    Array.from({ length: 6 }, () =>
      prisma.captcha.updateMany({
        where: { id: c.id, used: false, expiresAt: { gt: new Date() } },
        data: { used: true },
      })
    )
  )
  const winners = claims.filter((r) => r.count === 1).length
  assert.equal(winners, 1, `expected exactly 1 winning claim, got ${winners}`)
})

await check("captcha: used and expired challenges refuse", async () => {
  const used = await prisma.captcha.create({ data: { answer: "1", expiresAt: new Date(Date.now() + 600000), used: true } })
  const expired = await prisma.captcha.create({ data: { answer: "1", expiresAt: new Date(Date.now() - 1000) } })
  cleanup.captchaIds.push(used.id, expired.id)
  for (const id of [used.id, expired.id]) {
    const r = await prisma.captcha.updateMany({
      where: { id, used: false, expiresAt: { gt: new Date() } },
      data: { used: true },
    })
    assert.equal(r.count, 0)
  }
})

// ─── Reversal outbox ─────────────────────────────────────────────────
await check("outbox: SOURCE intent reverses events and self-deletes", async () => {
  const u = await mkUser("outbox-src")
  const ev = await mkEvent(u.id, { sourceType: "POST", sourceId: `__lh_post_${tag}`, key: `__lh_k1_${tag}` })
  const id = await prisma.$transaction(async (tx) =>
    enqueueReversal(tx, { kind: "SOURCE", sourceType: "POST", sourceId: `__lh_post_${tag}`, reason: "test" })
  )
  assert.ok(await drainOne(id), "first drain resolves")
  const after = await prisma.reputationEvent.findUnique({ where: { id: ev.id }, select: { reversedAt: true } })
  assert.ok(after?.reversedAt, "event reversed")
  assert.equal(await prisma.pendingReversal.findUnique({ where: { id } }), null, "row consumed")
  assert.equal(await drainOne(id), false, "re-drain is a no-op, cannot double-reverse")
  const reversals = await prisma.reputationEvent.count({ where: { reversalOfId: ev.id } })
  assert.equal(reversals, 1, "exactly one reversal entry")
})

await check("outbox: KEY intent on missing event completes", async () => {
  const id = await enqueueReversal(prisma, { kind: "KEY", eventKey: `__lh_missing_${tag}`, reason: "test" })
  assert.ok(await drainOne(id))
})

await check("outbox: fresh RUNNING claim is not stealable", async () => {
  const id = await enqueueReversal(prisma, { kind: "KEY", eventKey: `__lh_cas_${tag}`, reason: "test" })
  await prisma.pendingReversal.update({ where: { id }, data: { status: "RUNNING", claimedAt: new Date() } })
  assert.equal(await drainOne(id), false, "fresh claim held")
  const row = await prisma.pendingReversal.findUnique({ where: { id } })
  assert.equal(row?.status, "RUNNING")
  await prisma.pendingReversal.delete({ where: { id } })
})

await check("outbox: ACTOR sweep is bounded to grants before enqueue", async () => {
  const granter = await mkUser("actor-grant")
  const target = await mkUser("actor-target")
  const oldEv = await mkEvent(target.id, {
    type: "LIKE_RECEIVED", actorId: granter.id, key: `__lh_old_${tag}`,
    createdAt: new Date(Date.now() - 60000),
  })
  const id = await enqueueReversal(prisma, { kind: "ACTOR", actorId: granter.id, reason: "test" })
  // Grant AFTER the intent was enqueued — must survive the sweep.
  const newEv = await mkEvent(target.id, {
    type: "LIKE_RECEIVED", actorId: granter.id, key: `__lh_new_${tag}`,
    createdAt: new Date(Date.now() + 60000),
  })
  assert.ok(await drainOne(id))
  const old = await prisma.reputationEvent.findUnique({ where: { id: oldEv.id }, select: { reversedAt: true } })
  const fresh = await prisma.reputationEvent.findUnique({ where: { id: newEv.id }, select: { reversedAt: true } })
  assert.ok(old?.reversedAt, "pre-enqueue grant reversed")
  assert.equal(fresh?.reversedAt, null, "post-enqueue grant survives")
})

await check("outbox: drainPendingReversals consumes a backlog", async () => {
  const u = await mkUser("outbox-batch")
  await mkEvent(u.id, { sourceType: "THREAD", sourceId: `__lh_t_${tag}`, key: `__lh_tk_${tag}` })
  await enqueueReversal(prisma, { kind: "SOURCE", sourceType: "THREAD", sourceId: `__lh_t_${tag}`, reason: "test" })
  const r = await drainPendingReversals(50)
  assert.ok(r.drained >= 1, `expected ≥1 drained, got ${r.drained}`)
})

// ─── Sticky payout reconciliation ────────────────────────────────────
await check("quest sweep: payout with no qualifying content is reversed", async () => {
  const u = await mkUser("quest-sticky")
  const dayKey = new Date().toISOString().slice(0, 10)
  const ev = await mkEvent(u.id, {
    type: "QUEST_DAILY", key: `quest:${dayKey}:tend-the-garden:${u.id}`, amount: 15,
  })
  const res = await reconcileQuestPayouts()
  const after = await prisma.reputationEvent.findUnique({ where: { id: ev.id }, select: { reversedAt: true } })
  assert.ok(after?.reversedAt, `unearned quest payout must be reversed (checked=${res.checked} reversed=${res.reversed})`)
})

await check("quest sweep: earned payout survives", async () => {
  const u = await mkUser("quest-earned")
  const dr = await prisma.growDiary.create({
    data: { title: `__test_lh_qd_${tag}`, description: "", growType: "INDOOR", startDate: new Date(), authorId: u.id },
  })
  cleanup.diaryIds.push(dr.id)
  // tend-the-garden counts live DIARY_UPDATE reputation events today.
  await mkEvent(u.id, { type: "DIARY_UPDATE", sourceType: "DIARY", sourceId: dr.id })
  const dayKey = new Date().toISOString().slice(0, 10)
  const ev = await mkEvent(u.id, {
    type: "QUEST_DAILY", key: `quest:${dayKey}:tend-the-garden:${u.id}`, amount: 15,
  })
  await reconcileQuestPayouts()
  const after = await prisma.reputationEvent.findUnique({ where: { id: ev.id }, select: { reversedAt: true } })
  assert.equal(after?.reversedAt, null, "earned payout must not be reversed")
})

await check("challenge sweep: payout with no qualifying content is reversed", async () => {
  const { currentWeekKey } = await import("@/lib/challenges")
  const u = await mkUser("ch-sticky")
  const ev = await mkEvent(u.id, {
    type: "CHALLENGE_WEEKLY", key: `challenge:${currentWeekKey()}:tend-the-diary:${u.id}`, amount: 50,
  })
  await reconcileChallengePayouts()
  const after = await prisma.reputationEvent.findUnique({ where: { id: ev.id }, select: { reversedAt: true } })
  assert.ok(after?.reversedAt, "unearned challenge payout must be reversed")
})

// ─── Route source contracts (the gates must exist in the real code) ──
await check("register: captcha claim is atomic + Turnstile fail-closed in prod", () => {
  const src = readFileSync("src/app/api/auth/register/route.ts", "utf8")
  assert.ok(src.includes("updateMany"), "atomic claim via updateMany required")
  assert.ok(src.includes("used: false") && src.includes("expiresAt"), "claim must filter used+expiry")
  assert.ok(/turnstile_not_configured|production/.test(src), "prod must fail closed without Turnstile")
  assert.ok(src.includes('typeof captchaId !== "string"'), "captchaId type guard required")
})

await check("diaries POST: startDate is server-bounded", () => {
  const src = readFileSync("src/app/api/diaries/route.ts", "utf8")
  assert.ok(src.includes("MAX_BACKDATE_MS"), "backdate cap required")
  assert.ok(src.includes("Invalid start date"), "invalid dates rejected")
})

await check("harvest: reward span anchors on createdAt, not user startDate", () => {
  const src = readFileSync("src/app/api/diaries/[id]/harvest/route.ts", "utf8")
  assert.ok(src.includes("createdAt"), "createdAt must be selected")
  assert.ok(/spanDays[\s\S]*createdAt/.test(src), "spanDays must use createdAt")
})

await check("posts: reply reputation has a paid-content floor", () => {
  assert.ok(POST_MIN_PAID_LENGTH >= 10, "floor configured")
  const src = readFileSync("src/app/api/forum/posts/route.ts", "utf8")
  assert.ok(src.includes("POST_MIN_PAID_LENGTH"), "route must gate POST_CREATED on length")
})

await check("diary PATCH: startDate is not editable", () => {
  const src = readFileSync("src/lib/diary-edit.ts", "utf8")
  assert.ok(!src.includes('"startDate"') || src.includes("startDate") === false || !/^\s*startDate/m.test(src.slice(src.indexOf("DIARY_EDITABLE_FIELDS"))), "startDate must not be in editable fields")
  const route = readFileSync("src/app/api/diaries/[id]/route.ts", "utf8")
  const patch = route.slice(route.indexOf("export async function PATCH"))
  assert.ok(!/data\.startDate/.test(patch), "PATCH must never write startDate")
})

// ─── Accessibility contracts ─────────────────────────────────────────
await check("tooltip: no focusable wrapper around interactive children", () => {
  const src = readFileSync("src/components/ui/tooltip.tsx", "utf8")
  assert.ok(src.includes("isInteractive"), "interactive-child detection required")
  assert.ok(src.includes("insideInteractive"), "interactive-ancestor detection required")
  assert.ok(src.includes("tabIndex={focusable ? 0 : undefined}"), "conditional tabIndex required")
  assert.ok(!/outline-none/.test(src.replace(/focus-visible:outline-none/g, "")), "focus outline must not be suppressed")
  assert.ok(src.includes("focus-visible"), "visible focus indicator required")
  assert.ok(src.includes('"Escape"'), "Escape dismissal required")
})

await check("a11y: scoped inputs carry accessible names", () => {
  assert.ok(readFileSync("src/components/chat-room.tsx", "utf8").includes('aria-label={room ? `Message ${room.name}` : "Chat message"}'), "chat composer aria-label")
  assert.ok(readFileSync("src/components/tag-input.tsx", "utf8").includes('aria-label="Add tags"'), "TagInput aria-label")
  const report = readFileSync("src/components/report-button.tsx", "utf8")
  assert.ok(report.includes('aria-label="Report to moderators"'), "report dialog aria-label")
  assert.ok(report.includes('aria-label="Report reason"'), "report reason aria-label")
  assert.ok(report.includes('aria-label="Report details"'), "report details aria-label")
  assert.ok(readFileSync("src/components/image-uploader.tsx", "utf8").includes('aria-hidden="true"'), "hidden file input out of a11y tree")
})

await check("nameplates: readable solid fallback + supports-gated gradient", () => {
  const css = readFileSync("src/app/globals.css", "utf8")
  assert.ok(css.includes("--np-leaf"), "nameplate tokens required")
  assert.ok(css.includes("@supports ((-webkit-background-clip: text)"), "gradient must be supports-gated")
  const npBlock = css.slice(css.indexOf(".tt-nameplate-leaf"), css.indexOf("@supports ((-webkit-background-clip: text)"))
  assert.ok(!/color:\s*transparent/.test(npBlock), "no transparent text outside @supports")
  assert.ok(css.includes(".tt-gradient-text"), "shared gradient-text fallback class required")
})

await check("tokens: semantic success/warning colors exist per theme", () => {
  const css = readFileSync("src/app/globals.css", "utf8")
  assert.ok(css.includes("--light-success") && css.includes("--dark-success"), "success token both themes")
  assert.ok(css.includes("--light-warning") && css.includes("--dark-warning"), "warning token both themes")
  assert.ok(css.includes("--color-success") && css.includes("--color-warning"), "tailwind color registration")
})

// ─── Summary + cleanup ───────────────────────────────────────────────
const failed = results.filter(([s]) => s === "FAIL")
console.log(`\n${results.length - failed.length}/${results.length} passed`)

await prisma.pendingReversal.deleteMany({ where: { reason: "test" } })
await prisma.reputationEvent.deleteMany({ where: { id: { in: cleanup.eventIds } } })
await prisma.diaryUpdate.deleteMany({ where: { diaryId: { in: cleanup.diaryIds } } })
await prisma.growDiary.deleteMany({ where: { id: { in: cleanup.diaryIds } } })
await prisma.captcha.deleteMany({ where: { id: { in: cleanup.captchaIds } } })
await prisma.profile.deleteMany({ where: { userId: { in: cleanup.userIds } } })
await prisma.user.deleteMany({ where: { id: { in: cleanup.userIds } } })
await prisma.$disconnect()
process.exit(failed.length ? 1 : 0)
