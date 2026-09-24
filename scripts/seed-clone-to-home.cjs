/* eslint-disable @typescript-eslint/no-require-imports */
// Seeds Clone to Home partner + clone catalogue (real catalog data pulled from
// clonetohome.com/products.json). Re-runnable via slug upsert. Sold-out strains
// are created inactive so the operator can flip them on when they restock —
// upsert never touches `active` on update.
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

const PRODUCTS = [
  {
    name: "Super Boof Clone", slug: "cth-super-boof",
    category: "Clones", price: "$89", featured: true,
    productUrl: "https://clonetohome.com/products/super-boof",
    description: "Tropicana Cookies x Black Cherry Punch — high-yielding clone with balanced structure and heavy cola development. Tangy citrus layered with sweet cherry; fills canopy space efficiently.",
    recommendedFor: "Growers wanting a vigorous, reliable hybrid",
    pros: "High yield potential\nBalanced, easy-to-manage structure\nProven community favorite",
    cons: "Needs canopy management for best cola development",
  },
  {
    name: "Super Berry Clone", slug: "cth-super-berry",
    category: "Clones", price: "$125", featured: true,
    productUrl: "https://clonetohome.com/products/super-berry-cultivation-ready-clone",
    description: "Black Cherry Punch x Super Boof — resin-rich clone with candy-coated blueberry and floral notes. Dense flowers, exceptional trichome coverage.",
    recommendedFor: "Growers chasing terpene expression and bag appeal",
    pros: "Standout terpene profile\nExceptional trichome coverage\nBeginner-friendly",
    cons: "Medium yield — quality over quantity",
  },
  {
    name: "Gorilla Glue #4 Clone", slug: "cth-gorilla-glue-4",
    category: "Clones", price: "$89", featured: true,
    productUrl: "https://clonetohome.com/products/zuyaqui-clone-rooted-cultivation-ready-cannabis-clone-copy",
    description: "Joesy Whales cut — Chem's Sister x Sour Dubb x Chocolate Diesel. Resin-heavy legend with earthy pine, diesel, and subtle chocolate. Dense, sticky flowers that live up to the name.",
    recommendedFor: "Yield, potency, and resin output",
    pros: "Aggressive vigor\nExceptional trichome production\nProven legacy cut",
    cons: "Very sticky trim sessions",
  },
  {
    name: "Gelato #41 BX Clone", slug: "cth-gelato-41-bx",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/gorilla-glue-4-clone-rooted-cultivation-ready-cannabis-clone-copy",
    description: "Backcross of Gelato 41 — dessert-forward cultivar with sweet cream, citrus, and earthy gas. Dense, resin-coated buds, ~8-9 week flower.",
    recommendedFor: "Top-shelf quality and modern terpene expression",
    pros: "Dense resin-coated buds\nStrong lateral branching\nDependable structure",
    cons: "Not the cheapest cut in the lineup",
  },
  {
    name: "Super Lemon Haze Clone", slug: "cth-super-lemon-haze",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/gelato-41-bx-clone-rooted-cultivation-ready-cannabis-clone-copy",
    description: "Lemon Skunk x Super Silver Haze — vigorous sativa-dominant cultivar with classic citrus-haze expression. Bright lemon over sweet citrus and earth; ~10 week flower.",
    recommendedFor: "Growers with vertical space wanting uplifting haze",
    pros: "Responds well to training\nClassic proven genetics\nDistinctive lemon terps",
    cons: "Longer flower time\nTaller than most hybrids",
  },
  {
    name: "Black Maple Clone", slug: "cth-black-maple",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/black-maple-cultivation-ready-clone",
    description: "Big, vigorous, and very forgiving — selected for healthy structure, strong vigor, and consistent flowering performance.",
    recommendedFor: "Beginners — one of the most forgiving cuts",
    pros: "Very forgiving of mistakes\nVigorous growth",
    cons: "Can outgrow small tents",
  },
  {
    name: "Sour Sox Clone", slug: "cth-sour-sox",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/sour-sox",
    description: "Sour Garlic Cookies x Dulce de Uva — pungent sour garlic layered with fermented grape. Strong lateral growth; stretches during transition.",
    recommendedFor: "Growers who want bold, unusual terps",
    pros: "Unique sour-garlic profile\nStrong lateral branching",
    cons: "Stretches — plan headroom",
  },
  {
    name: "Gelonade Clone", slug: "cth-gelonade",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/gelonade",
    description: "Lemon Tree x Gelato 41 — citrus-forward with bold lemon aroma and golf-ball style buds under good canopy management.",
    recommendedFor: "Citrus lovers, managed canopies",
    pros: "Bold citrus terps\nStrong structural stretch",
    cons: "Benefits from canopy management",
  },
  {
    name: "Platinum Fanta Clone", slug: "cth-platinum-fanta",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/platinum-fanta",
    description: "Purple x Platinum Kush Breath — sweet orange-soda terpene notes, balanced structure, strong vegetative development and high-yield potential.",
    recommendedFor: "Beginner-friendly structure with great flavor",
    pros: "High-yield potential\nBeginner-friendly\nGreat structure",
    cons: "Lesser-known cut",
  },
  {
    name: "Grape Gas Clone", slug: "cth-grape-gas",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/grape-gas",
    description: "Grape Pie x Jet Fuel Gelato — sweet grape character with diesel undertones. Well-rounded and reliable across indoor, greenhouse, and outdoor.",
    recommendedFor: "Balanced, easy-to-manage grows",
    pros: "Performs in multiple environments\nHigh yield potential",
    cons: "Common profile — less exotic than the hazes",
  },
  {
    name: "Honey Banana Clone", slug: "cth-honey-banana",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/honey-banana",
    description: "Honey Boo Boo x Strawberry Banana — sweet overripe banana layered with berry and subtle gas. Dense, resin-rich colas.",
    recommendedFor: "Vigorous but beginner-compatible",
    pros: "Strong vigor\nStacked flower development",
    cons: "Dense colas need airflow",
  },
  {
    name: "Cereal Tree Clone", slug: "cth-cereal-tree",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/cereal-tree",
    description: "Cereal Milk x Apples and Bananas — stable structure with sweet, creamy cereal-milk terpenes. Consistent across indoor, greenhouse, and outdoor.",
    recommendedFor: "A fun, flavorful, forgiving grow",
    pros: "Stable structure\nCrowd-pleasing flavor",
    cons: "Modest stretch",
  },
  {
    name: "Purp Burst Clone", slug: "cth-purp-burst",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/purp-burst",
    description: "Terple x Platinum Kush Breath — high-yielding with vibrant purple flower development. Dense purple colas, bright candy-grape aroma.",
    recommendedFor: "Easy grow with bonus color potential",
    pros: "Purple bag appeal\nHigh yield\nEasy grow",
    cons: "Color depends on temps",
  },
  {
    name: "Tear Gas Clone", slug: "cth-tear-gas",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/watermelon-rush-clone-rooted-cultivation-ready-cannabis-clone-copy-1",
    description: "Sherb Cake x Skunkpiss — fuel-dominant with musky gas, pine, and chemical undertones. Dense structure and heavy terpene expression.",
    recommendedFor: "Classic gas profile hunters",
    pros: "Sharp fuel-forward profile\nDense stacking",
    cons: "Pungent — carbon filter recommended",
  },
  {
    name: "Zuyaqui Clone", slug: "cth-zuyaqui",
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/zuyaqui-clone-rooted-cultivation-ready-cannabis-clone",
    description: "Dog Walker OG x Horchata — layered gas with creamy undertones and earthy herbal pine. Open structure stacks dense while keeping airflow.",
    recommendedFor: "Growers wanting terpene complexity",
    pros: "Fuel + cream complexity\nGood airflow structure",
    cons: "Lesser-known lineage",
  },
  {
    name: "Le Pew Clone", slug: "cth-le-pew",
    category: "Clones", price: "$125",
    productUrl: "https://clonetohome.com/products/le-pew-cultivation-ready-clone",
    description: "Skunk #1 x Skunk #1 — classic structure and dependable high yields. Compact, bushy plants with musky pine and citrus; responds well to training.",
    recommendedFor: "Old-school skunk fans, high-yield runs",
    pros: "Dependable high yields\nResponds well to training\nCompact bushy structure",
    cons: "Premium price tier",
  },
  {
    name: "Watermelon Rush Clone", slug: "cth-watermelon-rush", soldOut: true,
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/watermelon-rush-clone-rooted-cultivation-ready-cannabis-clone-copy",
    description: "Watermelon Zkittles x Tropical Zkittles — fast-finishing, terp-forward with sweet watermelon candy aromatics. Currently sold out.",
    recommendedFor: "Flavor-focused growers",
    pros: "Fast finish\nSweet candy terps",
    cons: "Currently sold out",
  },
  {
    name: "Mendo Grapes Clone", slug: "cth-mendo-grapes", soldOut: true,
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/mendo-grapes",
    description: "Cultivation-ready clone selected for healthy structure, strong vigor, and consistent flowering performance. Currently sold out.",
    recommendedFor: "Check back on restock",
    pros: "Healthy structure\nStrong vigor",
    cons: "Currently sold out",
  },
  {
    name: "Cheese Clone", slug: "cth-cheese", soldOut: true,
    category: "Clones", price: "$89",
    productUrl: "https://clonetohome.com/products/cheese",
    description: "Classic Cheese cut — cultivation-ready clone selected for healthy structure, strong vigor, and consistent flowering. Currently sold out.",
    recommendedFor: "Check back on restock",
    pros: "Classic legacy profile",
    cons: "Currently sold out",
  },
];

(async () => {
  await import("./db-guard.mjs") // refuse production endpoints unless explicitly allowed
  const partner = await p.affiliatePartner.upsert({
    where: { slug: "clone-to-home" },
    update: {
      affiliateUrl: "https://clonetohome.com/collections/clones",
      promoCode: "TCK",
      active: true,
      featured: true,
      promoText: "Free shipping on every order · volume pricing down to $57.50/clone · return your clone box for 10% off",
    },
    create: {
      name: "Clone to Home",
      slug: "clone-to-home",
      websiteUrl: "https://clonetohome.com",
      affiliateUrl: "https://clonetohome.com/collections/clones",
      promoCode: "TCK",
      description: "Rooted, cultivation-ready cannabis clones shipped to your door — Farm Bill compliant live plants for adults 21+, free shipping to all 50 states.",
      promoText: "Free shipping on every order · volume pricing down to $57.50/clone · return your clone box for 10% off",
      active: true,
      featured: true,
    },
  });
  console.log("Partner:", partner.name, "| slug:", partner.slug, "| code:", partner.promoCode);

  let inactive = 0;
  for (const { soldOut, ...prod } of PRODUCTS) {
    await p.affiliateProduct.upsert({
      where: { slug: prod.slug },
      update: { ...prod, partnerId: partner.id }, // never flips active back on
      create: { ...prod, partnerId: partner.id, active: !soldOut },
    });
    if (soldOut) inactive++;
    console.log((soldOut ? "· (inactive)" : "✓"), prod.name);
  }
  const count = await p.affiliateProduct.count({ where: { partnerId: partner.id, active: true } });
  console.log(`\nDone — ${count} active Clone to Home products on /deals (${inactive} held inactive as sold out)`);
  await p.$disconnect();
})();
