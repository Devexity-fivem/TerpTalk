// cleanup-beta-test-artifacts.mts — remove confirmed beta test artifacts.
//
// Two targets, identified by the content census (2026-09-17):
//
//   TARGET A — 4 strain records that are injection-test probes. Deleted by
//   exact name whitelist → resolved IDs. Aborts unless the match is exactly
//   the expected set, and refuses to delete any strain referenced by
//   diaries or photos.
//
//   TARGET B — TerpBot General chat messages that are test-suite artifacts:
//   announcement-shaped messages (badge/tier/welcome/harvest) whose every
//   @mention resolves to a user that no longer exists. Messages are
//   SOFT-deleted (deleted=true), matching the app's own moderation-clear
//   semantics — reversible, no reply-FK churn. Legitimate TerpBot content
//   (grow tips, bot replies, moderation notices) does not match the shape
//   or has no dead mentions and is left untouched.
//
// SAFETY:
//   - Dry-run by default. Destructive writes require BOTH flags:
//       --execute --confirm=CLEANUP_BETA_ARTIFACTS
//   - Prints the DB target (endpoint marker only — never credentials).
//   - Refuses to run against the production endpoint without
//     ALLOW_PRODUCTION_DB_TESTS=1 (db-guard, imported for side effect).
//   - Aborts rather than guessing when invariants fail.
//   - Idempotent: an already-clean database exits successfully.
//
// Usage:
//   npx tsx scripts/cleanup-beta-test-artifacts.mts                 # dry-run
//   npx tsx scripts/cleanup-beta-test-artifacts.mts --execute --confirm=CLEANUP_BETA_ARTIFACTS
import "./db-guard.mjs"
import { prisma } from "../src/lib/prisma"
import { TERPBOT_USERNAME } from "../src/lib/terpbot-constants"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const EXECUTE = process.argv.includes("--execute")
const CONFIRM = process.argv.includes("--confirm=CLEANUP_BETA_ARTIFACTS")

// Exact names confirmed by the census — matched literally, never by pattern.
const EXPECTED_PROBE_NAMES = [
  "Baseline Strain Probe",
  "Probe' OR '1'='1",
  "Strain'; WAITFOR DELAY '0:0:6'-- x",
  "inj-probe-strain {{1337*7}}",
]

// Announcement shapes TerpBot emits for member events. Anything not starting
// with one of these is not an announcement and is never a deletion candidate.
const ANNOUNCEMENT_PREFIXES = ["🏅", "⬆️", "🌱", "🌾"] as const

const MENTION_RE = /@([\w.-]+)/g

function envLabel(): string {
  let url = process.env.DATABASE_URL
  if (!url) {
    try {
      const envPath = fileURLToPath(new URL("../.env", import.meta.url))
      url = readFileSync(envPath, "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"'\n]+)"?\s*$/m)?.[1]
    } catch {
      // no .env
    }
  }
  try {
    const host = url ? new URL(url).hostname : "(unset)"
    if (host.includes("ep-billowing-dew")) return `PRODUCTION (Neon main, ${host.split(".")[0]}…)`
    if (host.includes("neon.tech")) return `non-production Neon branch (${host.split(".")[0]}…)`
    if (host === "localhost" || host === "127.0.0.1") return "local database"
    return `unknown target (${host.split(".")[0]}…)`
  } catch {
    return "unknown target (unparseable DATABASE_URL)"
  }
}

function abort(msg: string): never {
  console.error(`\nABORT: ${msg}`)
  process.exit(1)
}

async function main() {
  console.log(`Beta test-artifact cleanup — ${EXECUTE ? "EXECUTE" : "DRY-RUN"}`)
  console.log(`Database target: ${envLabel()}`)

  if (EXECUTE && !CONFIRM)
    abort("--execute requires --confirm=CLEANUP_BETA_ARTIFACTS. Refusing to write.")

  // ============================ TARGET A: STRAINS ============================
  console.log("\n========== TARGET A: strain probes ==========")
  const probes = await prisma.strain.findMany({
    where: { name: { in: EXPECTED_PROBE_NAMES } },
    select: { id: true, name: true, createdAt: true, _count: { select: { diaries: true, photos: true } } },
  })
  console.log(`expected: ${EXPECTED_PROBE_NAMES.length} | found: ${probes.length}`)

  if (probes.length === 0) {
    console.log("  already clean — nothing to do.")
  } else {
    if (probes.length !== EXPECTED_PROBE_NAMES.length)
      abort(`expected 0 or ${EXPECTED_PROBE_NAMES.length} probe strains, found ${probes.length}. Investigate manually.`)

    for (const s of probes) {
      console.log(`  ${s.id} | ${JSON.stringify(s.name)} | created ${s.createdAt.toISOString().slice(0, 10)} | diaries:${s._count.diaries} photos:${s._count.photos}`)
      if (s._count.diaries > 0 || s._count.photos > 0)
        abort(`probe strain ${s.id} is referenced by user content (${s._count.diaries} diaries, ${s._count.photos} photos). Refusing to delete.`)
    }

    // Defense in depth: no OTHER strain may share these names.
    const extra = await prisma.strain.count({ where: { name: { in: EXPECTED_PROBE_NAMES }, id: { notIn: probes.map((s) => s.id) } } })
    if (extra > 0) abort("unexpected duplicate probe names found outside the resolved set.")

    if (EXECUTE) {
      await prisma.$transaction(probes.map((s) => prisma.strain.delete({ where: { id: s.id } })))
      console.log(`  DELETED ${probes.length} probe strains.`)
    } else {
      console.log(`  [dry-run] would delete ${probes.length} strains: ${probes.map((s) => s.id).join(", ")}`)
    }
  }

  // ============================ TARGET B: CHAT ============================
  console.log("\n========== TARGET B: General chat artifacts ==========")

  const bot = await prisma.user.findFirst({
    where: { profile: { username: TERPBOT_USERNAME } },
    select: { id: true, password: true },
  })
  if (!bot) abort("TerpBot account not found — cannot safely classify messages.")
  if (bot.password !== null) abort("the 'terpbot' username is held by a credentialed account. Refusing.")

  const room = await prisma.chatRoom.findUnique({ where: { slug: "general" }, select: { id: true } })
  if (!room) abort("General room not found.")

  const [msgs, liveUsers] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { roomId: room.id, deleted: false },
      select: { id: true, content: true, authorId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({ select: { name: true, profile: { select: { username: true } } } }),
  ])
  const live = new Set(
    liveUsers.flatMap((u) => [u.name, u.profile?.username].filter((x): x is string => !!x)).map((x) => x.toLowerCase()),
  )
  console.log(`non-deleted General messages: ${msgs.length} | live usernames: ${live.size}`)

  const candidates: typeof msgs = []
  const legitAnnouncements: typeof msgs = []
  const ambiguous: typeof msgs = []
  const otherKept: typeof msgs = []

  for (const m of msgs) {
    const isBot = m.authorId === bot.id
    const isAnnouncement = ANNOUNCEMENT_PREFIXES.some((p) => m.content.startsWith(p))
    const mentions = [...m.content.matchAll(MENTION_RE)].map((x) => x[1])
    const deadMentions = mentions.filter((n) => !live.has(n.toLowerCase()))
    const liveMentions = mentions.filter((n) => live.has(n.toLowerCase()))

    if (isBot && isAnnouncement && mentions.length > 0 && liveMentions.length === 0 && deadMentions.length > 0) {
      candidates.push(m) // bot announcement about users that no longer exist
    } else if (isBot && isAnnouncement && liveMentions.length > 0) {
      legitAnnouncements.push(m) // announcement about a REAL user — keep
    } else if (isBot && isAnnouncement) {
      ambiguous.push(m) // announcement shape, no mentions — report, don't touch
    } else {
      otherKept.push(m) // tips, replies, moderation notices, human messages — keep
    }
  }

  // Every candidate must be bot-authored in General — re-assert before write.
  if (candidates.some((m) => m.authorId !== bot.id)) abort("candidate set contains a non-TerpBot message.")

  console.log(`  deletion candidates (dead-user announcements): ${candidates.length}`)
  console.log(`  kept — announcements about LIVE users: ${legitAnnouncements.length}`)
  console.log(`  kept — everything else (tips/replies/notices/human msgs): ${otherKept.length}`)
  console.log(`  ambiguous — announcement shape, zero mentions (NOT deleted): ${ambiguous.length}`)

  console.log("\n  sample candidates:")
  for (const m of candidates.slice(0, 6))
    console.log(`    ${m.id} | ${m.createdAt.toISOString().slice(0, 10)} | ${JSON.stringify(m.content.slice(0, 90))}`)

  if (legitAnnouncements.length > 0) {
    console.log("\n  kept live-user announcements (examples):")
    for (const m of legitAnnouncements.slice(0, 5))
      console.log(`    ${JSON.stringify(m.content.slice(0, 90))}`)
  }
  if (ambiguous.length > 0) {
    console.log("\n  ambiguous (manual review):")
    for (const m of ambiguous.slice(0, 5))
      console.log(`    ${m.id} | ${JSON.stringify(m.content.slice(0, 90))}`)
  }

  if (EXECUTE && candidates.length > 0) {
    const res = await prisma.chatMessage.updateMany({
      where: { id: { in: candidates.map((m) => m.id) }, authorId: bot.id, roomId: room.id, deleted: false },
      data: { deleted: true },
    })
    if (res.count !== candidates.length)
      abort(`soft-delete affected ${res.count} rows, expected ${candidates.length}. Partial state — investigate.`)
    console.log(`\n  SOFT-DELETED ${res.count} artifact messages (reversible: deleted=true).`)
  } else if (!EXECUTE && candidates.length > 0) {
    console.log(`\n  [dry-run] would soft-delete ${candidates.length} messages.`)
  } else {
    console.log(`\n  already clean — nothing to do.`)
  }

  console.log(`\nDone (${EXECUTE ? "executed" : "dry-run — no writes"}).`)
  await prisma.$disconnect()
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })
