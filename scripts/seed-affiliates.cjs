/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const partner = await p.affiliatePartner.upsert({
    where: { slug: "mars-hydro" },
    update: {
      affiliateUrl: "https://www.mars-hydro.com/?acc=f8ee3bdb4999cd30c1d8931585db1a7b",
      promoCode: "TCK",
      active: true,
      featured: true,
    },
    create: {
      name: "Mars Hydro",
      slug: "mars-hydro",
      websiteUrl: "https://www.mars-hydro.com",
      affiliateUrl: "https://www.mars-hydro.com/?acc=f8ee3bdb4999cd30c1d8931585db1a7b",
      promoCode: "TCK",
      description: "LED grow lights, grow tents, and complete grow kits — a community favorite for indoor setups.",
      promoText: null,
      active: true,
      featured: true,
    },
  });
  console.log("Partner:", partner.name, "| slug:", partner.slug, "| code:", partner.promoCode);
  await p.$disconnect();
})();
