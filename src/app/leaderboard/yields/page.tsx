import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"
import Link from "next/link"
import { Trophy, Leaf, TrendingUp } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { buildMetadata } from "@/lib/seo"

export const metadata = buildMetadata({
  title: "Strain Yield Leaderboard",
  description: "Community-reported harvest outcomes from TerpTalk grow diaries.",
  pathname: "/leaderboard/yields",
})

const TO_GRAMS: Record<string, number> = {
  g: 1,
  oz: 28.3495,
  lb: 453.592,
  kg: 1000,
}

function toGrams(amount: number, unit?: string | null) {
  return amount * (TO_GRAMS[unit?.toLowerCase() || "g"] ?? 1)
}

function toOz(grams: number) {
  return grams / TO_GRAMS.oz
}

export default async function YieldLeaderboardPage() {
  const diaries = await prisma.growDiary.findMany({
    where: {
      harvested: true,
      deleted: false,
      yieldAmount: { not: null },
      strain: { not: null },
    },
    include: { author: { select: publicUserSelect } },
    orderBy: { harvestedAt: "desc" },
  })

  type Diary = (typeof diaries)[number]

  const groups = new Map<
    string,
    { display: string; entries: Diary[]; grams: number[] }
  >()

  for (const d of diaries) {
    const display = d.strain!.trim()
    const key = display.toLowerCase()
    const existing = groups.get(key)
    const grams = toGrams(d.yieldAmount!, d.yieldUnit)
    if (existing) {
      existing.entries.push(d)
      existing.grams.push(grams)
    } else {
      groups.set(key, { display, entries: [d], grams: [grams] })
    }
  }

  const rows = Array.from(groups.values())
    .map((g) => {
      const avg = g.grams.reduce((a, b) => a + b, 0) / g.grams.length
      const topEntry = g.entries.reduce((best, cur) => {
        const curGrams = toGrams(cur.yieldAmount!, cur.yieldUnit)
        const bestGrams = toGrams(best.yieldAmount!, best.yieldUnit)
        return curGrams > bestGrams ? cur : best
      }, g.entries[0])
      return {
        strain: g.display,
        grows: g.grams.length,
        avgGrams: avg,
        avgOz: toOz(avg),
        topGrams: Math.max(...g.grams),
        topOz: toOz(Math.max(...g.grams)),
        topEntry,
      }
    })
    .sort((a, b) => b.avgGrams - a.avgGrams)
    .slice(0, 50)

  const totalHarvests = diaries.length
  const totalGrams = diaries.reduce(
    (sum, d) => sum + toGrams(d.yieldAmount!, d.yieldUnit),
    0
  )

  return (
    <div className="min-h-screen bg-background py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Trophy className="w-8 h-8 text-amber-500" />
            Strain Yield Leaderboard
          </h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Real harvest outcomes reported by the TerpTalk community. Average yields are converted to ounces for comparison.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-3xl font-bold text-primary">{totalHarvests}</div>
            <div className="text-sm text-muted-foreground">Community harvests</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-3xl font-bold text-primary">{rows.length}</div>
            <div className="text-sm text-muted-foreground">Strains represented</div>
          </div>
          <div className="bg-card border border-border rounded-xl p-4">
            <div className="text-3xl font-bold text-primary">{toOz(totalGrams).toFixed(1)} oz</div>
            <div className="text-sm text-muted-foreground">Total reported yield</div>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <Leaf className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <h2 className="text-lg font-semibold">No harvest records yet</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Once growers log harvests in their diaries, this leaderboard will fill in.
            </p>
            <Link
              href="/diaries"
              className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Browse diaries <TrendingUp className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row, i) => (
              <div
                key={row.strain}
                className="bg-card border border-border rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 hover:border-primary/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary font-bold shrink-0">
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{row.strain}</h3>
                    <p className="text-sm text-muted-foreground">{row.grows} grow{row.grows === 1 ? "" : "s"} reported</p>
                  </div>
                </div>
                <div className="flex-1" />
                <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-sm">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">{row.avgOz.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">avg oz</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold text-emerald-500">{row.topOz.toFixed(2)}</div>
                    <div className="text-xs text-muted-foreground">top oz</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Avatar
                      src={row.topEntry.author.image ?? undefined}
                      alt={row.topEntry.author.profile?.username ?? row.topEntry.author.name ?? undefined}
                      size="sm"
                    />
                    <span className="text-muted-foreground text-xs">
                      Best by{" "}
                      <Link
                        href={`/u/${row.topEntry.author.profile?.username || row.topEntry.author.name}`}
                        className="text-foreground hover:underline"
                      >
                        {row.topEntry.author.profile?.username || row.topEntry.author.name}
                      </Link>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
