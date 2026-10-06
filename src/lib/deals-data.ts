// /deals catalog load — uncached core (the page wraps this in
// unstable_cache; suites call it directly). Partner _count must reflect
// what visitors actually see: ACTIVE products only — the products query
// below carries the same `active` predicate plus the partner-active
// condition, so the header count can never exceed the listed cards.
import { prisma } from "@/lib/prisma"

export async function loadDealsData() {
  const [partners, products, setting] = await Promise.all([
    prisma.affiliatePartner.findMany({
      where: { active: true },
      orderBy: [{ featured: "desc" }, { name: "asc" }],
      include: { _count: { select: { products: { where: { active: true } } } } },
    }),
    prisma.affiliateProduct.findMany({
      where: { active: true, partner: { active: true } },
      orderBy: [{ featured: "desc" }, { name: "asc" }],
      take: 200,
      include: { partner: { select: { name: true, slug: true, promoCode: true, affiliateUrl: true, promoText: true } } },
    }),
    prisma.setting.findUnique({ where: { key: "affiliateDisclosure" } }),
  ])
  return { partners, products, setting }
}
