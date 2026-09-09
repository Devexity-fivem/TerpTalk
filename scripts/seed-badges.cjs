/* eslint-disable @typescript-eslint/no-require-imports */
// Seed/update all community badges with open-source Game Icons images.
// Run: node scripts\seed-badges.cjs
const { PrismaClient } = require("@prisma/client")
const prisma = new PrismaClient()

const BADGE_ICONS = {
  "New Grower": "https://api.iconify.design/game-icons/hemp.svg",
  "First Post": "https://api.iconify.design/game-icons/bud.svg",
  "Conversation Starter": "https://api.iconify.design/game-icons/leaf-swirl.svg",
  "Active Grower": "https://api.iconify.design/game-icons/flamed-leaf.svg",
  "Diary Master": "https://api.iconify.design/game-icons/notebook.svg",
  "Strain Hunter": "https://api.iconify.design/game-icons/magnifying-glass.svg",
  "Grow Photographer": "https://api.iconify.design/game-icons/photo-camera.svg",
  "Social Butterfly": "https://api.iconify.design/game-icons/butterfly.svg",
  "Recruiter": "https://api.iconify.design/game-icons/shaking-hands.svg",
  "Liked": "https://api.iconify.design/game-icons/heart.svg",
  "Helpful Grower": "https://api.iconify.design/game-icons/light-bulb.svg",
  "Community Favorite": "https://api.iconify.design/game-icons/laurels-trophy.svg",
  "Top Contributor": "https://api.iconify.design/game-icons/star.svg",
  "Dedicated Grower": "https://api.iconify.design/game-icons/fire.svg",
  "Beta Tester": "https://api.iconify.design/game-icons/test-tube-held.svg",
  "Weekly Winner": "https://api.iconify.design/game-icons/laurels-trophy.svg",
}

const BADGE_DESCRIPTIONS = {
  "New Grower": "Posted your first thread, reply, or grow diary.",
  "First Post": "Made your first post in the forums.",
  "Conversation Starter": "Started 5 discussion threads.",
  "Active Grower": "Made 10 forum posts.",
  "Diary Master": "Created 5 grow diaries.",
  "Strain Hunter": "Added 3 strains to the database.",
  "Grow Photographer": "Shared 5 strain or grow photos.",
  "Social Butterfly": "Sent 25 messages in community chat.",
  "Recruiter": "Referred 3 new members.",
  "Liked": "Received 10 likes on your posts and diaries.",
  "Helpful Grower": "Received 20 likes on your posts and diaries.",
  "Community Favorite": "Received 100 likes on your posts and diaries.",
  "Top Contributor": "Reached 1,000 reputation points.",
  "Dedicated Grower": "Posted grow updates 7 days in a row.",
  "Beta Tester": "Joined TerpTalk during the beta and helped shape the community.",
  "Weekly Winner": "Won Budshot of the Week.",
}

async function main() {
  for (const [name, icon] of Object.entries(BADGE_ICONS)) {
    await prisma.badge.upsert({
      where: { name },
      create: {
        name,
        description: BADGE_DESCRIPTIONS[name] || name,
        icon,
        requirement: BADGE_DESCRIPTIONS[name] || name,
      },
      update: {
        description: BADGE_DESCRIPTIONS[name] || name,
        icon,
        requirement: BADGE_DESCRIPTIONS[name] || name,
      },
    })
    console.log(`✓ ${name}`)
  }
  console.log(`\n${Object.keys(BADGE_ICONS).length} badges updated`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
