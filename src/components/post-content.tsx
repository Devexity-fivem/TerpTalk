import { Suspense } from "react"
import AffiliateCard from "@/components/affiliate-card"
import { MarkdownRenderer } from "@/lib/markdown"
import MediaEmbed, { EMBED_RE } from "@/components/media-embed"

// Renders post content as safe Markdown, expanding [affiliate_product id="slug"]
// shortcodes into live product cards and auto-embedding YouTube/Vimeo links.
// Staff-only insertion is enforced by checking the author role — members can't
// inject cards.
const SHORTCODE = /\[affiliate_product\s+id="([a-z0-9-]+)"\s*\]/g

export default function PostContent({
  content,
  authorRole,
  pagePath,
}: {
  content: string
  authorRole?: string
  pagePath?: string
}) {
  const isStaff = authorRole === "MODERATOR" || authorRole === "ADMINISTRATOR"
  const parts = content.split(SHORTCODE)

  return (
    <div className="post-content leading-relaxed">
      {parts.map((part, i) => {
        // Odd indices are captured slugs
        if (i % 2 === 1) {
          if (!isStaff) return null
          return (
            <Suspense key={i} fallback={null}>
              <AffiliateCard slug={part} from={pagePath} />
            </Suspense>
          )
        }
        const embedParts = part.split(EMBED_RE)
        return (
          <span key={i}>
            {embedParts.map((chunk, j) => {
              const isEmbed = j % 2 === 1
              if (isEmbed) return <MediaEmbed key={`${i}-e-${j}`} url={chunk} />
              return <MarkdownRenderer key={`${i}-m-${j}`} content={chunk} />
            })}
          </span>
        )
      })}
    </div>
  )
}
