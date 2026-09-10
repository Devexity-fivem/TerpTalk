import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, isBanned } from "@/lib/security"
import { Prisma } from "@prisma/client"

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()
  if (await isBanned(session.user.id)) return forbidden()

  const profile = await prisma.profile.findUnique({
    where: { userId: session.user.id },
    select: {
      notifyOnReply: true,
      notifyOnMention: true,
      notifyOnCategoryFollow: true,
      notifyOnMessage: true,
      notifyOnComment: true,
      emailDigestFrequency: true,
    },
  })

  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 })
  return NextResponse.json(profile)
}

export async function PATCH(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()
  if (await isBanned(session.user.id)) return forbidden()

  const body = await request.json().catch(() => ({}))
  const data: {
    notifyOnReply?: boolean
    notifyOnMention?: boolean
    notifyOnCategoryFollow?: boolean
    notifyOnMessage?: boolean
    notifyOnComment?: boolean
    emailDigestFrequency?: string | null
  } = {}

  if ("notifyOnReply" in body) data.notifyOnReply = !!body.notifyOnReply
  if ("notifyOnMention" in body) data.notifyOnMention = !!body.notifyOnMention
  if ("notifyOnCategoryFollow" in body) data.notifyOnCategoryFollow = !!body.notifyOnCategoryFollow
  if ("notifyOnMessage" in body) data.notifyOnMessage = !!body.notifyOnMessage
  if ("notifyOnComment" in body) data.notifyOnComment = !!body.notifyOnComment
  if ("emailDigestFrequency" in body) data.emailDigestFrequency = body.emailDigestFrequency || null

  await prisma.profile.update({
    where: { userId: session.user.id },
    data: data as unknown as Prisma.ProfileUpdateInput,
  })

  return NextResponse.json({ ok: true })
}
