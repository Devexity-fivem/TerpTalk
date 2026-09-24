import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { DEFAULT_DISCLOSURE } from "@/lib/affiliate"
import { Tag, ExternalLink, Percent } from "lucide-react"
import DealsBrowser from "@/components/deals-browser"

// Cached 5 min — admin-edited affiliate data propagates quickly enough
export const revalidate = 300

export const metadata = {
  title: "TerpTalk Deals — Grow Equipment & Clones",
  description: "Recommended grow lights, tents, fans and equipment plus Farm Bill compliant clones shipped to all 50 states — from TerpTalk's affiliate partners. Community-tested gear with promo codes.",
}

// Products land in the "Clones & Genetics" section when their category reads
// as genetics rather than hardware — everything else is grow equipment.
const CLONE_SECTION_RE = /clone|seed|genetic/i

const getDealsData = unstable_cache(
  async () => {
    const [partners, products, setting] = await Promise.all([
      prisma.affiliatePartner.findMany({
        where: { active: true },
        orderBy: [{ featured: "desc" }, { name: "asc" }],
        include: { _count: { select: { products: true } } },
      }),
      prisma.affiliateProduct.findMany({
        where: { active: true, partner: { active: true } },
        orderBy: [{ featured: "desc" }, { name: "asc" }],
        take: 200,
        include: { partner: { select: { name: true, slug: true, promoCode: true, affiliateUrl: true } } },
      }),
      prisma.setting.findUnique({ where: { key: "affiliateDisclosure" } }),
    ])
    return { partners, products, setting }
  },
  ["deals-data"],
  { revalidate: 300, tags: ["deals"] }
)

export default async function DealsPage() {
  const { partners, products, setting } = await getDealsData()
  const disclosure = setting?.value || DEFAULT_DISCLOSURE
  const featured = partners.filter((p) => p.featured)

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <span className="tt-eyebrow">Gear locker</span>
          <h1 className="font-display text-3xl sm:text-4xl font-bold mt-1.5 mb-2 flex items-center gap-3 tracking-tight">
            <Percent className="w-8 h-8 text-primary" /> TerpTalk Deals
          </h1>
          <p className="text-muted-foreground">Community-recommended grow gear and genetics — partner links support the site at no extra cost to you.</p>
        </div>

        {/* Featured partners */}
        {featured.map((p) => (
          <div key={p.id} className="tt-holo-border tt-spotlight bg-gradient-to-br from-primary/15 to-card border border-primary/30 rounded-xl p-6 mb-8">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex-1">
                <h2 className="font-display text-2xl font-bold tracking-tight">{p.name}</h2>
                <p className="text-muted-foreground text-sm mt-1">{p.description}</p>
                {p.promoText && (
                  <p className="text-sm mt-2 font-medium text-warning">🔥 {p.promoText}</p>
                )}
                {p.promoCode && (
                  <p className="mt-2 inline-flex items-center gap-1.5 bg-primary/20 text-primary font-bold px-3 py-1.5 rounded-lg text-sm">
                    <Tag className="w-4 h-4" /> Use code {p.promoCode} at checkout
                  </p>
                )}
              </div>
              <a
                href={`/go/${p.slug}?from=/deals`}
                rel="sponsored nofollow"
                className="tt-cta inline-flex items-center gap-2 px-6 py-3 rounded-full font-bold text-primary-foreground shrink-0 transition-all"
              >
                Shop {p.name} <ExternalLink className="w-4 h-4" />
              </a>
            </div>
            <p className="text-[11px] text-muted-foreground mt-4">{disclosure}</p>
          </div>
        ))}

        {/* All partners strip */}
        {partners.filter((p) => !p.featured).length > 0 && (
          <div className="flex flex-wrap gap-3 mb-8">
            {partners.filter((p) => !p.featured).map((p) => (
              <a key={p.id} href={`/go/${p.slug}?from=/deals`} rel="sponsored nofollow"
                className="bg-card/80 border border-border/70 rounded-2xl px-4 py-2 text-sm hover:border-primary/50 transition-colors">
                {p.name} {p.promoCode && <span className="text-primary font-semibold">· code {p.promoCode}</span>}
              </a>
            ))}
          </div>
        )}

        {/* Product browser (search + category filter, client-side) */}
        <DealsBrowser
          products={products.map((p) => ({
            slug: p.slug,
            name: p.name,
            description: p.description,
            category: p.category,
            section: (CLONE_SECTION_RE.test(p.category) ? "clones" : "equipment") as "clones" | "equipment",
            imageUrl: p.imageUrl,
            price: p.price,
            recommendedFor: p.recommendedFor,
            featured: p.featured,
            promoCode: p.promoCode || p.partner.promoCode,
            partnerName: p.partner.name,
          }))}
        />

        <p className="text-xs text-muted-foreground mt-8">{disclosure}</p>
      </div>
    </div>
  )
}
