"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useParams } from "next/navigation"
import { User, MessageSquare, Loader2, MapPin, Globe, Sprout, Dna, Leaf, Store, Award } from "lucide-react"
import Link from "next/link"
import UserActions from "@/components/user-actions"
import RoleBadge from "@/components/role-badge"

interface PublicProfile {
  id: string
  role: string
  username: string
  bio: string | null
  location: string | null
  website: string | null
  avatarUrl: string | null
  growExperience: string | null
  favoriteStrain: string | null
  growSpace: string | null
  businessName: string | null
  businessType: string | null
  businessUrl: string | null
  image: string | null
  joinDate: string
  reputation: number
  trustLevel: string
  badges: Array<{ name: string; description: string; icon: string | null }>
  stats: {
    threadCreator: number
    posts: number
    diaryCreator: number
    followers: number
    following: number
  }
}

interface Thread {
  id: string
  title: string
  slug: string
  createdAt: string
  category: { name: string }
  replyCount: number
}

export default function PublicProfilePage() {
  const params = useParams()
  const { data: session } = useSession()
  const username = decodeURIComponent(String(params.username))
  const [data, setData] = useState<{ profile: PublicProfile; viewerBlocked: boolean; viewerFollowing: boolean; recentThreads: Thread[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    fetch(`/api/users/${encodeURIComponent(username)}`)
      .then(async (res) => {
        if (!res.ok) { setNotFound(true); setLoading(false); return }
        const d = await res.json()
        setData(d)
        setLoading(false)
      })
      .catch(() => { setNotFound(true); setLoading(false) })
  }, [username])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">User not found</h1>
          <p className="text-muted-foreground">This profile doesn&apos;t exist or isn&apos;t available.</p>
        </div>
      </div>
    )
  }

  const { profile, viewerBlocked, viewerFollowing, recentThreads } = data
  const joinDate = new Date(profile.joinDate).toLocaleDateString("en-US", { year: "numeric", month: "long" })

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-card rounded-lg border border-border p-6 mb-6">
          <div className="flex items-start gap-6 flex-wrap">
            <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
              {profile.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <User className="w-12 h-12 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h1 className="text-2xl font-bold mb-1 break-words flex items-center gap-2">@{profile.username} <RoleBadge role={profile.role} /></h1>
                  <p className="text-muted-foreground text-sm mb-2 flex items-center gap-2">
                    <span>Member since {joinDate}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                      <Award className="w-3 h-3" />{profile.trustLevel}
                    </span>
                  </p>
                  {profile.bio && <p className="text-sm mb-3 break-words whitespace-pre-wrap">{profile.bio}</p>}
                  <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                    {profile.location && (
                      <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{profile.location}</span>
                    )}
                    {profile.website && (
                      <a href={profile.website} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 text-primary hover:underline">
                        <Globe className="w-3.5 h-3.5" />{profile.website.replace(/^https?:\/\//, "").slice(0, 40)}
                      </a>
                    )}
                    {profile.growExperience && (
                      <span className="flex items-center gap-1"><Sprout className="w-3.5 h-3.5" />{profile.growExperience}</span>
                    )}
                    {profile.favoriteStrain && (
                      <span className="flex items-center gap-1"><Dna className="w-3.5 h-3.5" />{profile.favoriteStrain}</span>
                    )}
                    {profile.growSpace && (
                      <span className="flex items-center gap-1"><Leaf className="w-3.5 h-3.5" />{profile.growSpace}</span>
                    )}
                  </div>
                </div>
                {session && session.user?.id !== profile.id && (
                  <UserActions userId={profile.id} username={profile.username} initiallyBlocked={viewerBlocked} initiallyFollowing={viewerFollowing} />
                )}
                {profile.businessName && (
                  <div className="mt-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Store className="w-4 h-4 text-primary" />
                      <span>{profile.businessName}</span>
                      {profile.businessType && <span className="text-xs text-muted-foreground">({profile.businessType})</span>}
                    </div>
                    {profile.businessUrl && (
                      <a href={profile.businessUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-primary hover:underline">
                        {profile.businessUrl.replace(/^https?:\/\//, "").slice(0, 40)}
                      </a>
                    )}
                  </div>
                )}
              </div>
              <div className="flex gap-6 mt-4">
                <div className="text-center">
                  <div className="text-xl font-bold text-primary">{profile.reputation}</div>
                  <div className="text-xs text-muted-foreground">Reputation</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-primary">{profile.stats.threadCreator}</div>
                  <div className="text-xs text-muted-foreground">Threads</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-primary">{profile.stats.posts}</div>
                  <div className="text-xs text-muted-foreground">Posts</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-primary">{profile.stats.diaryCreator}</div>
                  <div className="text-xs text-muted-foreground">Diaries</div>
                </div>
              </div>
              {profile.badges?.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-4">
                  {profile.badges.map((b) => (
                    <span
                      key={b.name}
                      title={b.description}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-full text-xs font-medium"
                    >
                      {b.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-card rounded-lg border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">Recent Discussions</h2>
          </div>
          {recentThreads.length === 0 ? (
            <p className="text-muted-foreground">No discussions yet</p>
          ) : (
            <div className="space-y-2">
              {recentThreads.map((t) => (
                <Link
                  key={t.id}
                  href={`/forum/thread/${t.slug}`}
                  className="block p-3 rounded-lg hover:bg-secondary/50 transition-colors"
                >
                  <h3 className="font-medium mb-1 break-words">{t.title}</h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{t.category.name}</span>
                    <span>•</span>
                    <span>{t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"}</span>
                    <span>•</span>
                    <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
