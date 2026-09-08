import { prisma } from "@/lib/prisma"
import { Trophy, Medal, Award } from "lucide-react"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Leaderboard",
  description: "Top contributors in the TerpTalk cannabis growing community.",
}

export default async function LeaderboardPage() {
  const topUsers = await prisma.profile.findMany({
    where: { user: { banned: false } },
    orderBy: { reputation: "desc" },
    take: 25,
    select: {
      username: true,
      avatarUrl: true,
      reputation: true,
      user: {
        select: {
          id: true,
          name: true,
          role: true,
          createdAt: true,
          _count: {
            select: { threadCreator: true, posts: true, diaryCreator: true, followers: true },
          },
        },
      },
    },
  })

  const medal = (i: number) =>
    i === 0 ? <Trophy className="w-5 h-5 text-amber-400" /> :
    i === 1 ? <Medal className="w-5 h-5 text-gray-300" /> :
    i === 2 ? <Medal className="w-5 h-5 text-amber-700" /> :
    <span className="w-5 text-center text-sm text-muted-foreground">{i + 1}</span>

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-8 text-center">
          <Award className="w-12 h-12 text-primary mx-auto mb-3" />
          <h1 className="text-3xl font-bold mb-2">Top Growers</h1>
          <p className="text-muted-foreground">
            Earn reputation by posting, journaling, adding strains, and helping the community.
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border overflow-hidden">
          <div className="divide-y divide-border">
            {topUsers.length === 0 && (
              <p className="p-8 text-center text-muted-foreground">No members yet.</p>
            )}
            {topUsers.map((p, i) => (
              <Link
                key={p.user.id}
                href={`/u/${p.username || p.user.name}`}
                className="flex items-center gap-4 p-4 hover:bg-secondary/50 transition-colors"
              >
                <div className="w-8 flex justify-center shrink-0">{medal(i)}</div>
                <div className="w-10 h-10 rounded-full bg-primary/10 overflow-hidden flex items-center justify-center shrink-0">
                  {p.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-primary font-bold">
                      {(p.username || p.user.name || "?")[0].toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate flex items-center">
                    {p.username || p.user.name}
                    <RoleBadge role={p.user.role} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {p.user._count.threadCreator} threads · {p.user._count.posts} posts · {p.user._count.diaryCreator} diaries · {p.user._count.followers} followers
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-bold text-primary">{p.reputation}</div>
                  <div className="text-xs text-muted-foreground">rep</div>
                </div>
              </Link>
            ))}
          </div>
        </div>

        <p className="text-center text-sm text-muted-foreground mt-6">
          Check the <Link href="/about" className="text-primary hover:underline">About page</Link> to see how reputation and badges work.
        </p>
      </div>
    </div>
  )
}
