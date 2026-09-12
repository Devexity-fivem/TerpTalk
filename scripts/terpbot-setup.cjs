/* eslint-disable @typescript-eslint/no-require-imports */
// Ensure the TerpBot account exists and its profile is filled in.
// The app also self-heals this on the bot's next post — this script just
// forces it now. Run: node scripts\terpbot-setup.cjs
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

const BOT_PROFILE = {
  bio: "🤖 TerpTalk's resident bot. I welcome new members, celebrate your milestones, post the daily digest, and keep chat tidy. Type /help in chat to see my commands.",
  location: "The Garden",
  growSpace: "Server rack",
  growExperience: "Eternal — I watch every grow",
  favoriteStrain: "Blue Dream (compiled)",
  avatarUrl: "/terpbot.svg",
}

const prisma = new PrismaClient()

async function main() {
  let user = await prisma.user.findFirst({
    where: { profile: { username: "terpbot" } },
    select: { id: true, role: true, profile: { select: { id: true } } },
  })

  if (!user) {
    user = await prisma.user.create({
      data: {
        name: "TerpBot",
        role: "MEMBER",
        ageVerified: true,
        status: "ONLINE",
        profile: { create: { username: "terpbot", ...BOT_PROFILE } },
      },
      select: { id: true, role: true, profile: { select: { id: true } } },
    })
    console.log("Created TerpBot account with profile.")
  } else if (user.role !== "MEMBER") {
    // Pin the role — the bot must never hold staff privileges, even if it was
    // elevated out-of-band. Only ever touches the known bot row.
    await prisma.user.update({ where: { id: user.id }, data: { role: "MEMBER" } })
    console.log("Demoted TerpBot back to MEMBER.")
  }

  if (user.profile) {
    await prisma.profile.update({ where: { id: user.profile.id }, data: BOT_PROFILE })
    console.log("Updated existing TerpBot profile.")
  } else {
    await prisma.profile.create({ data: { userId: user.id, username: "terpbot", ...BOT_PROFILE } })
    console.log("Created missing TerpBot profile.")
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
