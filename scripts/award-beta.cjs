/* eslint-disable @typescript-eslint/no-require-imports */
// Award the Beta Tester badge to a user by username.
// Run: node scripts\award-beta.cjs devexity
const fs = require("fs")
const path = require("path")
const { PrismaClient } = require("@prisma/client")

// Load root .env manually (Prisma Client doesn't auto-load it for one-off scripts)
const envPath = path.join(__dirname, "..", ".env")
if (fs.existsSync(envPath)) {
  const env = fs.readFileSync(envPath, "utf8")
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  }
}

const username = process.argv[2]
if (!username) {
  console.error("Usage: node scripts\\award-beta.cjs <username>")
  process.exit(1)
}

const prisma = new PrismaClient()

async function main() {
  const user = await prisma.user.findFirst({
    where: { profile: { username: { equals: username, mode: "insensitive" } } },
    select: { id: true, name: true, profile: { select: { username: true } } },
  })
  if (!user) {
    console.error(`User "${username}" not found`)
    process.exit(1)
  }

  const badge = await prisma.badge.findUnique({
    where: { name: "Beta Tester" },
    select: { id: true },
  })
  if (!badge) {
    console.error("Beta Tester badge not found. Run: node scripts\\seed-badges.cjs")
    process.exit(1)
  }

  await prisma.userBadge.upsert({
    where: { userId_badgeId: { userId: user.id, badgeId: badge.id } },
    create: { userId: user.id, badgeId: badge.id },
    update: {},
  })

  console.log(`Beta Tester badge awarded to @${user.profile?.username ?? user.name}`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
