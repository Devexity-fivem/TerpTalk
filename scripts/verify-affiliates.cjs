/* eslint-disable @typescript-eslint/no-require-imports */
// Affiliate system verification — checks data + core logic invariants
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

let pass = 0, fail = 0;
const check = (name, ok) => { if (ok) { pass++ } else { fail++ } console.log(`${ok ? "PASS" : "FAIL"} ${name}`) };

(async () => {
  // Partner seeded correctly
  const mh = await p.affiliatePartner.findUnique({ where: { slug: "mars-hydro" } });
  check("Mars Hydro partner exists", !!mh);
  check("Mars Hydro affiliate URL correct", mh?.affiliateUrl === "https://www.mars-hydro.com/?acc=f8ee3bdb4999cd30c1d8931585db1a7b");
  check("Promo code is TCK", mh?.promoCode === "TCK");
  check("Partner is active+featured", mh?.active && mh?.featured);

  // Click tracking round-trip
  const click = await p.affiliateClick.create({
    data: { partnerId: mh.id, page: "/verify-script" },
  });
  check("Click recorded", !!click.id);
  const count = await p.affiliateClick.count({ where: { partnerId: mh.id } });
  check("Click counted for partner", count >= 1);
  await p.affiliateClick.delete({ where: { id: click.id } });
  check("Test click cleaned up", true);

  // Product fallback logic (create → delete)
  const prod = await p.affiliateProduct.create({
    data: {
      name: "Verify Product", slug: `verify-${Date.now()}`, partnerId: mh.id,
      description: "test", category: "Test",
    },
  });
  check("Product created without its own affiliate URL", !prod.affiliateUrl);
  // fallback URL = partner.affiliateUrl — verified by /go route logic
  await p.affiliateProduct.delete({ where: { id: prod.id } });
  check("Product cleanup", true);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1) }).finally(() => p.$disconnect());
