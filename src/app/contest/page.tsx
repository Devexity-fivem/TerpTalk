import { unstable_cache } from "next/cache"
import { previousWeekKey, previousMonthKey } from "@/lib/week"
import { Trophy, BookOpen } from "lucide-react"
import Link from "next/link"
import ContestBoard from "@/components/contest-board"
import DiaryContestBoard from "@/components/diary-contest-board"
import { resolveWeeklyWinner, resolveMonthlyDiaryWinner } from "@/lib/contest-awards"

import { buildMetadata } from "@/lib/seo"

export const dynamic = "force-dynamic"
export const metadata = buildMetadata({
  title: "Contests — Budshot of the Week & Diary of the Month",
  description: "Weekly photo contest plus a monthly grow-diary contest — the community votes, winners earn badges.",
  pathname: "/contest",
})

// Winner resolution + badge award live in lib/contest-awards so the cron
// can award badges even if nobody visits this page. Cached per period so
// the badge is not re-awarded on every page view.
const getLastWeekWinner = unstable_cache(
  async (week: string) => resolveWeeklyWinner(week),
  ["contest-last-winner"],
  { revalidate: 3600, tags: ["contest"] }
)

const getLastMonthDiaryWinner = unstable_cache(
  async (month: string) => resolveMonthlyDiaryWinner(month),
  ["diary-contest-last-winner"],
  { revalidate: 3600, tags: ["contest"] }
)

export default async function ContestPage() {
  const [lastWinner, lastDiaryWinner] = await Promise.all([
    getLastWeekWinner(previousWeekKey()),
    getLastMonthDiaryWinner(previousMonthKey()),
  ])

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
            <img src={lastWinner.imageUrl} alt="Last week's winner" loading="lazy" decoding="async" className="w-16 h-16 rounded-lg object-cover" />
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

        {/* Diary of the Month */}
        <div className="mt-10 mb-6">
          <h2 className="text-2xl font-bold mb-2 flex items-center gap-3">
            <BookOpen className="w-7 h-7 text-primary" /> Diary of the Month
          </h2>
          <p className="text-muted-foreground">
            Enter a well-documented grow diary — consistent updates and photos qualify. Most votes earns the <span className="text-amber-500 font-medium">Diary of the Month</span> badge.
          </p>
        </div>

        {lastDiaryWinner && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6 flex items-center gap-4">
            <BookOpen className="w-8 h-8 text-amber-500" />
            <div>
              <p className="text-xs text-amber-500 font-semibold uppercase tracking-wide">Last month&apos;s winner</p>
              <Link
                href={`/diaries/${lastDiaryWinner.diary.id}`}
                className="font-medium hover:text-primary"
              >
                {lastDiaryWinner.diary.title}
              </Link>
              <p className="text-xs text-muted-foreground">
                by {lastDiaryWinner.user.profile?.username || lastDiaryWinner.user.name} · {lastDiaryWinner._count.votes} votes
              </p>
            </div>
            <Trophy className="w-6 h-6 text-amber-500 ml-auto" />
          </div>
        )}

        <DiaryContestBoard />
      </div>
    </div>
  )
}
