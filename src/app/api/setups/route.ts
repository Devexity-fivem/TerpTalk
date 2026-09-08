import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const body = await request.json()
    const {
      title,
      description,
      space,
      tent,
      lighting,
      ventilation,
      fans,
      containers,
      medium,
      nutrients,
      controllers,
      equipment,
    } = body

    if (typeof title !== "string" || !title.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      )
    }

    if (title.length > LIMITS.TITLE_MAX || (description && description.length > LIMITS.DESCRIPTION_MAX)) {
      return NextResponse.json(
        { error: "Content exceeds maximum length" },
        { status: 400 }
      )
    }

    // Rate limit: 5 setups per day per user
    const rl = await rateLimit(`setup:${session.user.id}`, 5, 24 * 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "setups" },
      })
      return NextResponse.json(
        { error: "Too many setups created. Please try again later." },
        { status: 429 }
      )
    }

    if (await isBanned(session.user.id)) {
      return forbidden("Your account is suspended")
    }

    // Create grow setup
    const setup = await prisma.growSetup.create({
      data: {
        title,
        description,
        space,
        tent,
        lighting,
        ventilation,
        fans,
        containers,
        medium,
        nutrients,
        controllers,
        equipment,
        authorId: session.user.id,
      },
      include: {
        author: { select: publicUserSelect },
      },
    })

    return NextResponse.json({ setup }, { status: 201 })
  } catch (error) {
    console.error("Setup creation error:", error)
    return NextResponse.json(
      { error: "Failed to create setup" },
      { status: 500 }
    )
  }
}
