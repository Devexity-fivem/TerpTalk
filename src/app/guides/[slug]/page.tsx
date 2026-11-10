import { prisma } from "@/lib/prisma"
import { notFound } from "next/navigation"
import { BookOpen, Pencil } from "@/lib/icons"
import Link from "next/link"
import ShareButtons from "@/components/share-buttons"
import { buildMetadata, snippet } from "@/lib/seo"
import { JsonLd } from "@/components/json-ld"
import { Breadcrumbs } from "@/components/breadcrumbs"
import ProfileCard from "@/components/ui/profile-card"
import SectionCard from "@/components/ui/section-card"
import { getSession } from "@/lib/session"
import { isModerator, activeAuthor, publicUserSelect, isActiveAuthorRow } from "@/lib/security"
import { TOPIC_TO_CATEGORY_SLUGS } from "@/lib/guides"
import { MessageSquare } from "@/lib/icons"

export const dynamic = "force-dynamic"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const guide = await prisma.guide.findUnique({ where: { slug }, select: { title: true, excerpt: true, published: true, topic: true } })
  if (!guide || !guide.published) return buildMetadata({ title: "Guide not found", robots: { index: false } })
  return buildMetadata({
    title: `${guide.title} — Cannabis Grow Guide`,
    description: snippet(guide.excerpt),
    keywords: [guide.topic, "cannabis grow guide", "how to grow cannabis"],
    pathname: `/guides/${slug}`,
    og: { type: "article" },
  })
}

// Display labels mirror the canonical topic vocabulary (lib/guides GUIDE_TOPICS,
// same as the authoring form's TOPICS). Unknown values fall back safely.
const TOPIC_LABELS: Record<string, string> = {
  BASICS: "Basics",
  NUTRIENTS: "Nutrients",
  HARVEST: "Harvest",
  PESTS: "Pests",
  ENVIRONMENT: "Environment",
  GENETICS: "Genetics",
  TRAINING: "Training",
  LAW: "Law",
}
const topicLabel = (t: string) => TOPIC_LABELS[t] ?? t.charAt(0) + t.slice(1).toLowerCase()

// Guide content contract (see /guides/new): plain text with line breaks and
// '##' style headers. This block renderer honors exactly that — headings,
// paragraphs, lists, quotes — without inline markdown parsing, so literal
// characters like underscores in technical text can never be mangled.
type GuideBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "hr" }

function parseGuideBlocks(content: string): GuideBlock[] {
  const lines = content.split(/\r?\n/)
  const blocks: GuideBlock[] = []
  let i = 0
  while (i < lines.length) {
    const trimmed = lines[i].trim()
    if (trimmed === "") { i++; continue }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2].trim() })
      i++
      continue
    }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ type: "hr" })
      i++
      continue
    }
    if (trimmed.startsWith(">")) {
      const quote: string[] = []
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""))
        i++
      }
      blocks.push({ type: "blockquote", lines: quote })
      continue
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ""))
        i++
      }
      blocks.push({ type: "ul", items })
      continue
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""))
        i++
      }
      blocks.push({ type: "ol", items })
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i].trim() !== "") {
      para.push(lines[i].trim())
      i++
    }
    blocks.push({ type: "paragraph", text: para.join("\n") })
  }
  return blocks
}

function GuideContent({ content }: { content: string }) {
  return (
    <div className="max-w-none text-foreground">
      {parseGuideBlocks(content).map((b, i) => {
        const key = `gb-${i}`
        switch (b.type) {
          case "heading": {
            if (b.level <= 2) {
              return <h2 key={key} className="font-display text-2xl font-semibold mt-8 mb-3 tracking-tight text-foreground first:mt-0">{b.text}</h2>
            }
            if (b.level === 3) {
              return <h3 key={key} className="font-display text-xl font-semibold mt-6 mb-2 tracking-tight text-foreground">{b.text}</h3>
            }
            return <h4 key={key} className="font-display text-lg font-semibold mt-5 mb-2 text-foreground">{b.text}</h4>
          }
          case "paragraph":
            return <p key={key} className="mb-4 leading-relaxed whitespace-pre-wrap wrap-break-word text-foreground/90">{b.text}</p>
          case "ul":
            return <ul key={key} className="list-disc pl-5 mb-4 space-y-1.5 marker:text-primary">{b.items.map((it, j) => <li key={`${key}-li-${j}`} className="leading-relaxed">{it}</li>)}</ul>
          case "ol":
            return <ol key={key} className="list-decimal pl-5 mb-4 space-y-1.5 marker:text-primary">{b.items.map((it, j) => <li key={`${key}-li-${j}`} className="leading-relaxed">{it}</li>)}</ol>
          case "blockquote":
            return (
              <blockquote key={key} className="border-l-4 border-primary/50 pl-4 py-1 my-4 italic text-muted-foreground bg-secondary/30 rounded-r-lg">
                {b.lines.map((l, j) => <p key={`${key}-q-${j}`} className="mb-1 last:mb-0">{l}</p>)}
              </blockquote>
            )
          case "hr":
            return <hr key={key} className="my-6 border-border" />
          default:
            return null
        }
      })}
    </div>
  )
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [guide, session] = await Promise.all([
    prisma.guide.findUnique({
      where: { slug },
      include: { author: { select: { name: true, image: true, role: true, banned: true, suspendedUntil: true, profile: { select: { username: true, xp: true, publicMilestoneOptOut: true } } } } },
    }),
    getSession(),
  ])
  if (!guide || !guide.published) notFound()

  // Onward paths — same-topic guides and discussions in the categories this
  // topic maps to (TOPIC_TO_CATEGORY_SLUGS is the canonical mapping).
  const [relatedGuides, relatedThreads] = await Promise.all([
    prisma.guide.findMany({
      where: { published: true, topic: guide.topic, slug: { not: guide.slug }, author: activeAuthor() },
      orderBy: { title: "asc" },
      take: 6,
      select: { title: true, slug: true, excerpt: true },
    }),
    (TOPIC_TO_CATEGORY_SLUGS[guide.topic] ?? []).length > 0
      ? prisma.thread.findMany({
          where: {
            deleted: false,
            author: activeAuthor(),
            category: { hidden: false, slug: { in: TOPIC_TO_CATEGORY_SLUGS[guide.topic] } },
          },
          orderBy: { lastActivityAt: "desc" },
          take: 5,
          select: {
            slug: true,
            title: true,
            replyCount: true,
            author: { select: publicUserSelect },
            category: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ])

  // Edit permission is author-or-moderator — mirrors PATCH /api/guides/[slug].
  // Check the DB role so a stale JWT can't show an Edit link that will 403.
  let canEdit = guide.authorId === session?.user?.id || isModerator(session?.user?.role)
  if (!canEdit && session?.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { banned: true, role: true },
    })
    canEdit = !!user && !user.banned && isModerator(user.role)
  }

  const guideBase = process.env.NEXT_PUBLIC_SITE_URL || "https://terp-talk.vercel.app"
  const guideUrl = `${guideBase}/guides/${guide.slug}`
  const guideSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: snippet(guide.excerpt || guide.content || guide.title),
    articleSection: guide.topic,
    author: {
      "@type": "Person",
      name: guide.author.profile?.username || guide.author.name || "TerpTalk",
    },
    datePublished: guide.createdAt.toISOString(),
    dateModified: guide.updatedAt.toISOString(),
    url: guideUrl,
    mainEntityOfPage: { "@type": "WebPage", "@id": guideUrl },
    publisher: { "@type": "Organization", name: "TerpTalk", url: guideBase },
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <JsonLd data={guideSchema} />
        <Breadcrumbs items={[
          { label: "Grow Guides", href: "/guides" },
          { label: guide.title },
        ]} />
        <article className="tt-spotlight bg-card/80 rounded-2xl border border-border/70">
          <header className="px-6 py-8 md:px-10 md:py-10 border-b border-border/50">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground mb-4">
              <Link href={`/guides?topic=${guide.topic}`} className="tt-eyebrow inline-flex items-center gap-1.5 text-primary hover:underline">
                <BookOpen className="w-3.5 h-3.5" aria-hidden="true" /> {topicLabel(guide.topic)}
              </Link>
              <span aria-hidden="true">·</span>
              {isActiveAuthorRow(guide.author) ? (
                <span className="inline-flex items-center gap-1">by <ProfileCard
                  username={guide.author.profile?.username}
                  name={guide.author.profile?.username || guide.author.name}
                  avatarUrl={guide.author.image}
                  xp={guide.author.profile?.xp}
                  publicMilestoneOptOut={guide.author.profile?.publicMilestoneOptOut}
                  size="sm"
                  className="inline-flex"
                /></span>
              ) : (
                <span>by TerpTalk staff</span>
              )}
              <span aria-hidden="true">·</span>
              <span>{new Date(guide.createdAt).toLocaleDateString()}</span>
              {canEdit && (
                <>
                  <span aria-hidden="true">·</span>
                  <Link href={`/guides/${guide.slug}/edit`} className="inline-flex items-center gap-1 text-primary hover:underline">
                    <Pencil className="w-3 h-3" /> Edit
                  </Link>
                </>
              )}
            </div>
            <h1 className="font-display text-3xl md:text-4xl font-bold mb-3 tracking-tight leading-tight">{guide.title}</h1>
            {guide.excerpt && (
              <p className="text-lg text-muted-foreground leading-relaxed font-display">{guide.excerpt}</p>
            )}
          </header>
          <div className="px-6 py-8 md:px-10 md:py-9">
            <GuideContent content={guide.content} />
            <div className="mt-8 pt-4 border-t border-border">
              <ShareButtons path={`/guides/${guide.slug}`} title={guide.title} />
            </div>
          </div>
        </article>

        {(relatedGuides.length > 0 || relatedThreads.length > 0) && (
          <div className="mt-6 space-y-6">
            {relatedGuides.length > 0 && (
              <SectionCard spotlight title={<span className="flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary" />Related guides</span>}>
                <ul className="space-y-2">
                  {relatedGuides.map((g) => (
                    <li key={g.slug}>
                      <Link href={`/guides/${g.slug}`} className="text-sm font-medium text-primary hover:underline">
                        {g.title}
                      </Link>
                      {g.excerpt && <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{g.excerpt}</p>}
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}
            {relatedThreads.length > 0 && (
              <SectionCard spotlight title={<span className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-primary" />Related discussions</span>}>
                <ul className="space-y-2">
                  {relatedThreads.map((t) => (
                    <li key={t.slug}>
                      <Link href={`/forum/thread/${t.slug}`} className="text-sm font-medium text-primary hover:underline">
                        {t.title}
                      </Link>
                      <p className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1.5 flex-wrap">
                        {t.category.name} · {t.replyCount} repl{t.replyCount === 1 ? "y" : "ies"} · by <ProfileCard
                          username={t.author.profile?.username}
                          name={t.author.profile?.username || t.author.name}
                          avatarUrl={t.author.image}
                          xp={t.author.profile?.xp}
                          publicMilestoneOptOut={t.author.profile?.publicMilestoneOptOut}
                          size="sm"
                        />
                      </p>
                    </li>
                  ))}
                </ul>
              </SectionCard>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
