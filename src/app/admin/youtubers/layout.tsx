import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "YouTuber Applications",
  description: "Review featured YouTuber applications.",
  robots: { index: false, follow: false },
})

export default function YouTuberApplicationsLayout({ children }: { children: React.ReactNode }) {
  return children
}
