import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, hashIp, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { notifyMany } from "@/lib/notify"

const YOUTUBE_PATTERNS = [
  "https://www.youtube.com/",
  "https://youtube.com/",
  "https://m.youtube.com/",
]

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const ipHash = hashIp(ip)

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return unauthorized()
    }
    if (await isBanned(session.user.id)) {
      return forbidden()
    }

    const rl = await rateLimit(`youtube-apply:${ipHash}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many applications. Please try again later." },
        { status: 429 }
      )
    }

    const body = await request.json().catch(() => ({}))
    const { youtubeChannelUrl } = body

    if (!youtubeChannelUrl || typeof youtubeChannelUrl !== "string") {
      return NextResponse.json(
        { error: "YouTube channel URL is required" },
        { status: 400 }
      )
    }

    if (!YOUTUBE_PATTERNS.some((p) => youtubeChannelUrl.toLowerCase().startsWith(p))) {
      return NextResponse.json(
        { error: "Please provide a valid YouTube channel URL" },
        { status: 400 }
      )
    }

    const profile = await prisma.profile.findUnique({
      where: { userId: session.user.id },
      select: { id: true, youtubeChannelUrl: true },
    })

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      )
    }

    // A verified creator swapping their channel URL must be re-reviewed —
    // otherwise the badge would vouch for a channel staff never saw.
    const verifiedBadge = await prisma.badge.findUnique({
      where: { name: "Verified YouTuber" },
      select: { id: true },
    })
    if (verifiedBadge && profile.youtubeChannelUrl !== youtubeChannelUrl) {
      await prisma.userBadge.deleteMany({
        where: { userId: session.user.id, badgeId: verifiedBadge.id },
      })
    }

    await prisma.profile.update({
      where: { userId: session.user.id },
      data: { youtubeChannelUrl },
    })

    const admins = await prisma.user.findMany({
      where: { role: "ADMINISTRATOR", banned: false },
      select: { id: true },
    })
    if (admins.length > 0) {
      await notifyMany(
        admins.map((a) => ({
          userId: a.id,
          type: "MODERATOR_ANNOUNCEMENT" as const,
          title: "YouTuber verification request",
          content: `A member submitted a channel for verification.`,
          link: "/admin/youtubers",
        }))
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("YouTuber application error:", error)
    return NextResponse.json(
      { error: "Failed to submit application" },
      { status: 500 }
    )
  }
}
