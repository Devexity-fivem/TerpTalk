import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { readBlob } from "@/lib/blob"
import { isMediaKind, resolveMediaAccess } from "@/lib/media"
import { getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

export const dynamic = "force-dynamic"

const ID_RE = /^[a-z0-9]{8,40}$/i

/**
 * GET /api/media/[kind]/[id] — authorization-aware delivery for
 * restricted-class media (diary, post, setup images). The row id
 * identifies the owning content; visibility is evaluated per request via
 * the canonical predicates (canViewDiary, deletion, hidden categories,
 * active authors, block relationships). Denials are uniform 404s so the
 * endpoint is not an existence oracle. Responses are per-viewer: they
 * must never enter a shared cache.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string; id: string }> }
) {
  const { kind, id } = await params
  if (!isMediaKind(kind) || !ID_RE.test(id)) {
    return new NextResponse(null, { status: 404 })
  }

  const ip = getClientIp(request)
  const rl = await rateLimit(`media:${hashIp(ip)}`, 300, 60 * 1000)
  if (!rl.allowed) {
    return new NextResponse(null, { status: 404 })
  }

  const session = await getServerSession(authOptions)
  const viewer = { id: session?.user?.id, role: (session?.user as { role?: string } | undefined)?.role }

  const resolved = await resolveMediaAccess(kind, id, viewer)
  if (!resolved.ok) {
    return new NextResponse(null, { status: 404 })
  }

  const blob = await readBlob(resolved.url)
  if (!blob) {
    return new NextResponse(null, { status: 404 })
  }

  return new NextResponse(blob.body as BodyInit, {
    headers: {
      "Content-Type": blob.contentType,
      // Per-viewer authorized content — browser may cache briefly, shared
      // caches/CDNs must not. Revalidation always re-runs authorization.
      "Cache-Control": "private, max-age=300",
      "Vary": "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    },
  })
}
