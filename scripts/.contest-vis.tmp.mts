import { prisma } from "../src/lib/prisma"
import { resolveMonthlyDiaryWinner } from "../src/lib/contest-awards"
const M = `cgate${Date.now().toString(36)}`
async function main() {
  const prevMonth = "1999-01"
  const mkUser = (tag: string) => prisma.user.create({ data: { name: `${M}${tag}`, password: "x", profile: { create: { username: `${M}${tag}` } } } })
  const [a, b, v1, v2] = await Promise.all([mkUser("a"), mkUser("b"), mkUser("v1"), mkUser("v2")])
  const mkDiary = (vis: string, uid: string) => prisma.growDiary.create({
    data: { title: `${M}-${vis}`, description: "t", growType: "INDOOR", startDate: new Date(), authorId: uid, visibility: vis },
  })
  const hidden = await mkDiary("PRIVATE", a.id)
  const open = await mkDiary("PUBLIC", b.id)
  const e1 = await prisma.diaryContestEntry.create({ data: { month: prevMonth, diaryId: hidden.id, userId: a.id } })
  const e2 = await prisma.diaryContestEntry.create({ data: { month: prevMonth, diaryId: open.id, userId: b.id } })
  // hidden entry gets 2 votes (v1, a) — public gets 1 (v2). Pre-fix hidden wins.
  await prisma.diaryContestVote.createMany({ data: [
    { entryId: e1.id, userId: v1.id, month: prevMonth }, { entryId: e1.id, userId: a.id, month: prevMonth },
    { entryId: e2.id, userId: v2.id, month: prevMonth },
  ] })
  const winner = await resolveMonthlyDiaryWinner(prevMonth)
  console.log("winner:", winner?.diary?.title, "| expected:", open.title)
  console.log(winner?.diaryId === open.id ? "PASS: hidden diary skipped despite more votes" : "FAIL: hidden diary won or none")
  const ids = [a.id, b.id, v1.id, v2.id]
  await prisma.diaryContestVote.deleteMany({ where: { entryId: { in: [e1.id, e2.id] } } })
  await prisma.diaryContestEntry.deleteMany({ where: { id: { in: [e1.id, e2.id] } } })
  await prisma.growDiary.deleteMany({ where: { id: { in: [hidden.id, open.id] } } })
  await prisma.profile.deleteMany({ where: { userId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
