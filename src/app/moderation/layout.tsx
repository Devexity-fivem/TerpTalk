import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Moderation",
  description: "TerpTalk moderation queue.",
  robots: { index: false, follow: false },
})

export default function ModerationLayout({ children }: { children: React.ReactNode }) {
  return children
}
