"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import {
  Leaf, User, Camera, Loader2, Check, Copy, AlertTriangle, KeyRound, Users, Sparkles,
} from "lucide-react"
import { INTEREST_GROUPS, type SuggestedUser } from "@/lib/onboarding"
import RoleBadge from "@/components/role-badge"

interface Category {
  id: string
  name: string
  slug: string
  description: string | null
}

interface InitialState {
  username: string
  avatarUrl: string | null
  bio: string
  location: string
  hasPhrase: boolean
  followedCategoryIds: string[]
  followedUserCount: number
}

// Resize an image file to a 128x128 data URI — same approach as profile edit.
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
      resolve(canvas.toDataURL("image/png"))
    }
    img.onerror = reject
    img.src = URL.createObjectURL(file)
  })
}

const STEPS = ["Welcome", "Interests", "Profile", "Recovery", "Growers", "Done"] as const

export default function OnboardingStepper({
  callbackUrl,
  initial,
  categories,
}: {
  callbackUrl: string | null
  initial: InitialState
  categories: Category[]
}) {
  const { update } = useSession()
  const router = useRouter()

  // Resume: land on the first step that still has work to do.
  const [step, setStep] = useState(() => {
    const nothing =
      initial.followedCategoryIds.length === 0 &&
      !initial.avatarUrl && !initial.bio &&
      !initial.hasPhrase && initial.followedUserCount === 0
    if (nothing) return 0
    if (initial.followedCategoryIds.length === 0) return 1
    if (!initial.avatarUrl && !initial.bio) return 2
    if (!initial.hasPhrase) return 3
    if (initial.followedUserCount === 0) return 4
    return 5
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  // Interests
  const [interests, setInterests] = useState<Set<string>>(new Set(initial.followedCategoryIds))

  // Profile
  const [username, setUsername] = useState(initial.username)
  const [bio, setBio] = useState(initial.bio)
  const [location, setLocation] = useState(initial.location)
  const [avatar, setAvatar] = useState(initial.avatarUrl ?? "")
  const [avatarError, setAvatarError] = useState("")
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // Recovery
  const [hasPhrase, setHasPhrase] = useState(initial.hasPhrase)
  const [password, setPassword] = useState("")
  const [phrase, setPhrase] = useState("")
  const [phraseSaved, setPhraseSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  // Growers
  const [suggestions, setSuggestions] = useState<SuggestedUser[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [suggestError, setSuggestError] = useState("")
  const headingRef = useRef<HTMLHeadingElement>(null)

  const destination = callbackUrl ?? "/feed?tab=for-you"

  const loadSuggestions = () => {
    setSuggestError("")
    fetch("/api/onboarding/suggestions")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((d) => setSuggestions(d.users ?? []))
      .catch(() => setSuggestError("Could not load suggestions"))
  }

  useEffect(() => {
    if (step !== 4 || suggestions !== null) return
    let cancelled = false
    fetch("/api/onboarding/suggestions")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((d) => { if (!cancelled) { setSuggestions(d.users ?? []); setSuggestError("") } })
      .catch(() => { if (!cancelled) setSuggestError("Could not load suggestions") })
    return () => { cancelled = true }
  }, [step, suggestions])

  // Keep focus and scroll position sane across step transitions — each step
  // unmounts, so without this focus falls back to <body> and the new step's
  // heading may sit above the viewport.
  useEffect(() => {
    window.scrollTo(0, 0)
    headingRef.current?.focus()
  }, [step])

  const complete = async (dest: string) => {
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/onboarding/complete", { method: "POST" })
      if (res.ok) await update()
      router.push(dest)
    } catch {
      router.push(dest)
    }
  }

  const next = () => { if (busy) return; setError(""); setStep((s) => Math.min(s + 1, STEPS.length - 1)) }
  const back = () => { if (busy) return; setError(""); setStep((s) => Math.max(s - 1, 0)) }

  const saveInterests = async () => {
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/onboarding/interests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryIds: [...interests] }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Could not save interests")
        return
      }
      next()
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  const saveProfile = async () => {
    setBusy(true)
    setError("")
    try {
      const payload: Record<string, unknown> = {}
      if (username.trim() && username.trim() !== initial.username) payload.username = username.trim()
      if (bio.trim() !== initial.bio) payload.bio = bio.trim()
      if (location.trim() !== initial.location) payload.location = location.trim()
      if (avatar && avatar.startsWith("data:")) payload.avatarUrl = avatar
      if (Object.keys(payload).length === 0) return next()
      const res = await fetch("/api/profile/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Could not save profile")
        return
      }
      next()
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  const generatePhrase = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/profile/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        setPhrase(d.phrase)
        setHasPhrase(true)
      } else {
        setError(d.error || "Failed to generate phrase")
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setPassword("")
      setBusy(false)
    }
  }

  const followSelected = async () => {
    if (selected.size === 0) return next()
    setBusy(true)
    setError("")
    try {
      const res = await fetch("/api/onboarding/follow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userIds: [...selected] }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || "Could not follow growers")
        return
      }
      next()
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setAvatarError("Avatar must be a JPG, PNG or WebP image")
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setAvatarError("Avatar must be under 5MB")
      return
    }
    try {
      setAvatar(await resizeImage(file))
      setAvatarError("")
    } catch {
      setAvatarError("Could not read that image")
    }
  }

  const grouped = new Map<string, Category[]>()
  const groupedSlugs = new Set(INTEREST_GROUPS.flatMap((g) => g.slugs))
  for (const g of INTEREST_GROUPS) {
    grouped.set(g.label, categories.filter((c) => g.slugs.includes(c.slug)))
  }
  const ungrouped = categories.filter((c) => !groupedSlugs.has(c.slug))

  const chipCls = (on: boolean) =>
    `min-h-11 px-4 py-2 rounded-full border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
      on
        ? "bg-primary text-primary-foreground border-primary"
        : "bg-card border-border hover:border-primary/60"
    }`

  const btnPrimary =
    "min-h-12 px-6 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
  const btnGhost = "min-h-11 px-4 rounded-lg text-sm text-muted-foreground hover:text-foreground"

  return (
    // pb-28 clears the mobile bottom nav and floating chat/quick-post buttons.
    <div className="min-h-screen bg-background flex items-start lg:items-center justify-center px-4 pt-8 pb-28 lg:py-8">
      <div className="max-w-2xl w-full">
        {/* Progress */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
            <span aria-current="step">Step {step + 1} of {STEPS.length}</span>
            <span>{STEPS[step]}</span>
          </div>
          <div className="h-2 bg-secondary rounded-full overflow-hidden" role="progressbar" aria-label="Onboarding progress" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={STEPS.length}>
            <div
              className="h-full bg-primary rounded-full transition-all"
              style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
            />
          </div>
        </div>

        {error && (
          <div role="alert" className="bg-destructive/10 text-destructive px-4 py-2 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        {/* Step 0 — Welcome */}
        {step === 0 && (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <div className="bg-primary/10 p-4 rounded-full inline-flex mb-4">
              <Leaf className="w-10 h-10 text-primary" />
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold mb-3 outline-none">Welcome to TerpTalk 🌱</h1>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              A community built for growers, breeders, and cannabis enthusiasts.
              Customize your experience so we can show you discussions, growers,
              and content you&apos;ll actually care about.
            </p>
            <div className="flex flex-col gap-3">
              <button onClick={next} className={btnPrimary}>Continue</button>
              <button
                onClick={() => complete(destination)}
                disabled={busy}
                className={btnGhost + " disabled:opacity-50 flex items-center justify-center gap-2"}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {busy ? "Finishing up…" : "Skip onboarding"}
              </button>
            </div>
          </div>
        )}

        {/* Step 1 — Interests */}
        {step === 1 && (
          <div className="bg-card border border-border rounded-xl p-6 sm:p-8">
            <div className="text-center mb-6">
              <Sparkles className="w-8 h-8 text-primary mx-auto mb-3" />
              <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold mb-2 outline-none">What are you into?</h1>
              <p className="text-sm text-muted-foreground">
                Pick topics to personalize your feed. You can change these anytime.
              </p>
            </div>
            <div className="space-y-5 mb-8">
              {[...grouped.entries()].filter(([, cats]) => cats.length > 0).map(([label, cats]) => (
                <fieldset key={label}>
                  <legend className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{label}</legend>
                  <div className="flex flex-wrap gap-2">
                    {cats.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={interests.has(c.id)}
                        onClick={() =>
                          setInterests((prev) => {
                            const s = new Set(prev)
                            if (s.has(c.id)) s.delete(c.id)
                            else s.add(c.id)
                            return s
                          })
                        }
                        className={chipCls(interests.has(c.id))}
                      >
                        {interests.has(c.id) && <Check className="w-3.5 h-3.5 inline mr-1 -mt-0.5" aria-hidden />}
                        {c.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}
              {ungrouped.length > 0 && (
                <fieldset>
                  <legend className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">More topics</legend>
                  <div className="flex flex-wrap gap-2">
                    {ungrouped.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={interests.has(c.id)}
                        onClick={() =>
                          setInterests((prev) => {
                            const s = new Set(prev)
                            if (s.has(c.id)) s.delete(c.id)
                            else s.add(c.id)
                            return s
                          })
                        }
                        className={chipCls(interests.has(c.id))}
                      >
                        {interests.has(c.id) && <Check className="w-3.5 h-3.5 inline mr-1 -mt-0.5" aria-hidden />}
                        {c.name}
                      </button>
                    ))}
                  </div>
                </fieldset>
              )}
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3">
              <button onClick={back} disabled={busy} className={btnGhost + " disabled:opacity-50"}>Back</button>
              <div className="flex-1" />
              <button onClick={next} disabled={busy} className={btnGhost + " disabled:opacity-50"}>Skip for now</button>
              <button onClick={saveInterests} disabled={busy} className={btnPrimary}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Profile */}
        {step === 2 && (
          <div className="bg-card border border-border rounded-xl p-6 sm:p-8">
            <div className="text-center mb-6">
              <User className="w-8 h-8 text-primary mx-auto mb-3" />
              <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold mb-2 outline-none">Make it yours</h1>
              <p className="text-sm text-muted-foreground">Add an avatar and a short bio — all optional.</p>
            </div>
            <div className="space-y-5 mb-8">
              <div className="flex items-center gap-4">
                <div className="w-20 h-20 bg-secondary rounded-full flex items-center justify-center overflow-hidden">
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data-URI preview
                    <img src={avatar} alt="Avatar preview" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-10 h-10 text-muted-foreground" />
                  )}
                </div>
                <div>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={handleAvatar}
                  />
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    className="min-h-11 flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-colors"
                  >
                    <Camera className="w-4 h-4" />
                    {avatar ? "Change Avatar" : "Upload Avatar"}
                  </button>
                  <p className="text-sm text-muted-foreground mt-1">JPG, PNG or WebP. Max 5MB.</p>
                  {avatarError && <p role="alert" className="text-xs text-destructive mt-1">{avatarError}</p>}
                </div>
              </div>

              <div>
                <label htmlFor="ob-username" className="block text-sm font-medium mb-2">Username</label>
                <input
                  id="ob-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  minLength={3}
                  maxLength={20}
                />
                <p className="text-xs text-muted-foreground mt-1">Picked at signup — you can change it here once.</p>
              </div>

              <div>
                <label htmlFor="ob-bio" className="block text-sm font-medium mb-2">Bio</label>
                <textarea
                  id="ob-bio"
                  rows={3}
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  maxLength={150}
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary resize-none"
                  placeholder="A sentence about your grow setup or interests..."
                />
              </div>

              <div>
                <label htmlFor="ob-location" className="block text-sm font-medium mb-2">Location <span className="text-muted-foreground">(optional)</span></label>
                <input
                  id="ob-location"
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  maxLength={100}
                  className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Region — share only what you're comfortable with"
                />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3">
              <button onClick={back} disabled={busy} className={btnGhost + " disabled:opacity-50"}>Back</button>
              <div className="flex-1" />
              <button onClick={next} disabled={busy} className={btnGhost + " disabled:opacity-50"}>Skip for now</button>
              <button onClick={saveProfile} disabled={busy} className={btnPrimary}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Recovery phrase */}
        {step === 3 && (
          <div className="bg-card border border-border rounded-xl p-6 sm:p-8">
            <div className="text-center mb-6">
              <KeyRound className="w-8 h-8 text-primary mx-auto mb-3" />
              <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold mb-2 outline-none">Secure your account</h1>
              <p className="text-sm text-muted-foreground">
                No email needed — your 12-word recovery phrase is the only way back in if you forget your password.
              </p>
            </div>

            {hasPhrase && !phrase ? (
              <p className="text-sm text-muted-foreground text-center mb-8 flex items-center justify-center gap-2">
                <Check className="w-4 h-4 text-primary" /> Your recovery phrase is already set.
              </p>
            ) : phrase ? (
              <div className="mb-8">
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4">
                  <p className="text-xs text-amber-500 font-semibold mb-2 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> Shown only once — write it down now
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-sm">
                    {phrase.split(" ").map((w, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="text-muted-foreground text-xs w-4">{i + 1}.</span>
                        <span className="font-medium">{w}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(phrase)
                        .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
                        .catch(() => setError("Could not copy — please write the phrase down manually"))
                    }}
                    className="mt-3 min-h-11 px-2 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? "Copied!" : "Copy phrase"}
                  </button>
                </div>
                <button
                  onClick={() => setPhraseSaved(true)}
                  disabled={phraseSaved}
                  className="mt-4 w-full min-h-11 bg-secondary rounded-lg hover:bg-secondary/80 text-sm font-medium disabled:opacity-60"
                >
                  {phraseSaved ? "Saved — continue below" : "I've saved my phrase"}
                </button>
              </div>
            ) : (
              <form onSubmit={generatePhrase} className="space-y-3 mb-8">
                <div>
                  <label htmlFor="ob-recovery-password" className="block text-sm font-medium mb-1">
                    Confirm your password
                  </label>
                  <input
                    id="ob-recovery-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="current-password"
                    className="w-full px-4 py-2 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Current password"
                  />
                </div>
                <button type="submit" disabled={busy || !password} className={btnPrimary}>
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Generate recovery phrase
                </button>
              </form>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3">
              <button onClick={back} disabled={busy} className={btnGhost + " disabled:opacity-50"}>Back</button>
              <div className="flex-1" />
              <button onClick={next} disabled={busy || (!!phrase && !phraseSaved)} className={btnGhost + " disabled:opacity-50"}>Set up later</button>
              <button onClick={next} disabled={busy || (!!phrase && !phraseSaved)} className={btnPrimary}>
                Continue
              </button>
            </div>
          </div>
        )}

        {/* Step 4 — Suggested growers */}
        {step === 4 && (
          <div className="bg-card border border-border rounded-xl p-6 sm:p-8">
            <div className="text-center mb-6">
              <Users className="w-8 h-8 text-primary mx-auto mb-3" />
              <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold mb-2 outline-none">Growers to follow</h1>
              <p className="text-sm text-muted-foreground">
                Follow a few members so your feed starts alive.
              </p>
            </div>

            {suggestError && suggestions === null ? (
              <div role="alert" className="text-center mb-6">
                <p className="text-sm text-destructive mb-2">{suggestError}</p>
                <button onClick={loadSuggestions} className={btnGhost + " border border-border"}>Try again</button>
              </div>
            ) : suggestions === null ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : suggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center mb-6">
                No suggestions right now — you can find growers on profiles and the leaderboard.
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3 mb-8">
                {suggestions.map((u) => {
                  const on = selected.has(u.id)
                  return (
                    <button
                      key={u.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setSelected((prev) => {
                          const s = new Set(prev)
                          if (s.has(u.id)) s.delete(u.id)
                          else s.add(u.id)
                          return s
                        })
                      }
                      className={`min-h-11 text-left p-3 rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                        on ? "border-primary bg-primary/10" : "border-border bg-background hover:border-primary/50"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-secondary overflow-hidden flex items-center justify-center flex-shrink-0">
                          {u.image ? (
                            // eslint-disable-next-line @next/next/no-img-element -- external avatar URL
                            <img src={u.image} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-sm font-semibold truncate">
                            @{u.username ?? u.name}
                            <RoleBadge role={u.role} />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {u.reputation.toLocaleString()} rep · {u.followers} follower{u.followers === 1 ? "" : "s"}
                          </div>
                        </div>
                        {on && <Check className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />}
                      </div>
                      {u.bio && <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{u.bio}</p>}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-3">
              <button onClick={back} disabled={busy} className={btnGhost + " disabled:opacity-50"}>Back</button>
              <div className="flex-1" />
              <button onClick={next} disabled={busy} className={btnGhost + " disabled:opacity-50"}>Skip for now</button>
              <button onClick={followSelected} disabled={busy} className={btnPrimary}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                {selected.size > 0 ? `Follow ${selected.size}` : "Continue"}
              </button>
            </div>
          </div>
        )}

        {/* Step 5 — Done */}
        {step === 5 && (
          <div className="bg-card border border-border rounded-xl p-8 text-center">
            <div className="bg-primary/10 p-4 rounded-full inline-flex mb-4">
              <Check className="w-10 h-10 text-primary" />
            </div>
            <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-bold mb-3 outline-none">You&apos;re all set 🌱</h1>
            <p className="text-muted-foreground mb-8 max-w-md mx-auto">
              Your TerpTalk feed is ready. Follow growers, join a discussion, or start your own grow diary whenever you&apos;re ready.
            </p>
            <button onClick={() => complete(destination)} disabled={busy} className={btnPrimary + " w-full"}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Enter TerpTalk
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
