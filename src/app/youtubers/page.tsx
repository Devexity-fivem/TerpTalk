import { prisma } from "@/lib/prisma"
import Link from "next/link"
import { Video } from "@/lib/icons"
import { Avatar } from "@/components/ui/avatar"
import PageHeader from "@/components/ui/page-header"
import EmptyState from "@/components/ui/empty-state"
import Surface from "@/components/ui/surface"
import { buildMetadata } from "@/lib/seo"
import { activeAuthor } from "@/lib/security"

export const revalidate = 60

export const metadata = buildMetadata({
  title: "Featured YouTubers",
  description: "Cannabis growing creators featured on TerpTalk.",
  pathname: "/youtubers",
})

export default async function YoutubersPage() {
  const badge = await prisma.badge.findUnique({
    where: { name: "Verified YouTuber" },
    select: { id: true },
  })

  // The member query only runs when the badge exists — identical to the
  // previous early-return behavior.
  const users = badge
    ? await prisma.user.findMany({
        where: {
          ...activeAuthor(),
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
    : []

  const verifiedUsers = users.filter((u) => u.profile?.youtubeChannelUrl)

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <PageHeader
          context={<span className="tt-eyebrow">Creators</span>}
          title={
            <span className="flex items-center gap-3">
              <Video className="w-7 h-7 text-primary" /> Featured YouTubers
            </span>
          }
          description="Cannabis grow content creators verified by the TerpTalk team."
          actions={
            <Link
              href="/youtubers/apply"
              className="tt-cta inline-flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-semibold hover:bg-primary/90 transition-all"
            >
              <Video className="w-4 h-4" />
              Apply to be featured
            </Link>
          }
        />

        {verifiedUsers.length === 0 ? (
          <EmptyState
            icon={Video}
            title="No featured YouTubers yet"
            description="Be the first to apply and get your channel showcased."
            action={{ label: "Apply now", href: "/youtubers/apply" }}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {verifiedUsers.map((user) => (
              <Surface key={user.id} edge spotlight padding="md" className="flex flex-col">
                <div className="flex items-center gap-3 mb-3">
                  {user.profile?.avatarUrl ? (
                    <Avatar src={user.profile.avatarUrl} alt={user.profile.username || undefined} size="lg" className="w-12 h-12" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <Video className="w-6 h-6 text-primary" />
                    </div>
                  )}
                  <div>
                    <p className="font-display font-semibold">{user.profile?.username}</p>
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
                  className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline mt-auto"
                >
                  Visit channel
                </a>
              </Surface>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
