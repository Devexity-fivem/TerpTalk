// UI structural + accessibility contracts — static source checks for the
// chat panel, accessibility invariants, and client-side state handling.
// The panel is a presentation-layer change over the existing chat stack;
// behavioral guarantees (dedupe, room guard, unread, visibility) live in
// scripts/chat-ux-tests.mts and are re-run alongside this suite.
import { strict as assert } from "node:assert"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

let passed = 0
let failed = 0
function check(name: string, fn: () => void) {
  try {
    fn()
    passed++
    console.log(`PASS ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}: ${e instanceof Error ? e.message : e}`)
  }
}

const SRC = fileURLToPath(new URL("../src", import.meta.url))
const src = (rel: string) => readFileSync(join(SRC, rel), "utf8")

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(entry)) yield p
  }
}

const panel = src("components/chat-panel.tsx")
const room = src("components/chat-room.tsx")
const nav = src("components/navigation.tsx")
const mobileNav = src("components/mobile-nav.tsx")
const layout = src("app/layout.tsx")
const teaser = src("components/chat-teaser.tsx")

// ── Provider / dock structure ──────────────────────────────────────────

check("provider exposes open/close/toggle + unread state", () => {
  for (const k of ["openPanel", "closePanel", "togglePanel", "chatUnread"]) {
    assert.ok(panel.includes(k), `missing ${k}`)
  }
})

check("activity poll lives in the provider (single owner)", () => {
  assert.ok(panel.includes("/api/chat/rooms?badge=1"), "badge poll in provider")
  assert.ok(panel.includes("CHAT_SEEN_EVENT"), "seen-event listener in provider")
  assert.ok(!nav.includes("?badge=1"), "navigation must not run a second poll")
})

check("dock never stacks on the dedicated /chat page", () => {
  assert.ok(panel.includes('pathname === "/chat"'), "pathname guard present")
  assert.ok(/onChatPage[\s\S]*return null/.test(panel), "early return on /chat")
})

check("dock is guest-safe (no session → nothing rendered)", () => {
  assert.ok(/!session[\s\S]*return null/.test(panel), "session guard")
})

check("ChatRoom mounts only while the panel is open", () => {
  assert.ok(/\{open && \(/.test(panel), "panel content gated on open state")
  assert.ok(panel.includes("<ChatRoom embedded"), "panel reuses ChatRoom")
  assert.ok(panel.includes("<Suspense"), "useSearchParams needs Suspense")
})

check("panel pushes layout instead of overlaying on lg+", () => {
  assert.ok(panel.includes("lg:pr-[340px]"), "inset right padding when open")
  assert.ok(panel.includes("w-[340px]"), "panel width in the 320-380 target band")
})

check("single responsive surface — never two mounted ChatRooms", () => {
  // Two CSS-hidden containers would still mount two ChatRoom instances
  // (duplicate sockets). The dock must render exactly one.
  assert.equal(panel.match(/<ChatRoom/g)?.length, 1, "exactly one ChatRoom mount point")
  assert.ok(panel.includes("env(safe-area-inset-bottom)"), "sheet respects safe area")
  assert.ok(panel.includes("lg:w-[340px]"), "desktop panel geometry")
})

check("closed desktop state exposes a compact edge tab with unread dot", () => {
  assert.ok(/\{!open && \(/.test(panel), "FAB only when closed")
  assert.ok(panel.includes("chatUnreadRooms"), "unread count accessible")
})

check("panel carries expand-to-/chat and close controls", () => {
  assert.ok(panel.includes('href="/chat"'), "full-chat expand link")
  assert.ok(panel.includes("headerActions"), "actions slot wired to ChatRoom")
})

check("panel top tracks the real nav bottom (banner-safe)", () => {
  // When an announcement/recovery banner sits above the sticky nav, the
  // nav's rect is lower than 64px — the panel must measure, not assume.
  assert.ok(panel.includes("getBoundingClientRect().bottom"), "nav bottom is measured")
  assert.ok(panel.includes("tt-top-nav"), "nav measured by id")
  assert.ok(panel.includes("panelTop"), "measured offset applied")
  assert.ok(nav.includes('id="tt-top-nav"'), "nav carries the measurement id")
})

check("Escape closes the open panel (keyboard path)", () => {
  assert.ok(/e\.key === "Escape"[\s\S]*closePanel/.test(panel), "Escape → closePanel")
})

check("panel trigger declares the dialog it opens", () => {
  assert.ok(panel.includes('aria-haspopup="dialog"'), "FAB aria-haspopup")
  assert.ok(panel.includes('role="dialog"'), "panel dialog role")
})

// ── ChatRoom embedded mode ─────────────────────────────────────────────

check("embedded mode never rewrites the page URL on room switch", () => {
  assert.ok(
    /if \(!embedded\) window\.history\.replaceState/.test(room),
    "replaceState must be guarded"
  )
})

check("embedded mode ignores the ?room= deep link", () => {
  assert.ok(/embedded \? null : searchParams\.get\("room"\)/.test(room))
})

check("embedded mode drops the outer card frame (panel provides it)", () => {
  assert.ok(/!embedded && "rounded-2xl border/.test(room))
})

check("header actions slot renders", () => {
  assert.ok(room.includes("{headerActions}"))
})

// ── Navigation / entry points ──────────────────────────────────────────

check("desktop nav Chat opens the panel without navigating", () => {
  assert.ok(nav.includes("openPanel()"), "nav calls openPanel")
  assert.ok(nav.includes("e.preventDefault()"), "nav suppresses navigation")
})

check("mobile bottom-nav Chat toggles the sheet in place", () => {
  assert.ok(mobileNav.includes("togglePanel()"), "mobile nav toggles panel")
  assert.ok(mobileNav.includes("e.preventDefault()"), "mobile nav suppresses navigation")
})

check("guests still reach /chat normally (no dead control)", () => {
  assert.ok(nav.includes('"/chat" && session'), "nav guards on session")
  assert.ok(mobileNav.includes('"/chat" && session'), "mobile nav guards on session")
})

check("navigation consumes chatUnread from the shared provider", () => {
  assert.ok(nav.includes("useChatPanel()"), "nav uses the context")
  assert.ok(!nav.includes("setChatUnread"), "no parallel unread state")
})

// ── Layout integration ─────────────────────────────────────────────────

check("provider wraps Navigation so nav can open the panel", () => {
  const i = layout.indexOf("<ChatPanelProvider>")
  const j = layout.indexOf("<Navigation")
  assert.ok(i !== -1 && j !== -1 && i < j, "provider must wrap Navigation")
})

check("content inset wraps <main> (panel pushes layout)", () => {
  assert.ok(layout.includes("<ChatPanelInset>"), "inset mounted")
  const i = layout.indexOf("<ChatPanelInset>")
  const j = layout.indexOf("<main")
  assert.ok(i !== -1 && j !== -1 && i < j, "inset must wrap main")
})

check("dock mounted once at the layout boundary", () => {
  assert.equal(layout.match(/<ChatDock \/>/g)?.length, 1, "exactly one dock")
})

// ── Homepage teaser ────────────────────────────────────────────────────

check("teaser opens the panel for signed-in users", () => {
  assert.ok(teaser.includes("openPanel"), "open-panel CTA")
})

check("teaser keeps a direct /chat link and guest sign-in", () => {
  assert.ok(teaser.includes("/chat?room="), "full-chat link")
  assert.ok(teaser.includes("signInHref"), "guest sign-in path")
})

// ── Realtime architecture invariants ───────────────────────────────────

check("exactly one browser-side Pusher construction site", () => {
  // pusher-js is the BROWSER client — it must only be constructed inside
  // the shared singleton module. (src/lib/pusher.ts is the separate
  // server SDK and is expected.)
  const sites: string[] = []
  for (const p of walk(SRC)) {
    const text = readFileSync(p, "utf8")
    if (text.includes("new Pusher(") && text.includes("pusher-js")) sites.push(p)
  }
  assert.deepEqual(
    sites.map((s) => s.split(/[\\/]/).pop()),
    ["pusher-client.ts"],
    `pusher-js constructed in: ${sites.join(", ")}`
  )
})

check("panel opens without subscribing (subscribe lives inside ChatRoom)", () => {
  assert.ok(!panel.includes(".subscribe("), "dock itself holds no subscription")
})

check("ChatRoom unsubscribes on unmount/room switch (socket cleanup)", () => {
  // A commented-out or removed unsubscribe leaks a channel per open/switch.
  // Assert the call is live code inside an effect cleanup, not a comment.
  assert.ok(
    /return \(\) => \{[\s\S]*?^\s*peekSharedPusher\(\)\?\.unsubscribe\(/m.test(room),
    "unsubscribe must run in the subscription effect's cleanup"
  )
})

// ── Client state contracts ───────────────────────────────────────────

check("messages page: conversation switch resets state and cursor", () => {
  const page = src("app/messages/page.tsx")
  assert.ok(page.includes("activeWithRef.current = withId"))
  assert.ok(page.includes("cursorRef.current = null"))
  assert.ok(page.includes("setMessages([])"))
  assert.ok(page.includes("activeWithRef.current !== uid")) // stale-response guard
  assert.ok(page.includes("!seen.has(m.id)")) // id dedupe on append
  assert.ok(page.includes("unread: 0")) // unread zeroed on open
})

check("navigation: invalid session triggers client signOut", () => {
  assert.ok(nav.includes("signOut({ redirect: false })"))
  assert.ok(nav.includes("!userId) return"))
})

check("profile page: failed/malformed response never stored as data", () => {
  const page = src("app/profile/page.tsx")
  assert.ok(page.includes("res.ok"))
  assert.ok(page.includes("data?.user?.createdAt"))
  assert.ok(page.includes("loadError"))
})

// ── Accessibility contracts ──────────────────────────────────────────

check("tooltip: no focusable wrapper around interactive children", () => {
  const tip = src("components/ui/tooltip.tsx")
  assert.ok(tip.includes("isInteractive"), "interactive-child detection required")
  assert.ok(tip.includes("insideInteractive"), "interactive-ancestor detection required")
  assert.ok(tip.includes("tabIndex={focusable ? 0 : undefined}"), "conditional tabIndex required")
  assert.ok(!/outline-none/.test(tip.replace(/focus-visible:outline-none/g, "")), "focus outline must not be suppressed")
  assert.ok(tip.includes("focus-visible"), "visible focus indicator required")
  assert.ok(tip.includes('"Escape"'), "Escape dismissal required")
})

check("a11y: scoped inputs carry accessible names", () => {
  assert.ok(src("components/chat-room.tsx").includes('aria-label={room ? `Message ${room.name}` : "Chat message"}'), "chat composer aria-label")
  assert.ok(src("components/tag-input.tsx").includes('aria-label="Add tags"'), "TagInput aria-label")
  const report = src("components/report-button.tsx")
  assert.ok(report.includes('aria-label="Report to moderators"'), "report dialog aria-label")
  assert.ok(report.includes('aria-label="Report reason"'), "report reason aria-label")
  assert.ok(report.includes('aria-label="Report details"'), "report details aria-label")
  assert.ok(src("components/image-uploader.tsx").includes('aria-hidden="true"'), "hidden file input out of a11y tree")
})

check("nameplates: readable solid fallback + supports-gated gradient", () => {
  const css = src("app/globals.css")
  assert.ok(css.includes("--np-leaf"), "nameplate tokens required")
  assert.ok(css.includes("@supports ((-webkit-background-clip: text)"), "gradient must be supports-gated")
  const npBlock = css.slice(css.indexOf(".tt-nameplate-leaf"), css.indexOf("@supports ((-webkit-background-clip: text)"))
  assert.ok(!/color:\s*transparent/.test(npBlock), "no transparent text outside @supports")
  assert.ok(css.includes(".tt-gradient-text"), "shared gradient-text fallback class required")
})

check("tokens: semantic success/warning colors exist per theme", () => {
  const css = src("app/globals.css")
  assert.ok(css.includes("--light-success") && css.includes("--dark-success"), "success token both themes")
  assert.ok(css.includes("--light-warning") && css.includes("--dark-warning"), "warning token both themes")
  assert.ok(css.includes("--color-success") && css.includes("--color-warning"), "tailwind color registration")
})

// ── Grow intelligence surfaces ─────────────────────────────────────

check("grow intel route: owner-only + rate-limited + deterministic actions", () => {
  const route = src("app/api/diaries/[id]/intel/route.ts")
  assert.ok(route.includes("unauthorized()"), "auth required")
  assert.ok(route.includes("isBanned"), "banned members blocked")
  assert.ok(route.includes("rateLimit"), "rate limited")
  assert.ok(route.includes("getGrowIntel(id, session.user.id)"), "owner scope via getGrowIntel")
  assert.ok(route.includes('"Diary not found"'), "non-owner gets 404 — no existence leak")
  for (const a of ["next", "status", "check", "plan", "measurements", "changes"]) {
    assert.ok(route.includes(`"${a}"`), `action ${a}`)
  }
  assert.ok(!/openai|anthropic|\bllm\b/i.test(route), "no LLM calls")
})

check("grow-intel lib: owner scope + deterministic projections only", () => {
  const lib = src("lib/grow-intel.ts")
  assert.ok(lib.includes('scope: "owner"'), "owner scope")
  assert.ok(lib.includes("buildSnapshot"), "snapshot pipeline")
  assert.ok(lib.includes("buildCultivationDecisions"), "decision engine")
  assert.ok(lib.includes("activeChecklist"), "checklist engine")
  assert.ok(lib.includes("decisionLine"), "canonical decision phrasing")
})

check("intel panel: quick actions hit the deterministic API, not generation", () => {
  const panel = src("components/grow-intel-panel.tsx")
  assert.ok(panel.includes("/api/diaries/"), "API-backed")
  for (const a of ["next", "status", "check", "plan", "measurements", "changes"]) {
    assert.ok(panel.includes(`"${a}"`), `quick action ${a}`)
  }
  assert.ok(panel.includes("useShareComposer"), "community prefill bridge")
  assert.ok(panel.includes('"use client"'), "client boundary declared")
})

check("grow comparison: honesty-tier gated + neutral phrasing", () => {
  const lib = src("lib/grow-compare.ts")
  assert.ok(lib.includes('tier === "none"'), "honesty tier respected")
  assert.ok(lib.includes("median"), "median-based community values")
  assert.ok(!/winner|leaderboard|best grower|\branks?\b|\branked\b|\branking\b/i.test(lib), "no ranking language")
  const page = src("app/diaries/[id]/page.tsx")
  assert.ok(page.includes("buildGrowComparison"), "diary page renders comparison")
  assert.ok(page.includes("getGrowIntel"), "diary page renders owner intel")
})

// ── Grow experiments ─────────────────────────────────────────────

check("experiments lib: pure module, deterministic follow-up, grower-stated outcomes", () => {
  const lib = src("lib/experiments.ts")
  assert.ok(!lib.includes("@/lib/prisma"), "no Prisma import — pure module")
  assert.ok(lib.includes("experimentFollowUp"), "follow-up rule")
  assert.ok(lib.includes("EXPERIMENT_FOLLOW_UP_DAYS"), "explicit staleness window")
  assert.ok(lib.includes("ENDED"), "endedAt stamping on terminal states")
  assert.ok(lib.includes("parseExperimentCreate") && lib.includes("parseExperimentPatch"), "payload validation")
  // Honesty contract: the vocabulary for results is grower-stated only,
  // and renderers may never assert causality.
  assert.ok(lib.includes("WORKED") && lib.includes("DID_NOT_WORK") && lib.includes("INCONCLUSIVE"), "outcome vocabulary")
  assert.ok(!/\bcaused\b|\bproven\b|\bguaranteed\b/i.test(lib), "no causality/proof language")
})

check("experiment routes: owner-only writes, private diaries leak nothing", () => {
  const col = src("app/api/diaries/[id]/experiments/route.ts")
  const item = src("app/api/diaries/[id]/experiments/[experimentId]/route.ts")
  for (const r of [col, item]) {
    assert.ok(r.includes("unauthorized()"), "auth required")
    assert.ok(r.includes("isBanned"), "banned members blocked")
    assert.ok(!/openai|anthropic|\bllm\b/i.test(r), "no LLM calls")
  }
  assert.ok(col.includes("rateLimit"), "create rate-limited")
  assert.ok(col.includes("enforceLinkTrust"), "member text passes the link gate")
  assert.ok(col.includes('visibility === "PRIVATE"'), "private diary hides experiments")
  assert.ok(col.includes('"Diary not found"'), "one 404 — no existence oracle")
  assert.ok(item.includes('"forbidden"'), "item route distinguishes 403 vs 404")
  assert.ok(item.includes("updateMany"), "guarded write")
})

check("update route: experiment link is same-diary + advances ACTIVE→OBSERVING", () => {
  const route = src("app/api/diaries/updates/route.ts")
  assert.ok(route.includes("exp.diaryId !== diaryId"), "cross-diary link rejected")
  assert.ok(route.includes('status: "ACTIVE"') && route.includes('status: "OBSERVING"'), "guarded transition")
})

check("diary page: experiments merge into the existing timeline", () => {
  const page = src("app/diaries/[id]/page.tsx")
  assert.ok(page.includes("serializeExperiment"), "experiment serialization")
  assert.ok(page.includes("ExperimentCard"), "evidence card rendered")
  assert.ok(page.includes("GrowLessons"), "lessons section rendered")
  // One timeline: experiments fold into the week groups, not a parallel list
  assert.ok(/weeks\.map|weeksMerged/.test(page), "weeks grouping reused")
  assert.ok((page.match(/groupUpdatesByWeek\(/g) || []).length === 1, "single timeline grouping")
})

check("strain evidence: public scope + min-sample thresholds", () => {
  const lib = src("lib/strain-stats.ts")
  assert.ok(lib.includes("getStrainEvidence"), "evidence service")
  const fn = lib.slice(lib.indexOf("getEvidence"))
  assert.ok(fn.includes("publicDiaryWhere"), "public diaries only")
  assert.ok(fn.includes("activeAuthor"), "deleted/banned authors excluded")
  assert.ok(fn.includes("experimentDiaryCount >= 3"), "category threshold ≥3 grows")
  assert.ok(fn.includes("outcomeTotal >= 3"), "outcome threshold ≥3 statements")
  assert.ok(!/\bproven\b|\brequired\b/i.test(fn), "no efficacy claims")
})

check("terpbot: experiment commands registered + public-scope only", () => {
  const reg = src("lib/chat-commands.ts")
  assert.ok(reg.includes('"experiments"') && reg.includes('"experiment"'), "commands registered")
  const data = src("lib/terpbot-data.ts")
  assert.ok(data.includes("growExperiment.findMany"), "queries recorded experiments")
  assert.ok(/growExperiment\.findMany[\s\S]{0,400}publicDiaryWhere/.test(data), "room output stays public-scope")
})

check("experiment card: evidence wording, editable ask-community, owner controls", () => {
  const card = src("components/experiment-card.tsx")
  assert.ok(card.includes("observation"), "evidence count shown")
  assert.ok(card.includes("EXPERIMENT_OUTCOME_LABELS"), "grower-stated outcome label")
  assert.ok(card.includes("useShareComposer"), "ask-community bridge")
  assert.ok(card.includes("type: \"question\""), "prefills an editable question")
  assert.ok(!/\bcaused\b|\bproven\b|\bfixed the\b/i.test(card), "no causality wording")
})

check("grow intel + cockpit: experiments are first-class deterministic signals", () => {
  const lib = src("lib/grow-intel.ts")
  assert.ok(lib.includes("growExperiment.findMany"), "experiments in projection")
  assert.ok(lib.includes("experimentFollowUp"), "deterministic follow-up in attention")
  const route = src("app/api/diaries/[id]/intel/route.ts")
  assert.ok(route.includes('"experiments"'), "intel action registered")
  const home = src("components/member-home.tsx")
  assert.ok(home.includes("data.knowledge"), "grow-knowledge card")
  assert.ok(home.includes("activeExperiments"), "grow cards carry experiment counts")
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
