import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getClientIp, hashIp } from "@/lib/security"
import { rateLimit } from "@/lib/rate-limit"

// GET /go/[slug]?from=/page — records the click, then redirects to the
// affiliate URL. Works for product slugs and partner slugs.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const from = new URL(request.url).searchParams.get("from")?.slice(0, 200) || null
  const session = await getServerSession(authOptions).catch(() => null)

  // Rate-limit click tracking so analytics can't be inflated. The redirect
  // still happens — we just skip recording the click — so a user who
  // legitimately clicks fast isn't bounced off the destination.
  const rl = await rateLimit(`affclick:${hashIp(getClientIp(request))}`, 30, 10 * 60 * 1000)
  const trackClick = rl.allowed

  // Product slug first, then partner slug
  const product = await prisma.affiliateProduct.findUnique({
    where: { slug },
    include: { partner: { select: { id: true, affiliateUrl: true, active: true } } },
  })
  const partner = product
    ? null
    : await prisma.affiliatePartner.findUnique({
        where: { slug },
        select: { id: true, affiliateUrl: true, active: true },
      })

  const partnerId = product?.partnerId ?? partner?.id
  const partnerActive = product ? product.partner.active : partner?.active
  const dest = product?.affiliateUrl || product?.partner.affiliateUrl || partner?.affiliateUrl

  if (!dest || !partnerId || partnerActive === false || (product && !product.active)) {
    return NextResponse.redirect(new URL("/deals", request.url))
  }

  if (trackClick) {
    await prisma.affiliateClick.create({
      data: {
        partnerId,
        productId: product?.id ?? null,
        page: from,
        userId: session?.user?.id ?? null, // account id only — no PII
      },
    }).catch(() => {})
  }

  return NextResponse.redirect(dest, 302)
}
