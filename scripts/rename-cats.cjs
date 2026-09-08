/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  await p.category.updateMany({
    where: { slug: "grow-setup-showcases" },
    data: { name: "Smoke Reports & Strain Reviews", slug: "smoke-reports", description: "Post-harvest reviews — flavor, effects, and how the grow went" },
  });
  await p.category.updateMany({
    where: { slug: "grow-journals" },
    data: { name: "New Grower Questions", slug: "new-grower-questions", description: "Beginner help — no question is too basic" },
  });
  const cats = await p.category.findMany({ select: { name: true, slug: true }, orderBy: { name: "asc" } });
  console.log("Done:", cats.length, "categories");
  await p.$disconnect();
})();
