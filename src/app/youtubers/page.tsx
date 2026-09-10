import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { Video } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"

export const revalidate = 60

export default async function YoutubersPage() {
  const badge = await prisma.badge.findUnique({
    where: { name: "Verified YouTuber" },
    select: { id: true },
  })

  if (!badge) {
    return (
      <div className="min-h-screen py-8 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl font-bold">Featured YouTubers</h1>
              <p className="text-muted-foreground mt-1">
                Cannabis grow content creators verified by the TerpTalk team.
              </p>
            </div>
            <Link
              href="/youtubers/apply"
              className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              <Video className="w-4 h-4" />
              Apply to be featured
            </Link>
          </div>
          <div className="text-center py-16 border border-dashed border-border rounded-lg">
            <Video className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-medium">No featured YouTubers yet</h2>
            <p className="text-muted-foreground mt-2">
              Be the first to apply and get your channel showcased.
            </p>
            <Link href="/youtubers/apply" className="inline-block mt-4 text-primary hover:underline">
              Apply now
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const users = await prisma.user.findMany({
    where: {
      badges: { some: { badgeId: badge.id } },
      profile: { youtubeChannelUrl: { not: null } },
    },
    include: {
      profile: {
        select: {
          username: true,
          avatarUrl: true,
          youtubeChannelUrl: true,
          bio: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  })

  const verifiedUsers = users.filter((u) => u.profile?.youtubeChannelUrl)

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold">Featured YouTubers</h1>
            <p className="text-muted-foreground mt-1">
              Cannabis grow content creators verified by the TerpTalk team.
            </p>
          </div>
          <Link
            href="/youtubers/apply"
            className="inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            <Video className="w-4 h-4" />
            Apply to be featured
          </Link>
        </div>

        {verifiedUsers.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-lg">
            <Video className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-medium">No featured YouTubers yet</h2>
            <p className="text-muted-foreground mt-2">
              Be the first to apply and get your channel showcased.
            </p>
            <Link href="/youtubers/apply" className="inline-block mt-4 text-primary hover:underline">
              Apply now
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {verifiedUsers.map((user) => (
              <div
                key={user.id}
                className="border border-border rounded-lg p-4 bg-card hover:bg-secondary/50 transition-colors"
              >
                <div className="flex items-center gap-3 mb-3">
                  {user.profile?.avatarUrl ? (
                    <Avatar src={user.profile.avatarUrl} alt={user.profile.username || undefined} size="lg" className="w-12 h-12" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Video className="w-6 h-6 text-primary" />
                    </div>
                  )}
                  <div>
                    <p className="font-semibold">{user.profile?.username}</p>
                    <p className="text-xs text-muted-foreground">Verified YouTuber</p>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                  {user.profile?.bio || "Growing and sharing cannabis content on YouTube."}
                </p>

                <a
                  href={user.profile?.youtubeChannelUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                >
                  Visit channel
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
