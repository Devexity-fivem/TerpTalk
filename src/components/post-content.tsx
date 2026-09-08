import { Suspense } from "react"
import AffiliateCard from "@/components/affiliate-card"

// Renders post content, expanding [affiliate_product id="slug"] shortcodes
// into live product cards. Staff-only insertion is enforced by checking
// the author role — members can't inject cards.
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
    <div className="whitespace-pre-wrap break-words">
      {parts.map((part, i) => {
        // Odd indices are captured slugs
        if (i % 2 === 1) {
          if (!isStaff) return null // non-staff shortcodes are stripped
          return (
            <Suspense key={i} fallback={null}>
              <AffiliateCard slug={part} from={pagePath} />
            </Suspense>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </div>
  )
}
