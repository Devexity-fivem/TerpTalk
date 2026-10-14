import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { unauthorized, forbidden, getClientIp, logSecurityEvent, getSecurityUser, isBannedRow, enforceLinkTrust, blockExistsBetween } from "@/lib/security"
import { progressionRateLimit, getProgressionPerks } from "@/lib/progression"
import { checkMaintenance } from "@/lib/maintenance"
import { storeImages, deleteImagesIfUnreferenced, MAX_POST_IMAGES } from "@/lib/blob"
import { notifyMentions } from "@/lib/mentions"
import { notify } from "@/lib/notify"
import { eventSource } from "@/lib/event-sources"
import { recordProductEvent } from "@/lib/product-events"
import {
  MOMENT_CONTENT_MAX, STORY_CAPTION_MAX, STORY_TTL_MS, MOMENT_VISIBILITIES,
  canViewMoment, followersAudience, getMomentForViewer, momentPath, parseHashtags, resolveHashtagIds,
  type MomentVisibility,
} from "@/lib/moments"

const isId = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9]{8,40}$/i.test(v)

// POST — create a moment.
//   { kind?: "POST"|"STORY", content?, images?: dataUri[], visibility?: "PUBLIC"|"FOLLOWERS",
//     diaryId?, strainId?, repostOfId? }
// POST: text and/or up to 4 photos. With repostOfId it is a quote — own
// text required (pure reposts go through /api/moments/[id]/repost).
// STORY: 1–4 photos + optional ≤200-char caption, expires in 24h.
// Moments pay no XP by design (Progression V2: no posting-volume input).
export async function POST(request: Request) {
  let imageUrls: string[] = []
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id) return unauthorized()
    const userId = session.user.id

    const securityUser = await getSecurityUser(userId)
    if (isBannedRow(securityUser)) return forbidden("Your account is suspended")

    const maintenance = await checkMaintenance()
    if (maintenance) return maintenance

    const body = await request.json().catch(() => ({}))
    const kind = body.kind === undefined ? "POST" : body.kind
    if (kind !== "POST" && kind !== "STORY") {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 })
    }
    const visibility: MomentVisibility = body.visibility === undefined ? "PUBLIC" : body.visibility
    if (!(MOMENT_VISIBILITIES as readonly string[]).includes(visibility)) {
      return NextResponse.json({ error: "Invalid visibility" }, { status: 400 })
    }
    if (body.content !== undefined && typeof body.content !== "string") {
      return NextResponse.json({ error: "Invalid content" }, { status: 400 })
    }
    const content = typeof body.content === "string" ? body.content.trim() : ""
    if (body.images != null && !Array.isArray(body.images)) {
      return NextResponse.json({ error: "Images must be an array" }, { status: 400 })
    }
    const images: unknown[] = Array.isArray(body.images) ? body.images : []
    if (images.length > MAX_POST_IMAGES) {
      return NextResponse.json({ error: `You can attach at most ${MAX_POST_IMAGES} images` }, { status: 400 })
    }

    const repostOfId = body.repostOfId ?? null
    if (repostOfId !== null && !isId(repostOfId)) {
      return NextResponse.json({ error: "Invalid repost target" }, { status: 400 })
    }

    if (kind === "STORY") {
      if (images.length === 0) return NextResponse.json({ error: "A story needs at least one photo" }, { status: 400 })
      if (content.length > STORY_CAPTION_MAX) return NextResponse.json({ error: `Story captions are limited to ${STORY_CAPTION_MAX} characters` }, { status: 400 })
      if (repostOfId) return NextResponse.json({ error: "Stories can't repost" }, { status: 400 })
    } else {
      if (content.length > MOMENT_CONTENT_MAX) return NextResponse.json({ error: `Posts are limited to ${MOMENT_CONTENT_MAX} characters` }, { status: 400 })
      if (repostOfId && !content) return NextResponse.json({ error: "A quote needs your own text" }, { status: 400 })
      if (!content && images.length === 0) return NextResponse.json({ error: "Write something or add a photo" }, { status: 400 })
    }

    // Rate limits — tier-scaled like threads: 30 posts/hour, 10 stories/day.
    const perks = await getProgressionPerks(userId)
    const rl = kind === "STORY"
      ? await progressionRateLimit(userId, `story:${userId}`, 10, 24 * 60 * 60 * 1000, perks)
      : await progressionRateLimit(userId, `moment:${userId}`, 30, 60 * 60 * 1000, perks)
    if (!rl.allowed) {
      await logSecurityEvent("RATE_LIMIT_EXCEEDED", { userId, ip: getClientIp(request), metadata: { endpoint: "moments", kind } })
      return NextResponse.json({ error: "You're posting too fast. Please try again later." }, { status: 429 })
    }

    // Grow tag — only the author's own live diary.
    let diaryId: string | null = null
    if (body.diaryId != null) {
      if (!isId(body.diaryId)) return NextResponse.json({ error: "Invalid diary" }, { status: 400 })
      const d = await prisma.growDiary.findUnique({ where: { id: body.diaryId }, select: { authorId: true, deleted: true } })
      if (!d || d.deleted || d.authorId !== userId) return NextResponse.json({ error: "Diary not found" }, { status: 400 })
      diaryId = body.diaryId
    }
    let strainId: string | null = null
    if (body.strainId != null) {
      if (!isId(body.strainId)) return NextResponse.json({ error: "Invalid strain" }, { status: 400 })
      const s = await prisma.strain.findUnique({ where: { id: body.strainId }, select: { id: true } })
      if (!s) return NextResponse.json({ error: "Strain not found" }, { status: 400 })
      strainId = s.id
    }

    // Quote target — a live PUBLIC post the author can see. One 404 for
    // every failure (no existence oracle).
    let quoted: { id: string; authorId: string } | null = null
    if (repostOfId) {
      const target = await prisma.moment.findUnique({
        where: { id: repostOfId },
        select: {
          id: true, authorId: true, kind: true, visibility: true, deleted: true, expiresAt: true,
          author: { select: { banned: true, suspendedUntil: true } },
        },
      })
      if (!target || target.kind !== "POST" || target.visibility !== "PUBLIC" || !(await canViewMoment(target, userId))) {
        return NextResponse.json({ error: "Post not found" }, { status: 404 })
      }
      quoted = { id: target.id, authorId: target.authorId }
    }

    if (content) {
      const linkBlock = await enforceLinkTrust(content, userId, request, "moments")
      if (linkBlock) return linkBlock
    }

    // Upload before the row exists so a storage failure can't leave a
    // moment with half its photos.
    try {
      imageUrls = await storeImages(images, "moments", MAX_POST_IMAGES, { access: "private" })
    } catch (err) {
      console.error("Moment image upload error:", err)
      return NextResponse.json({ error: "Image upload failed" }, { status: 400 })
    }

    const tagIds = kind === "POST" ? await resolveHashtagIds(parseHashtags(content)) : []
    const moment = await prisma.moment.create({
      data: {
        kind,
        content,
        visibility,
        authorId: userId,
        diaryId,
        strainId,
        repostOfId: quoted?.id ?? null,
        expiresAt: kind === "STORY" ? new Date(Date.now() + STORY_TTL_MS) : null,
        images: { create: imageUrls.map((url, order) => ({ url, order })) },
        tags: { create: tagIds.map((tagId) => ({ tagId })) },
      },
      select: { id: true },
    })
    imageUrls = []

    // Product event: one per persisted moment — best-effort, references
    // the id only, never the content.
    await recordProductEvent({
      type: "INTERACTION_POSTED",
      userId,
      source: eventSource(body.source),
      objectType: "Moment",
      objectId: moment.id,
    })

    const actorName = session.user.name || "Someone"
    const link = momentPath(moment.id)
    if (content) {
      await notifyMentions(
        content, userId, actorName, link,
        kind === "STORY" ? "their story" : "a post",
        quoted ? [quoted.authorId] : [],
        visibility === "FOLLOWERS" ? followersAudience(userId) : undefined,
      )
    }
    // A followers-only quote only notifies the original author if they can
    // open it (i.e. they follow the quoter).
    const quotedCanView = quoted && (visibility === "PUBLIC" || (await followersAudience(userId)([quoted.authorId])).has(quoted.authorId))
    if (quoted && quotedCanView && quoted.authorId !== userId && !(await blockExistsBetween(userId, quoted.authorId))) {
      await notify({
        userId: quoted.authorId,
        type: "REACTION",
        title: "Your post was quoted",
        content: `@${actorName} quoted your post`,
        link,
        actorId: userId,
        groupKey: `moment-quote:${quoted.id}:${userId}`,
        dedupeMs: 60 * 60 * 1000,
      })
    }

    const dto = await getMomentForViewer(moment.id, userId)
    return NextResponse.json({ moment: dto }, { status: 201 })
  } catch (error) {
    deleteImagesIfUnreferenced(imageUrls).catch(() => {})
    console.error("Moment create error:", error)
    return NextResponse.json({ error: "Failed to create post" }, { status: 500 })
  }
}
