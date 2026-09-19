// Info-architecture & cleanup regression tests — covers the Help Center,
// standalone Community Rules page, plant-doctor route split, navigation
// link wiring, TerpBot copy accuracy, emailDigestFrequency removal, and the
// recovery-phrase warning banner. Mostly source-level assertions since these
// are static pages; DB check confirms the dropped column is really gone.
// Run: npm run test:info-pages
import "./db-guard.mjs"
import { strict as assert } from "node:assert"
import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { prisma } from "@/lib/prisma"

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), "utf8")

async function run() {
  console.log("Starting info-pages regression tests...")

  // ── 1. /rules page ──────────────────────────────────────────────────
  const rules = read("src/app/rules/page.tsx")
  assert.ok(rules.includes("Community Rules"), "rules page has title")
  assert.ok(rules.includes("/terms"), "rules page links to Terms")
  assert.ok(rules.includes("Report button"), "rules page explains reporting")
  assert.ok(rules.includes("/restricted"), "rules page points restricted users to appeal path")
  assert.ok(/TerpBot.{0,30}moderator/i.test(rules) && /not a moderator|isn.{0,10}t a moderator|never makes moderation/i.test(rules), "rules page clarifies TerpBot is not staff")
  assert.ok(!rules.includes("decisions are final"), "rules page does not foreclose appeals")

  // ── 2. /help is a Help Center, wizard moved to /plant-doctor ────────
  const help = read("src/app/help/page.tsx")
  assert.ok(help.includes("Help Center"), "help page is a Help Center")
  for (const section of ["Getting started", "Account & security", "Forums & posting", "Grow diaries & setups", "Chat & TerpBot", "Reputation, tiers & badges", "Notifications & privacy", "Reports & moderation"]) {
    assert.ok(help.includes(section), `help page covers "${section}"`)
  }
  assert.ok(help.includes("/plant-doctor"), "help links to plant doctor")
  assert.ok(help.includes("recovery phrase"), "help explains recovery phrase")
  assert.ok(/no email|never ask for your email|No email/i.test(help), "help states no email is collected")
  assert.ok(!help.includes("ProblemWizard"), "help no longer renders the plant wizard")

  const doctor = read("src/app/plant-doctor/page.tsx")
  assert.ok(doctor.includes("ProblemWizard"), "plant-doctor renders the wizard")
  assert.ok(doctor.includes("/help"), "plant-doctor links back to Help Center")

  // ── 3. Navigation & footer wiring ───────────────────────────────────
  const nav = read("src/components/navigation.tsx")
  assert.ok(nav.includes('"/rules"'), "drawer links /rules")
  assert.ok(nav.includes('"/help"'), "drawer links Help Center")
  assert.ok(nav.includes('"/plant-doctor"'), "drawer links Plant Doctor")
  assert.ok(nav.includes('"/leaderboard"'), "drawer links Leaderboard")
  assert.ok(!nav.includes('"/help", label: "Plant Help"'), "old Plant Help label removed")

  const footer = read("src/components/footer.tsx")
  assert.ok(footer.includes('"/rules"'), "footer links /rules")
  assert.ok(footer.includes('"/help"'), "footer links /help")
  assert.ok(footer.includes('"/plant-doctor"'), "footer links /plant-doctor")

  const menu = read("src/components/user-menu.tsx")
  assert.ok(menu.includes('"/help"'), "user menu links Help Center")

  const sitemap = read("src/app/sitemap.ts")
  assert.ok(sitemap.includes("/rules") && sitemap.includes("/plant-doctor"), "sitemap covers new routes")
  // Personalized/member surfaces must not be SEO destinations. /feed was
  // removed after being listed — this keeps it (and friends) from returning.
  const staticEntries = sitemap.match(/url: "[^"]+"/g)?.map((s) => s.slice(6, -1)) ?? []
  for (const gated of ["/feed", "/profile", "/settings", "/messages", "/notifications", "/progress", "/chat", "/admin", "/moderation"]) {
    assert.ok(!staticEntries.includes(gated), `sitemap must not include gated route ${gated}`)
  }
  assert.ok(staticEntries.includes("/forum") && staticEntries.includes("/discover") && staticEntries.includes("/strains"), "sitemap keeps public routes")

  const about = read("src/app/about/page.tsx")
  assert.ok(about.includes('"/rules"'), "about links /rules")

  // ── 4. TerpBot consistency ──────────────────────────────────────────
  const botProfile = read("src/app/u/[username]/profile-client.tsx")
  assert.ok(!botProfile.includes("/nextbadges\""), "bot profile no longer suggests the broken mention+slash example")
  assert.ok(botProfile.includes("personalized"), "bot profile says no PERSONALIZED advice (tips still exist)")

  const botLib = read("src/lib/terpbot.ts")
  assert.ok(!/keep chat tidy|garden tidy/i.test(botLib), "bot bio no longer implies moderation")

  const botPage = read("src/app/u/[username]/page.tsx")
  assert.ok(!/garden tidy|chat tidy/i.test(botPage), "bot description no longer implies moderation")

  const cron = read("src/app/api/cron/terpbot/route.ts")
  assert.ok(!cron.includes("winner: @${name}"), "opted-out winner is never rendered as a fake @mention")
  assert.ok(cron.includes('"a member"'), "opted-out winner falls back to neutral 'a member'")
  assert.ok(!cron.includes("Yesterday:"), "digest label matches rolling 24h window")

  const follows = read("src/app/api/follows/route.ts")
  assert.ok(follows.includes("TERPBOT_USERNAME"), "follows API blocks following TerpBot")

  const chat = read("src/components/chat-room.tsx")
  assert.ok(/rules\|help/.test(chat), "chat linkifies /rules and /help for TerpBot output")

  // ── 5. emailDigestFrequency fully removed ───────────────────────────
  const schema = read("prisma/schema.prisma")
  assert.ok(!schema.includes("emailDigestFrequency"), "schema field removed")
  const migrations = readdirSync(join(root, "prisma/migrations"))
  assert.ok(
    migrations.some((m) => read(`prisma/migrations/${m}/migration.sql`).includes('DROP COLUMN IF EXISTS "emailDigestFrequency"')),
    "drop migration exists"
  )
  for (const f of ["src/app/api/profile/route.ts", "src/app/api/profile/notifications/route.ts", "src/app/profile/page.tsx", "src/app/settings/notifications/page.tsx"]) {
    assert.ok(!read(f).includes("emailDigestFrequency"), `${f} has no dead pref`)
  }
  const col = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'Profile' AND column_name = 'emailDigestFrequency'`
  )
  assert.equal(col[0]?.n, 0, "emailDigestFrequency column dropped in database")

  // ── 6. Recovery-phrase warning + signup note ────────────────────────
  const layout = read("src/app/layout.tsx")
  assert.ok(layout.includes("RecoveryWarningBanner"), "layout renders the recovery-phrase warning")
  const banner = read("src/components/recovery-warning-banner.tsx")
  assert.ok(banner.includes("/api/profile/recovery"), "banner checks real phrase status")
  const signup = read("src/app/auth/signup/page.tsx")
  assert.ok(/never ask for your email/i.test(signup), "signup explains no-email model")
  assert.ok(/recovery phrase/i.test(signup), "signup warns about recovery phrase")

  // ── 7. Deleted components stay deleted ──────────────────────────────
  // Note: src/components/ui/skeleton.tsx was intentionally re-added in Sprint A
  // as the shared loading-state primitive — it is no longer a dead file.
  for (const f of ["src/components/badge-icon.tsx", "src/components/ui/badge.tsx", "src/components/ui/button.tsx", "src/components/ui/card.tsx", "src/components/ui/input.tsx"]) {
    assert.ok(!existsSync(join(root, f)), `${f} removed`)
  }

  console.log("All info-pages tests passed.")
}

run()
  .catch((e) => { console.error("TEST FAILED:", e); process.exit(1) })
  .finally(() => prisma.$disconnect())
