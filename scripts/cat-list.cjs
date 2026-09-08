/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const cats = await p.category.findMany({
    select: { name: true, slug: true, description: true, _count: { select: { threads: true } } },
    orderBy: { name: "asc" },
  });
  cats.forEach((c) => console.log(`${c.name} | /${c.slug} | ${c._count.threads} threads | ${c.description || ""}`));
  await p.$disconnect();
})();
