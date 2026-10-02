import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { checkMaintenance } from "@/lib/maintenance"
import { PROFILE_SECTION_HARD_MAX, validateSectionInput } from "@/lib/profile-settings"
import { profileSectionLimit } from "@/lib/progression"

const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" }

// GET — the owner's own custom sections (all visibilities).
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()

  const profile = await prisma.profile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

  const sections = await prisma.profileCustomSection.findMany({
    where: { profileId: profile.id },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  })
  return NextResponse.json({ sections }, { headers: NO_STORE })
}

// POST — create a custom section. Owner-only; body is markdown SOURCE (rendered
// through MarkdownRenderer — raw HTML/scripts are never emitted). Count is
// progression-tiered: Seed 2 → Rooted 4 → Harvested 6 → Cured 8.
export async function POST(request: Request) {
  const maintenance = await checkMaintenance()
  if (maintenance) return maintenance

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()
  const rl = await rateLimit(`profile-sections:${session.user.id}`, 30, 60 * 60 * 1000)
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  const profile = await prisma.profile.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  })
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })

  const body = await request.json().catch(() => null)
  const parsed = validateSectionInput(body)
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (parsed.title === undefined || parsed.body === undefined) {
    return NextResponse.json({ error: "title and body are required" }, { status: 400 })
  }

  const limit = Math.min(await profileSectionLimit(session.user.id), PROFILE_SECTION_HARD_MAX)
  const count = await prisma.profileCustomSection.count({ where: { profileId: profile.id } })
  if (count >= limit) {
    return NextResponse.json({ error: `You can have up to ${limit} custom sections` }, { status: 403 })
  }

  const section = await prisma.profileCustomSection.create({
    data: {
      profileId: profile.id,
      title: parsed.title,
      body: parsed.body,
      visibility: parsed.visibility ?? "PUBLIC",
      order: parsed.order ?? count,
    },
  })
  return NextResponse.json({ section }, { status: 201, headers: NO_STORE })
}
