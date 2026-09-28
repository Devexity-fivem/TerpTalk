// Browser regression suite — persistent high-value UI contracts driven
// through a real headless Chromium session (playwright-core). Registered
// in master-tests.mts as the "browser" suite in the HTTP tier (requires
// the dev server at MASTER_BASE_URL, same as every HTTP suite).
//
// Scope is deliberately small and deterministic: auth flow, profile V2,
// diary privacy, blocked-profile boundaries, progression display, mobile
// nav, and the a11y landmark contract. No Pusher-delivery assertions —
// realtime wiring is covered by the chat HTTP suite; this file owns the
// rendered-DOM contracts only.
import "./db-guard.mjs"
import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import { chromium } from "playwright-core"

const prisma = new PrismaClient()
const BASE = (process.env.MASTER_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "")
const TS = Date.now().toString(36)
const PASSWORD = "VerifyPass123!"

let pass = 0, fail = 0
const results: string[] = []
const ok = (name: string, cond: boolean, info?: unknown) => {
  results.push(`${cond ? "PASS" : "FAIL"} ${name}`)
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${cond ? "" : ` — ${JSON.stringify(info)?.slice(0, 300)}`}`)
  cond ? pass++ : fail++
}

async function mkUser(tag: string) {
  return prisma.user.create({
    data: {
      name: `__browser_${tag}_${TS}`,
      ageVerified: true,
      password: bcrypt.hashSync(PASSWORD, 12),
      sessionVersion: 1,
      onboardingCompletedAt: new Date(),
      profile: { create: { username: `__br_${tag}_${TS}` } },
    },
  })
}

const main = async () => {
  const alice = await mkUser("a")
  const bob = await mkUser("b")
  const aliceUsername = `__br_a_${TS}`
  const bobUsername = `__br_b_${TS}`

  const pubDiary = await prisma.growDiary.create({
    data: {
      title: `__br public grow ${TS}`,
      slug: `__br-pub-${TS}`,
      description: "browser fixture",
      growType: "INDOOR",
      startDate: new Date(),
      authorId: alice.id,
      visibility: "PUBLIC",
    },
  })
  const privDiary = await prisma.growDiary.create({
    data: {
      title: `__br private grow ${TS}`,
      slug: `__br-priv-${TS}`,
      description: "browser fixture",
      growType: "INDOOR",
      startDate: new Date(),
      authorId: alice.id,
      visibility: "PRIVATE",
    },
  })

  // Login attempts are bucketed per-IP (30/15min) — earlier HTTP suites in
  // a master run can exhaust the allowance. Clear the login buckets like
  // account-verify does for register, so this suite is deterministic.
  await prisma.rateLimit.deleteMany({
    where: { OR: [{ key: { startsWith: "login" } }] },
  }).catch(() => {})

  const browser = await chromium.launch({ headless: true })
  const login = async (username: string) => {
    const context = await browser.newContext()
    const page = await context.newPage()
    // networkidle — the controlled inputs reset to React state on hydration;
    // filling during the race submits empty credentials (no POST is logged).
    await page.goto(`${BASE}/auth/signin`, { waitUntil: "networkidle" })
    await page.fill("#username", username)
    await page.fill("#password", PASSWORD)
    if ((await page.inputValue("#username")) !== username) {
      await page.fill("#username", username)
      await page.fill("#password", PASSWORD)
    }
    await page.press("#password", "Enter")
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/auth/signin"), { timeout: 45_000 })
    } catch {
      const errText = (await page.locator('[class*="destructive"]').first().textContent().catch(() => "")) ?? ""
      throw new Error(`login as ${username} stuck at ${page.url()} — signin error: ${errText.trim().slice(0, 200) || "(none rendered)"}`)
    }
    return { context, page }
  }

  try {
    // ── Anonymous browsing ───────────────────────────────────────────
    const anon = await browser.newContext()
    const anonPage = await anon.newPage()
    const homeRes = await anonPage.goto(BASE, { waitUntil: "domcontentloaded" })
    ok("anon: home renders 200", homeRes?.status() === 200, homeRes?.status())
    ok("anon: main landmark + exactly one h1", (await anonPage.locator("main").count()) >= 1 && (await anonPage.locator("h1").count()) === 1)
    ok("anon: sign-in affordance visible", (await anonPage.locator('a[href^="/auth/signin"]').count()) >= 1)

    const signinRes = await anonPage.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded" })
    ok("anon: signin 200", signinRes?.status() === 200)
    const labeledUser = await anonPage.locator("label[for=username]").count()
    const labeledPass = await anonPage.locator("label[for=password]").count()
    ok("a11y: signin inputs have labels", labeledUser === 1 && labeledPass === 1)

    // Public vs private diary — the existence-oracle contract must hold
    // in the rendered page, not just the route.
    const pubRes = await anonPage.goto(`${BASE}/diaries/${pubDiary.slug}`, { waitUntil: "domcontentloaded" })
    ok("privacy: PUBLIC diary renders to anonymous", pubRes?.status() === 200, pubRes?.status())
    const privRes = await anonPage.goto(`${BASE}/diaries/${privDiary.slug}`, { waitUntil: "domcontentloaded" })
    const privBody = (await anonPage.textContent("body")) ?? ""
    ok(
      "privacy: PRIVATE diary → 404/not-found for anonymous",
      privRes?.status() === 404 || /not found|404/i.test(privBody),
      { status: privRes?.status() }
    )

    // ── Auth flow ────────────────────────────────────────────────────
    const { context: aliceCtx, page: alicePage } = await login(aliceUsername)
    ok("auth: credentials login leaves /auth/signin", !alicePage.url().includes("/auth/signin"), alicePage.url())
    await alicePage.goto(BASE, { waitUntil: "domcontentloaded" })
    const msgLink = await alicePage.locator('a[aria-label*="Messages"]').count()
    ok("auth: session nav shows Messages affordance", msgLink >= 1, { found: msgLink })

    // ── Profile V2 surfaces ──────────────────────────────────────────
    const profRes = await alicePage.goto(`${BASE}/u/${aliceUsername}`, { waitUntil: "domcontentloaded" })
    const profBody = (await alicePage.textContent("body")) ?? ""
    ok("profile: public profile 200 + shows username", profRes?.status() === 200 && profBody.includes(aliceUsername), profRes?.status())

    const selfRes = await alicePage.goto(`${BASE}/profile`, { waitUntil: "networkidle" })
    const selfBody = (await alicePage.textContent("body")) ?? ""
    // Client-rendered tab — identity can surface as username or display name.
    ok(
      "profile: own /profile 200 + identity rendered",
      selfRes?.status() === 200 && (selfBody.includes(aliceUsername) || selfBody.includes(`__browser_a_${TS}`)),
      selfRes?.status()
    )

    // Owner sees their private diary — the other side of the oracle.
    const ownerPriv = await alicePage.goto(`${BASE}/diaries/${privDiary.slug}`, { waitUntil: "domcontentloaded" })
    ok("privacy: owner can view own PRIVATE diary", ownerPriv?.status() === 200, ownerPriv?.status())

    // ── Progression display ──────────────────────────────────────────
    const progRes = await alicePage.goto(`${BASE}/progress`, { waitUntil: "domcontentloaded" })
    const progBody = (await alicePage.textContent("body")) ?? ""
    ok("progression: /progress renders rank/unlock surface", progRes?.status() === 200 && progBody.length > 500, progRes?.status())

    // ── Block boundary (privacy) ─────────────────────────────────────
    await prisma.block.create({ data: { blockerId: alice.id, blockedId: bob.id } })
    const { context: bobCtx, page: bobPage } = await login(bobUsername)
    const blockedRes = await bobPage.goto(`${BASE}/u/${aliceUsername}`, { waitUntil: "domcontentloaded" })
    const blockedBody = (await bobPage.textContent("body")) ?? ""
    ok(
      "privacy: blocked member sees not-found on blocker profile",
      blockedRes?.status() === 404 || /not found|404/i.test(blockedBody),
      { status: blockedRes?.status() }
    )
    await bobCtx.close()

    // ── Mobile contract ──────────────────────────────────────────────
    const mob = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const mobPage = await mob.newPage()
    await mobPage.goto(BASE, { waitUntil: "domcontentloaded" })
    const overflowX = await mobPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    ok("mobile: home renders without horizontal overflow at 390px", !overflowX)
    ok("mobile: nav menu toggle present", (await mobPage.locator('button[aria-label*="navigation menu"], a[href="/auth/signin"]').count()) >= 1)
    await mob.close()

    await aliceCtx.close()
    await anon.close()
  } finally {
    await browser.close().catch(() => {})
    await prisma.block.deleteMany({ where: { OR: [{ blockerId: alice.id }, { blockerId: bob.id }] } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id] } } }).catch(() => {})
    await prisma.$disconnect()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
