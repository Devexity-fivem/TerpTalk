import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden, enforceLinkTrust } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { storeImages, deleteImagesIfUnreferenced } from "@/lib/blob"
import { checkMaintenance } from "@/lib/maintenance"
import { awardReputation, reverseReputationBySource, REP_POINTS } from "@/lib/reputation"
import { notificationLinkWhere } from "@/lib/notify"
import { revalidateTag } from "next/cache"
import { parseSetupPatch, setupPatchTouchesStrainStats, SETUP_MAX_IMAGES } from "@/lib/setup-edit"
import { diffUpdateImages } from "@/lib/diary-update-edit"

// The caller's own non-deleted setups — feeds the "link a grow setup"
// picker on the diary form. Owner-scoped by construction.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    const setups = await prisma.growSetup.findMany({
      where: { authorId: session.user.id, deleted: false },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, title: true },
    })
    return NextResponse.json({ setups })
  } catch (error) {
    console.error("Own setups error:", error)
    return NextResponse.json({ setups: [] })
  }
}

export async function POST(request: Request) {
  let storedImages: string[] = []

  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

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

    const linkBlock = await enforceLinkTrust(
      [title, description].filter((f): f is string => typeof f === "string").join("\n"),
      session.user.id,
      request,
      "setups"
    )
    if (linkBlock) return linkBlock

    // Validate any uploaded images are data URIs (client-resized, max 6)
    const validImages = Array.isArray(images)
      ? images.filter((i: unknown) => typeof i === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(i) && i.length <= 400_000).slice(0, 6)
      : []
    if (Array.isArray(images) && images.length > 0 && validImages.length === 0) {
      return NextResponse.json({ error: "Invalid image format" }, { status: 400 })
    }
    // Offload to Blob storage when configured
    storedImages = await storeImages(validImages, "setups", 6)

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

    await awardReputation(
      session.user.id,
      "SETUP_CREATED",
      REP_POINTS.SETUP_CREATED,
      `Shared grow setup "${setup.title.slice(0, 60)}"`,
      { key: `setup:${setup.id}`, sourceType: "SETUP", sourceId: setup.id }
    ).catch(() => {})

    revalidateTag("setups", { expire: 0 })

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

// DELETE — delete own setup: { id }
// Soft-delete; image rows are detached and their blobs permanently removed.
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const body = await request.json().catch(() => ({}))
    const { id } = body
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Missing setup id" }, { status: 400 })
    }

    const setup = await prisma.growSetup.findUnique({
      where: { id },
      select: { id: true, authorId: true, deleted: true },
    })
    if (!setup || setup.deleted) {
      return NextResponse.json({ error: "Setup not found" }, { status: 404 })
    }
    if (setup.authorId !== session.user.id) return forbidden()

    const imageUrls = await prisma.$transaction(async (tx) => {
      await tx.growSetup.update({ where: { id }, data: { deleted: true } })
      const imgs = await tx.setupImage.findMany({ where: { setupId: id }, select: { url: true } })
      await tx.setupImage.deleteMany({ where: { setupId: id } })
      await tx.notification.deleteMany({ where: notificationLinkWhere(`/setups/${id}`) })
      return imgs.map((i) => i.url)
    })

    await reverseReputationBySource("SETUP", id, "Setup removed", session.user.id).catch(() => 0)
    deleteImagesIfUnreferenced(imageUrls).catch(() => {})
    revalidateTag("setups", { expire: 0 })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Setup delete error:", error)
    return NextResponse.json({ error: "Failed to delete setup" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  let storedImages: string[] = []

  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const rl = await rateLimit(`setup-edit:${session.user.id}`, 10, 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "setups PATCH" },
      })
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const parsed = parseSetupPatch(await request.json().catch(() => null))
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    if (!parsed.id) {
      return NextResponse.json({ error: "Missing setup id" }, { status: 400 })
    }
    const { id, data, keepImageIds, newImages } = parsed

    const setup = await prisma.growSetup.findUnique({
      where: { id },
      select: {
        id: true,
        authorId: true,
        deleted: true,
        strain: true,
        images: { select: { id: true, url: true, order: true } },
      },
    })
    // One 404 for missing and soft-deleted — no existence oracle.
    if (!setup || setup.deleted) {
      return NextResponse.json({ error: "Setup not found" }, { status: 404 })
    }
    if (setup.authorId !== session.user.id) {
      return forbidden()
    }

    // Member-authored text — same link gate as creation.
    if ("title" in data || "description" in data) {
      const text = [data.title, data.description].filter((f): f is string => typeof f === "string").join("\n")
      const linkBlock = await enforceLinkTrust(text, session.user.id, request, "setups")
      if (linkBlock) return linkBlock
    }

    // Image diff — keepImageIds can only reference this setup's own rows;
    // foreign ids are dropped by the diff, never matched by the delete.
    const { kept, removed } = diffUpdateImages(setup.images, keepImageIds)
    const adding = newImages ?? []
    if (kept.length + adding.length > SETUP_MAX_IMAGES) {
      return NextResponse.json({ error: "Too many images" }, { status: 400 })
    }
    if (adding.length > 0) {
      storedImages = await storeImages(adding, "setups")
    }

    const touchesStrainStats = setupPatchTouchesStrainStats(setup, data)
    const changed = Object.keys(data).length > 0 || removed.length > 0 || storedImages.length > 0

    if (changed) {
      // New images append after the highest kept order — kept photos never
      // reorder on a plain text edit.
      const nextOrder = kept.reduce((m, i) => Math.max(m, i.order), -1) + 1
      let count = 0
      await prisma.$transaction(async (tx) => {
        if (removed.length > 0) {
          await tx.setupImage.deleteMany({
            where: { setupId: id, id: { in: removed.map((i) => i.id) } },
          })
        }
        if (storedImages.length > 0) {
          await tx.setupImage.createMany({
            data: storedImages.map((url, i) => ({ setupId: id, url, order: nextOrder + i })),
          })
        }
        // Guarded write — a concurrent soft-delete between load and write
        // yields count 0 → 404, no resurrection. `updatedAt` is written so
        // the derived "edited" marker also covers image-only edits.
        const res = await tx.growSetup.updateMany({
          where: { id, deleted: false },
          data: { ...data, updatedAt: new Date() },
        })
        count = res.count
      })
      if (count === 0) {
        deleteImagesIfUnreferenced(storedImages).catch(() => {})
        return NextResponse.json({ error: "Setup not found" }, { status: 404 })
      }
    }

    // Post-commit — removed URLs are swept only if nothing else references
    // them; an edit is not a creation, so no rep, no notifications, no bot.
    deleteImagesIfUnreferenced(removed.map((i) => i.url)).catch(() => {})
    revalidateTag("setups", { expire: 0 })
    if (touchesStrainStats) revalidateTag("strains", { expire: 0 })

    const result = await prisma.growSetup.findUnique({
      where: { id },
      include: { images: { orderBy: { order: "asc" } } },
    })
    return NextResponse.json({ setup: result })
  } catch (error) {
    // Newly stored images are orphaned if the mutation failed — sweep them.
    deleteImagesIfUnreferenced(storedImages).catch(() => {})
    console.error("Setup edit error:", error)
    return NextResponse.json({ error: "Failed to edit setup" }, { status: 500 })
  }
}
