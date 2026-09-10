import { prisma } from "@/lib/prisma"

// Open-source Game Icons SVGs (CC BY 3.0) used as badge images.
// https://game-icons.net / https://github.com/game-icons/icons — free for commercial use.
// Hosted via Iconify: https://iconify.design/
export const BADGE_ICONS: Record<string, string> = {
  // Core participation
  "New Grower": "https://api.iconify.design/game-icons/hemp.svg",
  "First Post": "https://api.iconify.design/game-icons/bud.svg",
  "Conversation Starter": "https://api.iconify.design/game-icons/leaf-swirl.svg",
  "Active Grower": "https://api.iconify.design/game-icons/flamed-leaf.svg",
  // Content / collection
  "Diary Master": "https://api.iconify.design/game-icons/notebook.svg",
  "Strain Hunter": "https://api.iconify.design/game-icons/magnifying-glass.svg",
  "Grow Photographer": "https://api.iconify.design/game-icons/photo-camera.svg",
  // Social
  "Social Butterfly": "https://api.iconify.design/game-icons/butterfly.svg",
  "Recruiter": "https://api.iconify.design/game-icons/shaking-hands.svg",
  "Liked": "https://api.iconify.design/game-icons/heart.svg",
  "Helpful Grower": "https://api.iconify.design/game-icons/light-bulb.svg",
  // Top honors
  "Community Favorite": "https://api.iconify.design/game-icons/laurels-trophy.svg",
  "Top Contributor": "https://api.iconify.design/game-icons/star.svg",
  "Helper": "https://api.iconify.design/game-icons/hand.svg",
  "Top Helper": "https://api.iconify.design/game-icons/trophy.svg",
  // Special / streaks
  "Dedicated Grower": "https://api.iconify.design/game-icons/fire.svg",
  "Beta Tester": "https://api.iconify.design/game-icons/test-tube-held.svg",
  "Weekly Winner": "https://api.iconify.design/game-icons/laurels-trophy.svg",
  "Verified YouTuber": "https://api.iconify.design/game-icons/video-camera.svg",
  // Reputation tiers
  "Sprout": "https://api.iconify.design/game-icons/seedling.svg",
  "Seedling": "https://api.iconify.design/game-icons/plant-seed.svg",
  "Grower": "https://api.iconify.design/game-icons/palm-tree.svg",
  "Cultivator": "https://api.iconify.design/game-icons/gardening-shears.svg",
  "Master Grower": "https://api.iconify.design/game-icons/laurel-crown.svg",
  "Legendary Grower": "https://api.iconify.design/game-icons/crowned-heart.svg",
}

export const BADGE_DESCRIPTIONS: Record<string, string> = {
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
  "Top Contributor": "Reached 5,000 reputation points.",
  "Helper": "Your reply was marked as an accepted answer.",
  "Top Helper": "5 of your replies were marked as accepted answers.",
  "Dedicated Grower": "Posted grow updates 7 days in a row.",
  "Beta Tester": "Joined TerpTalk during the beta and helped shape the community.",
  "Weekly Winner": "Won Budshot of the Week.",
  "Verified YouTuber": "A featured cannabis grow content creator on YouTube.",
  "Sprout": "Reached 50 reputation.",
  "Seedling": "Reached 150 reputation.",
  "Grower": "Reached 300 reputation.",
  "Cultivator": "Reached 600 reputation.",
  "Master Grower": "Reached 1,000 reputation.",
  "Legendary Grower": "Reached 2,500 reputation.",
}

// Seed all open-source badges. Safe to re-run — it updates icons/descriptions.
export async function seedBadges() {
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
  }
}
