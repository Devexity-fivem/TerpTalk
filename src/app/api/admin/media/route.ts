import { NextResponse } from "next/server"
import { requireAdmin } from "@/lib/require-staff"
import { prisma } from "@/lib/prisma"
import { forbidden, getClientIp, logSecurityEvent } from "@/lib/security"
import { deleteImagesIfUnreferenced } from "@/lib/blob"
import { rateLimit } from "@/lib/rate-limit"
import { reverseReputationBySource } from "@/lib/reputation"

type MediaType = "post" | "diary" | "setup" | "strain" | "contest" | "avatar"

// GET — list uploaded media across content types (ADMINISTRATOR only)
export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const rl = await rateLimit(`admin-media:${admin.id}`, 30, 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const { searchParams } = new URL(request.url)
  const q = (searchParams.get("q") || "").trim().slice(0, 60)
  const type = (searchParams.get("type") as MediaType | null) || undefined

  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1)
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10) || 25))
  const skip = type ? (page - 1) * limit : 0
  const take = type ? limit : 100

  const [postImages, diaryImages, setupImages, strainPhotos, contestEntries, profiles] = await Promise.all([
    type && type !== "post" ? [] : prisma.postImage.findMany({
      where: q ? { url: { contains: q, mode: "insensitive" as const } } : undefined,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { post: { select: { author: { select: { profile: { select: { username: true } } } } } } },
    }),
    type && type !== "diary" ? [] : prisma.diaryImage.findMany({
      where: q ? { url: { contains: q, mode: "insensitive" as const } } : undefined,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { update: { select: { author: { select: { profile: { select: { username: true } } } } } } },
    }),
    type && type !== "setup" ? [] : prisma.setupImage.findMany({
      where: q ? { url: { contains: q, mode: "insensitive" as const } } : undefined,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { setup: { select: { author: { select: { profile: { select: { username: true } } } } } } },
    }),
    type && type !== "strain" ? [] : prisma.strainPhoto.findMany({
      where: q ? { imageUrl: { contains: q, mode: "insensitive" as const } } : undefined,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { user: { select: { profile: { select: { username: true } } } } },
    }),
    type && type !== "contest" ? [] : prisma.contestEntry.findMany({
      where: q ? { imageUrl: { contains: q, mode: "insensitive" as const } } : undefined,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      include: { user: { select: { profile: { select: { username: true } } } } },
    }),
    type && type !== "avatar" ? [] : prisma.profile.findMany({
      where: q ? { avatarUrl: { contains: q, mode: "insensitive" as const } } : {},
      orderBy: { joinDate: "desc" },
      skip,
      take,
      select: { userId: true, avatarUrl: true, joinDate: true, username: true },
    }),
  ])

  const items = [
    ...postImages.map((i) => ({ id: i.id, type: "post" as const, url: i.url, createdAt: i.createdAt, author: i.post?.author?.profile?.username ?? "unknown" })),
    ...diaryImages.map((i) => ({ id: i.id, type: "diary" as const, url: i.url, createdAt: i.createdAt, author: i.update?.author?.profile?.username ?? "unknown" })),
    ...setupImages.map((i) => ({ id: i.id, type: "setup" as const, url: i.url, createdAt: i.createdAt, author: i.setup?.author?.profile?.username ?? "unknown" })),
    ...strainPhotos.map((i) => ({ id: i.id, type: "strain" as const, url: i.imageUrl, createdAt: i.createdAt, author: i.user?.profile?.username ?? "unknown" })),
    ...contestEntries.map((i) => ({ id: i.id, type: "contest" as const, url: i.imageUrl, createdAt: i.createdAt, author: i.user?.profile?.username ?? "unknown" })),
    ...profiles.map((p) => ({ id: p.userId, type: "avatar" as const, url: p.avatarUrl ?? "", createdAt: p.joinDate, author: p.username ?? "unknown" })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, take)

  const hasMore = type ? items.length === take : false

  return NextResponse.json({ items, page: type ? page : 1, limit, hasMore })
}

// POST — delete a media record and its Blob object
// { action: "delete", id, type }
export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return forbidden()

  const rl = await rateLimit(`admin-media:${admin.id}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  const body = await request.json().catch(() => ({}))
  const { action, id, type } = body

  if (action !== "delete" || typeof id !== "string" || !id || typeof type !== "string" || !type) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  let url: string | null = null

  await prisma.$transaction(async (tx) => {
    switch (type) {
      case "post": {
        const row = await tx.postImage.delete({ where: { id }, select: { url: true } })
        url = row.url
        break
      }
      case "diary": {
        const row = await tx.diaryImage.delete({ where: { id }, select: { url: true } })
        url = row.url
        break
      }
      case "setup": {
        const row = await tx.setupImage.delete({ where: { id }, select: { url: true } })
        url = row.url
        break
      }
      case "strain": {
        const row = await tx.strainPhoto.delete({ where: { id }, select: { imageUrl: true } })
        url = row.imageUrl
        break
      }
      // Note: only strain photos carry rep (STRAIN_PHOTO awards keyed to the
      // photo id) — post/diary/setup images and avatars never earned points.
      case "contest": {
        const row = await tx.contestEntry.delete({ where: { id }, select: { imageUrl: true } })
        url = row.imageUrl
        break
      }
      case "avatar": {
        // Read the old URL first — update() returns the post-write (null) value.
        const old = await tx.profile.findUnique({ where: { userId: id }, select: { avatarUrl: true } })
        await tx.profile.update({ where: { userId: id }, data: { avatarUrl: null } })
        await tx.user.update({ where: { id }, data: { image: null } })
        url = old?.avatarUrl ?? null
        break
      }
      default:
        throw new Error("INVALID_TYPE")
    }
  })

  if (type === "strain") {
    // Reverse the STRAIN_PHOTO award — same path as member-side deletes.
    await reverseReputationBySource("STRAIN_PHOTO", id, "Photo removed by staff", admin.id).catch(() => 0)
  }

  if (url) {
    try {
      await deleteImagesIfUnreferenced([url])
    } catch {
      // Cleanup is best-effort; the DB record is already removed.
    }
  }

  await logSecurityEvent("SUSPICIOUS_ACTIVITY", {
    userId: admin.id,
    ip: getClientIp(request),
    metadata: { adminAction: "media_delete", mediaId: id, mediaType: type },
  })

  return NextResponse.json({ ok: true })
}
