/* eslint-disable @typescript-eslint/no-require-imports */
// Seeds Mars Hydro products (real catalog data). Re-runnable via slug upsert.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const PRODUCTS = [
  {
    name: "Mars Hydro TS1000 (150W)", slug: "mars-hydro-ts1000",
    category: "Grow Lights", price: "$87.99", featured: true,
    productUrl: "https://www.mars-hydro.com/ts-1000-led-grow-light",
    imageUrl: "https://www.mars-hydro.com/media/catalog/product/cache/14b21078391bf63571b1ddcbbe3983ac/a/_/a.jpg",
    description: "The beginner classic — 150W full-spectrum LED covering 2-4 plants in a 2.5x2.5ft flower space. Dimmable, daisy-chainable.",
    recommendedFor: "First-time growers, 2x2 - 2.5x2.5ft tents",
    pros: "Great entry price\nDimmable for seedlings through flower\n2.3 umol/j efficiency",
    cons: "Limited footprint for bigger tents\nSmart control needs add-on module",
  },
  {
    name: "Mars Hydro TSW2000 (300W)", slug: "mars-hydro-tsw2000",
    category: "Grow Lights", price: "$159.99", featured: true,
    productUrl: "https://www.mars-hydro.com/tsw-2000-led-grow-light",
    imageUrl: "https://www.mars-hydro.com/media/catalog/product/cache/14b21078391bf63571b1ddcbbe3983ac/a/_/a_tsw2000_1.jpg",
    description: "Best-selling home-use light. 300W, covers 4x4ft veg / 3x3ft flower, 2.6 umol/j — replaces a 400W HPS while saving ~25% power.",
    recommendedFor: "3x3 to 4x4ft tents, 4-8 plants",
    pros: "Proven yield bump vs HPS\nDaisy-chain dimming\n2.6 umol/j efficiency",
    cons: "Bigger footprint than TS series",
  },
  {
    name: "Mars Hydro FC-E3000 (300W)", slug: "mars-hydro-fc-e3000",
    category: "Grow Lights", price: "$170.99", featured: false,
    productUrl: "https://www.mars-hydro.com/dimmable-fc-e3000-led-grow-light",
    imageUrl: "https://www.mars-hydro.com/media/catalog/product/cache/14b21078391bf63571b1ddcbbe3983ac/m/a/mars_hydro_fc-e3000_led_grow_light.jpg",
    description: "Bar-style 300W with Bridgelux LEDs + OSRAM deep red for stronger flowering. 2.8 umol/j, daisy-chains up to 80 units.",
    recommendedFor: "3x3ft tents, growers upgrading from blurple",
    pros: "OSRAM red boost for flower\nUniform bar-style spread\nScales to commercial",
    cons: "Bar lights weigh more than quantum boards",
  },
  {
    name: "Mars Hydro TS600 (100W)", slug: "mars-hydro-ts600",
    category: "Grow Lights", price: "$63.99",
    productUrl: "https://www.mars-hydro.com/all-products/ts-600-led-grow-light",
    description: "Budget 100W full-spectrum light for seedlings, clones, and single-plant grows. RJ12 smart-control ready.",
    recommendedFor: "Clones, seedlings, micro grows",
    pros: "Cheapest way into quality LED\nLow power draw",
    cons: "Too small for flowering multiple plants",
  },
  {
    name: "FC1500 EVO + 2.3x2.3ft Tent Kit", slug: "mars-hydro-fc1500-tent-kit",
    category: "Grow Tent Kits", price: "$339.99", featured: true,
    productUrl: "https://www.mars-hydro.com/fc-1500-evo-complete-ifresh-grow-tent-kits",
    imageUrl: "https://www.mars-hydro.com/media/catalog/product/cache/14b21078391bf63571b1ddcbbe3983ac/f/c/fc-1500set.jpg",
    description: "Complete starter kit: FC1500 LED (Samsung LM301H EVO, 2.85 umol/j), 1680D tent, 4in fan + carbon filter, bags, trellis, tools. Fits 1-2 plants.",
    recommendedFor: "Complete beginners wanting everything in one box",
    pros: "Everything included — light, tent, ventilation, tools\nPremium EVO diodes\n1680D tent fabric",
    cons: "1-2 plant capacity",
  },
  {
    name: "TS1000 + 2.6x2.6ft Tent Kit", slug: "mars-hydro-ts1000-tent-kit",
    category: "Grow Tent Kits", price: "$289.99",
    productUrl: "https://www.mars-hydro.com/ts-1000-led-grow-light",
    description: "Starter bundle pairing the beginner-favorite TS1000 with a 32x32x63in grow tent. Simple path to a first harvest.",
    recommendedFor: "First grow on a budget",
    pros: "Lowest-cost complete setup\nTent matched to light footprint",
    cons: "Ventilation sold separately",
  },
  {
    name: "FC-E3000 + 3.3x3.3ft Tent Kit", slug: "mars-hydro-fc-e3000-tent-kit",
    category: "Grow Tent Kits", price: "$389.99", featured: true,
    productUrl: "https://www.mars-hydro.com/fc-e3000-3x3-ifresh-grow-tent-kits",
    imageUrl: "https://www.mars-hydro.com/media/catalog/product/cache/14b21078391bf63571b1ddcbbe3983ac/f/c/fc-e3000_100x100x180_ifresh4kits_.jpg",
    description: "The complete smart grow: FC-E3000 light, 3.3x3.3x6ft tent, 4in fan + filter, iControl smart controller with temp/RH sensor, all accessories.",
    recommendedFor: "Growers wanting app-controlled climate",
    pros: "iControl smart controller included\n2-4 plant capacity\nFull accessory pack",
    cons: "Higher upfront cost",
  },
  {
    name: "TSW2000 + 4x4ft Tent Kit", slug: "mars-hydro-tsw2000-tent-kit",
    category: "Grow Tent Kits", price: "$503.99",
    productUrl: "https://www.mars-hydro.com/tsw-2000-led-grow-light",
    description: "Roomy 4x4ft (48x48x80in) complete kit around the TSW2000 — space for a serious multi-plant home grow.",
    recommendedFor: "Home growers scaling up to 4x4",
    pros: "Big grow space for the price\nProven light + tent pairing",
    cons: "Needs real floor space",
  },
  {
    name: "iFresh 4in Fan + Carbon Filter Kit", slug: "mars-hydro-ifresh-4-inch",
    category: "Fans & Ventilation", price: "$109.99",
    productUrl: "https://www.mars-hydro.com/mh-4-inch-smart-inline-fan-carbon-filter-kits",
    imageUrl: "https://www.mars-hydro.com/media/catalog/product/cache/14b21078391bf63571b1ddcbbe3983ac/1/-/1-4-mars-fan-2025-ifresh-fan-combo-04.jpg",
    description: "Quiet EC-motor 4in inline fan (205 CFM, ~26dBA) with refillable carbon filter and speed controller. Optional app control add-on.",
    recommendedFor: "2x2 to 3x3ft tents",
    pros: "Near-silent operation\nRefillable filter saves money\nSmart control upgradeable",
    cons: "App features need the Pro add-on",
  },
  {
    name: "iFresh 6in Fan + Carbon Filter Kit", slug: "mars-hydro-ifresh-6-inch",
    category: "Fans & Ventilation", price: "$179.99",
    productUrl: "https://www.mars-hydro.com/6-inch-smart-inline-fan-carbon-filter-kits",
    imageUrl: "https://www.mars-hydro.com/media/catalog/product/cache/14b21078391bf63571b1ddcbbe3983ac/1/-/1-6-mars-fan-2025-ifresh-fan-combo-06.jpg",
    description: "The bigger brother — 6in EC fan pushing 402 CFM with iControl smart controller. For larger tents and hotter lights.",
    recommendedFor: "4x4ft tents and up",
    pros: "402 CFM moves serious air\nEC motor = efficient + quiet\nSmart controller included",
    cons: "Overkill for small tents",
  },
];

(async () => {
  const partner = await p.affiliatePartner.findUnique({ where: { slug: "mars-hydro" } });
  if (!partner) { console.error("Mars Hydro partner missing — run seed-affiliates.cjs first"); process.exit(1); }

  for (const prod of PRODUCTS) {
    await p.affiliateProduct.upsert({
      where: { slug: prod.slug },
      update: { ...prod, partnerId: partner.id },
      create: { ...prod, partnerId: partner.id, active: true },
    });
    console.log("✓", prod.name);
  }
  const count = await p.affiliateProduct.count({ where: { partnerId: partner.id } });
  console.log(`\nDone — ${count} Mars Hydro products live on /deals`);
  await p.$disconnect();
})();
