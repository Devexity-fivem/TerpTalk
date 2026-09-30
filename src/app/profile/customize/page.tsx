"use client"

import { signInHref } from "@/lib/callback-url"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  ArrowDown, ArrowUp, ChevronDown, ImagePlus, Loader2, Lock, Pin, Plus, Save,
  Sprout, Trash2, User, X,
} from "@/lib/icons"
import Link from "next/link"
import PageHeader from "@/components/ui/page-header"
import SectionCard from "@/components/ui/section-card"
import Tabs from "@/components/ui/tabs"
import Tag from "@/components/ui/tag"
import EmptyState from "@/components/ui/empty-state"
import ConfirmDialog from "@/components/ui/confirm-dialog"
import { Avatar } from "@/components/ui/avatar"
import { MarkdownRenderer } from "@/lib/markdown"
import {
  PROFILE_BLOCK_IDS,
  PROFILE_SECTION_IDS,
  PROFILE_TAB_IDS,
  NOTABLE_STAT_IDS,
  NOTABLE_STAT_LABELS,
  PROFILE_MEDIUMS,
  PROFILE_STYLES,
  PROFILE_GOALS_MAX,
  PROFILE_SECTION_TITLE_MAX,
  PROFILE_SECTION_BODY_MAX,
} from "@/lib/profile-settings"
import { ACCENT_META, THEME_META, DENSITY_META } from "@/lib/profile-appearance"
import { PROFILE_WIDGETS } from "@/lib/profile-widgets"
import { cn } from "@/lib/utils"

/* ── Types ───────────────────────────────────────────────────────── */

interface CustomSection {
  id: string
  title: string
  body: string
  visibility: "PUBLIC" | "MEMBERS" | "HIDDEN"
  order: number
}

interface WorkingSettings {
  bannerImage: string | null
  accent: string
  theme: string
  density: string
  sectionOrder: string[]
  hiddenSections: string[]
  shownStats: string[]
  pinnedSection: string | null
  identity: { mediums: string[]; styles: string[]; goals: string }
}

interface ProfilePayload {
  user: { id: string; name: string | null }
  profile: {
    username: string
    avatarUrl: string | null
    featuredDiaryId: string | null
    profileSettings: unknown
    xp: number
  } | null
  featureableDiaries: {
    id: string; slug: string | null; title: string; strain: string | null
    harvested: boolean; stage: string; visibility: string
  }[]
  customization: {
    sectionLimit: number
    statSlots: number
    widgets: { records: boolean; ownerInsights: boolean }
  } | null
  stats: { rank?: { name: string } }
}

interface SectionInfo { name: string; desc: string; unlockRank?: string }

/** Plain-language names/descriptions for every hideable/orderable id. */
const SECTION_INFO: Record<string, SectionInfo> = {
  overview: { name: "Overview", desc: "Your profile home — always first, can't be hidden." },
  featured: { name: "Featured grow", desc: "The grow you picked to lead your profile." },
  stats: { name: "Grower profile & stats", desc: "Mastery map, stat strip, and progression." },
  records: { name: "Records", desc: "Longest grow, biggest harvest, earliest start.", unlockRank: "Harvested" },
  pinned: { name: "Pinned section", desc: "A custom section pinned high on your overview." },
  history: { name: "Recent activity", desc: "Latest threads and progression events." },
  badges: { name: "Badges", desc: "Your badge showcase on Contributions." },
  grows: { name: "Grows tab", desc: "Your grow portfolio." },
  harvests: { name: "Harvests tab", desc: "Your completed harvest shelf." },
  contributions: { name: "Contributions tab", desc: "Answers, experiments, setups, discussions." },
  about: { name: "About tab", desc: "Bio, identity, and your custom sections." },
  "owner-insights": { name: "Profile insights", desc: "Private 30-day panel — only you see it.", unlockRank: "Cured" },
}

const VISIBILITY_INFO = [
  { id: "PUBLIC" as const, name: "Public", desc: "Anyone who can view your profile." },
  { id: "MEMBERS" as const, name: "Members", desc: "Logged-in TerpTalk members." },
  { id: "HIDDEN" as const, name: "Hidden", desc: "Visible only to you." },
]

/** Client-side banner downscale → webp data URI (server re-validates +
 *  re-encodes through the shared image pipeline). */
function fileToBannerDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type)) return reject(new Error("Choose an image file"))
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const W = 1400, H = 440
        const canvas = document.createElement("canvas")
        canvas.width = W
        canvas.height = H
        const ctx = canvas.getContext("2d")
        if (!ctx) return reject(new Error("Couldn't process the image"))
        const scale = Math.max(W / img.width, H / img.height)
        const w = img.width * scale
        const h = img.height * scale
        ctx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h)
        resolve(canvas.toDataURL("image/webp", 0.85))
      }
      img.onerror = () => reject(new Error("That file doesn't look like an image"))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error("Couldn't read the file"))
    reader.readAsDataURL(file)
  })
}

export default function ProfileCustomizePage() {
  const { status } = useSession()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [payload, setPayload] = useState<ProfilePayload | null>(null)
  const [sections, setSections] = useState<CustomSection[]>([])

  // Working settings — saved as one blob via PATCH.
  const [settings, setSettings] = useState<WorkingSettings | null>(null)
  const [baseline, setBaseline] = useState<string>("")
  const [featuredId, setFeaturedId] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedTick, setSavedTick] = useState(false)

  const [bannerBusy, setBannerBusy] = useState(false)
  const [featuredBusy, setFeaturedBusy] = useState(false)
  const [sectionBusy, setSectionBusy] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CustomSection | null>(null)
  const [editingSection, setEditingSection] = useState<CustomSection | null>(null)
  const [newSection, setNewSection] = useState<{ title: string; body: string; visibility: CustomSection["visibility"] } | null>(null)

  const bannerInputRef = useRef<HTMLInputElement>(null)
  const dirty = settings !== null && baseline !== "" && JSON.stringify(settings) !== baseline

  /* ── Load ── */
  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [pRes, sRes] = await Promise.all([
        fetch("/api/profile", { cache: "no-store" }),
        fetch("/api/profile/sections", { cache: "no-store" }),
      ])
      if (!pRes.ok) throw new Error("Couldn't load your profile")
      const p: ProfilePayload = await pRes.json()
      const s: { sections?: CustomSection[] } = sRes.ok ? await sRes.json() : { sections: [] }
      setPayload(p)
      setSections(s.sections ?? [])
      const raw = (p.profile?.profileSettings ?? {}) as Partial<WorkingSettings>
      const ws: WorkingSettings = {
        bannerImage: typeof raw.bannerImage === "string" ? raw.bannerImage : null,
        accent: typeof raw.accent === "string" ? raw.accent : "pine",
        theme: typeof raw.theme === "string" ? raw.theme : "default",
        density: typeof raw.density === "string" ? raw.density : "cozy",
        sectionOrder: Array.isArray(raw.sectionOrder) ? raw.sectionOrder : [...PROFILE_SECTION_IDS],
        hiddenSections: Array.isArray(raw.hiddenSections) ? raw.hiddenSections : [],
        shownStats: Array.isArray(raw.shownStats) ? raw.shownStats : ["grows", "harvests", "updates", "acceptedAnswers"],
        pinnedSection: typeof raw.pinnedSection === "string" ? raw.pinnedSection : null,
        identity: {
          mediums: Array.isArray(raw.identity?.mediums) ? raw.identity!.mediums : [],
          styles: Array.isArray(raw.identity?.styles) ? raw.identity!.styles : [],
          goals: typeof raw.identity?.goals === "string" ? raw.identity.goals : "",
        },
      }
      setSettings(ws)
      setBaseline(JSON.stringify(ws))
      setFeaturedId(p.profile?.featuredDiaryId ?? null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load your profile")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(signInHref("/profile/customize"))
    }
  }, [status, router])

  useEffect(() => {
    if (status !== "authenticated") return
    // Deferred so no setState runs synchronously inside the effect body.
    const id = setTimeout(() => void load(), 0)
    return () => clearTimeout(id)
  }, [status, load])

  // Unsaved-changes guard — a simple beforeunload, not a state machine.
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener("beforeunload", onUnload)
    return () => window.removeEventListener("beforeunload", onUnload)
  }, [dirty])

  /* ── Settings save ── */
  const saveSettings = async (patch: Partial<WorkingSettings>) => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileSettings: patch }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Couldn't save")
      // Re-baseline from the server's normalized blob.
      const stored = (data.profile?.profileSettings ?? {}) as Partial<WorkingSettings>
      const normalized: WorkingSettings = {
        bannerImage: typeof stored.bannerImage === "string" ? stored.bannerImage : null,
        accent: stored.accent ?? settings?.accent ?? "pine",
        theme: stored.theme ?? settings?.theme ?? "default",
        density: stored.density ?? settings?.density ?? "cozy",
        sectionOrder: Array.isArray(stored.sectionOrder) ? stored.sectionOrder : settings?.sectionOrder ?? [...PROFILE_SECTION_IDS],
        hiddenSections: Array.isArray(stored.hiddenSections) ? stored.hiddenSections : settings?.hiddenSections ?? [],
        shownStats: Array.isArray(stored.shownStats) ? stored.shownStats : settings?.shownStats ?? [],
        pinnedSection: typeof stored.pinnedSection === "string" ? stored.pinnedSection : null,
        identity: stored.identity ?? settings?.identity ?? { mediums: [], styles: [], goals: "" },
      }
      setSettings(normalized)
      setBaseline(JSON.stringify(normalized))
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 2500)
      return true
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save")
      return false
    } finally {
      setSaving(false)
    }
  }

  /* ── Banner ── */
  const uploadBanner = async (file: File) => {
    setBannerBusy(true)
    setSaveError(null)
    try {
      const uri = await fileToBannerDataUri(file)
      if (uri.length > 400_000) throw new Error("That image is too large — try a smaller one")
      // Server normalizes the patch and returns the stored blob URL — the
      // working settings update from the response, no re-load needed.
      await saveSettings({ bannerImage: uri })
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't upload the banner")
    } finally {
      setBannerBusy(false)
      if (bannerInputRef.current) bannerInputRef.current.value = ""
    }
  }

  const removeBanner = async () => {
    setBannerBusy(true)
    await saveSettings({ bannerImage: null })
    setBannerBusy(false)
  }

  /* ── Featured grow ── */
  const setFeatured = async (id: string | null) => {
    setFeaturedBusy(true)
    setSaveError(null)
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featuredDiaryId: id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Couldn't update the featured grow")
      setFeaturedId(id)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't update the featured grow")
    } finally {
      setFeaturedBusy(false)
    }
  }

  /* ── Custom sections ── */
  const createSection = async () => {
    if (!newSection) return
    setSectionBusy("new")
    setSaveError(null)
    try {
      const res = await fetch("/api/profile/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newSection, order: sections.length }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Couldn't create the section")
      setSections((prev) => [...prev, data.section])
      setNewSection(null)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't create the section")
    } finally {
      setSectionBusy(null)
    }
  }

  const updateSection = async (s: CustomSection) => {
    setSectionBusy(s.id)
    setSaveError(null)
    try {
      const res = await fetch(`/api/profile/sections/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: s.title, body: s.body, visibility: s.visibility }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Couldn't save the section")
      setSections((prev) => prev.map((x) => (x.id === s.id ? data.section : x)))
      setEditingSection(null)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Couldn't save the section")
    } finally {
      setSectionBusy(null)
    }
  }

  const moveSection = async (id: string, dir: -1 | 1) => {
    const idx = sections.findIndex((s) => s.id === id)
    const swap = idx + dir
    if (idx < 0 || swap < 0 || swap >= sections.length) return
    const a = sections[idx]
    const b = sections[swap]
    setSectionBusy(id)
    try {
      await Promise.all([
        fetch(`/api/profile/sections/${a.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: b.order }) }),
        fetch(`/api/profile/sections/${b.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: a.order }) }),
      ])
      const next = [...sections]
      next[idx] = b
      next[swap] = a
      setSections(next)
    } finally {
      setSectionBusy(null)
    }
  }

  const deleteSection = async (s: CustomSection) => {
    setSectionBusy(s.id)
    try {
      await fetch(`/api/profile/sections/${s.id}`, { method: "DELETE" })
      setSections((prev) => prev.filter((x) => x.id !== s.id))
      // The server clears pinnedSection too — mirror it in working AND
      // baseline so no phantom dirty flag appears.
      if (settings?.pinnedSection === s.id) {
        setSettings((w) => w && { ...w, pinnedSection: null })
        setBaseline((b) => {
          try { return JSON.stringify({ ...JSON.parse(b), pinnedSection: null }) } catch { return b }
        })
      }
      setDeleteTarget(null)
    } finally {
      setSectionBusy(null)
    }
  }

  /* ── Reorder helpers for the Layout panel ── */
  const moveInOrder = (list: string[], id: string, dir: -1 | 1) => {
    const idx = list.indexOf(id)
    const swap = idx + dir
    if (idx < 0 || swap < 0 || swap >= list.length || !settings) return
    const next = [...list]
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    return next
  }

  const tabOrder = settings ? settings.sectionOrder.filter((id) => (PROFILE_TAB_IDS as readonly string[]).includes(id)) : []
  const blockOrder = settings ? settings.sectionOrder.filter((id) => (PROFILE_BLOCK_IDS as readonly string[]).includes(id)) : []
  const composeOrder = (blocks: string[], tabs: string[]) => ["overview", ...blocks, ...tabs]

  const setHidden = (id: string, hidden: boolean) =>
    setSettings((s) =>
      s && {
        ...s,
        hiddenSections: hidden ? [...s.hiddenSections, id] : s.hiddenSections.filter((x) => x !== id),
      })

  if (status === "loading" || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" aria-label="Loading" />
      </div>
    )
  }
  if (loadError || !payload || !settings) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <EmptyState icon={User} title="Couldn't load customization" description={loadError ?? undefined} />
      </div>
    )
  }

  const username = payload.profile?.username ?? ""
  const statSlots = payload.customization?.statSlots ?? 4
  const sectionLimit = payload.customization?.sectionLimit ?? 2
  const widgets = payload.customization?.widgets ?? { records: false, ownerInsights: false }
  const visibilityLabel = (v: string) => (v === "UNLISTED" ? "Unlisted" : v === "PRIVATE" ? "Private" : v === "MEMBERS" ? "Members" : v)

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto px-4 py-6 sm:py-8 pb-28">
        <PageHeader
          size="md"
          title="Customize profile"
          description="Presets only — your profile stays fast, safe, and TerpTalk-coherent. Custom sections use Markdown."
          context={<Link href={`/u/${encodeURIComponent(username)}`} className="text-primary hover:underline">← View your profile</Link>}
          actions={
            <Link href="/profile" className="rounded-full bg-secondary/70 px-3.5 py-1.5 text-xs font-medium hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              Account settings
            </Link>
          }
        />

        {/* Live preview — real components inside the same preset scope the
            public profile uses. */}
        <div
          className="rounded-2xl border border-border/70 bg-card/80 overflow-hidden mb-6"
          data-paccent={settings.accent}
          data-ptheme={settings.theme}
          data-pdensity={settings.density}
        >
          <p className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Preview</p>
          {settings.bannerImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={settings.bannerImage} alt="" className="h-16 w-full object-cover" />
          ) : (
            <div className="tt-spectrum-bar h-1 mt-2" />
          )}
          <div className="p-4 flex items-center gap-3 flex-wrap">
            <Avatar src={payload.profile?.avatarUrl} alt="" size="md" className="bg-primary/10 text-primary" fallback={<User className="w-5 h-5 text-primary" />} />
            <div className="min-w-0 flex-1">
              <p className="font-display font-bold break-words">@{username}</p>
              <div className="flex items-center gap-1.5 flex-wrap mt-1">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-medium">
                  <Sprout className="w-3 h-3" aria-hidden="true" /> {payload.stats?.rank?.name ?? "Seed"}
                </span>
                <Tag variant="muted">sample tag</Tag>
                <a href="#preview" className="text-xs text-primary hover:underline" onClick={(e) => e.preventDefault()}>sample link</a>
              </div>
            </div>
            <span className="rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium">Primary</span>
          </div>
        </div>

        <Tabs
          syncWithUrl
          defaultValue="appearance"
          ariaLabel="Customization categories"
          items={[
            { id: "appearance", label: "Appearance" },
            { id: "layout", label: "Layout" },
            { id: "content", label: "Content" },
            { id: "identity", label: "Identity" },
          ]}
        >
          {(active) => (
            <div className="space-y-4 mt-4">
              {/* ── APPEARANCE ── */}
              {active === "appearance" && (
                <>
                  <SectionCard title="Theme" description="A preset look for your profile surfaces.">
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Theme">
                      {THEME_META.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="radio"
                          aria-checked={settings.theme === t.id}
                          onClick={() => setSettings((s) => s && { ...s, theme: t.id })}
                          className={cn(
                            "text-left rounded-xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            settings.theme === t.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                          )}
                        >
                          <span className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-md border border-border/70 shrink-0" style={{ background: t.swatch }} aria-hidden="true" />
                            <span className="font-medium text-sm">{t.name}</span>
                          </span>
                          <span className="block text-xs text-muted-foreground mt-1">{t.description}</span>
                        </button>
                      ))}
                    </div>
                  </SectionCard>

                  <SectionCard title="Accent" description="The action color on your profile — buttons, links, selected tabs.">
                    <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5" role="radiogroup" aria-label="Accent">
                      {ACCENT_META.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          role="radio"
                          aria-checked={settings.accent === a.id}
                          onClick={() => setSettings((s) => s && { ...s, accent: a.id })}
                          className={cn(
                            "text-left rounded-xl border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            settings.accent === a.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                          )}
                        >
                          <span className="w-8 h-8 rounded-full block mb-2" style={{ background: a.swatch }} aria-hidden="true" />
                          <span className="font-medium text-sm block">{a.name}</span>
                          <span className="block text-[11px] text-muted-foreground mt-0.5 leading-snug">{a.description}</span>
                        </button>
                      ))}
                    </div>
                  </SectionCard>

                  <SectionCard title="Density" description="How tightly your profile packs its sections.">
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Density">
                      {DENSITY_META.map((d) => (
                        <button
                          key={d.id}
                          type="button"
                          role="radio"
                          aria-checked={settings.density === d.id}
                          onClick={() => setSettings((s) => s && { ...s, density: d.id })}
                          className={cn(
                            "rounded-xl border px-4 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            settings.density === d.id ? "border-primary bg-primary/5 font-medium" : "border-border hover:border-primary/40"
                          )}
                        >
                          {d.name}
                          <span className="block text-[11px] text-muted-foreground font-normal">{d.description}</span>
                        </button>
                      ))}
                    </div>
                  </SectionCard>

                  <SectionCard title="Banner" description="An image strip across the top of your profile. Images are resized, stripped of metadata, and stored on TerpTalk storage.">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        ref={bannerInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        className="sr-only"
                        aria-label="Upload banner image"
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) uploadBanner(f)
                        }}
                      />
                      <button
                        type="button"
                        disabled={bannerBusy}
                        onClick={() => bannerInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      >
                        {bannerBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" aria-hidden="true" />}
                        {settings.bannerImage ? "Replace banner" : "Upload banner"}
                      </button>
                      {settings.bannerImage && (
                        <button
                          type="button"
                          disabled={bannerBusy}
                          onClick={removeBanner}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-secondary/70 px-4 py-2 text-sm font-medium hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        >
                          <X className="w-4 h-4" aria-hidden="true" /> Remove
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">PNG, JPEG, or WebP. Cropped to a wide strip — keep the focus near the center.</p>
                  </SectionCard>
                </>
              )}

              {/* ── LAYOUT ── */}
              {active === "layout" && (
                <>
                  <SectionCard title="Tab order" description="Overview always leads — reorder the rest with the arrows.">
                    <ul className="space-y-1.5">
                      <li className="flex items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Overview</span>
                        <span className="text-xs">— always first</span>
                      </li>
                      {tabOrder.map((id, i) => (
                        <ReorderRow
                          key={id}
                          name={SECTION_INFO[id]?.name ?? id}
                          desc={SECTION_INFO[id]?.desc}
                          first={i === 0}
                          last={i === tabOrder.length - 1}
                          onUp={() => {
                            const next = moveInOrder(tabOrder, id, -1)
                            if (next) setSettings((s) => s && { ...s, sectionOrder: composeOrder(blockOrder, next) })
                          }}
                          onDown={() => {
                            const next = moveInOrder(tabOrder, id, 1)
                            if (next) setSettings((s) => s && { ...s, sectionOrder: composeOrder(blockOrder, next) })
                          }}
                        />
                      ))}
                    </ul>
                  </SectionCard>

                  <SectionCard title="Overview order" description="The stacked blocks on your profile home.">
                    <ul className="space-y-1.5">
                      {blockOrder.filter((id) => ["featured", "stats", "records", "pinned", "history"].includes(id)).map((id, i, arr) => (
                        <ReorderRow
                          key={id}
                          name={SECTION_INFO[id]?.name ?? id}
                          desc={SECTION_INFO[id]?.desc}
                          locked={id === "records" && !widgets.records ? "Unlocks at Harvested" : undefined}
                          first={i === 0}
                          last={i === arr.length - 1}
                          onUp={() => {
                            const ids = arr
                            const idx = ids.indexOf(id)
                            const swapId = ids[idx - 1]
                            if (!swapId) return
                            const next = [...blockOrder]
                            const ai = next.indexOf(id); const bi = next.indexOf(swapId)
                            ;[next[ai], next[bi]] = [next[bi], next[ai]]
                            setSettings((s) => s && { ...s, sectionOrder: composeOrder(next, tabOrder) })
                          }}
                          onDown={() => {
                            const ids = arr
                            const idx = ids.indexOf(id)
                            const swapId = ids[idx + 1]
                            if (!swapId) return
                            const next = [...blockOrder]
                            const ai = next.indexOf(id); const bi = next.indexOf(swapId)
                            ;[next[ai], next[bi]] = [next[bi], next[ai]]
                            setSettings((s) => s && { ...s, sectionOrder: composeOrder(next, tabOrder) })
                          }}
                        />
                      ))}
                    </ul>
                  </SectionCard>

                  <SectionCard title="Hidden sections" description="Hide what you don't want on your profile. Hidden tabs and blocks disappear completely.">
                    <ul className="grid gap-1.5 sm:grid-cols-2">
                      {PROFILE_SECTION_IDS.filter((id) => id !== "overview").map((id) => {
                        const info = SECTION_INFO[id]
                        const locked =
                          id === "records" && !widgets.records ? "Unlocks at Harvested"
                          : id === "owner-insights" && !widgets.ownerInsights ? "Unlocks at Cured"
                          : undefined
                        const hidden = settings.hiddenSections.includes(id)
                        return (
                          <li key={id}>
                            <label className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2 cursor-pointer transition-colors", hidden ? "border-border bg-secondary/40" : "border-border hover:border-primary/40")}>
                              <input
                                type="checkbox"
                                checked={!hidden}
                                onChange={(e) => setHidden(id, !e.target.checked)}
                                className="mt-0.5 accent-primary"
                              />
                              <span className="min-w-0">
                                <span className="flex items-center gap-1.5 text-sm font-medium">
                                  {info?.name ?? id}
                                  {locked && (
                                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                      <Lock className="w-3 h-3" aria-hidden="true" /> {locked}
                                    </span>
                                  )}
                                </span>
                                {info?.desc && <span className="block text-xs text-muted-foreground">{info.desc}</span>}
                              </span>
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                  </SectionCard>

                  <SectionCard title="Pinned section" description="Pin one of your custom sections near the top of your overview.">
                    <select
                      value={settings.pinnedSection ?? ""}
                      onChange={(e) => setSettings((s) => s && { ...s, pinnedSection: e.target.value || null })}
                      className="w-full max-w-sm rounded-xl border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Pinned custom section"
                    >
                      <option value="">None</option>
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>{s.title}</option>
                      ))}
                    </select>
                    {sections.length === 0 && (
                      <p className="text-xs text-muted-foreground mt-2">Create a custom section in the Content tab first.</p>
                    )}
                  </SectionCard>
                </>
              )}

              {/* ── CONTENT ── */}
              {active === "content" && (
                <>
                  <SectionCard title="Featured grow" description="Lead your profile with the grow you're proudest of — any visibility works; visitors only see it if it's public.">
                    <div className="flex items-center gap-2 flex-wrap">
                      <select
                        value={featuredId ?? ""}
                        disabled={featuredBusy}
                        onChange={(e) => setFeatured(e.target.value || null)}
                        className="w-full max-w-sm rounded-xl border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                        aria-label="Featured grow"
                      >
                        <option value="">Latest active grow</option>
                        {(payload.featureableDiaries ?? []).map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.title}{d.strain ? ` — ${d.strain}` : ""}{d.visibility !== "PUBLIC" ? ` (${visibilityLabel(d.visibility)})` : ""}
                          </option>
                        ))}
                      </select>
                      {featuredBusy && <Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden="true" />}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Leave empty to show your freshest active grow automatically.</p>
                  </SectionCard>

                  <SectionCard
                    title="Custom sections"
                    description={`Markdown-formatted sections on your About tab. ${sections.length} of ${sectionLimit} used${sectionLimit < 8 ? " — higher ranks unlock more" : ""}.`}
                    actions={
                      !newSection && sections.length < sectionLimit ? (
                        <button
                          type="button"
                          onClick={() => setNewSection({ title: "", body: "", visibility: "PUBLIC" })}
                          className="inline-flex items-center gap-1 rounded-xl bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New section
                        </button>
                      ) : undefined
                    }
                  >
                    {newSection && (
                      <SectionEditor
                        value={newSection}
                        busy={sectionBusy === "new"}
                        submitLabel="Create section"
                        onChange={setNewSection}
                        onSubmit={createSection}
                        onCancel={() => setNewSection(null)}
                      />
                    )}
                    {sections.length === 0 && !newSection ? (
                      <EmptyState compact title="No custom sections" description="Add up to a few of your own — grow notes, links, rules for DMs, anything Markdown." />
                    ) : (
                      <ul className="space-y-2">
                        {sections.map((s, i) => (
                          <li key={s.id} className="rounded-xl border border-border p-3">
                            {editingSection?.id === s.id ? (
                              <SectionEditor
                                value={editingSection}
                                busy={sectionBusy === s.id}
                                submitLabel="Save section"
                                onChange={(v) => setEditingSection((prev) => prev && { ...prev, ...v })}
                                onSubmit={() => updateSection(editingSection)}
                                onCancel={() => setEditingSection(null)}
                              />
                            ) : (
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium text-sm break-words flex items-center gap-2">
                                    {s.title}
                                    {settings.pinnedSection === s.id && (
                                      <Tag variant="primary"><Pin className="w-3 h-3 mr-0.5" aria-hidden="true" />Pinned</Tag>
                                    )}
                                    {s.visibility !== "PUBLIC" && (
                                      <Tag variant="muted">{s.visibility === "MEMBERS" ? "Members" : "Only you"}</Tag>
                                    )}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1 break-words">{s.body.slice(0, 90)}</p>
                                </div>
                                <div className="flex items-center gap-0.5 shrink-0">
                                  <button type="button" aria-label={`Move "${s.title}" up`} disabled={i === 0 || !!sectionBusy} onClick={() => moveSection(s.id, -1)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30">
                                    <ArrowUp className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                  <button type="button" aria-label={`Move "${s.title}" down`} disabled={i === sections.length - 1 || !!sectionBusy} onClick={() => moveSection(s.id, 1)} className="p-1.5 rounded-lg hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30">
                                    <ArrowDown className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                  <button type="button" onClick={() => setEditingSection(s)} disabled={!!sectionBusy} className="px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30">
                                    Edit
                                  </button>
                                  <button type="button" aria-label={`Delete "${s.title}"`} onClick={() => setDeleteTarget(s)} disabled={!!sectionBusy} className="p-1.5 rounded-lg text-destructive hover:bg-destructive/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30">
                                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </SectionCard>

                  <SectionCard title="Widgets" description="Progression widgets — they appear on your profile automatically once unlocked.">
                    <ul className="space-y-1.5">
                      {PROFILE_WIDGETS.map((w) => {
                        const unlocked = w.id === "records" ? widgets.records : widgets.ownerInsights
                        return (
                          <li key={w.id} className="flex items-start gap-2.5 rounded-xl border border-border px-3 py-2.5">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium flex items-center gap-2">
                                {w.name}
                                {!unlocked && <Tag variant="muted"><Lock className="w-3 h-3 mr-0.5" aria-hidden="true" />{w.id === "records" ? "Harvested" : "Cured"}</Tag>}
                                {w.ownerOnly && <Tag variant="muted">Private</Tag>}
                              </p>
                              <p className="text-xs text-muted-foreground">{w.description}</p>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  </SectionCard>
                </>
              )}

              {/* ── IDENTITY ── */}
              {active === "identity" && (
                <>
                  <SectionCard
                    title="Notable stats"
                    description={`Pick the stats shown on your profile — ${settings.shownStats.length} of ${statSlots} slots${statSlots < 8 ? " (higher ranks unlock more)" : ""}.`}
                  >
                    <ul className="grid gap-1.5 sm:grid-cols-2">
                      {NOTABLE_STAT_IDS.map((id) => {
                        const checked = settings.shownStats.includes(id)
                        const atCap = !checked && settings.shownStats.length >= statSlots
                        return (
                          <li key={id}>
                            <label className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2 text-sm transition-colors", checked ? "border-primary bg-primary/5 font-medium" : atCap ? "border-border opacity-50 cursor-not-allowed" : "border-border hover:border-primary/40 cursor-pointer")}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={atCap}
                                onChange={(e) =>
                                  setSettings((s) =>
                                    s && {
                                      ...s,
                                      shownStats: e.target.checked ? [...s.shownStats, id] : s.shownStats.filter((x) => x !== id),
                                    }
                                  )
                                }
                                className="accent-primary"
                              />
                              {NOTABLE_STAT_LABELS[id]}
                            </label>
                          </li>
                        )
                      })}
                    </ul>
                    <p className="text-xs text-muted-foreground mt-2">The first four show in your hero; the rest appear on your overview.</p>
                  </SectionCard>

                  <SectionCard title="Grow mediums" description="What you grow in — shown as chips on your profile.">
                    <ChipPicker
                      options={PROFILE_MEDIUMS}
                      selected={settings.identity.mediums}
                      onToggle={(m) =>
                        setSettings((s) => s && {
                          ...s,
                          identity: { ...s.identity, mediums: s.identity.mediums.includes(m) ? s.identity.mediums.filter((x) => x !== m) : [...s.identity.mediums, m] },
                        })
                      }
                    />
                  </SectionCard>

                  <SectionCard title="Growing style" description="How you run your grows.">
                    <ChipPicker
                      options={PROFILE_STYLES}
                      selected={settings.identity.styles}
                      onToggle={(v) =>
                        setSettings((s) => s && {
                          ...s,
                          identity: { ...s.identity, styles: s.identity.styles.includes(v) ? s.identity.styles.filter((x) => x !== v) : [...s.identity.styles, v] },
                        })
                      }
                    />
                  </SectionCard>

                  <SectionCard title="Goals" description="What you're working toward — up to 280 characters.">
                    <textarea
                      value={settings.identity.goals}
                      maxLength={PROFILE_GOALS_MAX}
                      rows={3}
                      onChange={(e) => setSettings((s) => s && { ...s, identity: { ...s.identity, goals: e.target.value } })}
                      placeholder="e.g. dial in my no-till bed and finish a full organic run"
                      className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
                      aria-label="Growing goals"
                    />
                    <p className="text-xs text-muted-foreground mt-1 text-right tabular-nums">{settings.identity.goals.length}/{PROFILE_GOALS_MAX}</p>
                  </SectionCard>
                </>
              )}
            </div>
          )}
        </Tabs>

        {saveError && (
          <p role="alert" className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {saveError}
          </p>
        )}
      </div>

      {/* Sticky save bar — settings edits are explicit-save; section CRUD,
          banner and featured grow apply immediately. */}
      {dirty && (
        <div className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-card/95 backdrop-blur">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Unsaved changes</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSettings(JSON.parse(baseline))}
                disabled={saving}
                className="rounded-xl bg-secondary/70 px-4 py-2 text-sm font-medium hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => settings && saveSettings(settings)}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Save className="w-4 h-4" aria-hidden="true" />}
                Save changes
              </button>
            </div>
          </div>
        </div>
      )}
      {savedTick && !dirty && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-full bg-primary text-primary-foreground px-4 py-1.5 text-sm font-medium shadow-lg" role="status">
          Saved
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => { if (deleteTarget) await deleteSection(deleteTarget) }}
        title={`Delete "${deleteTarget?.title ?? ""}"?`}
        description="This section is removed from your profile for everyone. This can't be undone."
        confirmLabel="Delete section"
        destructive
      />
    </div>
  )
}

/* ── Bits ────────────────────────────────────────────────────────── */

function ReorderRow({
  name, desc, locked, first, last, onUp, onDown,
}: {
  name: string
  desc?: string
  locked?: string
  first: boolean
  last: boolean
  onUp: () => void
  onDown: () => void
}) {
  return (
    <li className="flex items-center gap-2 rounded-xl border border-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium flex items-center gap-2">
          {name}
          {locked && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Lock className="w-3 h-3" aria-hidden="true" /> {locked}
            </span>
          )}
        </p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <button type="button" aria-label={`Move ${name} up`} disabled={first} onClick={onUp} className="p-1.5 rounded-lg hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30">
          <ArrowUp className="w-4 h-4" aria-hidden="true" />
        </button>
        <button type="button" aria-label={`Move ${name} down`} disabled={last} onClick={onDown} className="p-1.5 rounded-lg hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30">
          <ArrowDown className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  )
}

function ChipPicker({
  options, selected, onToggle,
}: {
  options: readonly string[]
  selected: string[]
  onToggle: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = selected.includes(o)
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
            )}
          >
            {o.replace(/_/g, " ")}
          </button>
        )
      })}
    </div>
  )
}

function SectionEditor({
  value, busy, submitLabel, onChange, onSubmit, onCancel,
}: {
  value: { title: string; body: string; visibility: CustomSection["visibility"] }
  busy: boolean
  submitLabel: string
  onChange: (v: { title: string; body: string; visibility: CustomSection["visibility"] }) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const [preview, setPreview] = useState(false)
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-3 space-y-2.5 mb-3">
      <input
        type="text"
        value={value.title}
        maxLength={PROFILE_SECTION_TITLE_MAX}
        placeholder="Section title"
        aria-label="Section title"
        onChange={(e) => onChange({ ...value, title: e.target.value })}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex gap-1.5" role="radiogroup" aria-label="Section visibility">
        {VISIBILITY_INFO.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={value.visibility === v.id}
            onClick={() => onChange({ ...value, visibility: v.id })}
            className={cn(
              "rounded-lg border px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              value.visibility === v.id ? "border-primary bg-primary/10 font-medium" : "border-border hover:border-primary/40"
            )}
          >
            {v.name}
            <span className="block text-[10px] text-muted-foreground font-normal">{v.desc}</span>
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <label htmlFor="section-body" className="text-xs text-muted-foreground">Markdown — headings, lists, links. No HTML.</label>
        <button type="button" onClick={() => setPreview((p) => !p)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
          <ChevronDown className={cn("w-3 h-3 transition-transform", preview && "rotate-180")} aria-hidden="true" />
          {preview ? "Edit" : "Preview"}
        </button>
      </div>
      {preview ? (
        <div className="rounded-lg border border-border bg-card px-3 py-2 text-sm min-h-16">
          {value.body.trim() ? <MarkdownRenderer content={value.body} /> : <p className="text-muted-foreground text-xs">Nothing to preview yet.</p>}
        </div>
      ) : (
        <textarea
          id="section-body"
          value={value.body}
          maxLength={PROFILE_SECTION_BODY_MAX}
          rows={5}
          placeholder="## My grow notes&#10;- what worked&#10;- what I'd change"
          onChange={(e) => onChange({ ...value, body: e.target.value })}
          className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-y"
        />
      )}
      <p className="text-[11px] text-muted-foreground text-right tabular-nums">{value.body.length}/{PROFILE_SECTION_BODY_MAX}</p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg bg-secondary/70 px-3.5 py-1.5 text-sm font-medium hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy || !value.title.trim() || !value.body.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3.5 py-1.5 text-sm font-medium hover:bg-primary/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
