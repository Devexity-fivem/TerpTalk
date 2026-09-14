import { PrismaClient } from "@prisma/client"
import bcrypt from "bcryptjs"
import crypto from "node:crypto"

const prisma = new PrismaClient()

const ACCOUNTS = [
  { username: "mp_member_a", role: "MEMBER" },
  { username: "mp_member_b", role: "MEMBER" },
  { username: "mp_moderator", role: "MODERATOR" },
  { username: "mp_admin", role: "ADMINISTRATOR" },
] as const

async function main() {
  for (const { username, role } of ACCOUNTS) {
    const password = crypto.randomBytes(18).toString("base64url")
    const hashed = await bcrypt.hash(password, 12)
    const existing = await prisma.profile.findUnique({ where: { username } })
    if (existing) {
      await prisma.user.update({
        where: { id: existing.userId },
        data: { password: hashed, role, sessionVersion: { increment: 1 } },
      })
      console.log(`updated  ${username} (${role}) password=${password}`)
    } else {
      await prisma.user.create({
        data: {
          name: username,
          ageVerified: true,
          password: hashed,
          role,
          sessionVersion: 1,
          profile: { create: { username } },
        },
      })
      console.log(`created  ${username} (${role}) password=${password}`)
    }
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
