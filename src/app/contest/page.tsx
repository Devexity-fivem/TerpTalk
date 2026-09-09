import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import { previousWeekKey } from "@/lib/week"
import { Trophy } from "lucide-react"
import Link from "next/link"
import ContestBoard from "@/components/contest-board"

export const revalidate = 60 // public content, edge-cached

export const metadata = {
  title: "Budshot of the Week",
  description: "Weekly photo contest — submit your best budshot, the community votes, winner gets the Weekly Winner badge.",
}

// Lazily award the previous week's winner badge (idempotent)
async function awardLastWeek() {
  const prev = previousWeekKey()
  const top = await prisma.contestEntry.findFirst({
    where: { week: prev },
    orderBy: { votes: { _count: "desc" } },
    include: { user: { select: publicUserSelect }, _count: { select: { votes: true } } },
  })
  if (!top || top._count.votes === 0) return null

  const badge = await prisma.badge.upsert({
    where: { name: "Weekly Winner" },
    update: {},
    create: {
      name: "Weekly Winner",
      description: "Won Budshot of the Week",
      icon: "https://cdn.jsdelivr.net/npm/twemoji@14.0.2/dist/svg/1f3c6.svg",
      requirement: "Win a weekly photo contest",
    },
  })
  const has = await prisma.userBadge.findUnique({
    where: { userId_badgeId: { userId: top.userId, badgeId: badge.id } },
  })
  if (!has) {
    await prisma.userBadge.create({ data: { userId: top.userId, badgeId: badge.id } }).catch(() => {})
    await prisma.notification.create({
      data: {
        userId: top.userId,
        type: "BADGE",
        title: "🏆 You won Budshot of the Week!",
        content: "Your photo took the top spot. Check your new badge.",
        link: "/contest",
      },
    }).catch(() => {})
  }
  return top
}

export default async function ContestPage() {
  const lastWinner = await awardLastWeek()

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
            <Trophy className="w-8 h-8 text-amber-500" /> Budshot of the Week
          </h1>
          <p className="text-muted-foreground">
            Submit your best budshot each week. The community votes — most votes earns the <span className="text-amber-500 font-medium">Weekly Winner</span> badge.
          </p>
        </div>

        {lastWinner && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6 flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={lastWinner.imageUrl} alt="Last week's winner" className="w-16 h-16 rounded-lg object-cover" />
            <div>
              <p className="text-xs text-amber-500 font-semibold uppercase tracking-wide">Last week&apos;s winner</p>
              <Link
                href={`/u/${lastWinner.user.profile?.username || lastWinner.user.name}`}
                className="font-medium hover:text-primary"
              >
                {lastWinner.user.profile?.username || lastWinner.user.name}
              </Link>
              <p className="text-xs text-muted-foreground">{lastWinner._count.votes} votes</p>
            </div>
            <Trophy className="w-6 h-6 text-amber-500 ml-auto" />
          </div>
        )}

        <ContestBoard />
      </div>
    </div>
  )
}
