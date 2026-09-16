import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, publicUserSelect, LIMITS, getClientIp, logSecurityEvent, isBanned, forbidden, enforceLinkTrust } from "@/lib/security"
import { awardReputation, checkBadges, repRateLimit, reverseReputationByKey, REP_POINTS } from "@/lib/reputation"
import { storeImages, deleteImagesIfUnreferenced, MAX_POST_IMAGES } from "@/lib/blob"
import { checkMaintenance } from "@/lib/maintenance"
import { notifyMany } from "@/lib/notify"
import { revalidateTag } from "next/cache"
import { diaryDay, diaryWeek } from "@/lib/diary-weeks"
import { evaluateGrowJourney } from "@/lib/grow-journey"
import { rateLimit } from "@/lib/rate-limit"
import {
  UPDATE_STAGES,
  UPDATE_NUMERIC_RANGES,
  cleanUpdateString,
  parseUpdatePatch,
  diffUpdateImages,
  updatePatchTouchesStrainStats,
} from "@/lib/diary-update-edit"

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
      diaryId,
      title,
      content,
      dayNumber,
      weekNumber,
      stage,
      temperature,
      humidity,
      vpd,
      ph,
      ec,
      heightCm,
      feeding,
      training,
      images,
    } = body

    if (
      typeof title !== "string" || !title.trim() ||
      typeof content !== "string" || !content.trim() ||
      typeof diaryId !== "string" || !diaryId
    ) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    if (title.length > LIMITS.DIARY_TITLE_MAX || content.length > LIMITS.POST_CONTENT_MAX) {
      return NextResponse.json(
        { error: "Content exceeds maximum length" },
        { status: 400 }
      )
    }

    // Validate controlled fields — stage must be a real stage, numbers must be numbers
    if (stage !== undefined && stage !== null && !UPDATE_STAGES.has(stage)) {
      return NextResponse.json({ error: "Invalid stage" }, { status: 400 })
    }
    const numericValues: Record<string, unknown> = { dayNumber, weekNumber, temperature, humidity, vpd, ph, ec, heightCm }
    for (const n of Object.values(numericValues)) {
      if (n !== undefined && n !== null && typeof n !== "number") {
        return NextResponse.json({ error: "Numeric fields must be numbers" }, { status: 400 })
      }
    }

    // Sanity bounds — keep implausible readings out of charts and aggregates.
    for (const [name, lo, hi] of UPDATE_NUMERIC_RANGES) {
      const v = numericValues[name]
      if (typeof v === "number" && (v < lo || v > hi)) {
        return NextResponse.json({ error: `${name} is out of range` }, { status: 400 })
      }
    }

    if (Array.isArray(images) && images.length > 20) {
      return NextResponse.json({ error: "Too many images" }, { status: 400 })
    }
    const validImages = Array.isArray(images)
      ? images.filter((i: unknown) => typeof i === "string" && /^data:image\/(png|jpe?g|webp);base64,/.test(i) && i.length <= 400_000).slice(0, 4)
      : []

    // Rate limit + ban check before any expensive work
    const rl = await repRateLimit(session.user.id, `diary-update:${session.user.id}`, 30, 60 * 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "diaries/updates" },
      })
      return NextResponse.json(
        { error: "Too many updates. Please try again later." },
        { status: 429 }
      )
    }

    if (await isBanned(session.user.id)) {
      return forbidden("Your account is suspended")
    }

    // Validate diary exists and user is the author
    const diary = await prisma.growDiary.findUnique({
      where: { id: diaryId },
    })

    if (!diary || diary.deleted) {
      return NextResponse.json(
        { error: "Diary not found" },
        { status: 404 }
      )
    }

    if (diary.authorId !== session.user.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      )
    }

    const linkBlock = await enforceLinkTrust(`${title}\n${content}`, session.user.id, request, "diaries/updates")
    if (linkBlock) return linkBlock

    // Offload to Blob storage when configured (keeps DB rows small)
    storedImages = await storeImages(validImages, "diary-updates")

    // Derive day/week from the diary start date when the client doesn't
    // supply them — manual entry is no longer exposed in the form.
    const derivedDay = typeof dayNumber === "number" ? dayNumber : diaryDay(diary.startDate, new Date())
    const derivedWeek = typeof weekNumber === "number" ? weekNumber : diaryWeek(diary.startDate, new Date())

    // Create update + optional diary stage change in one transaction — a
    // stage-update failure can't leave an update that disagrees with the
    // diary's stage.
    const update = await prisma.$transaction(async (tx) => {
      const created = await tx.diaryUpdate.create({
        data: {
          title,
          content,
          diaryId,
          authorId: session.user.id,
          dayNumber: derivedDay,
          weekNumber: derivedWeek,
          stage: stage || diary.stage,
          temperature: typeof temperature === "number" ? temperature : null,
          humidity: typeof humidity === "number" ? humidity : null,
          vpd: typeof vpd === "number" ? vpd : null,
          ph: typeof ph === "number" ? ph : null,
          ec: typeof ec === "number" ? ec : null,
          heightCm: typeof heightCm === "number" ? heightCm : null,
          feeding: cleanUpdateString(feeding, 300),
          training: cleanUpdateString(training, 300),
          // Attach up to 4 client-resized photos
          ...(storedImages.length > 0 && {
            images: {
              create: storedImages.map((url: string, i: number) => ({
                url,
                order: i,
              })),
            },
          }),
        },
        include: {
          author: { select: publicUserSelect },
          images: true,
        },
      })
      // Update diary stage only on an explicit change. The form defaults to the
      // diary's current stage, so an untouched select never regresses it.
      if (stage && stage !== diary.stage) {
        await tx.growDiary.update({
          where: { id: diaryId },
          data: { stage },
        })
      }
      return created
    })

    // One paying update per diary per UTC day — keyed so extra updates and
    // retries don't farm. A 10-character floor keeps trivial "bump" updates
    // from paying; the update itself is still posted either way.
    if (content.trim().length >= 10) {
      const updateDay = new Date().toISOString().slice(0, 10)
      await awardReputation(
        session.user.id,
        "DIARY_UPDATE",
        REP_POINTS.DIARY_UPDATE,
        `Updated diary "${diary.title.slice(0, 60)}"`,
        { key: `diaryupd:${diaryId}:${updateDay}`, sourceType: "DIARY", sourceId: diaryId }
      ).catch(() => {})
    }

    revalidateTag("diaries", { expire: 0 })

    // Grow-journey milestones recompute from live rows — a new meaningful
    // update day or stage change may cross a gate. Keyed, idempotent.
    await evaluateGrowJourney(diaryId).catch(() => {})

    // Streak and diary badges are rule-backed via the growStreak stat —
    // run the standard check so updates under the 10-char rep floor (which
    // skip the award pipeline) still advance badges.
    await checkBadges(session.user.id).catch(() => {})

    // Notify diary followers (not the author) — notifyMany filters
    // prefs, banned recipients, and blocks in bulk.
    const followers = await prisma.diaryFollow.findMany({
      where: { diaryId, userId: { not: session.user.id } },
      select: { userId: true },
      take: 5000,
    })
    if (followers.length > 0) {
      const authorName = session.user.name || "Someone"
      await notifyMany(
        followers.map((f) => ({
          userId: f.userId,
          type: "DIARY_UPDATE" as const,
          title: "Diary updated",
          content: `@${authorName} added "${update.title.slice(0, 60)}" to "${diary.title.slice(0, 50)}"`,
          // Deep-link to the week section — derive the anchor the same way
          // the page does (createdAt vs startDate); client-supplied
          // weekNumber is never trusted for display grouping.
          link: `/diaries/${diaryId}#week-${diaryWeek(diary.startDate, update.createdAt)}`,
          actorId: session.user.id,
          // Throttle fan-out like thread-follow notifications — rapid
          // update bursts shouldn't spam followers.
          groupKey: `diary-update:${diaryId}`,
          dedupeMs: 6 * 60 * 60 * 1000,
        }))
      )
    }

    return NextResponse.json({ update }, { status: 201 })
  } catch (error) {
    // Clean up any already-uploaded Blob objects if the diary update could not be created.
    deleteImagesIfUnreferenced(storedImages).catch(() => {})
    console.error("Update creation error:", error)
    return NextResponse.json(
      { error: "Failed to create update" },
      { status: 500 }
    )
  }
}
// DELETE — delete own diary update: { id }
// DiaryUpdate has no `deleted` flag; nothing references it except its own
// images (cascade), so a hard delete is safe. Derived state (streaks,
// stage runs, harvest report, counts) recomputes from remaining updates.
// Per-day diary rep is keyed to the diary+day — deleting the LAST update
// of that diary+day claws the day's points back, so post-then-delete can't
// launder filler updates into kept rep.
export async function DELETE(request: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const body = await request.json().catch(() => ({}))
    const { id } = body
    if (typeof id !== "string" || !id) {
      return NextResponse.json({ error: "Missing update id" }, { status: 400 })
    }

    const update = await prisma.diaryUpdate.findUnique({
      where: { id },
      select: {
        id: true, authorId: true, diaryId: true, createdAt: true,
        diary: { select: { authorId: true, deleted: true } },
        images: { select: { url: true } },
      },
    })
    if (!update || update.diary.deleted) {
      return NextResponse.json({ error: "Update not found" }, { status: 404 })
    }
    if (update.authorId !== session.user.id || update.diary.authorId !== session.user.id) {
      return forbidden()
    }

    await prisma.diaryUpdate.delete({ where: { id } })

    // Claw back the day's diary-update rep if this was the last remaining
    // update for that diary on that UTC day — otherwise delete-the-evidence
    // keeps the payout. Reverse-by-key is a no-op when no award exists.
    const dayStart = new Date(Date.UTC(
      update.createdAt.getUTCFullYear(), update.createdAt.getUTCMonth(), update.createdAt.getUTCDate()
    ))
    const dayEnd = new Date(dayStart.getTime() + 86400000)
    const remaining = await prisma.diaryUpdate.count({
      where: { diaryId: update.diaryId, createdAt: { gte: dayStart, lt: dayEnd } },
    })
    if (remaining === 0) {
      const dayKey = update.createdAt.toISOString().slice(0, 10)
      await reverseReputationByKey(`diaryupd:${update.diaryId}:${dayKey}`, "Diary update deleted").catch(() => null)
    }
    // Losing a meaningful update day can regress a grow-journey stage —
    // reconciliation claws the milestone award back if it no longer holds.
    await evaluateGrowJourney(update.diaryId).catch(() => {})
    deleteImagesIfUnreferenced(update.images.map((i) => i.url)).catch(() => {})
    revalidateTag("diaries", { expire: 0 })

    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error("Diary update delete error:", error)
    return NextResponse.json({ error: "Failed to delete update" }, { status: 500 })
  }
}

// PATCH — edit own diary update: { id, ...editable fields, keepImageIds?, images? }
// Owner-only (mirrors DELETE: update author AND diary author). createdAt is
// authoritative chronology and is never writable; dayNumber/weekNumber are
// derived display fields and stay untouched. A stage edit changes that
// update's historical stage label only — GrowDiary.stage is never written
// here, so a correction can't silently move the diary's current stage.
// No creation side effects: no rep award, no badge check, no follower
// notifications, no TerpBot. evaluateGrowJourney still runs because an edit
// can legitimately flip the update's "meaningful" contribution.
export async function PATCH(request: Request) {
  let storedImages: string[] = []

  try {
    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()

    if (await isBanned(session.user.id)) return forbidden("Your account is suspended")

    const rl = await rateLimit(`diary-update-edit:${session.user.id}`, 10, 60 * 1000)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", {
        userId: session.user.id,
        ip: getClientIp(request),
        metadata: { endpoint: "diaries/updates PATCH" },
      })
      return NextResponse.json({ error: "Too many requests" }, { status: 429 })
    }

    const parsed = parseUpdatePatch(await request.json().catch(() => null))
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }
    if (!parsed.id) {
      return NextResponse.json({ error: "Missing update id" }, { status: 400 })
    }
    const { id, data, keepImageIds, newImages } = parsed

    const update = await prisma.diaryUpdate.findUnique({
      where: { id },
      select: {
        id: true,
        authorId: true,
        diaryId: true,
        stage: true,
        temperature: true,
        humidity: true,
        vpd: true,
        ph: true,
        ec: true,
        diary: { select: { authorId: true, deleted: true } },
        images: { select: { id: true, url: true, order: true } },
      },
    })
    // One 404 for missing update and deleted parent — no existence oracle.
    if (!update || update.diary.deleted) {
      return NextResponse.json({ error: "Update not found" }, { status: 404 })
    }
    if (update.authorId !== session.user.id || update.diary.authorId !== session.user.id) {
      return forbidden()
    }

    // Member-authored text — same link gate as creation.
    if ("title" in data || "content" in data) {
      const text = [data.title, data.content].filter((f): f is string => typeof f === "string").join("\n")
      const linkBlock = await enforceLinkTrust(text, session.user.id, request, "diaries/updates")
      if (linkBlock) return linkBlock
    }

    // Image diff — keepImageIds can only reference this update's own rows;
    // foreign ids are dropped by the diff, never matched by the delete.
    const { kept, removed } = diffUpdateImages(update.images, keepImageIds)
    const adding = newImages ?? []
    if (kept.length + adding.length > MAX_POST_IMAGES) {
      return NextResponse.json({ error: "Too many images" }, { status: 400 })
    }
    if (adding.length > 0) {
      storedImages = await storeImages(adding, "diary-updates")
    }

    const touchesStrainStats = updatePatchTouchesStrainStats(update, data)
    const changed = Object.keys(data).length > 0 || removed.length > 0 || storedImages.length > 0

    if (changed) {
      // New images append after the highest kept order — kept photos never
      // reorder on a plain text/env edit.
      const nextOrder = kept.reduce((m, i) => Math.max(m, i.order), -1) + 1
      let count = 0
      await prisma.$transaction(async (tx) => {
        if (removed.length > 0) {
          await tx.diaryImage.deleteMany({
            where: { updateId: id, id: { in: removed.map((i) => i.id) } },
          })
        }
        if (storedImages.length > 0) {
          await tx.diaryImage.createMany({
            data: storedImages.map((url, i) => ({ updateId: id, url, order: nextOrder + i })),
          })
        }
        // Guarded write — a concurrent delete between load and write yields
        // count 0 → 404, no resurrection. `updatedAt` is always written so
        // the derived "edited" marker also covers image-only edits.
        const res = await tx.diaryUpdate.updateMany({
          where: { id },
          data: { ...data, updatedAt: new Date() },
        })
        count = res.count
      })
      if (count === 0) {
        deleteImagesIfUnreferenced(storedImages).catch(() => {})
        return NextResponse.json({ error: "Update not found" }, { status: 404 })
      }
    }

    // Post-commit side effects — reconciliation only, never creation rewards.
    deleteImagesIfUnreferenced(removed.map((i) => i.url)).catch(() => {})
    await evaluateGrowJourney(update.diaryId).catch(() => {})
    revalidateTag("diaries", { expire: 0 })
    if (touchesStrainStats) revalidateTag("strains", { expire: 0 })

    const result = await prisma.diaryUpdate.findUnique({
      where: { id },
      include: { images: { orderBy: { order: "asc" } } },
    })
    return NextResponse.json({ update: result })
  } catch (error) {
    // Newly stored images are orphaned if the mutation failed — sweep them.
    deleteImagesIfUnreferenced(storedImages).catch(() => {})
    console.error("Diary update edit error:", error)
    return NextResponse.json({ error: "Failed to edit update" }, { status: 500 })
  }
}
