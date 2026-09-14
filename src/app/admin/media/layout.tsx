import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Media Moderation",
  description: "TerpTalk media moderation queue.",
  robots: { index: false, follow: false },
})

export default function MediaModerationLayout({ children }: { children: React.ReactNode }) {
  return children
}
