import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  // Create forum categories
  const categories = [
    { name: "New Grower Questions", description: "Beginner help — no question is too basic", slug: "new-grower-questions", order: 1 },
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
    { name: "Smoke Reports & Strain Reviews", description: "Post-harvest reviews — flavor, effects, and how the grow went", slug: "smoke-reports", order: 18 },
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
    { name: "Top Contributor", description: "Outstanding community contributor", icon: "🏆", requirement: "Earn 10,000 reputation" },
    { name: "Sprout", description: "Reached 250 reputation", icon: "🌿", requirement: "Earn 250 reputation" },
    { name: "Seedling", description: "Reached 750 reputation", icon: "🌱", requirement: "Earn 750 reputation" },
    { name: "Grower", description: "Reached 1,500 reputation", icon: "🌲", requirement: "Earn 1,500 reputation" },
    { name: "Cultivator", description: "Reached 3,500 reputation", icon: "🌿", requirement: "Earn 3,500 reputation" },
    { name: "Master Grower", description: "Reached 7,000 reputation", icon: "🏆", requirement: "Earn 7,000 reputation" },
    { name: "Legendary Grower", description: "Reached 15,000 reputation", icon: "👑", requirement: "Earn 15,000 reputation" },
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

  // Bootstrap admin + moderator accounts only when explicit env credentials are provided.
  // Never allow a reserved/system username (e.g. "terpbot") through these
  // paths — that would create a passworded privileged account the bot would
  // then adopt, making it a loginable admin.
  const RESERVED = new Set([
    "admin", "administrator", "moderator", "mod", "system", "support",
    "root", "terptalk", "staff", "help", "api", "www", "null", "undefined",
    "terpbot",
  ])
  if (process.env.ADMIN_USERNAME && RESERVED.has(process.env.ADMIN_USERNAME.toLowerCase())) {
    console.warn(`⚠ ADMIN_USERNAME "${process.env.ADMIN_USERNAME}" is reserved — skipping admin creation`)
    process.env.ADMIN_USERNAME = ""
  }
  if (process.env.MOD_USERNAME && RESERVED.has(process.env.MOD_USERNAME.toLowerCase())) {
    console.warn(`⚠ MOD_USERNAME "${process.env.MOD_USERNAME}" is reserved — skipping moderator creation`)
    process.env.MOD_USERNAME = ""
  }
  if (process.env.ADMIN_USERNAME && process.env.ADMIN_PASSWORD) {
    const existingAdmin = await prisma.profile.findUnique({ where: { username: process.env.ADMIN_USERNAME } })
    if (!existingAdmin) {
      const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12)
      await prisma.user.create({
        data: {
          name: process.env.ADMIN_USERNAME,
          password: hashed,
          role: 'ADMINISTRATOR',
          ageVerified: true,
          profile: { create: { username: process.env.ADMIN_USERNAME, bio: 'TerpTalk administration' } },
        },
      })
      console.log(`✔ Admin account created: ${process.env.ADMIN_USERNAME}`)
    }
  }

  if (process.env.MOD_USERNAME && process.env.MOD_PASSWORD) {
    const existingMod = await prisma.profile.findUnique({ where: { username: process.env.MOD_USERNAME } })
    if (!existingMod) {
      const hashed = await bcrypt.hash(process.env.MOD_PASSWORD, 12)
      await prisma.user.create({
        data: {
          name: process.env.MOD_USERNAME,
          password: hashed,
          role: 'MODERATOR',
          ageVerified: true,
          profile: { create: { username: process.env.MOD_USERNAME, bio: 'TerpTalk moderation team' } },
        },
      })
      console.log(`✔ Moderator account created: ${process.env.MOD_USERNAME}`)
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