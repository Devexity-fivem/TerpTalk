import { prisma } from "@/lib/prisma"
import { unstable_cache } from "next/cache"
import { publicUserSelect, activeAuthor } from "@/lib/security"
import { publicDiaryWhere } from "@/lib/diary-visibility"
import { mediaProxyUrl } from "@/lib/media"
import { diaryPath, strainPath, setupPath } from "@/lib/slugs"
import { QUESTION_CATEGORY_RE } from "@/lib/answer-match"
import { MEDIUM_LABELS, LIGHT_LABELS } from "@/lib/grow-fields"

// Discover = the public browse surface. Every query here is public-scope
// (deleted:false + activeAuthor + publicDiaryWhere for diaries); viewer
// block lists are applied as a post-filter on the page, like the strain
// page's photo strip. Cached per tab — modest staleness is fine for a
// browse surface.

export type DiscoverTab =
  | "latest"
  | "trending"
  | "questions"
  | "grows"
  | "harvests"
  | "strains"
  | "setups"
  | "growers"

export const DISCOVER_TABS: DiscoverTab[] = [
  "latest",
  "trending",
  "questions",
  "grows",
  "harvests",
  "strains",
  "setups",
  "growers",
]

export type DiscoverItemKind =
  | "THREAD"
  | "QUESTION"
  | "DIARY"
  | "HARVEST"
  | "STRAIN"
  | "SETUP"
  | "GROWER"

export interface DiscoverAuthor {
  id: string
  name: string | null
  username: string | null
  image: string | null
  role: string
  xp: number
  publicMilestoneOptOut: boolean
}

export interface DiscoverItem {
  kind: DiscoverItemKind
  /** stable id for keys + block filtering */
  id: string
  /** the user this item is attributed to — used for viewer block
   *  post-filtering (null for unattributed catalog rows) */
  userId: string | null
  href: string
  title: string
  /** small descriptor line — category, strain name, medium, etc. */
  subtitle: string | null
  author: DiscoverAuthor | null
  timestamp: string
  /** question status chip — only set for QUESTION items */
  flag?: "open" | "answered" | "solved"
  meta: string[]
  thumb: string | null
}

const LIST_LIMIT = 12
// Over-fetch so the viewer block post-filter can't starve a list.
const FETCH_LIMIT = LIST_LIMIT + 8

type PublicUser = {
  id: string
  name: string | null
  image: string | null
  role: string
  profile: { username: string | null; xp: number; publicMilestoneOptOut: boolean } | null
}

function toAuthor(u: PublicUser): DiscoverAuthor {
  return {
    id: u.id,
    name: u.name,
    username: u.profile?.username ?? null,
    image: u.image,
    role: u.role,
    xp: u.profile?.xp ?? 0,
    publicMilestoneOptOut: u.profile?.publicMilestoneOptOut ?? false,
  }
}

function threadItem(t: {
  id: string
  slug: string
  title: string
  authorId: string
  createdAt: Date
  replyCount: number
  views: number
  author: PublicUser
  category: { name: string }
  kind?: DiscoverItemKind
  flag?: DiscoverItem["flag"]
}): DiscoverItem {
  return {
    kind: t.kind ?? "THREAD",
    id: t.id,
    userId: t.authorId,
    href: `/forum/thread/${t.slug}`,
    title: t.title,
    subtitle: t.category.name,
    author: toAuthor(t.author),
    timestamp: t.createdAt.toISOString(),
    flag: t.flag,
    meta: [`${t.replyCount} repl${t.replyCount === 1 ? "y" : "ies"}`, `${t.views} views`],
    thumb: null,
  }
}

function diaryItem(
  d: {
    id: string
    slug: string | null
    title: string
    authorId: string
    author: PublicUser
    updatedAt: Date
    stage: string
    strain?: string | null
    strainRef?: { name: string } | null
    updates?: { images: { id: string; url: string }[] }[]
    _count?: { updates: number; followers: number }
  },
  kind: "DIARY" | "HARVEST"
): DiscoverItem {
  const strainName = d.strainRef?.name || d.strain || null
  const meta: string[] = []
  if (kind === "HARVEST") meta.push("harvested")
  else meta.push(d.stage.toLowerCase().replace(/_/g, " "))
  if (d._count) meta.push(`${d._count.updates} updates`)
  return {
    kind,
    id: d.id,
    userId: d.authorId,
    href: diaryPath(d),
    title: d.title,
    subtitle: strainName,
    author: toAuthor(d.author),
    timestamp: d.updatedAt.toISOString(),
    meta,
    thumb: d.updates?.[0]?.images[0]?.url ?? null,
  }
}

function threadScore(t: { views: number; replyCount: number; createdAt: Date }) {
  const hours = (Date.now() - new Date(t.createdAt).getTime()) / 36e5
  return (t.views + t.replyCount * 5) / Math.pow(hours + 2, 1.5)
}

// ── Latest — unified chronological stream across content kinds ──────
export async function computeDiscoverLatest(): Promise<DiscoverItem[]> {
  const [threads, diaries, harvests, setups] = await Promise.all([
    prisma.thread.findMany({
      where: { deleted: false, category: { hidden: false }, author: activeAuthor() },
      orderBy: { createdAt: "desc" },
      take: 14,
      select: {
        id: true, slug: true, title: true, createdAt: true, lastActivityAt: true,
        replyCount: true, views: true, authorId: true,
        author: { select: publicUserSelect },
        category: { select: { name: true } },
      },
    }),
    prisma.growDiary.findMany({
      where: { deleted: false, author: activeAuthor(), ...publicDiaryWhere },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true, slug: true, title: true, authorId: true, updatedAt: true, createdAt: true,
        stage: true, strain: true,
        strainRef: { select: { name: true } },
        author: { select: publicUserSelect },
        updates: { take: 1, orderBy: { createdAt: "desc" }, select: { images: { take: 1, orderBy: { order: "asc" } } } },
        _count: { select: { updates: true, followers: true } },
      },
    }),
    prisma.growDiary.findMany({
      where: {
        deleted: false, author: activeAuthor(), ...publicDiaryWhere,
        harvested: true, harvestedAt: { not: null },
      },
      orderBy: { harvestedAt: "desc" },
      take: 6,
      select: {
        id: true, slug: true, title: true, authorId: true, updatedAt: true, harvestedAt: true,
        stage: true, strain: true,
        strainRef: { select: { name: true } },
        author: { select: publicUserSelect },
        updates: { take: 1, orderBy: { createdAt: "desc" }, select: { images: { take: 1, orderBy: { order: "asc" } } } },
        _count: { select: { updates: true, followers: true } },
      },
    }),
    prisma.growSetup.findMany({
      where: { deleted: false, author: activeAuthor() },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true, slug: true, title: true, authorId: true, createdAt: true,
        medium: true, lighting: true,
        author: { select: publicUserSelect },
        images: { take: 1, orderBy: { createdAt: "desc" } },
      },
    }),
  ])

  const setupItem = (s: (typeof setups)[number]): DiscoverItem => ({
    kind: "SETUP",
    id: s.id,
    userId: s.authorId,
    href: setupPath(s),
    title: s.title,
    subtitle:
      [s.medium ? MEDIUM_LABELS[s.medium as keyof typeof MEDIUM_LABELS] ?? s.medium : null, s.lighting ? LIGHT_LABELS[s.lighting as keyof typeof LIGHT_LABELS] ?? s.lighting : null]
        .filter(Boolean)
        .join(" · ") || null,
    author: toAuthor(s.author),
    timestamp: s.createdAt.toISOString(),
    meta: ["setup"],
    thumb: s.images[0] ? mediaProxyUrl("setup", s.images[0].id) : null,
  })

  const merged: { item: DiscoverItem; ts: Date }[] = [
    ...threads.map((t) => ({ item: threadItem(t), ts: t.createdAt })),
    ...diaries.map((d) => ({ item: diaryItem(d, "DIARY"), ts: d.createdAt })),
    ...harvests.map((d) => {
      const item = diaryItem(d, "HARVEST")
      item.timestamp = (d.harvestedAt ?? d.updatedAt).toISOString()
      return { item, ts: d.harvestedAt ?? d.updatedAt }
    }),
    ...setups.map((s) => ({ item: setupItem(s), ts: s.createdAt })),
  ]
  merged.sort((a, b) => b.ts.getTime() - a.ts.getTime() || a.item.id.localeCompare(b.item.id))
  return merged.slice(0, FETCH_LIMIT).map((m) => m.item)
}

// ── Trending — engagement-scored threads + featured grows ───────────
export async function computeDiscoverTrending(): Promise<{ threads: DiscoverItem[]; diaries: DiscoverItem[] }> {
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [candidates, featuredGrows] = await Promise.all([
    prisma.thread.findMany({
      where: { deleted: false, category: { hidden: false }, createdAt: { gte: oneWeekAgo }, author: activeAuthor() },
      take: 100,
      select: {
        id: true, slug: true, title: true, createdAt: true, lastActivityAt: true,
        replyCount: true, views: true, authorId: true,
        author: { select: publicUserSelect },
        category: { select: { name: true } },
      },
    }),
    prisma.growDiary.findMany({
      where: { deleted: false, author: activeAuthor(), ...publicDiaryWhere },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }, { id: "asc" }],
      take: FETCH_LIMIT,
      select: {
        id: true, slug: true, title: true, authorId: true, updatedAt: true,
        stage: true, strain: true,
        strainRef: { select: { name: true } },
        author: { select: publicUserSelect },
        updates: { take: 1, orderBy: { createdAt: "desc" }, select: { images: { take: 1, orderBy: { order: "asc" } } } },
        _count: { select: { updates: true, followers: true } },
      },
    }),
  ])
  const threads = candidates
    .map((t) => ({ t, score: threadScore(t) }))
    .sort((a, b) => b.score - a.score || a.t.id.localeCompare(b.t.id))
    .slice(0, LIST_LIMIT)
    .map(({ t }) => threadItem(t))
  return { threads, diaries: featuredGrows.map((d) => diaryItem(d, "DIARY")) }
}

// ── Questions — question-category threads, needs-help first ─────────
export async function computeDiscoverQuestions(): Promise<DiscoverItem[]> {
  const categories = await prisma.category.findMany({
    where: { hidden: false },
    select: { id: true, slug: true, name: true },
  })
  const questionCatIds = new Set(
    categories.filter((c) => QUESTION_CATEGORY_RE.test(`${c.slug} ${c.name}`)).map((c) => c.id)
  )
  if (!questionCatIds.size) return []

  const threads = await prisma.thread.findMany({
    where: {
      deleted: false,
      author: activeAuthor(),
      categoryId: { in: [...questionCatIds] },
    },
    orderBy: [{ lastActivityAt: "desc" }, { id: "asc" }],
    take: FETCH_LIMIT * 2,
    select: {
      id: true, slug: true, title: true, createdAt: true, lastActivityAt: true,
      replyCount: true, views: true, authorId: true,
      author: { select: publicUserSelect },
      category: { select: { name: true } },
      acceptedAnswer: { select: { deleted: true } },
    },
  })

  const flagged = threads.map((t) => {
    const flag: DiscoverItem["flag"] =
      t.acceptedAnswer && !t.acceptedAnswer.deleted ? "solved" : t.replyCount > 0 ? "answered" : "open"
    return { t, flag }
  })
  const rank = { open: 0, answered: 1, solved: 2 } as const
  flagged.sort(
    (a, b) =>
      rank[a.flag] - rank[b.flag] ||
      b.t.lastActivityAt.getTime() - a.t.lastActivityAt.getTime() ||
      a.t.id.localeCompare(b.t.id)
  )
  return flagged.slice(0, FETCH_LIMIT).map(({ t, flag }) =>
    threadItem({ ...t, kind: "QUESTION" as const, flag })
  )
}

// ── Grows / Harvests ────────────────────────────────────────────────
export async function computeDiscoverGrows(): Promise<DiscoverItem[]> {
  const diaries = await prisma.growDiary.findMany({
    where: { deleted: false, author: activeAuthor(), ...publicDiaryWhere },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: FETCH_LIMIT,
    select: {
      id: true, slug: true, title: true, authorId: true, updatedAt: true,
      stage: true, strain: true,
      strainRef: { select: { name: true } },
      author: { select: publicUserSelect },
      updates: { take: 1, orderBy: { createdAt: "desc" }, select: { images: { take: 1, orderBy: { order: "asc" } } } },
      _count: { select: { updates: true, followers: true } },
    },
  })
  return diaries.map((d) => diaryItem(d, "DIARY"))
}

export async function computeDiscoverHarvests(): Promise<DiscoverItem[]> {
  const diaries = await prisma.growDiary.findMany({
    where: {
      deleted: false, author: activeAuthor(), ...publicDiaryWhere,
      harvested: true, harvestedAt: { not: null },
    },
    orderBy: [{ harvestedAt: "desc" }, { id: "asc" }],
    take: FETCH_LIMIT,
    select: {
      id: true, slug: true, title: true, authorId: true, updatedAt: true, harvestedAt: true,
      harvestRating: true, yieldAmount: true, yieldUnit: true, yieldPrivate: true,
      stage: true, strain: true,
      strainRef: { select: { name: true } },
      author: { select: publicUserSelect },
      updates: { take: 1, orderBy: { createdAt: "desc" }, select: { images: { take: 1, orderBy: { order: "asc" } } } },
      _count: { select: { updates: true, followers: true } },
    },
  })
  return diaries.map((d) => {
    const item = diaryItem(d, "HARVEST")
    item.timestamp = (d.harvestedAt ?? d.updatedAt).toISOString()
    if (d.harvestRating != null) item.meta.push(`${d.harvestRating}/10`)
    if (d.yieldAmount != null && !d.yieldPrivate) item.meta.push(`${d.yieldAmount} ${d.yieldUnit ?? "g"}`)
    return item
  })
}

// ── Strains — catalog entries ranked by public grow count ───────────
export async function computeDiscoverStrains(): Promise<DiscoverItem[]> {
  const strains = await prisma.strain.findMany({
    orderBy: [{ diaries: { _count: "desc" } }, { name: "asc" }],
    take: FETCH_LIMIT,
    select: {
      id: true, slug: true, name: true, type: true, breeder: true,
      breederImageUrl: true, createdAt: true, createdById: true,
      _count: {
        select: { diaries: { where: { deleted: false, visibility: "PUBLIC" } } },
      },
    },
  })
  return strains.map((s) => ({
    kind: "STRAIN" as const,
    id: s.id,
    userId: s.createdById,
    href: strainPath(s),
    title: s.name,
    subtitle: [s.type ? s.type.toLowerCase().replace(/_/g, " ") : null, s.breeder].filter(Boolean).join(" · ") || null,
    author: null,
    timestamp: s.createdAt.toISOString(),
    meta: s._count.diaries > 0 ? [`${s._count.diaries} public grow${s._count.diaries === 1 ? "" : "s"}`] : ["catalog entry"],
    thumb: s.breederImageUrl,
  }))
}

// ── Setups ──────────────────────────────────────────────────────────
export async function computeDiscoverSetups(): Promise<DiscoverItem[]> {
  const setups = await prisma.growSetup.findMany({
    where: { deleted: false, author: activeAuthor() },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: FETCH_LIMIT,
    select: {
      id: true, slug: true, title: true, authorId: true, createdAt: true,
      medium: true, lighting: true,
      author: { select: publicUserSelect },
      images: { take: 1, orderBy: { createdAt: "desc" } },
    },
  })
  return setups.map((s) => ({
    kind: "SETUP" as const,
    id: s.id,
    userId: s.authorId,
    href: setupPath(s),
    title: s.title,
    subtitle:
      [s.medium ? MEDIUM_LABELS[s.medium as keyof typeof MEDIUM_LABELS] ?? s.medium : null, s.lighting ? LIGHT_LABELS[s.lighting as keyof typeof LIGHT_LABELS] ?? s.lighting : null]
        .filter(Boolean)
        .join(" · ") || null,
    author: toAuthor(s.author),
    timestamp: s.createdAt.toISOString(),
    meta: ["setup"],
    thumb: s.images[0] ? mediaProxyUrl("setup", s.images[0].id) : null,
  }))
}

// ── Growers — active contributors, online-status rules respected ────
// Ordering by lastSeenAt follows the homepage "who's online" precedent:
// only members who did NOT opt out of online status ever appear, and
// the value itself is never displayed.
export async function computeDiscoverGrowers(): Promise<DiscoverItem[]> {
  const users = await prisma.user.findMany({
    where: {
      ...activeAuthor(),
      AND: [
        { profile: { isNot: { username: "terpbot" } } },
        { OR: [{ profile: { hideOnlineStatus: false } }, { profile: null }] },
      ],
      OR: [
        { posts: { some: { deleted: false } } },
        { threadCreator: { some: { deleted: false } } },
        { diaryCreator: { some: { deleted: false, visibility: "PUBLIC" } } },
      ],
    },
    orderBy: [{ lastSeenAt: "desc" }, { id: "asc" }],
    take: FETCH_LIMIT,
    select: publicUserSelect,
  })
  return users.map((u) => {
    const a = toAuthor(u)
    return {
      kind: "GROWER" as const,
      id: u.id,
      userId: u.id,
      href: `/u/${a.username ?? u.id}`,
      title: a.username || a.name || "Member",
      subtitle: null,
      author: a,
      timestamp: "",
      meta: ["grower"],
      thumb: null,
    }
  })
}

// Cached wrappers — one entry per section, all bounded.
const getLatest = unstable_cache(computeDiscoverLatest, ["discover-latest"], {
  revalidate: 300,
  tags: ["forum", "diaries", "setups"],
})
const getTrending = unstable_cache(computeDiscoverTrending, ["discover-trending"], {
  revalidate: 300,
  tags: ["forum", "diaries"],
})
const getQuestions = unstable_cache(computeDiscoverQuestions, ["discover-questions"], {
  revalidate: 300,
  tags: ["forum"],
})
const getGrows = unstable_cache(computeDiscoverGrows, ["discover-grows"], {
  revalidate: 300,
  tags: ["diaries"],
})
const getHarvests = unstable_cache(computeDiscoverHarvests, ["discover-harvests"], {
  revalidate: 300,
  tags: ["diaries"],
})
const getStrains = unstable_cache(computeDiscoverStrains, ["discover-strains"], {
  revalidate: 300,
  tags: ["strains", "diaries"],
})
const getSetups = unstable_cache(computeDiscoverSetups, ["discover-setups"], {
  revalidate: 300,
  tags: ["setups"],
})
const getGrowers = unstable_cache(computeDiscoverGrowers, ["discover-growers"], {
  revalidate: 300,
  tags: ["diaries", "forum"],
})

export type DiscoverBrowse =
  | { layout: "trending"; threads: DiscoverItem[]; diaries: DiscoverItem[] }
  | { layout: "list"; items: DiscoverItem[] }

export async function getDiscoverBrowse(tab: DiscoverTab): Promise<DiscoverBrowse> {
  switch (tab) {
    case "trending": {
      const { threads, diaries } = await getTrending()
      return { layout: "trending", threads, diaries }
    }
    case "questions":
      return { layout: "list", items: await getQuestions() }
    case "grows":
      return { layout: "list", items: await getGrows() }
    case "harvests":
      return { layout: "list", items: await getHarvests() }
    case "strains":
      return { layout: "list", items: await getStrains() }
    case "setups":
      return { layout: "list", items: await getSetups() }
    case "growers":
      return { layout: "list", items: await getGrowers() }
    default:
      return { layout: "list", items: await getLatest() }
  }
}

/** Drop items attributed to users the viewer blocks / is blocked by. */
export function filterDiscoverBlocked<T extends { userId: string | null }>(items: T[], blockedIds: string[]): T[] {
  if (!blockedIds.length) return items
  return items.filter((i) => !i.userId || !blockedIds.includes(i.userId))
}
