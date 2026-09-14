import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isBanned } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { Prisma } from "@prisma/client"

const DM_POLICIES = new Set(["EVERYONE", "FOLLOWING", "NONE"])

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()
  if (await isBanned(session.user.id)) return forbidden()

  const rl = await rateLimit(`profile-notifications:${session.user.id}`, 60, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const profile = await prisma.profile.findUnique({
    where: { userId: session.user.id },
    select: {
      notifyOnReply: true,
      notifyOnMention: true,
      notifyOnCategoryFollow: true,
      notifyOnMessage: true,
      notifyOnComment: true,
      notifyOnFollow: true,
      notifyOnReaction: true,
      notifyOnMilestone: true,
      notifyOnBotAssist: true,
      hideOnlineStatus: true,
      publicMilestoneOptOut: true,
      dmPolicy: true,
    },
  })

  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })
  return NextResponse.json(profile)
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()
  if (await isBanned(session.user.id)) return forbidden()

  const rl = await rateLimit(`profile-notifications:${session.user.id}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const data: {
    notifyOnReply?: boolean
    notifyOnMention?: boolean
    notifyOnCategoryFollow?: boolean
    notifyOnMessage?: boolean
    notifyOnComment?: boolean
    notifyOnFollow?: boolean
    notifyOnReaction?: boolean
    notifyOnMilestone?: boolean
    notifyOnBotAssist?: boolean
    hideOnlineStatus?: boolean
    publicMilestoneOptOut?: boolean
    dmPolicy?: string
  } = {}

  if ("notifyOnReply" in body) data.notifyOnReply = !!body.notifyOnReply
  if ("notifyOnMention" in body) data.notifyOnMention = !!body.notifyOnMention
  if ("notifyOnCategoryFollow" in body) data.notifyOnCategoryFollow = !!body.notifyOnCategoryFollow
  if ("notifyOnMessage" in body) data.notifyOnMessage = !!body.notifyOnMessage
  if ("notifyOnComment" in body) data.notifyOnComment = !!body.notifyOnComment
  if ("notifyOnFollow" in body) data.notifyOnFollow = !!body.notifyOnFollow
  if ("notifyOnReaction" in body) data.notifyOnReaction = !!body.notifyOnReaction
  if ("notifyOnMilestone" in body) data.notifyOnMilestone = !!body.notifyOnMilestone
  if ("notifyOnBotAssist" in body) data.notifyOnBotAssist = !!body.notifyOnBotAssist
  if ("hideOnlineStatus" in body) data.hideOnlineStatus = !!body.hideOnlineStatus
  if ("publicMilestoneOptOut" in body) data.publicMilestoneOptOut = !!body.publicMilestoneOptOut
  if ("dmPolicy" in body) {
    const raw = body.dmPolicy
    if (typeof raw === "string" && DM_POLICIES.has(raw.toUpperCase())) {
      data.dmPolicy = raw.toUpperCase()
    } else {
      return NextResponse.json({ error: "Invalid message privacy setting" }, { status: 400 })
    }
  }

  await prisma.profile.update({
    where: { userId: session.user.id },
    data: data as unknown as Prisma.ProfileUpdateInput,
  })

  // Hiding online status clears any stale ONLINE marker immediately —
  // nothing else ever stamps a user back to OFFLINE.
  if (data.hideOnlineStatus === true) {
    await prisma.user.update({
      where: { id: session.user.id },
      data: { status: "OFFLINE" },
    }).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
