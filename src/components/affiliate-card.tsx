import { prisma } from "@/lib/prisma"
import { DEFAULT_DISCLOSURE } from "@/lib/affiliate"
import { ExternalLink, Tag } from "lucide-react"

// Reusable affiliate product card — data comes from the DB so admin
// changes (URL, promo code, copy) update every card automatically.
export default async function AffiliateCard({ slug, from }: { slug: string; from?: string }) {
  const product = await prisma.affiliateProduct.findUnique({
    where: { slug },
    include: { partner: true },
  })
  if (!product || !product.active || !product.partner.active) return null

  const disclosure = (await prisma.setting.findUnique({ where: { key: "affiliateDisclosure" } }))?.value || DEFAULT_DISCLOSURE
  const code = product.promoCode || product.partner.promoCode
  const href = `/go/${product.slug}${from ? `?from=${encodeURIComponent(from)}` : ""}`
  const pros = product.pros?.split("\n").filter(Boolean) || []

  return (
    <div className="bg-card border border-border rounded-xl p-4 my-3">
      <div className="flex gap-4">
        {product.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt={product.name} loading="lazy" decoding="async" className="w-20 h-20 rounded-lg object-cover shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{product.name}</span>
            <span className="text-xs text-muted-foreground">by {product.partner.name}</span>
            {product.price && <span className="text-xs font-medium text-primary">{product.price}</span>}
          </div>
          <p className="text-sm text-muted-foreground mt-1">{product.description}</p>
          {product.recommendedFor && (
            <p className="text-xs text-muted-foreground mt-1">Recommended for: {product.recommendedFor}</p>
          )}
          {pros.length > 0 && (
            <ul className="text-xs text-muted-foreground mt-1.5 space-y-0.5">
              {pros.slice(0, 3).map((p, i) => <li key={i}>✓ {p}</li>)}
            </ul>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
        {code && (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-primary/15 text-primary px-2.5 py-1 rounded-lg">
            <Tag className="w-3 h-3" /> Use code: {code}
          </span>
        )}
        <a
          href={href}
          rel="sponsored nofollow"
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 ml-auto"
        >
          Shop {product.partner.name} <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
      <p className="text-[10px] text-muted-foreground mt-2">{disclosure}</p>
    </div>
  )
}
