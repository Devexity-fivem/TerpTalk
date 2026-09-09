import { prisma } from "@/lib/prisma"

// Open-source Twemoji SVGs (CC-BY 4.0) used as badge images.
// https://github.com/twitter/twemoji — free for commercial use.
export const BADGE_ICONS: Record<string, string> = {
  "New Grower": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f331.svg",
  "First Post": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f4dd.svg",
  "Conversation Starter": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f4ac.svg",
  "Active Grower": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f33f.svg",
  "Diary Master": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f4d3.svg",
  "Strain Hunter": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f50e.svg",
  "Grow Photographer": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f4f7.svg",
  "Social Butterfly": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f98b.svg",
  "Recruiter": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f91d.svg",
  "Liked": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f44d.svg",
  "Helpful Grower": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f4a1.svg",
  "Community Favorite": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f3c6.svg",
  "Top Contributor": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/2b50.svg",
  "Dedicated Grower": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f525.svg",
  "Beta Tester": "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f9ea.svg",
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
  "Top Contributor": "Reached 1,000 reputation points.",
  "Dedicated Grower": "Posted grow updates 7 days in a row.",
  "Beta Tester": "Joined TerpTalk during the beta and helped shape the community.",
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
