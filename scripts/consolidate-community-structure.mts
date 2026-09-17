// consolidate-community-structure.mts — one-time beta-launch consolidation.
//
// Shrinks the forum from 21 flat categories to 8 purposeful launch categories
// and the chat room list from 8 public rooms to 3, WITHOUT deleting anything:
//
//   - Categories are archived via the existing `hidden` flag — honored by the
//     forum index, category pages (404 for non-mods), /api/categories (the
//     new-thread picker), search scoping, feed, sitemap, onboarding, and guide
//     cross-links. Threads/posts/follows/reputation/notifications untouched;
//     all archived categories were verified empty, so no content moves.
//   - Chat rooms are archived via `isPrivate: true` — they vanish from every
//     member surface (room list, picker, teaser, badges) and become staff-only
//     through the existing canAccessRoom gate. All had zero messages.
//   - The rep-gated Grow Room (grow-room) is untouched — it stays behind its
//     grow_room_enabled flag as a progression reward.
//
// Fully reversible: flip `hidden`/`isPrivate` back to restore. Idempotent:
// re-running only writes rows that differ.
//
// Run (dev):   npx tsx scripts/consolidate-community-structure.mts
// Run (prod):  DATABASE_URL="<prod>" ALLOW_PRODUCTION_DB_TESTS=1 npx tsx scripts/consolidate-community-structure.mts
import "./db-guard.mjs"
import { prisma } from "../src/lib/prisma"

// Launch structure — order defines the forum index. general first (broadest),
// then beginner/problem paths, then grow-medium, gear, reviews, and off-topic.
const VISIBLE_CATEGORIES: { slug: string; order: number }[] = [
  { slug: "general-cannabis-discussion", order: 1 },
  { slug: "new-grower-questions", order: 2 },
  { slug: "plant-problems", order: 3 },
  { slug: "indoor-growing", order: 4 },
  { slug: "outdoor-growing", order: 5 },
  { slug: "diy-equipment", order: 6 },
  { slug: "smoke-reports", order: 7 },
  { slug: "off-topic", order: 8 },
]

// Sub-specializations a launch community can't support yet — archived, not
// deleted. Unhide when real demand exists.
const ARCHIVED_CATEGORIES = [
  "greenhouse-growing",
  "soil-living-soil",
  "hydroponics",
  "lighting",
  "ventilation",
  "genetics-breeding",
  "seeds-starting-plants",
  "nutrients",
  "training-trellising",
  "flowering",
  "harvest-curing",
  "advanced-growing",
  "cannabis-memes",
]

const PUBLIC_ROOMS: { slug: string; order: number }[] = [
  { slug: "general", order: 1 },
  { slug: "grow-talk", order: 2 },
  { slug: "off-topic", order: 3 },
]

const ARCHIVED_ROOMS = ["indoor", "outdoor", "genetics", "flower-room", "equipment"]

async function main() {
  console.log("Consolidating community structure…\n")

  // Safety net: refuse to archive a category that has acquired threads.
  for (const slug of ARCHIVED_CATEGORIES) {
    const cat = await prisma.category.findUnique({
      where: { slug },
      select: { id: true, name: true, hidden: true, _count: { select: { threads: true } } },
    })
    if (!cat) {
      console.log(`  - category ${slug}: not present, skipping`)
      continue
    }
    if (cat._count.threads > 0) {
      console.log(`  ! category ${slug}: has ${cat._count.threads} thread(s) — refusing to archive, fix manually`)
      continue
    }
    if (cat.hidden) {
      console.log(`  - category ${slug}: already hidden`)
      continue
    }
    await prisma.category.update({ where: { slug }, data: { hidden: true } })
    console.log(`  ✓ category ${slug}: archived (hidden)`)
  }

  for (const { slug, order } of VISIBLE_CATEGORIES) {
    const cat = await prisma.category.findUnique({ where: { slug }, select: { hidden: true, order: true } })
    if (!cat) {
      console.log(`  ! category ${slug}: MISSING — required, not creating (check seed)`)
      continue
    }
    if (cat.hidden === false && cat.order === order) {
      console.log(`  - category ${slug}: already visible @${order}`)
      continue
    }
    await prisma.category.update({ where: { slug }, data: { hidden: false, order } })
    console.log(`  ✓ category ${slug}: visible @${order}`)
  }

  // Safety net for rooms: refuse to archive a room that has messages.
  for (const slug of ARCHIVED_ROOMS) {
    const room = await prisma.chatRoom.findUnique({
      where: { slug },
      select: { id: true, isPrivate: true, _count: { select: { messages: true } } },
    })
    if (!room) {
      console.log(`  - room ${slug}: not present, skipping`)
      continue
    }
    if (room._count.messages > 0) {
      console.log(`  ! room ${slug}: has ${room._count.messages} message(s) — refusing to archive, fix manually`)
      continue
    }
    if (room.isPrivate) {
      console.log(`  - room ${slug}: already archived`)
      continue
    }
    await prisma.chatRoom.update({ where: { slug }, data: { isPrivate: true } })
    console.log(`  ✓ room ${slug}: archived (private)`)
  }

  for (const { slug, order } of PUBLIC_ROOMS) {
    const room = await prisma.chatRoom.findUnique({ where: { slug }, select: { isPrivate: true, order: true } })
    if (!room) {
      console.log(`  ! room ${slug}: MISSING — not creating (the app lazily ensures 'general')`)
      continue
    }
    if (room.isPrivate === false && room.order === order) {
      console.log(`  - room ${slug}: already public @${order}`)
      continue
    }
    await prisma.chatRoom.update({ where: { slug }, data: { isPrivate: false, order } })
    console.log(`  ✓ room ${slug}: public @${order}`)
  }

  const [visibleCats, publicRooms, gated] = await Promise.all([
    prisma.category.count({ where: { hidden: false } }),
    prisma.chatRoom.count({ where: { isPrivate: false, requiredRep: null } }),
    prisma.chatRoom.count({ where: { requiredRep: { not: null } } }),
  ])
  console.log(`\nResult: ${visibleCats} visible categories, ${publicRooms} public chat rooms (+${gated} rep-gated).`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
