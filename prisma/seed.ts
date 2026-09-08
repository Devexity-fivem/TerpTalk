import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'

const prisma = new PrismaClient()

async function main() {
  // Create forum categories
  const categories = [
    { name: "Grow Journals", description: "Share your complete grow journeys from seed to harvest", slug: "grow-journals", order: 1 },
    { name: "Indoor Growing", description: "Indoor cultivation techniques, setups, and equipment", slug: "indoor-growing", order: 2 },
    { name: "Outdoor Growing", description: "Outdoor cultivation tips and seasonal growing", slug: "outdoor-growing", order: 3 },
    { name: "Greenhouse Growing", description: "Greenhouse cultivation and climate control", slug: "greenhouse-growing", order: 4 },
    { name: "Soil & Living Soil", description: "Organic soil building and living soil techniques", slug: "soil-living-soil", order: 5 },
    { name: "Hydroponics", description: "Hydroponic systems and nutrient solutions", slug: "hydroponics", order: 6 },
    { name: "Lighting", description: "Lighting systems, spectrums, and schedules", slug: "lighting", order: 7 },
    { name: "Ventilation", description: "Air flow, filtration, and climate control", slug: "ventilation", order: 8 },
    { name: "Genetics & Breeding", description: "Strain genetics, breeding, and phenotypes", slug: "genetics-breeding", order: 9 },
    { name: "Seeds & Starting Plants", description: "Seed selection, germination, and cloning", slug: "seeds-starting-plants", order: 10 },
    { name: "Plant Problems", description: "Diagnose and treat plant issues and pests", slug: "plant-problems", order: 11 },
    { name: "Nutrients", description: "Nutrient regimes, deficiencies, and feeding schedules", slug: "nutrients", order: 12 },
    { name: "Training & Trellising", description: "Plant training techniques for better yields", slug: "training-trellising", order: 13 },
    { name: "Flowering", description: "Flowering phase care and management", slug: "flowering", order: 14 },
    { name: "Harvest & Curing", description: "Harvest timing, drying, and curing techniques", slug: "harvest-curing", order: 15 },
    { name: "Advanced Growing", description: "Advanced techniques and experimental methods", slug: "advanced-growing", order: 16 },
    { name: "DIY & Equipment", description: "DIY projects and equipment modifications", slug: "diy-equipment", order: 17 },
    { name: "Grow Setup Showcases", description: "Show off your grow room and equipment", slug: "grow-setup-showcases", order: 18 },
    { name: "General Cannabis Discussion", description: "General cannabis discussions and news", slug: "general-cannabis-discussion", order: 19 },
    { name: "Cannabis Memes", description: "Funny cannabis-related content", slug: "cannabis-memes", order: 20 },
    { name: "Off Topic", description: "Non-cannabis related discussions", slug: "off-topic", order: 21 },
  ]

  for (const category of categories) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      update: {},
      create: category,
    })
  }

  // Create some badges — names must match BADGE_RULES in src/lib/reputation.ts
  const badges = [
    { name: "New Grower", description: "Made your first contribution", icon: "🌱", requirement: "Create a thread, post, or diary" },
    { name: "First Post", description: "Posted your first reply", icon: "✉️", requirement: "Create 1 post" },
    { name: "Conversation Starter", description: "Keeps discussions flowing", icon: "💬", requirement: "Create 5 threads" },
    { name: "Active Grower", description: "Regular contributor to the community", icon: "🌿", requirement: "Create 10 forum posts" },
    { name: "Diary Master", description: "Created detailed grow diaries", icon: "📖", requirement: "Create 5 grow diaries" },
    { name: "Strain Hunter", description: "Contributed to the strain database", icon: "🧬", requirement: "Add 3 strains" },
    { name: "Grow Photographer", description: "Shares grow photos with the community", icon: "📸", requirement: "Upload 5 strain photos" },
    { name: "Social Butterfly", description: "Active in community chat", icon: "🦋", requirement: "Send 25 chat messages" },
    { name: "Recruiter", description: "Brings new members to the community", icon: "🤝", requirement: "Refer 3 members" },
    { name: "Liked", description: "Content appreciated by the community", icon: "👍", requirement: "Receive 10 likes" },
    { name: "Helpful Grower", description: "Provided helpful answers", icon: "💡", requirement: "Receive 20 likes" },
    { name: "Community Favorite", description: "Beloved by the community", icon: "🔥", requirement: "Receive 100 likes" },
    { name: "Top Contributor", description: "Outstanding community contributor", icon: "🏆", requirement: "Earn 1000 reputation" },
  ]

  for (const badge of badges) {
    await prisma.badge.upsert({
      where: { name: badge.name },
      update: {},
      create: badge,
    })
  }

  // Create chat rooms
  const chatRooms = [
    { name: "General", description: "General discussion for all growers", slug: "general", order: 1 },
    { name: "Grow Talk", description: "Discuss growing techniques and tips", slug: "grow-talk", order: 2 },
    { name: "Indoor Growing", description: "Indoor cultivation discussions", slug: "indoor", order: 3 },
    { name: "Outdoor Growing", description: "Outdoor cultivation discussions", slug: "outdoor", order: 4 },
    { name: "Genetics", description: "Strain genetics and breeding", slug: "genetics", order: 5 },
    { name: "Flower Room", description: "Flowering phase discussions", slug: "flower-room", order: 6 },
    { name: "Equipment", description: "Equipment and setup discussions", slug: "equipment", order: 7 },
    { name: "Off Topic", description: "Non-growing related discussions", slug: "off-topic", order: 8 },
  ]

  for (const room of chatRooms) {
    await prisma.chatRoom.upsert({
      where: { slug: room.slug },
      update: {},
      create: room,
    })
  }

  // Bootstrap admin + moderator accounts (env-configured, dev/beta only)
  const adminPassword = process.env.ADMIN_PASSWORD || randomBytes(16).toString('hex')
  const adminUsername = process.env.ADMIN_USERNAME || 'ttadmin'

  const existingAdmin = await prisma.profile.findUnique({ where: { username: adminUsername } })
  if (!existingAdmin) {
    const hashed = await bcrypt.hash(adminPassword, 12)
    await prisma.user.create({
      data: {
        name: adminUsername,
        password: hashed,
        role: 'ADMINISTRATOR',
        ageVerified: true,
        profile: { create: { username: adminUsername, bio: 'TerpTalk administration' } },
      },
    })
    console.log(`✔ Admin account created: ${adminUsername}`)
    if (!process.env.ADMIN_PASSWORD) {
      console.log(`  ⚠ No ADMIN_PASSWORD env set — generated: ${adminPassword}`)
      console.log('  Set ADMIN_PASSWORD/ADMIN_USERNAME env vars and re-run to control credentials.')
    }
  }

  const modUsername = process.env.MOD_USERNAME || 'ttmoderator'
  const existingMod = await prisma.profile.findUnique({ where: { username: modUsername } })
  if (!existingMod) {
    const modPassword = process.env.MOD_PASSWORD || randomBytes(16).toString('hex')
    const hashed = await bcrypt.hash(modPassword, 12)
    await prisma.user.create({
      data: {
        name: modUsername,
        password: hashed,
        role: 'MODERATOR',
        ageVerified: true,
        profile: { create: { username: modUsername, bio: 'TerpTalk moderation team' } },
      },
    })
    console.log(`✔ Moderator account created: ${modUsername}`)
    if (!process.env.MOD_PASSWORD) {
      console.log(`  ⚠ No MOD_PASSWORD env set — generated: ${modPassword}`)
    }
  }

  console.log("Database seeded successfully!")
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })