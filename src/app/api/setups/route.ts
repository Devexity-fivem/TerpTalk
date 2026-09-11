import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { storeImage, deleteImagesIfUnreferenced } from "@/lib/blob"

export async function POST(request: Request) {
  let storedImages: string[] = []

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return unauthorized()
    }

    const body = await request.json().catch(() => ({}))
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
      strain,
      images,
    } = body

    if (typeof title !== "string" || !title.trim()) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      )
    }

    const stringFields = [description, space, tent, lighting, ventilation, fans, containers, medium, nutrients, controllers, equipment, strain]
    if (stringFields.some((f) => typeof f === "string" && f.length > 500)) {
      return NextResponse.json({ error: "A field exceeds maximum length" }, { status: 400 })
    }

    if (title.length > LIMITS.TITLE_MAX || (description && description.length > LIMITS.DESCRIPTION_MAX)) {
      return NextResponse.json(
        { error: "Content exceeds maximum length" },
        { status: 400 }
      )
    }

    if (Array.isArray(images) && images.length > 30) {
      return NextResponse.json({ error: "Too many images" }, { status: 400 })
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

    // Validate any uploaded images are data URIs (client-resized, max 6)
    const validImages = Array.isArray(images)
      ? images.filter((i: unknown) => typeof i === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(i) && i.length <= 400_000).slice(0, 6)
      : []
    if (Array.isArray(images) && images.length > 0 && validImages.length === 0) {
      return NextResponse.json({ error: "Invalid image format" }, { status: 400 })
    }
    // Offload to Blob storage when configured
    storedImages = await Promise.all(validImages.map((i: string) => storeImage(i, "setups")))

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
        strain,
        authorId: session.user.id,
        ...(storedImages.length > 0 && {
          images: {
            create: storedImages.map((url: string, i: number) => ({ url, order: i })),
          },
        }),
      },
      include: {
        author: { select: publicUserSelect },
      },
    })

    return NextResponse.json({ setup }, { status: 201 })
  } catch (error) {
    // Clean up any already-uploaded Blob objects if the setup could not be created.
    deleteImagesIfUnreferenced(storedImages).catch(() => {})
    console.error("Setup creation error:", error)
    return NextResponse.json(
      { error: "Failed to create setup" },
      { status: 500 }
    )
  }
}
