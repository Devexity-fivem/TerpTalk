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
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPlantDoctorCase, scanPlantDoctorFollowups } from "@/lib/plant-doctor"
import { WIZARD_RESULTS } from "@/lib/problem-wizard"
import { settlePendingPush } from "@/lib/web-push"

const prisma = new PrismaClient()
// Minimal service-worker surface used inside sw.evaluate() — the scripts
// tsconfig has no webworker lib.
type SWNote = { title: string; data: unknown; close(): void }
type SWScope = {
  registration: { getNotifications(): Promise<SWNote[]> }
  NotificationEvent: new (type: string, init: { notification: SWNote }) => Event
}
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

  // Phase 7 contextual-surface fixtures — a catalog strain with bob's
  // public grower diary, and a question-category thread tagged with it.
  const ctxStrain = await prisma.strain.create({
    data: { name: `__brCtxStrain ${TS}`, slug: `__brctx-${TS}` },
  })
  await prisma.growDiary.create({
    data: {
      title: `__br ctx grow ${TS}`, slug: `__br-ctxg-${TS}`, description: "",
      growType: "INDOOR", startDate: new Date(), authorId: bob.id,
      visibility: "PUBLIC", strainId: ctxStrain.id, strain: ctxStrain.name,
    },
  })
  const ctxCat =
    (await prisma.category.findFirst({
      where: {
        hidden: false,
        OR: [
          { slug: { contains: "question" } }, { name: { contains: "question" } },
          { slug: { contains: "help" } }, { name: { contains: "help" } },
        ],
      },
    })) ??
    (await prisma.category.create({
      data: { name: `__br questions ${TS}`, slug: `__br-qcat-${TS}`, description: "" },
    }))
  const ctxTag = await prisma.tag.create({
    data: { name: ctxStrain.name.toLowerCase(), slug: `__brtag-${TS}` },
  })
  const ctxQThread = await prisma.thread.create({
    data: {
      // bob authors it — the chat suite asserts alice owns zero threads.
      // Named ctxQThread: the KC section below declares its own ctxThread.
      title: `__br ctx growers question ${TS}`, slug: `__br-ctxq-${TS}`, content: "x",
      authorId: bob.id, categoryId: ctxCat.id,
      tags: { create: [{ tagId: ctxTag.id }] },
    },
  })

  // Phase 8 digest fixture — alice user-follows carol, whose public diary
  // (created this week) + update feed "From growers you follow" on
  // /mydigest. Carol is separate from bob: the blocked-profile check above
  // leaves alice blocking bob for the rest of the suite.
  const carol = await mkUser("c")
  const carolUsername = `__br_c_${TS}`
  const carolDiary = await prisma.growDiary.create({
    data: {
      title: `__br digest grow ${TS}`, slug: `__br-dg-${TS}`, description: "",
      growType: "INDOOR", startDate: new Date(), authorId: carol.id, visibility: "PUBLIC",
    },
  })
  await prisma.diaryUpdate.create({
    data: { diaryId: carolDiary.id, authorId: carol.id, stage: "VEG", title: `__br digest update ${TS}`, content: "browser fixture — followed grower update" },
  })
  await prisma.follow.create({ data: { followerId: alice.id, followingId: carol.id } })

  // Chat fixtures (Batch O) — a public room where the anchor target is the
  // OLDEST message and ~40 newer fillers force the initial view to land at
  // the bottom, so an in-view target proves the #msg- scroll ran.
  const chatRoom = await prisma.chatRoom.create({
    data: { name: `__br lounge ${TS}`, slug: `__br-lounge-${TS}`, order: 990 },
  })
  const chatTarget = await prisma.chatMessage.create({
    data: { roomId: chatRoom.id, authorId: alice.id, content: `__br anchor ${TS} — the pinned question`, createdAt: new Date(Date.now() - 60 * 60_000) },
  })
  const bobChatMsg = await prisma.chatMessage.create({
    data: { roomId: chatRoom.id, authorId: bob.id, content: `__br bob's message ${TS}`, createdAt: new Date(Date.now() - 59 * 60_000) },
  })
  await prisma.chatMessage.createMany({
    data: Array.from({ length: 40 }, (_, i) => ({
      roomId: chatRoom.id,
      authorId: alice.id,
      content: `__br filler ${TS} #${i + 1}`,
      createdAt: new Date(Date.now() - (58 - i) * 60_000),
    })),
  })

  // Login attempts are bucketed per-IP (30/15min) — earlier HTTP suites in
  // a master run can exhaust the allowance. Clear the login buckets like
  // account-verify does for register, so this suite is deterministic.
  await prisma.rateLimit.deleteMany({
    where: { OR: [{ key: { startsWith: "login" } }] },
  }).catch(() => {})

  const browser = await chromium.launch({ headless: true })
  // DOMContentLoaded resolves before streamed RSC content attaches —
  // asserting on counts immediately after it raced hydration under load
  // (the master-run flake). Wait for the specific element each assertion
  // reads instead of a blanket network state: Pusher keeps sockets open,
  // so networkidle is unreliable on authed pages. waitForSelector is a
  // bounded condition, not a sleep.
  const gotoMain = async (page: import("playwright-core").Page, url: string, selector = "main#main-content") => {
    const res = await page.goto(url, { waitUntil: "domcontentloaded" })
    await page.waitForSelector(selector, { timeout: 30_000 })
    return res
  }
  const login = async (username: string, contextOpts?: import("playwright-core").BrowserContextOptions) => {
    const context = await browser.newContext(contextOpts)
    const page = await context.newPage()
    // networkidle is safe here specifically: the anonymous signin page
    // opens no Pusher socket, so network settles. The controlled inputs
    // reset to React state on hydration; the value re-check below covers
    // a fill that landed before hydration finished.
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
    const homeRes = await gotoMain(anonPage, BASE, "main h1")
    ok("anon: home renders 200", homeRes?.status() === 200, homeRes?.status())
    ok("anon: main landmark + exactly one h1", (await anonPage.locator("main").count()) >= 1 && (await anonPage.locator("h1").count()) === 1)
    ok("anon: sign-in affordance visible", (await anonPage.locator('a[href^="/auth/signin"]').count()) >= 1)

    const signinRes = await gotoMain(anonPage, `${BASE}/auth/signin`, "label[for=username]")
    ok("anon: signin 200", signinRes?.status() === 200)
    const labeledUser = await anonPage.locator("label[for=username]").count()
    const labeledPass = await anonPage.locator("label[for=password]").count()
    ok("a11y: signin inputs have labels", labeledUser === 1 && labeledPass === 1)

    // Public vs private diary — the existence-oracle contract must hold
    // in the rendered page, not just the route.
    const pubRes = await gotoMain(anonPage, `${BASE}/diaries/${pubDiary.slug}`)
    ok("privacy: PUBLIC diary renders to anonymous", pubRes?.status() === 200, pubRes?.status())
    const privRes = await gotoMain(anonPage, `${BASE}/diaries/${privDiary.slug}`)
    const privBody = (await anonPage.textContent("body")) ?? ""
    ok(
      "privacy: PRIVATE diary → 404/not-found for anonymous",
      privRes?.status() === 404 || /not found|404/i.test(privBody),
      { status: privRes?.status() }
    )

    // ── Auth flow ────────────────────────────────────────────────────
    const { context: aliceCtx, page: alicePage } = await login(aliceUsername)
    ok("auth: credentials login leaves /auth/signin", !alicePage.url().includes("/auth/signin"), alicePage.url())
    // The Messages affordance is rendered by the hydrated session nav —
    // wait for the element itself rather than a load-state heuristic.
    await gotoMain(alicePage, BASE)
    await alicePage.waitForSelector('a[aria-label*="Messages"]', { timeout: 15_000 }).catch(() => null)
    const msgLink = await alicePage.locator('a[aria-label*="Messages"]').count()
    ok("auth: session nav shows Messages affordance", msgLink >= 1, { found: msgLink })

    // ── Profile V2 surfaces ──────────────────────────────────────────
    const profRes = await gotoMain(alicePage, `${BASE}/u/${aliceUsername}`)
    const profBody = (await alicePage.textContent("body")) ?? ""
    ok("profile: public profile 200 + shows username", profRes?.status() === 200 && profBody.includes(aliceUsername), profRes?.status())

    const selfRes = await gotoMain(alicePage, `${BASE}/profile`)
    // Client-rendered tab — identity can surface as username or display
    // name; wait for either rather than a fixed load state.
    await alicePage.waitForFunction(
      (names: string[]) => names.some((n) => document.body.textContent?.includes(n)),
      [aliceUsername, `__browser_a_${TS}`],
      { timeout: 30_000 }
    ).catch(() => {})
    const selfBody = (await alicePage.textContent("body")) ?? ""
    ok(
      "profile: own /profile 200 + identity rendered",
      selfRes?.status() === 200 && (selfBody.includes(aliceUsername) || selfBody.includes(`__browser_a_${TS}`)),
      selfRes?.status()
    )

    // Owner sees their private diary — the other side of the oracle.
    const ownerPriv = await gotoMain(alicePage, `${BASE}/diaries/${privDiary.slug}`)
    ok("privacy: owner can view own PRIVATE diary", ownerPriv?.status() === 200, ownerPriv?.status())

    // ── Progression display ──────────────────────────────────────────
    const progRes = await gotoMain(alicePage, `${BASE}/progress`)
    const progBody = (await alicePage.textContent("body")) ?? ""
    ok("progression: /progress renders rank/unlock surface", progRes?.status() === 200 && progBody.length > 500, progRes?.status())

    // ── Chat deep links + ask-the-community (Batch O) ────────────────
    const inView = (mid: string) => {
      const el = document.querySelector(`[data-mid="${mid}"]`)
      const log = el?.closest('[role="log"]')
      if (!el || !log) return false
      const r = el.getBoundingClientRect()
      const c = log.getBoundingClientRect()
      // Inside the scrollport AND not pinned at the bottom — the anchor
      // target is the oldest row, so bottom-landing would exclude it.
      return r.top >= c.top - 2 && r.bottom <= c.bottom + 2 &&
        log.scrollHeight - log.scrollTop - log.clientHeight > 4
    }
    const chatRes = await gotoMain(alicePage, `${BASE}/chat?room=${chatRoom.slug}#msg-${chatTarget.id}`, '[role="log"]')
    ok("chat: /chat?room=<slug>#msg-<id> loads", chatRes?.status() === 200, chatRes?.status())
    await alicePage.waitForSelector(`[data-mid="${chatTarget.id}"]`, { timeout: 30_000 })
    const anchored = await alicePage.waitForFunction(inView, chatTarget.id, { timeout: 15_000 })
      .then(() => true).catch(() => false)
    ok("chat: #msg anchor scrolls the exact message into view", anchored)

    // Regression: a room-only link still lands at the newest messages.
    await gotoMain(alicePage, `${BASE}/chat?room=${chatRoom.slug}`, '[role="log"]')
    await alicePage.waitForSelector("[data-mid]", { timeout: 30_000 })
    const landedBottom = await alicePage.waitForFunction(() => {
      const log = document.querySelector('[role="log"]')
      return !!log && log.scrollHeight - log.scrollTop - log.clientHeight < 4
    }, null, { timeout: 15_000 }).then(() => true).catch(() => false)
    ok("chat: room-only link still lands at the newest messages", landedBottom)

    // Nonexistent anchor → normal room view, no crash.
    await gotoMain(alicePage, `${BASE}/chat?room=${chatRoom.slug}#msg-doesnotexist`, '[role="log"]')
    const rows = await alicePage.locator("[data-mid]").count()
    ok("chat: nonexistent #msg anchor degrades to a normal room view", rows > 30, rows)

    // Own message → Ask the community → composer prefill → cancel = nothing.
    await alicePage.locator(`[data-mid="${chatTarget.id}"] button[aria-label="Message options"]`).click()
    const askItem = alicePage.locator('button[role="menuitem"]:has-text("Ask the community")')
    ok("chat: own message exposes Ask the community", (await askItem.count()) === 1)
    await askItem.click()
    await alicePage.waitForSelector('div[role="dialog"][aria-label="Share something"]', { timeout: 10_000 })
    const prefill = await alicePage.inputValue('div[role="dialog"] textarea')
    ok("chat: composer opens with the message text as editable draft", prefill === chatTarget.content, prefill.slice(0, 80))
    await alicePage.keyboard.press("Escape")
    await alicePage.waitForSelector('div[role="dialog"]', { state: "detached", timeout: 10_000 })
    ok("chat: cancelling the composer creates no thread", (await prisma.thread.count({ where: { authorId: alice.id } })) === 0)

    // Another member's message must not expose the action.
    await alicePage.locator(`[data-mid="${bobChatMsg.id}"] button[aria-label="Message options"]`).click()
    ok("chat: another member's message hides Ask the community",
      (await alicePage.locator('button[role="menuitem"]:has-text("Ask the community")').count()) === 0)
    await alicePage.locator(`[data-mid="${bobChatMsg.id}"] button[aria-label="Message options"]`).click()

    // Mention → notification → #msg link → exact message (Batch P).
    // Emit through the real POST endpoint using alice's session cookie.
    const aliceCookies = await aliceCtx.cookies(BASE)
    const cookieHeader = aliceCookies.map((c) => `${c.name}=${c.value}`).join("; ")
    const mentionPost = await fetch(`${BASE}/api/chat/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookieHeader },
      body: JSON.stringify({ roomId: chatRoom.id, content: `hey @${bobUsername} look at this ${TS}` }),
    })
    const mentionMsg = (await mentionPost.json().catch(() => ({})))?.message
    // Bury the mention under newer messages so a bottom-landing would miss
    // it — proving the anchor pulled bob to the exact row. Keep the room
    // under the 50-message GET window so older fixture rows still render.
    if (mentionMsg?.id) {
      await prisma.chatMessage.createMany({
        data: Array.from({ length: 4 }, (_, i) => ({
          roomId: chatRoom.id, authorId: alice.id,
          content: `__br post-mention ${TS} #${i + 1}`,
          createdAt: new Date(Date.now() + (i + 1) * 1000),
        })),
      })
    }
    const { context: bobChatCtx, page: bobChatPage } = await login(bobUsername)
    await gotoMain(bobChatPage, `${BASE}/notifications`)
    const mentionLink = bobChatPage.locator(`a[href*="#msg-"]`).first()
    const linkFound = await mentionLink.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)
    ok("chat: mention notification carries a #msg-<id> link", linkFound && mentionPost.status === 201, { status: mentionPost.status, id: mentionMsg?.id })
    await mentionLink.click()
    await bobChatPage.waitForSelector(`[data-mid="${mentionMsg?.id}"]`, { timeout: 30_000 }).catch(() => null)
    const mentionAnchored = mentionMsg?.id
      ? await bobChatPage.waitForFunction(inView, mentionMsg.id, { timeout: 15_000 }).then(() => true).catch(() => false)
      : false
    ok("chat: clicking the mention notification lands on the exact message", mentionAnchored)
    await bobChatCtx.close()

    // Mobile: anchor lands at 390px and the menu fits the viewport.
    const { context: chatMobCtx, page: chatMobPage } = await login(aliceUsername, { viewport: { width: 390, height: 844 } })
    await gotoMain(chatMobPage, `${BASE}/chat?room=${chatRoom.slug}#msg-${chatTarget.id}`, '[role="log"]')
    await chatMobPage.waitForSelector(`[data-mid="${chatTarget.id}"]`, { timeout: 30_000 })
    const mobAnchored = await chatMobPage.waitForFunction(inView, chatTarget.id, { timeout: 15_000 })
      .then(() => true).catch(() => false)
    ok("mobile: #msg anchor lands on the message at 390px", mobAnchored)
    await chatMobPage.locator(`[data-mid="${chatTarget.id}"] button[aria-label="Message options"]`).click()
    const menu = chatMobPage.locator('div[role="menu"]').first()
    await menu.waitFor({ state: "visible", timeout: 10_000 })
    const menuBox = await menu.boundingBox()
    ok("mobile: message menu fits the 390px viewport",
      !!menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= 391 && menuBox.width > 0)
    await chatMobCtx.close()

    // ── Setup canonical discussion + comment anchor (Batch Q) ────────
    const setup = await prisma.growSetup.create({
      data: { title: `__br setup ${TS}`, slug: `__br-setup-${TS}`, description: "browser fixture", authorId: alice.id },
    })
    // 30 comments so the list is tall; the anchor target is the OLDEST —
    // landing on it proves the hash scrolled past the page top.
    await prisma.setupComment.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        setupId: setup.id, authorId: bob.id, content: `__br sc ${TS} #${i + 1}`,
        createdAt: new Date(Date.now() - (30 - i) * 60_000),
      })),
    })
    const aliceComment = await prisma.setupComment.create({
      data: { setupId: setup.id, authorId: alice.id, content: `__br sc alice ${TS}` },
    })
    const firstComment = await prisma.setupComment.findFirst({
      where: { setupId: setup.id }, orderBy: { createdAt: "asc" }, select: { id: true },
    })
    const setupRes = await gotoMain(anonPage, `${BASE}/setups/${setup.slug}`)
    ok("setup: page renders 200 to anonymous", setupRes?.status() === 200, setupRes?.status())
    ok("setup: discuss affordance renders without a thread",
      (await anonPage.locator('button:has-text("Discuss this setup")').count()) === 1)
    // #comment-<id> lands on the exact comment (browser-native anchor).
    await gotoMain(anonPage, `${BASE}/setups/${setup.slug}#comment-${firstComment?.id}`)
    const commentAnchored = firstComment?.id
      ? await anonPage.waitForFunction((id: string) => {
          const el = document.getElementById(`comment-${id}`)
          if (!el) return false
          const r = el.getBoundingClientRect()
          return r.top >= -2 && r.bottom <= window.innerHeight + 2 && window.scrollY > 0
        }, firstComment.id, { timeout: 15_000 }).then(() => true).catch(() => false)
      : false
    ok("setup: #comment anchor scrolls the exact comment into view", commentAnchored)
    // Batch R — anonymous visitors get no per-comment report affordance.
    ok("setup: anonymous sees no comment report affordance",
      (await anonPage.locator('button:has-text("Report")').count()) === 0)
    // Member clicks Discuss → lazy-creates the canonical thread → thread page.
    const { context: bobSetupCtx, page: bobSetupPage } = await login(bobUsername)
    await gotoMain(bobSetupPage, `${BASE}/setups/${setup.slug}`)
    // Batch R — members can report others' comments but never their own.
    // ReportButton gates on useSession(), which resolves after hydration —
    // wait for it rather than counting synchronously.
    const aliceCommentRow = bobSetupPage.locator(`#comment-${aliceComment.id}`)
    const reportBtn = aliceCommentRow.locator('button:has-text("Report")')
    const reportVisible = await reportBtn.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)
    ok("setup: member sees Report on another member's comment", reportVisible)
    ok("setup: author sees no Report on own comment",
      (await bobSetupPage.locator(`#comment-${firstComment?.id} button:has-text("Report")`).count()) === 0)
    if (reportVisible) {
      await reportBtn.click()
      await bobSetupPage.locator('button:has-text("Submit report")').click()
      // Wait for the round-trip — the button swaps to a confirmation label.
      await bobSetupPage.locator('text=Reported').first()
        .waitFor({ state: "visible", timeout: 15_000 }).catch(() => {})
    }
    const commentReport = await prisma.report.findFirst({
      where: { type: "SETUP_COMMENT", targetId: aliceComment.id, reporterId: bob.id },
    })
    ok("setup: comment report submits through the existing report API", !!commentReport)
    await bobSetupPage.locator('button:has-text("Discuss this setup")').click()
    await bobSetupPage.waitForURL(/\/forum\/thread\//, { timeout: 45_000 })
    const createdSlug = bobSetupPage.url().split("/forum/thread/")[1]
    const createdThread = await prisma.thread.findFirst({ where: { slug: createdSlug }, select: { authorId: true } })
    const linkedSetup = await prisma.growSetup.findUnique({ where: { id: setup.id }, select: { threadId: true } })
    ok("setup: discuss click lazy-creates canonical thread owned by the setup author",
      !!createdThread && createdThread.authorId === alice.id && !!linkedSetup?.threadId,
      { slug: createdSlug })
    // The setup page now links the canonical discussion instead of offering create.
    await gotoMain(bobSetupPage, `${BASE}/setups/${setup.slug}`)
    const discLink = bobSetupPage.locator('a[href*="/forum/thread/"]')
    ok("setup: canonical discussion link replaces the affordance",
      (await discLink.count()) >= 1 && (await discLink.first().getAttribute("href"))?.includes(createdSlug) === true)
    await bobSetupCtx.close()

    // ── Plant Doctor outcome loop ──────────────────────────────────
    // Wizard → track the fix → report outcome → survives reload.
    await gotoMain(alicePage, `${BASE}/plant-doctor`)
    await alicePage.locator('button:has-text("Leaves")').click()
    await alicePage.locator('button:has-text("Yellowing")').click()
    await alicePage.locator('button:has-text("All over evenly")').click()
    const trackBtn = alicePage.locator('button:has-text("Track this fix")')
    await trackBtn.waitFor({ state: "visible", timeout: 15_000 })
    await trackBtn.click()
    const tracked = await alicePage.locator('text=/Tracked — come back/')
      .waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)
    ok("pd: member tracks a diagnosis into a case", tracked)
    // router.refresh() swaps the server-rendered case list in below.
    const trackedFixes = alicePage.locator('text=Your tracked fixes')
    const fixesVisible = await trackedFixes.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)
    ok("pd: tracked fix appears in owner list", fixesVisible)
    if (fixesVisible) {
      await alicePage.locator('button:has-text("It helped")').first().click()
      const reported = await alicePage.locator('text=/^It helped$/').last()
        .waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)
      ok("pd: outcome report renders as current state", reported)
      // Reload — the record is durable, not session state.
      await gotoMain(alicePage, `${BASE}/plant-doctor`)
      const persisted = await alicePage.locator('text=Your tracked fixes')
        .waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false)
      const body = persisted ? (await alicePage.textContent("body")) ?? "" : ""
      ok("pd: outcome survives reload", persisted && body.includes("It helped"))
    }
    // Anonymous visitors get the wizard but not the tracking affordance.
    await gotoMain(anonPage, `${BASE}/plant-doctor`)
    await anonPage.locator('button:has-text("Leaves")').click()
    await anonPage.locator('button:has-text("Yellowing")').click()
    await anonPage.locator('button:has-text("All over evenly")').click()
    await anonPage.locator('text=Sign in').waitFor({ state: "visible", timeout: 15_000 }).catch(() => {})
    const anonBody = (await anonPage.textContent("body")) ?? ""
    ok("pd: anonymous sees sign-in instead of tracking",
      anonBody.includes("Sign in") && !anonBody.includes("Track this fix") && !anonBody.includes("Your tracked fixes"))

    // ── Knowledge compounding — grow context + symptom filters ───────
    // Fixtures are created HERE (not at suite start): the chat section's
    // "cancelling creates no thread" check requires alice to own zero
    // threads until this point.
    const QUESTION_RE = /question|help|problem|doctor/i
    const qCatRow = (await prisma.category.findMany({ where: { hidden: false }, select: { id: true, slug: true, name: true } }))
      .find((c) => QUESTION_RE.test(`${c.slug} ${c.name}`))
    if (!qCatRow) throw new Error("browser: no question-like category seeded")
    const ctxThread = await prisma.thread.create({
      data: {
        title: `__br ctx question ${TS}`,
        slug: `__br-ctx-${TS}`,
        content: "browser fixture — symptom question with linked grow context",
        categoryId: qCatRow.id,
        authorId: alice.id,
        contextDiaryId: pubDiary.id,
      },
    })
    const pestTag = await prisma.tag.upsert({
      where: { slug: "pests" },
      update: {},
      create: { name: "pests", slug: "pests" },
    })
    await prisma.threadTag.upsert({
      where: { threadId_tagId: { threadId: ctxThread.id, tagId: pestTag.id } },
      update: {},
      create: { threadId: ctxThread.id, tagId: pestTag.id },
    })
    const privCtxThread = await prisma.thread.create({
      data: {
        title: `__br ctx private ${TS}`,
        slug: `__br-ctxp-${TS}`,
        content: "browser fixture — question linked to a private grow",
        categoryId: qCatRow.id,
        authorId: alice.id,
        contextDiaryId: privDiary.id,
      },
    })
    // The prisma-created fixtures need one real thread POST to bust the
    // cached "forum" tag before /questions recomputes.
    const bustRes = await aliceCtx.request.post(`${BASE}/api/forum/threads`, {
      data: { title: `__br bust ${TS}`, content: "browser cache-bust thread body — enough chars", categoryId: qCatRow.id },
    })
    ok("kc: cache-bust thread create", bustRes.status() === 201, bustRes.status())

    // Symptom filter — the pests-tagged question shows under its tag.
    await gotoMain(anonPage, `${BASE}/questions?filter=all&symptom=pests`)
    const qPestBody = (await anonPage.textContent("body")) ?? ""
    ok("kc: symptom filter lists tagged question", qPestBody.includes(`__br ctx question ${TS}`))
    // A different symptom does not.
    await gotoMain(anonPage, `${BASE}/questions?filter=all&symptom=nutrient-deficiency`)
    const qDefBody = (await anonPage.textContent("body")) ?? ""
    ok("kc: other symptom excludes untagged question", !qDefBody.includes(`__br ctx question ${TS}`))
    // The "grow linked" indicator rides the question card.
    ok("kc: grow-linked indicator renders", qPestBody.includes("grow linked"))

    // Thread page — public context chip visible to anon…
    await gotoMain(anonPage, `${BASE}/forum/thread/${ctxThread.slug}`)
    const ctxBody = (await anonPage.textContent("body")) ?? ""
    ok("kc: public context grow chip renders for anon",
      ctxBody.includes("About their grow:") && ctxBody.includes(`__br public grow ${TS}`))
    // …private context hidden from anon…
    const ctxPrivRes = await gotoMain(anonPage, `${BASE}/forum/thread/${privCtxThread.slug}`)
    const ctxPrivBody = (await anonPage.textContent("body")) ?? ""
    ok("kc: private context grow hidden from anon",
      ctxPrivRes?.status() === 200 && !ctxPrivBody.includes("About their grow:"), ctxPrivRes?.status())
    // …and shown to the diary owner.
    await gotoMain(alicePage, `${BASE}/forum/thread/${privCtxThread.slug}`)
    const privOwnerBody = (await alicePage.textContent("body")) ?? ""
    ok("kc: private context grow shown to owner", privOwnerBody.includes("About their grow:"))

    // ── Web Push: opt-in → real delivery → click routing ─────────────
    // Bundled headless-shell Chromium has no push service and reports
    // notifications as denied, so this leg drives Microsoft Edge
    // (Chromium + a real WNS push service) through a persistent profile —
    // Push is disabled in incognito-style contexts by design. Real VAPID
    // keys from .env, real push service, real service worker.
    {
      const profileDir = mkdtempSync(join(tmpdir(), "tt-push-"))
      const edge = await chromium.launchPersistentContext(profileDir, { headless: true, channel: "msedge" })
        .catch((e) => { throw new Error(`push leg needs Microsoft Edge (channel "msedge"): ${String(e).slice(0, 160)}`) })
      try {
        await edge.grantPermissions(["notifications"], { origin: BASE })
        const p = await edge.newPage()
        await p.goto(`${BASE}/auth/signin`, { waitUntil: "networkidle" })
        await p.fill("#username", aliceUsername)
        await p.fill("#password", PASSWORD)
        await p.press("#password", "Enter")
        await p.waitForURL((u) => !u.pathname.startsWith("/auth/signin"), { timeout: 45_000 })

        // Invitation renders without overflow at every required width.
        let inviteOk = true
        for (const w of [360, 390, 1024, 1280, 1440]) {
          await p.setViewportSize({ width: w, height: 900 })
          await gotoMain(p, BASE)
          const seen = await p.locator('[data-testid="push-invite"]').waitFor({ timeout: 20_000 }).then(() => true).catch(() => false)
          const over = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
          if (!seen || over) { inviteOk = false; console.log(`  invite @${w}px seen=${seen} overflow=${over}`) }
        }
        ok("push: invitation renders at 360/390/1024/1280/1440 without overflow", inviteOk)

        await p.locator('[data-testid="push-invite"] button:has-text("Turn on")').click()
        await p.locator('[data-testid="push-invite"]').waitFor({ state: "detached", timeout: 20_000 }).catch(() => {})
        const subs = await prisma.pushSubscription.findMany({ where: { userId: alice.id }, select: { endpoint: true } })
        ok("push: Turn on persists a real push-service subscription",
          subs.length === 1 && new URL(subs[0].endpoint).protocol === "https:", subs.map((s) => new URL(s.endpoint).host))

        await gotoMain(p, `${BASE}/settings/notifications`, '[data-testid="push-status"]')
        await p.waitForFunction(() => document.querySelector('[data-testid="push-status"]')?.textContent?.includes("On for this device"), null, { timeout: 15_000 }).catch(() => {})
        ok("push: settings shows the enabled state",
          ((await p.textContent('[data-testid="push-status"]')) ?? "").includes("On for this device"))

        // Reload keeps the invitation away (already subscribed).
        await gotoMain(p, BASE)
        await p.waitForTimeout(2500)
        ok("push: invitation hidden once enabled", (await p.locator('[data-testid="push-invite"]').count()) === 0)

        // Real reply from bob → in-app REPLY + one OS notification.
        const pushThread = await prisma.thread.create({
          data: { title: `__br push thread ${TS}`, slug: `__br-push-${TS}`, content: "push e2e", categoryId: qCatRow.id, authorId: alice.id },
        })
        const { context: bobPushCtx } = await login(bobUsername)
        const replyRes = await bobPushCtx.request.post(`${BASE}/api/forum/posts`, {
          data: { threadId: pushThread.id, content: `__br push reply ${TS} — enough content to pass the minimum` },
        })
        await bobPushCtx.close()
        const sw = edge.serviceWorkers()[0] ?? await edge.waitForEvent("serviceworker")
        const shownNotes = async () => sw.evaluate(async () =>
          (await (self as unknown as SWScope).registration.getNotifications())
            .map((n) => ({ title: n.title, url: (n.data as { url: string }).url })))
        let shown: { title: string; url: string }[] = []
        for (let i = 0; i < 30 && !shown.length; i++) {
          await p.waitForTimeout(1000)
          shown = await shownNotes()
        }
        const replyRows = await prisma.notification.count({ where: { userId: alice.id, type: "REPLY" } })
        ok("push: reply → exactly one in-app notification + one OS notification",
          replyRes.status() === 201 && replyRows === 1 && shown.length === 1 && shown[0].url.startsWith(`/forum/thread/${pushThread.slug}?post=`),
          { s: replyRes.status(), replyRows, shown })

        // Click → existing deep link + CLICKED telemetry.
        await sw.evaluate(async () => {
          const reg = (self as unknown as SWScope).registration
          const [n] = await reg.getNotifications()
          self.dispatchEvent(new (self as unknown as SWScope).NotificationEvent("notificationclick", { notification: n }))
        })
        await p.waitForURL((u) => u.pathname === `/forum/thread/${pushThread.slug}`, { timeout: 15_000 }).catch(() => {})
        let clicked = 0
        for (let i = 0; i < 10 && !clicked; i++) {
          await p.waitForTimeout(500)
          clicked = await prisma.pushEvent.count({ where: { userId: alice.id, type: "CLICKED", category: "REPLY" } })
        }
        ok("push: click opens the exact thread/post deep link", new URL(p.url()).pathname === `/forum/thread/${pushThread.slug}` && p.url().includes("#post-"), p.url())
        ok("push: click recorded (type + category only)", clicked === 1, clicked)

        // Plant Doctor follow-up — same logical reminder: one in-app
        // BOT_ASSIST, one OS notification to /plant-doctor, no repeat.
        const pdCase = await createPlantDoctorCase({ userId: alice.id, resultId: Object.keys(WIZARD_RESULTS)[3] })
        if (!("caseId" in pdCase)) throw new Error("pd case create failed")
        await prisma.plantDoctorCase.update({ where: { id: pdCase.caseId }, data: { createdAt: new Date(Date.now() - 10 * 86400000) } })
        await sw.evaluate(async () => {
          for (const n of await (self as unknown as SWScope).registration.getNotifications()) n.close()
        })
        const pd1 = await scanPlantDoctorFollowups({ caseIds: [pdCase.caseId] })
        const pd2 = await scanPlantDoctorFollowups({ caseIds: [pdCase.caseId] })
        await settlePendingPush()
        shown = []
        for (let i = 0; i < 30 && !shown.length; i++) {
          await p.waitForTimeout(1000)
          shown = await shownNotes()
        }
        const pdRows = await prisma.notification.count({ where: { userId: alice.id, type: "BOT_ASSIST", link: "/plant-doctor" } })
        ok("push: Plant Doctor reminder → one in-app row + one OS notification to /plant-doctor, retry deduped",
          pd1.sent === 1 && pd2.sent === 0 && pdRows === 1 && shown.length === 1 && shown[0].url === "/plant-doctor",
          { pd1, pd2, pdRows, shown })
        await prisma.botEvent.deleteMany({ where: { key: `assist:pd-followup:${pdCase.caseId}` } })
        await prisma.rateLimit.deleteMany({ where: { key: `terpbot:assist:user:${alice.id}` } })

        // Turn off from settings removes the subscription.
        await gotoMain(p, `${BASE}/settings/notifications`, '[data-testid="push-status"]')
        await p.locator('[data-testid="push-settings"] button:has-text("Turn off")').click({ timeout: 15_000 })
        await p.waitForFunction(() => document.querySelector('[data-testid="push-status"]')?.textContent?.includes("Off on this device"), null, { timeout: 15_000 }).catch(() => {})
        ok("push: Turn off removes the stored subscription",
          (await prisma.pushSubscription.count({ where: { userId: alice.id } })) === 0)
      } finally {
        await edge.close().catch(() => {})
        await prisma.pushEvent.deleteMany({ where: { userId: { in: [alice.id, bob.id] } } }).catch(() => {})
        rmSync(profileDir, { recursive: true, force: true })
      }
    }

    // ── Social Grow Updates (Phase 1) ────────────────────────────────
    // Real UI: bob reacts to + comments on alice's PUBLIC update; the
    // comment lands as an anchored Post in the lazily created discussion.
    // UNLISTED/PRIVATE grows render no composer; deleting the update
    // leaves no orphan comment anywhere.
    const mkSocDiary = (visibility: string, tag: string) => prisma.growDiary.create({
      data: {
        title: `__br social ${tag} ${TS}`, slug: `__br-soc-${tag}-${TS}`, description: "social fixture",
        growType: "INDOOR", startDate: new Date(), authorId: alice.id, visibility,
      },
    })
    const socDiary = await mkSocDiary("PUBLIC", "pub")
    const unlSocDiary = await mkSocDiary("UNLISTED", "unl")
    const mkSocUpdate = (diaryId: string, tag: string) => prisma.diaryUpdate.create({
      data: { diaryId, authorId: alice.id, title: `__br update ${tag} ${TS}`, content: "week 2 canopy", stage: "VEGETATIVE", dayNumber: 9, weekNumber: 2 },
    })
    const socUpd = await mkSocUpdate(socDiary.id, "pub")
    const unlUpd = await mkSocUpdate(unlSocDiary.id, "unl")
    const privUpd = await mkSocUpdate(privDiary.id, "priv")
    const socComment = `__br comment ${TS} — love the canopy`
    {
      const { context: bobSocCtx, page: bp } = await login(bobUsername)
      const row = `[data-update-social="${socUpd.id}"]`
      await gotoMain(bp, `${BASE}/diaries/${socDiary.slug}`, row)
      await bp.locator(`${row} button:has-text("React")`).first().click()
      await bp.locator(`${row} button[aria-label="React with like"]`).click()
      await bp.waitForFunction((sel) => !!document.querySelector(sel)?.textContent?.includes("1"), row, { timeout: 15_000 }).catch(() => {})
      ok("social: member reacts to a PUBLIC grow update in the UI",
        (await prisma.reaction.count({ where: { userId: bob.id, diaryUpdateId: socUpd.id } })) === 1)

      await bp.locator(`[data-update-comment="${socUpd.id}"]`).click()
      await bp.fill(`#update-comment-${socUpd.id}`, socComment)
      await bp.locator(`${row} button:has-text("Post comment")`).click()
      // Done = composer closed (submit succeeded) AND the refreshed inline
      // list carries the comment. The textarea's own value must not count.
      await bp.waitForSelector(`#update-comment-${socUpd.id}`, { state: "detached", timeout: 30_000 }).catch(() => {})
      await bp.waitForFunction(
        ([sel, text]) => !!document.querySelector(`${sel} ul[aria-label="Comments on this update"]`)?.textContent?.includes(text),
        [row, socComment] as const,
        { timeout: 30_000 }
      ).catch(() => {})
      const anchored = await prisma.post.findFirst({
        where: { authorId: bob.id, diaryUpdateId: socUpd.id },
        select: { threadId: true, deleted: true },
      })
      const socThread = await prisma.growDiary.findUnique({ where: { id: socDiary.id }, select: { threadId: true } })
      ok("social: UI comment is an anchored Post in the grow's discussion thread",
        !!anchored && !anchored.deleted && anchored.threadId === socThread?.threadId,
        { anchored, socThread })
      ok("social: comment renders inline under the update",
        ((await bp.locator(`${row} ul[aria-label="Comments on this update"]`).textContent().catch(() => "")) ?? "").includes(socComment))

      await gotoMain(bp, `${BASE}/diaries/${unlSocDiary.slug}`, `[data-update-social="${unlUpd.id}"]`)
      ok("social: UNLISTED grow renders no comment composer",
        (await bp.locator(`[data-update-comment="${unlUpd.id}"]`).count()) === 0)
      await bp.goto(`${BASE}/diaries/${privDiary.slug}`, { waitUntil: "domcontentloaded" })
      ok("social: PRIVATE grow exposes no update interaction to non-owner",
        (await bp.locator(`[data-update-social="${privUpd.id}"]`).count()) === 0)
      await bobSocCtx.close()
    }
    {
      const anonSoc = await browser.newContext()
      const ap = await anonSoc.newPage()
      await gotoMain(ap, `${BASE}/diaries/${socDiary.slug}`, `[data-update-social="${socUpd.id}"]`)
      ok("social: anonymous visitor sees PUBLIC update comments",
        ((await ap.textContent("body")) ?? "").includes(socComment))
      // Grower deletes the update — the anchored comment must not survive
      // as an orphan in the grow discussion.
      const del = await aliceCtx.request.delete(`${BASE}/api/diaries/updates`, { data: { id: socUpd.id } })
      const thread = await prisma.growDiary.findUnique({
        where: { id: socDiary.id }, select: { discussion: { select: { slug: true } } },
      })
      await gotoMain(ap, `${BASE}/forum/thread/${thread?.discussion?.slug}`)
      ok("social: deleting the update leaves no orphan comment in the discussion",
        del.status() === 200 && !((await ap.textContent("body")) ?? "").includes(socComment),
        { status: del.status() })
      await anonSoc.close()
    }

    // ── Block boundary (privacy) ─────────────────────────────────────
    await prisma.block.create({ data: { blockerId: alice.id, blockedId: bob.id } })
    const { context: bobCtx, page: bobPage } = await login(bobUsername)
    const blockedRes = await gotoMain(bobPage, `${BASE}/u/${aliceUsername}`)
    const blockedBody = (await bobPage.textContent("body")) ?? ""
    ok(
      "privacy: blocked member sees not-found on blocker profile",
      blockedRes?.status() === 404 || /not found|404/i.test(blockedBody),
      { status: blockedRes?.status() }
    )
    // Blocked member gets a read-only update row — no reaction control,
    // no composer — and the API rejects the write regardless.
    const blockedUpd = await mkSocUpdate(socDiary.id, "blk")
    await gotoMain(bobPage, `${BASE}/diaries/${socDiary.slug}`)
    // The blocked row has no visible children (no controls) — wait for
    // attachment, not visibility.
    await bobPage.waitForSelector(`[data-update-social="${blockedUpd.id}"]`, { state: "attached", timeout: 30_000 })
    const blockedReact = await bobCtx.request.post(`${BASE}/api/reactions`, { data: { type: "LIKE", diaryUpdateId: blockedUpd.id } })
    ok("social: blocked member has no update reaction/comment controls and the API refuses",
      (await bobPage.locator(`[data-update-comment="${blockedUpd.id}"]`).count()) === 0 &&
      (await bobPage.locator(`[data-update-social="${blockedUpd.id}"] button:has-text("React")`).count()) === 0 &&
      blockedReact.status() === 403,
      { react: blockedReact.status() })
    await bobCtx.close()

    // ── Contextual grower surfaces (Phase 7) ─────────────────────────
    // Strain page: anonymous viewers get public-evidence grower cards at
    // every supported width; the section is a real h2 under the page h1
    // and never produces horizontal overflow.
    // Warm both routes once — dev-mode cold compile can exceed the 30s
    // selector wait under suite load; the assertions run on warm hits.
    await anonPage.request.get(`${BASE}/strains/${ctxStrain.slug}`).catch(() => {})
    await anonPage.request.get(`${BASE}/forum/thread/${ctxQThread.slug}`).catch(() => {})
    for (const w of [360, 390, 1024, 1280, 1440]) {
      await anonPage.setViewportSize({ width: w, height: 900 })
      await gotoMain(anonPage, `${BASE}/strains/${ctxStrain.slug}`, 'h2:has-text("Growers growing this strain")')
      const noOverflow = !(await anonPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1))
      const profileLink = await anonPage.locator(`a[href="/u/${bobUsername}"]`).count()
      const followCta = await anonPage.locator('a[href^="/auth/signin"]:has-text("Follow")').count()
      ok(`ctx: strain growers render + follow CTA at ${w}px without overflow`,
        noOverflow && profileLink >= 1 && followCta >= 1, { w, profileLink, followCta })
    }

    // Question thread: the grower rail renders with real tag signals —
    // same public-evidence rules for anonymous viewers.
    await anonPage.setViewportSize({ width: 390, height: 844 })
    const ctxThreadRes = await anonPage.goto(`${BASE}/forum/thread/${ctxQThread.slug}`, { waitUntil: "domcontentloaded" })
    try {
      await anonPage.waitForSelector('h2:has-text("Growers with related experience")', { timeout: 30_000 })
    } catch {
      const html = await anonPage.content()
      const db = await prisma.thread.findUnique({ where: { id: ctxQThread.id }, select: { slug: true, deleted: true, category: { select: { slug: true, name: true, hidden: true } } } })
      console.log("CTX DEBUG status:", ctxThreadRes?.status(), "| url:", anonPage.url(),
        "| has-rail:", html.includes("Growers with related experience"), "| has-evidence:", html.includes("What might already help"),
        "| notfound:", /404|not found/i.test(html.slice(0, 3000)), "| db-thread:", JSON.stringify(db))
      throw new Error("context rail missing")
    }
    ok("ctx: question rail shows the strain-matched grower at 390px",
      (await anonPage.locator(`a[href="/u/${bobUsername}"]`).count()) >= 1)
    const qNoOverflow = !(await anonPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1))
    ok("ctx: question rail no overflow at 390px", qNoOverflow)

    // Digest (authed): "From growers you follow" renders carol's update
    // + new grow with canonical links at every supported width.
    await alicePage.request.get(`${BASE}/mydigest`).catch(() => {})
    for (const w of [360, 390, 1024, 1280, 1440]) {
      await alicePage.setViewportSize({ width: w, height: 900 })
      await gotoMain(alicePage, `${BASE}/mydigest`, 'h2:has-text("From growers you follow")')
      const dgBody = (await alicePage.textContent("body")) ?? ""
      const dgNoOverflow = !(await alicePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1))
      ok(`digest: followed-grower section renders at ${w}px without overflow`,
        dgNoOverflow &&
          (await alicePage.locator(`a[href="/u/${carolUsername}"]`).count()) >= 1 &&
          (await alicePage.locator(`a[href^="/diaries/"]`).count()) >= 1 &&
          dgBody.includes(`__br digest update ${TS}`),
        { w })
    }

    // ── Mobile contract ──────────────────────────────────────────────
    const mob = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const mobPage = await mob.newPage()
    await gotoMain(mobPage, BASE)
    const overflowX = await mobPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    ok("mobile: home renders without horizontal overflow at 390px", !overflowX)
    ok("mobile: nav menu toggle present", (await mobPage.locator('button[aria-label*="navigation menu"], a[href="/auth/signin"]').count()) >= 1)
    await gotoMain(mobPage, `${BASE}/questions`)
    const qOverflow = await mobPage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    const qMobBody = (await mobPage.textContent("body")) ?? ""
    ok("mobile: /questions renders symptom chips without overflow at 390px",
      !qOverflow && qMobBody.includes("All symptoms"))
    await mob.close()

    await aliceCtx.close()
    await anon.close()
  } finally {
    await browser.close().catch(() => {})
    await prisma.block.deleteMany({ where: { OR: [{ blockerId: alice.id }, { blockerId: bob.id }] } }).catch(() => {})
    await prisma.thread.deleteMany({ where: { id: ctxQThread.id } }).catch(() => {})
    await prisma.tag.deleteMany({ where: { id: ctxTag.id } }).catch(() => {})
    await prisma.strain.deleteMany({ where: { id: ctxStrain.id } }).catch(() => {})
    await prisma.category.deleteMany({ where: { id: ctxCat.id, slug: `__br-qcat-${TS}` } }).catch(() => {})
    await prisma.chatRoom.deleteMany({ where: { id: chatRoom.id } }).catch(() => {})
    await prisma.user.deleteMany({ where: { id: { in: [alice.id, bob.id, carol.id] } } }).catch(() => {})
    await prisma.$disconnect()
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
