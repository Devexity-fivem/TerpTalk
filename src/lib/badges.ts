import { prisma } from "@/lib/prisma"
import { BADGE_REGISTRY } from "@/lib/badge-registry"

// Seed/update all registered badge definitions. Safe to re-run.
export async function seedBadges() {
  for (const badge of BADGE_REGISTRY) {
    await prisma.badge.upsert({
      where: { name: badge.name },
      create: {
        name: badge.name,
        description: badge.description,
        icon: badge.icon,
        color: badge.rarity,
        requirement: badge.requirement,
      },
      update: {
        description: badge.description,
        icon: badge.icon,
        color: badge.rarity,
        requirement: badge.requirement,
      },
    })
  }
}
