"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { User, Calendar, Award, MessageSquare, Leaf, Loader2, Download, Trash2 } from "lucide-react"
import { signOut } from "next-auth/react"
import Link from "next/link"

interface ProfileData {
  user: {
    id: string
    name: string
    image: string | null
    role: string
    ageVerified: boolean
    createdAt: string
  }
  profile: {
    username: string
    bio: string | null
    location: string | null
    website: string | null
    joinDate: string
    reputation: number
  } | null
  stats: {
    diaries: number
    posts: number
    followers: number
    following: number
    badges: number
    reputation: number
  }
  recentThreads: Array<{
    id: string
    title: string
    slug: string
    createdAt: string
    category: { name: string }
    _count: { posts: number }
  }>
  recentDiaries: Array<{
    id: string
    title: string
    createdAt: string
    _count: { updates: number; followers: number }
  }>
}

export default function ProfilePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [profileData, setProfileData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/auth/signin")
    }
  }, [status, router])

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/profile")
        .then(res => res.json())
        .then(data => {
          setProfileData(data)
          setLoading(false)
        })
        .catch(() => {
          setLoading(false)
        })
    }
  }, [status])

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!session || !profileData) {
    return null
  }

  const joinDate = new Date(profileData.user.createdAt).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long'
  })

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Profile Header */}
        <div className="bg-card rounded-lg border border-border p-6 mb-6">
          <div className="flex items-start gap-6">
            <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center">
              <User className="w-12 h-12 text-primary" />
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold mb-1">{profileData.profile?.username || profileData.user.name}</h1>
              <p className="text-muted-foreground mb-4">Member since {joinDate}</p>
              <div className="flex gap-6">
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{profileData.stats.reputation}</div>
                  <div className="text-sm text-muted-foreground">Reputation</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{profileData.stats.followers}</div>
                  <div className="text-sm text-muted-foreground">Followers</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{profileData.stats.following}</div>
                  <div className="text-sm text-muted-foreground">Following</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-primary">{profileData.stats.diaries}</div>
                  <div className="text-sm text-muted-foreground">Diaries</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Profile Sections */}
        <div className="grid md:grid-cols-2 gap-6">
          {/* Grow Diaries */}
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Leaf className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Grow Diaries</h2>
            </div>
            {profileData.recentDiaries.length === 0 ? (
              <p className="text-muted-foreground">No grow diaries yet</p>
            ) : (
              <div className="space-y-3">
                {profileData.recentDiaries.map((diary) => (
                  <Link
                    key={diary.id}
                    href={`/diaries/${diary.id}`}
                    className="block p-3 rounded-lg hover:bg-secondary/50 transition-colors"
                  >
                    <h3 className="font-medium mb-1">{diary.title}</h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{diary._count.updates} updates</span>
                      <span>•</span>
                      <span>{diary._count.followers} followers</span>
                      <span>•</span>
                      <span>{new Date(diary.createdAt).toLocaleDateString()}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Discussion Posts */}
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Recent Discussions</h2>
            </div>
            {profileData.recentThreads.length === 0 ? (
              <p className="text-muted-foreground">No discussion posts yet</p>
            ) : (
              <div className="space-y-3">
                {profileData.recentThreads.map((thread) => (
                  <Link
                    key={thread.id}
                    href={`/forum/thread/${thread.slug}`}
                    className="block p-3 rounded-lg hover:bg-secondary/50 transition-colors"
                  >
                    <h3 className="font-medium mb-1">{thread.title}</h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{thread.category.name}</span>
                      <span>•</span>
                      <span>{thread._count.posts} replies</span>
                      <span>•</span>
                      <span>{new Date(thread.createdAt).toLocaleDateString()}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Badges */}
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Award className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Badges</h2>
            </div>
            {profileData.stats.badges === 0 ? (
              <p className="text-muted-foreground">No badges earned yet</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {profileData.stats.badges} badges earned
              </div>
            )}
          </div>

          {/* Account Controls */}
          <div className="bg-card rounded-lg border border-border p-6">
            <h2 className="text-lg font-semibold mb-4">Privacy & Account</h2>
            <div className="space-y-3">
              <a
                href="/api/profile/export"
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <Download className="w-4 h-4" /> Download my data (JSON)
              </a>
              <button
                onClick={async () => {
                  const username = profileData.profile?.username || profileData.user.name
                  const confirm = window.prompt(
                    `Type your username "${username}" to permanently delete your account and all content:`
                  )
                  if (confirm === null) return
                  const res = await fetch("/api/profile", {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ confirmUsername: confirm }),
                  })
                  if (res.ok) {
                    signOut({ callbackUrl: "/" })
                  } else {
                    const d = await res.json()
                    alert(d.error || "Deletion failed")
                  }
                }}
                className="flex items-center gap-2 text-sm text-destructive hover:text-destructive/80 transition-colors"
              >
                <Trash2 className="w-4 h-4" /> Delete my account
              </button>
              <p className="text-xs text-muted-foreground">
                Account deletion is permanent and removes all your content.
              </p>
            </div>
          </div>

          {/* Activity */}
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <Calendar className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Recent Activity</h2>
            </div>
            {profileData.recentThreads.length === 0 && profileData.recentDiaries.length === 0 ? (
              <p className="text-muted-foreground">No recent activity</p>
            ) : (
              <div className="space-y-2 text-sm text-muted-foreground">
                {profileData.recentThreads.length > 0 && (
                  <div>Started {profileData.recentThreads.length} discussion{profileData.recentThreads.length !== 1 ? 's' : ''}</div>
                )}
                {profileData.recentDiaries.length > 0 && (
                  <div>Created {profileData.recentDiaries.length} grow diar{profileData.recentDiaries.length !== 1 ? 'ies' : 'y'}</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
