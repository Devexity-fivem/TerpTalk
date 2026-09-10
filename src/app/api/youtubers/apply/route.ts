import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

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
      select: { id: true },
    })

    if (!profile) {
      return NextResponse.json(
        { error: "Profile not found" },
        { status: 404 }
      )
    }

    await prisma.profile.update({
      where: { userId: session.user.id },
      data: { youtubeChannelUrl },
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("YouTuber application error:", error)
    return NextResponse.json(
      { error: "Failed to submit application" },
      { status: 500 }
    )
  }
}
