import type { Metadata } from "next"

const SITE_NAME = "TerpTalk"
const DEFAULT_DESCRIPTION =
  "TerpTalk is a 21+ community for cannabis growers — grow journals, strain database, setup showcases, forums, and live chat. Share your grow, learn from others."
const DEFAULT_TITLE_TEMPLATE = "%s | TerpTalk"
const DEFAULT_TITLE = "TerpTalk — Cannabis Growing Community, Forum & Strain Database"

export const DEFAULT_KEYWORDS = [
  "cannabis growing",
  "cannabis cultivation",
  "grow journal",
  "grow diary",
  "strain database",
  "cannabis forum",
  "indoor growing",
  "outdoor growing",
  "grow lights",
  "grow tents",
  "hydroponics",
  "organic growing",
  "cannabis genetics",
  "cannabis community",
]

export function buildMetadata({
  title,
  description,
  keywords,
  pathname,
  robots,
  og,
  twitter,
}: {
  title?: string
  description?: string
  keywords?: string[]
  pathname?: string
  robots?: { index?: boolean; follow?: boolean }
  og?: { title?: string; description?: string; image?: string; type?: "website" | "article" }
  twitter?: { title?: string; description?: string; image?: string }
} = {}): Metadata {
  const baseUrl = "https://terp-talk.vercel.app"
  const fullTitle = title ? `${title} | ${SITE_NAME}` : DEFAULT_TITLE
  const fullDescription = description || DEFAULT_DESCRIPTION

  return {
    title: title ? { absolute: fullTitle } : { default: DEFAULT_TITLE, template: DEFAULT_TITLE_TEMPLATE },
    description: fullDescription,
    keywords: keywords || DEFAULT_KEYWORDS,
    metadataBase: new URL(baseUrl),
    alternates: pathname ? { canonical: `${baseUrl}${pathname}` } : undefined,
    openGraph: {
      type: og?.type || "website",
      siteName: SITE_NAME,
      title: og?.title || fullTitle,
      description: og?.description || fullDescription,
      url: pathname ? `${baseUrl}${pathname}` : baseUrl,
      images: og?.image ? [{ url: og.image }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: twitter?.title || og?.title || fullTitle,
      description: twitter?.description || og?.description || fullDescription,
      images: (twitter?.image || og?.image) ? [{ url: twitter?.image || og?.image || "" }] : undefined,
    },
    robots: robots || { index: true, follow: true },
  }
}

// Safe truncate for meta descriptions (stay under ~160 chars)
export function metaDescription(text: string, max = 160) {
  if (text.length <= max) return text
  return text.slice(0, max - 1).replace(/\s+\S*$/, "") + "…"
}

// Build a clean, SEO-friendly description from thread/diary content
export function snippet(text: string, max = 160) {
  const plain = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return metaDescription(plain, max)
}
