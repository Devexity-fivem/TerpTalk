import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { unauthorized } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"
import { prisma } from "@/lib/prisma"
import { canViewDiary } from "@/lib/diary-visibility"
import { eventSource } from "@/lib/event-sources"
import { recordProductEvent, utcDay } from "@/lib/product-events"

// Client-observed product events — the social-loop signals a server
// action can't see. Mirrors /api/push/event: session-gated, strictly
// allowlisted type/source, rate-limited, no content or URLs accepted.
//
//   DIGEST_VIEWED            member opened /mydigest — once per UTC day
//   FOLLOWED_CONTENT_VIEWED  member opened a grow — recorded only when
//                            the server can verify they actually follow
//                            the grower AND may view that grow, once
//                            per diary per UTC day. Fails closed: an
//                            unfollowed or unviewable grow records
//                            nothing and the response stays 200, so the
//                            endpoint never becomes a follow/privacy
//                            oracle.
const CLIENT_TYPES = new Set(["DIGEST_VIEWED", "FOLLOWED_CONTENT_VIEWED"])

export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()

  const body = (await request.json().catch(() => ({}))) as {
    type?: unknown
    source?: unknown
    objectType?: unknown
    objectId?: unknown
  }
  if (typeof body.type !== "string" || !CLIENT_TYPES.has(body.type)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 })
  }
  const rl = await rateLimit(`product-event:${session.user.id}`, 60, 60 * 60 * 1000)
  if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 })

  const userId = session.user.id
  const source = eventSource(body.source)

  if (body.type === "DIGEST_VIEWED") {
    await recordProductEvent({ type: "DIGEST_VIEWED", userId, source, key: `dv:${userId}:${utcDay()}` })
    return NextResponse.json({ ok: true })
  }

  // FOLLOWED_CONTENT_VIEWED — the only meaningful object is a Diary the
  // member follows. Anything else records nothing (fail-closed).
  if (body.objectType !== "Diary" || typeof body.objectId !== "string" || body.objectId.length > 40) {
    return NextResponse.json({ ok: true })
  }
  const diary = await prisma.growDiary.findUnique({
    where: { id: body.objectId, deleted: false },
    select: { authorId: true, visibility: true },
  })
  if (!diary || !canViewDiary(diary, userId)) return NextResponse.json({ ok: true })
  const follows = await prisma.follow.findUnique({
    where: { followerId_followingId: { followerId: userId, followingId: diary.authorId } },
    select: { followerId: true },
  })
  if (!follows) return NextResponse.json({ ok: true })
  await recordProductEvent({
    type: "FOLLOWED_CONTENT_VIEWED",
    userId,
    source,
    objectType: "Diary",
    objectId: body.objectId,
    key: `fcv:${userId}:${body.objectId}:${utcDay()}`,
  })
  return NextResponse.json({ ok: true })
}
