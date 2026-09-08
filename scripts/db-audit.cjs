/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
(async () => {
  const [categories, chatRooms, badges, users, strains, admins, diaries, threads] = await Promise.all([
    p.category.count(), p.chatRoom.count(), p.badge.count(), p.user.count(),
    p.strain.count(), p.user.count({ where: { role: "ADMINISTRATOR" } }),
    p.growDiary.count(), p.thread.count(),
  ]);
  const catNames = await p.category.findMany({ select: { name: true } });
  console.log(JSON.stringify({ categories, chatRooms, badges, users, strains, admins, diaries, threads }));
  console.log("Categories:", catNames.map((c) => c.name).join(", "));
  await p.$disconnect();
})();
