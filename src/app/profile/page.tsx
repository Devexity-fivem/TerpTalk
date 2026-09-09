"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { User, Calendar, Award, MessageSquare, Leaf, Loader2, Download, Trash2, Pencil, MapPin, Globe, Sprout, Dna, Store } from "lucide-react"
import { signOut } from "next-auth/react"
import Link from "next/link"
import RoleBadge from "@/components/role-badge"
import SavedThreads from "@/components/saved-threads"
import SavedSearches from "@/components/saved-searches"
import RecoveryPhraseCard from "@/components/recovery-phrase-card"

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
    avatarUrl: string | null
    growExperience: string | null
    favoriteStrain: string | null
    growSpace: string | null
    businessName: string | null
    businessType: string | null
    businessUrl: string | null
    notifyOnReply: boolean
    notifyOnMention: boolean
    notifyOnCategoryFollow: boolean
    notifyOnMessage: boolean
    notifyOnComment: boolean
    emailDigestFrequency: string | null
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
    referrals: number
  }
  badges: Array<{ name: string; description: string; icon: string | null; earnedAt: string }>
  recentThreads: Array<{
    id: string
    title: string
    slug: string
    createdAt: string
    category: { name: string }
    replyCount: number
  }>
  recentDiaries: Array<{
    id: string
    title: string
    createdAt: string
    _count: { updates: number; followers: number }
  }>
}

const EXPERIENCE_LEVELS = ["Just starting out", "First grow", "A few grows in", "Experienced", "Veteran grower", "Commercial"]

// Resize an image file to a 128x128 data URI for avatar upload
function resizeImage(file: File, size = 128): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement("canvas")
      const min = Math.min(img.width, img.height)
      const sx = (img.width - min) / 2
      const sy = (img.height - min) / 2
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext("2d")
      if (!ctx) return reject(new Error("no canvas"))
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size)
      resolve(canvas.toDataURL("image/webp", 0.85))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

export default function ProfilePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [profileData, setProfileData] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    bio: "",
    location: "",
    website: "",
    avatarUrl: "",
    growExperience: "",
    favoriteStrain: "",
    growSpace: "",
    businessName: "",
    businessType: "",
    businessUrl: "",
    notifyOnReply: true,
    notifyOnMention: true,
    notifyOnCategoryFollow: true,
    notifyOnMessage: true,
    notifyOnComment: true,
    emailDigestFrequency: "",
  })

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
            <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
              {profileData.profile?.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profileData.profile.avatarUrl} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <User className="w-12 h-12 text-primary" />
              )}
            </div>
              <div className="flex-1">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <h1 className="text-2xl font-bold mb-1 flex items-center gap-2">{profileData.profile?.username || profileData.user.name} <RoleBadge role={profileData.user.role} /></h1>
                    <p className="text-muted-foreground text-sm mb-2">Member since {joinDate}</p>
                    {profileData.profile?.bio && (
                      <p className="text-sm mb-3 whitespace-pre-wrap break-words">{profileData.profile.bio}</p>
                    )}
                    <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                      {profileData.profile?.location && (
                        <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{profileData.profile.location}</span>
                      )}
                      {profileData.profile?.website && (
                        <a href={profileData.profile.website} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-1 text-primary hover:underline">
                          <Globe className="w-3.5 h-3.5" />{profileData.profile.website.replace(/^https?:\/\//, "").slice(0, 40)}
                        </a>
                      )}
                      {profileData.profile?.growExperience && (
                        <span className="flex items-center gap-1"><Sprout className="w-3.5 h-3.5" />{profileData.profile.growExperience}</span>
                      )}
                      {profileData.profile?.favoriteStrain && (
                        <span className="flex items-center gap-1"><Dna className="w-3.5 h-3.5" />{profileData.profile.favoriteStrain}</span>
                      )}
                      {profileData.profile?.growSpace && (
                        <span className="flex items-center gap-1"><Leaf className="w-3.5 h-3.5" />{profileData.profile.growSpace}</span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      const p = profileData.profile
                      setEditForm({
                        bio: p?.bio || "",
                        location: p?.location || "",
                        website: p?.website || "",
                        avatarUrl: p?.avatarUrl || "",
                        growExperience: p?.growExperience || "",
                        favoriteStrain: p?.favoriteStrain || "",
                        growSpace: p?.growSpace || "",
                        businessName: p?.businessName || "",
                        businessType: p?.businessType || "",
                        businessUrl: p?.businessUrl || "",
                        notifyOnReply: p?.notifyOnReply ?? true,
                        notifyOnMention: p?.notifyOnMention ?? true,
                        notifyOnCategoryFollow: p?.notifyOnCategoryFollow ?? true,
                        notifyOnMessage: p?.notifyOnMessage ?? true,
                        notifyOnComment: p?.notifyOnComment ?? true,
                        emailDigestFrequency: p?.emailDigestFrequency || "",
                      })
                      setEditing(true)
                    }}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
                  >
                    <Pencil className="w-4 h-4" /> Edit Profile
                  </button>
                </div>
                <div className="flex gap-6 mt-4">
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
                  <div className="text-center">
                    <div className="text-2xl font-bold text-primary">{profileData.stats.referrals}</div>
                    <div className="text-sm text-muted-foreground">Referrals</div>
                  </div>
                </div>
              </div>
            </div>
        </div>

        {/* Edit Profile Modal */}
        {editing && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditing(false)}>
            <div className="bg-card border border-border rounded-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
              <h2 className="text-lg font-semibold mb-4">Edit Profile</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Profile Photo</label>
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center overflow-hidden shrink-0">
                      {editForm.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={editForm.avatarUrl} alt="preview" className="w-full h-full object-cover" />
                      ) : (
                        <User className="w-8 h-8 text-primary" />
                      )}
                    </div>
                    <div className="space-y-2">
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        onChange={async (e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          if (file.size > 5 * 1024 * 1024) { alert("Image must be under 5MB"); return }
                          try {
                            const dataUri = await resizeImage(file)
                            setEditForm({ ...editForm, avatarUrl: dataUri })
                          } catch {
                            alert("Could not process that image")
                          }
                        }}
                        className="text-sm text-muted-foreground file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-primary file:text-primary-foreground file:text-xs file:font-medium hover:file:bg-primary/90"
                      />
                      <p className="text-xs text-muted-foreground">JPG, PNG, WebP or GIF — cropped to a square, max 5MB</p>
                      {editForm.avatarUrl && (
                        <button
                          type="button"
                          onClick={() => setEditForm({ ...editForm, avatarUrl: "" })}
                          className="text-xs text-destructive hover:underline"
                        >
                          Remove photo
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Bio</label>
                  <textarea
                    value={editForm.bio}
                    onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                    rows={3}
                    maxLength={150}
                    placeholder="Tell the community about yourself..."
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1">Location</label>
                    <input
                      type="text"
                      value={editForm.location}
                      onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                      maxLength={100}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Website</label>
                    <input
                      type="url"
                      value={editForm.website}
                      onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                      maxLength={200}
                      placeholder="https://..."
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Grow Experience</label>
                    <select
                      value={editForm.growExperience}
                      onChange={(e) => setEditForm({ ...editForm, growExperience: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="">—</option>
                      {EXPERIENCE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Grow Space</label>
                    <input
                      type="text"
                      value={editForm.growSpace}
                      onChange={(e) => setEditForm({ ...editForm, growSpace: e.target.value })}
                      maxLength={100}
                      placeholder="e.g. 4x4 tent, outdoor"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium mb-1">Favorite Strain</label>
                    <input
                      type="text"
                      value={editForm.favoriteStrain}
                      onChange={(e) => setEditForm({ ...editForm, favoriteStrain: e.target.value })}
                      maxLength={100}
                      placeholder="e.g. Northern Lights"
                      className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <div className="col-span-2 border-t border-border pt-4 mt-2">
                    <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Store className="w-4 h-4 text-primary" /> Business / Breeder Profile
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-sm font-medium mb-1">Business Name</label>
                        <input
                          type="text"
                          value={editForm.businessName}
                          onChange={(e) => setEditForm({ ...editForm, businessName: e.target.value })}
                          maxLength={80}
                          placeholder="e.g. Mephisto Genetics"
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1">Business Type</label>
                        <select
                          value={editForm.businessType}
                          onChange={(e) => setEditForm({ ...editForm, businessType: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">—</option>
                          <option value="BREEDER">Breeder</option>
                          <option value="VENDOR">Vendor</option>
                          <option value="GROW_SHOP">Grow Shop</option>
                          <option value="BRAND">Brand</option>
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-sm font-medium mb-1">Business URL</label>
                        <input
                          type="url"
                          value={editForm.businessUrl}
                          onChange={(e) => setEditForm({ ...editForm, businessUrl: e.target.value })}
                          maxLength={200}
                          placeholder="https://..."
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="col-span-2 border-t border-border pt-4 mt-2">
                    <h3 className="text-sm font-medium mb-3">Notifications</h3>
                    <div className="space-y-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editForm.notifyOnReply}
                          onChange={(e) => setEditForm({ ...editForm, notifyOnReply: e.target.checked })}
                          className="rounded border-border bg-background text-primary"
                        />
                        Notify me when someone replies to my thread
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editForm.notifyOnMention}
                          onChange={(e) => setEditForm({ ...editForm, notifyOnMention: e.target.checked })}
                          className="rounded border-border bg-background text-primary"
                        />
                        Notify me when I am mentioned
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editForm.notifyOnCategoryFollow}
                          onChange={(e) => setEditForm({ ...editForm, notifyOnCategoryFollow: e.target.checked })}
                          className="rounded border-border bg-background text-primary"
                        />
                        Notify me about new threads in followed categories
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editForm.notifyOnMessage}
                          onChange={(e) => setEditForm({ ...editForm, notifyOnMessage: e.target.checked })}
                          className="rounded border-border bg-background text-primary"
                        />
                        Notify me about direct messages
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={editForm.notifyOnComment}
                          onChange={(e) => setEditForm({ ...editForm, notifyOnComment: e.target.checked })}
                          className="rounded border-border bg-background text-primary"
                        />
                        Notify me about comments on my setups and diaries
                      </label>
                      <div className="flex items-center gap-3">
                        <label className="text-sm whitespace-nowrap">Email digest</label>
                        <select
                          value={editForm.emailDigestFrequency}
                          onChange={(e) => setEditForm({ ...editForm, emailDigestFrequency: e.target.value })}
                          className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                          <option value="">—</option>
                          <option value="DAILY">Daily</option>
                          <option value="WEEKLY">Weekly</option>
                          <option value="NEVER">Never</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button
                    disabled={saving}
                    onClick={async () => {
                      setSaving(true)
                      const res = await fetch("/api/profile", {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify(editForm),
                      })
                      setSaving(false)
                      if (res.ok) {
                        const d = await res.json()
                        setProfileData(prev => prev ? { ...prev, profile: d.profile } : prev)
                        setEditing(false)
                      } else {
                        const d = await res.json()
                        alert(d.error || "Failed to save")
                      }
                    }}
                    className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save Changes"}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="px-4 py-2 border border-border rounded-lg hover:bg-secondary transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

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
                      <span>{thread.replyCount} repl{thread.replyCount === 1 ? "y" : "ies"}</span>
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
            {profileData.badges.length === 0 ? (
              <p className="text-muted-foreground">No badges earned yet — post, grow, and share to earn them</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {profileData.badges.map((b) => (
                  <span
                    key={b.name}
                    title={b.description}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/15 text-amber-400 border border-amber-500/30 rounded-full text-xs font-medium"
                  >
                    {b.name}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Saved Threads */}
          <SavedThreads />

          {/* Saved Searches */}
          <SavedSearches />

          {/* Referrals */}
          <div className="bg-card rounded-lg border border-border p-6">
            <div className="flex items-center gap-2 mb-4">
              <User className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Referrals</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-3">
              Invite growers — earn <span className="font-semibold text-amber-500">+25 reputation</span> per signup and unlock the <span className="font-semibold text-amber-500">🤝 Recruiter</span> badge at 3 referrals. You&apos;ve referred <span className="font-semibold text-foreground">{profileData.stats.referrals}</span> member{profileData.stats.referrals !== 1 ? "s" : ""}.
            </p>
            <div className="flex gap-2">
              <input
                readOnly
                value={typeof window !== "undefined" ? `${window.location.origin}/auth/signup?ref=${profileData.profile?.username || profileData.user.name}` : ""}
                className="flex-1 px-3 py-2 text-xs rounded-lg border border-border bg-background text-muted-foreground"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={() => {
                  const link = `${window.location.origin}/auth/signup?ref=${profileData.profile?.username || profileData.user.name}`
                  navigator.clipboard.writeText(link)
                }}
                className="px-3 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                Copy
              </button>
            </div>
          </div>

          {/* Account Recovery */}
          <RecoveryPhraseCard />

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
