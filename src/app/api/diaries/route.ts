import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden, enforceLinkTrust } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { awardReputation, reverseReputationBySource, REP_POINTS } from "@/lib/reputation"
import { notificationLinkWhere } from "@/lib/notify"
import { deleteImagesIfUnreferenced } from "@/lib/blob"
import { checkMaintenance } from "@/lib/maintenance"
import { parseMediumType, parseLightType, parseTechniques } from "@/lib/grow-fields"
import { revalidateTag } from "next/cache"
import { after } from "next/server"
import { assistFirstDiary } from "@/lib/terpbot-assist"

export async function POST(request: Request) {
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
      strain,
      strainId,
      genetics,
      growType,
      startDate,
      medium,
      mediumType,
      containerSize,
      lighting,
      lightType,
      nutrients,
      equipment,
      techniques,
      spaceDimensions,
      setupId,
    } = body

    if (typeof title !== "string" || !title.trim() || !startDate) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // description is NOT NULL in the schema but the form sends "" when the
    // member leaves it blank — a missing key must not 500 the create.
    if (description !== undefined && typeof description !== "string") {
      return NextResponse.json({ error: "Invalid description" }, { status: 400 })
    }

    if (title.length > LIMITS.DIARY_TITLE_MAX || (description && description.length > LIMITS.DESCRIPTION_MAX)) {
      return NextResponse.json(
        { error: "Content exceeds maximum length" },
        { status: 400 }
      )
    }

    const VALID_GROW_TYPES = new Set(["INDOOR", "OUTDOOR", "GREENHOUSE", "HYDROPONIC", "OTHER"])
    if (typeof growType !== "string" || !VALID_GROW_TYPES.has(growType)) {
      return NextResponse.json({ error: "Invalid grow type" }, { status: 400 })
    }

    const stringFields = [strain, genetics, medium, containerSize, lighting, nutrients, equipment, spaceDimensions]
    if (stringFields.some((f) => typeof f === "string" && f.length > 500)) {
      return NextResponse.json({ error: "A field exceeds maximum length" }, { status: 400 })
    }

    // Structured fields — all optional, additive to the legacy free text.
    const cleanMediumType = parseMediumType(mediumType)
    if (mediumType != null && !cleanMediumType) {
      return NextResponse.json({ error: "Invalid medium type" }, { status: 400 })
    }
    const cleanLightType = parseLightType(lightType)
    if (lightType != null && !cleanLightType) {
      return NextResponse.json({ error: "Invalid light type" }, { status: 400 })
    }
    const cleanTechniques = parseTechniques(techniques)
    // Strict: a non-array or any out-of-vocabulary value rejects the request.
    if (techniques != null && (!cleanTechniques || cleanTechniques.length !== techniques.length)) {
      return NextResponse.json({ error: "Invalid techniques" }, { status: 400 })
    }

    // Optional catalog strain link — must point at a real strain. The
    // free-text `strain` stays populated so fuzzy matching still works.
    const cleanStrainId = typeof strainId === "string" && strainId.trim() ? strainId : null
    const cleanSetupId = typeof setupId === "string" && setupId.trim() ? setupId : null
    if (strainId != null && typeof strainId !== "string") {
      return NextResponse.json({ error: "Invalid strain" }, { status: 400 })
    }
    if (setupId != null && typeof setupId !== "string") {
      return NextResponse.json({ error: "Invalid setup" }, { status: 400 })
    }

    let linkedStrainName: string | null = null
    if (cleanStrainId) {
      const strainRow = await prisma.strain.findUnique({
        where: { id: cleanStrainId },
        select: { id: true, name: true },
      })
      if (!strainRow) {
        return NextResponse.json({ error: "Strain not found" }, { status: 400 })
      }
      linkedStrainName = strainRow.name
    }

    // Optional setup link — only the member's own setups can be attached.
    if (cleanSetupId) {
      const setup = await prisma.growSetup.findUnique({
        where: { id: cleanSetupId },
        select: { id: true, authorId: true, deleted: true },
      })
      if (!setup || setup.deleted || setup.authorId !== session.user.id) {
        return NextResponse.json({ error: "Setup not found" }, { status: 400 })
      }
    }

    const parsedStartDate = new Date(startDate)
    if (isNaN(parsedStartDate.getTime())) {
      return NextResponse.json(
        { error: "Invalid start date" },
        { status: 400 }
      )
    }
    const now = new Date()
    if (parsedStartDate.getTime() > now.getTime() + 365 * 24 * 60 * 60 * 1000 || parsedStartDate.getFullYear() < 1970) {
      return NextResponse.json({ error: "Invalid start date" }, { status: 400 })
    }

    // Rate limit: 5 diaries per day per user
    const rl = await rateLimit(`diary:${session.user.id}`, 5, 24 * 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "diaries" },
      })
      return NextResponse.json(
        { error: "Too many diaries created. Please try again later." },
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
      "diaries"
    )
    if (linkBlock) return linkBlock

    // Create grow diary
    const diary = await prisma.growDiary.create({
      data: {
        title,
        description: description ?? "",
        strain: linkedStrainName ?? strain,
        strainId: cleanStrainId,
        genetics,
        growType,
        startDate: parsedStartDate,
        medium,
        mediumType: cleanMediumType,
        containerSize,
        lighting,
        lightType: cleanLightType,
        nutrients,
        equipment,
        techniques: cleanTechniques ?? [],
        spaceDimensions,
        setupId: cleanSetupId,
        authorId: session.user.id,
      },
      include: {
        author: { select: publicUserSelect },
      },
    })

    await awardReputation(
      session.user.id,
      "DIARY_CREATED",
      REP_POINTS.DIARY_CREATED,
      `Started grow diary "${diary.title.slice(0, 60)}"`,
      { key: `diary:${diary.id}`, sourceType: "DIARY", sourceId: diary.id }
    ).catch(() => {})

    // First-diary assist: one private TerpBot tip, once ever per member.
    // Deferred — the claim inside assistFirstDiary makes retries idempotent.
    after(() => assistFirstDiary(session.user.id, diary.id).then(() => {}))

    revalidateTag("diaries", { expire: 0 })
    // A structured strain link feeds strain-page stats — same bust as harvest.
    if (cleanStrainId) revalidateTag("strains", { expire: 0 })

    return NextResponse.json({ diary }, { status: 201 })
  } catch (error) {
    console.error("Diary creation error:", error)
    return NextResponse.json(
      { error: "Failed to create diary" },
      { status: 500 }
    )
  }
}
// DELETE — delete own diary: { id }
// Soft-delete keeps the row for moderation/audit but removes it from every
// public surface (all reads filter `deleted`). Images are permanently
// removed — restore paths re-attach nothing.
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const body = await request.json().catch(() => ({}))
    const { id } = body
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Missing diary id" }, { status: 400 })
    }

    const diary = await prisma.growDiary.findUnique({
      where: { id },
      select: { id: true, authorId: true, deleted: true },
    })
    if (!diary || diary.deleted) {
      return NextResponse.json({ error: "Diary not found" }, { status: 404 })
    }
    if (diary.authorId !== session.user.id) return forbidden()

    const imageUrls = await prisma.$transaction(async (tx) => {
      // threadId goes null with the diary: the discussion thread survives as
      // a normal thread, and no diary context can leak through it.
      await tx.growDiary.update({ where: { id }, data: { deleted: true, threadId: null } })
      const imgs = await tx.diaryImage.findMany({
        where: { update: { diaryId: id } },
        select: { url: true },
      })
      await tx.diaryImage.deleteMany({ where: { update: { diaryId: id } } })
      // Links to this diary in members' notifications would dangle.
      await tx.notification.deleteMany({ where: notificationLinkWhere(`/diaries/${id}`) })
      return imgs.map((i) => i.url)
    })

    // Diary rep (DIARY_CREATED, per-day update awards, reactions) is all
    // keyed sourceType=DIARY/sourceId=diaryId — one reversal unwinds it.
    await reverseReputationBySource("DIARY", id, "Diary removed", session.user.id).catch(() => 0)
    deleteImagesIfUnreferenced(imageUrls).catch(() => {})
    revalidateTag("diaries", { expire: 0 })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Diary delete error:", error)
    return NextResponse.json({ error: "Failed to delete diary" }, { status: 500 })
  }
}
