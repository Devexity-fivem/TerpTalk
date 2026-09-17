// Persistent global Chat panel — structural regression coverage.
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
  assert.ok(/!embedded && "rounded-xl border/.test(room))
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

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
