import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import { unauthorized, forbidden, isBanned } from "@/lib/security"
import { checkMaintenance } from "@/lib/maintenance"
import { validateSectionInput, parseProfileSettings } from "@/lib/profile-settings"

const NO_STORE = { "Cache-Control": "no-store, max-age=0, must-revalidate" }

async function ownSection(userId: string, sectionId: string) {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { id: true },
  })
  if (!profile) return { error: "Profile not found", status: 404 as const }
  const section = await prisma.profileCustomSection.findUnique({
    where: { id: sectionId },
    select: { id: true, profileId: true },
  })
  if (!section || section.profileId !== profile.id) {
    return { error: "Section not found", status: 404 as const }
  }
  return { profile, section }
}

// PATCH — edit a custom section (owner only).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const maintenance = await checkMaintenance()
  if (maintenance) return maintenance

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()
  if (await isBanned(session.user.id)) return forbidden()

  const { id } = await params
  const found = await ownSection(session.user.id, id)
  if ("error" in found) {
    return NextResponse.json({ error: found.error }, { status: found.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = validateSectionInput(body)
  if (parsed.error) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const data: Record<string, unknown> = {}
  if (parsed.title !== undefined) data.title = parsed.title
  if (parsed.body !== undefined) data.body = parsed.body
  if (parsed.visibility !== undefined) data.visibility = parsed.visibility
  if (parsed.order !== undefined) data.order = parsed.order
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 })
  }

  const section = await prisma.profileCustomSection.update({ where: { id }, data })
  return NextResponse.json({ section }, { headers: NO_STORE })
}

// DELETE — remove a custom section (owner only). Also clears
// profileSettings.pinnedSection if it pointed at the deleted row so the
// settings blob never references a missing section.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const maintenance = await checkMaintenance()
  if (maintenance) return maintenance

  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()
  if (await isBanned(session.user.id)) return forbidden()

  const { id } = await params
  const found = await ownSection(session.user.id, id)
  if ("error" in found) {
    return NextResponse.json({ error: found.error }, { status: found.status })
  }

  const [fullProfile] = await prisma.$transaction([
    prisma.profile.findUnique({
      where: { id: found.profile.id },
      select: { profileSettings: true },
    }),
    prisma.profileCustomSection.delete({ where: { id } }),
  ])

  const settings = parseProfileSettings(fullProfile?.profileSettings)
  if (settings.pinnedSection === id) {
    await prisma.profile.update({
      where: { id: found.profile.id },
      data: { profileSettings: { ...settings, pinnedSection: null } as unknown as Prisma.InputJsonValue },
    })
  }

  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
