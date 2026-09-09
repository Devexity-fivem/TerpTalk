import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, getClientIp, logSecurityEvent, isBanned, forbidden, isModerator } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, REP_POINTS } from "@/lib/reputation"
import { storeImage } from "@/lib/blob"

const VALID_KINDS = new Set(["PLANT", "FLOWER"])

// POST — upload a photo for a strain (client-resized data URI)
export async function POST(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json().catch(() => ({}))
    const { strainId, kind, image, caption } = body

    if (typeof strainId !== "string" || !strainId || !VALID_KINDS.has(kind)) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 })
    }

    if (
      typeof image !== "string" ||
      image.length > 400_000 ||
      !/^data:image\/(png|jpe?g|webp);base64,/.test(image)
    ) {
      return NextResponse.json(
        { error: "Image must be a JPG, PNG or WebP upload" },
        { status: 400 }
      )
    }

    // Rate limit: 20 photos per day per user
    const rl = await rateLimit(`strain-photo:${session.user.id}`, 20, 24 * 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "strains/photos" },
      })
      return NextResponse.json(
        { error: "Too many uploads. Please try again tomorrow." },
        { status: 429 }
      )
    }

    if (await isBanned(session.user.id)) {
      return forbidden("Your account is suspended")
    }

    const strain = await prisma.strain.findUnique({ where: { id: strainId }, select: { id: true } })
    if (!strain) {
      return NextResponse.json({ error: "Strain not found" }, { status: 404 })
    }

    const photo = await prisma.strainPhoto.create({
      data: {
        strainId,
        userId: session.user.id,
        kind,
        imageUrl: await storeImage(image, "strains"),
        caption: typeof caption === "string" ? caption.trim().slice(0, 200) || null : null,
      },
      include: {
        user: { select: { id: true, name: true, profile: { select: { username: true } } } },
      },
    })

    await awardReputation(
      session.user.id,
      "STRAIN_PHOTO",
      REP_POINTS.STRAIN_PHOTO,
      "Uploaded a strain photo"
    ).catch(() => {})

    return NextResponse.json({ photo }, { status: 201 })
  } catch (error) {
    console.error("Strain photo upload error:", error)
    return NextResponse.json({ error: "Failed to upload photo" }, { status: 500 })
  }
}

// DELETE — remove own photo (or moderator/admin): { id }
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json().catch(() => ({}))
    const { id } = body
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Missing photo id" }, { status: 400 })
    }

    const photo = await prisma.strainPhoto.findUnique({
      where: { id },
      select: { id: true, userId: true },
    })
    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 })
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true, banned: true },
    })
    if (!user || user.banned) return forbidden()

    if (photo.userId !== session.user.id && !isModerator(user.role)) {
      return forbidden()
    }

    await prisma.strainPhoto.delete({ where: { id } })
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Strain photo delete error:", error)
    return NextResponse.json({ error: "Failed to delete photo" }, { status: 500 })
  }
}
