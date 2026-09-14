import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Moderation Case",
  description: "TerpTalk moderation case details.",
  robots: { index: false, follow: false },
})

export default function ModerationCaseLayout({ children }: { children: React.ReactNode }) {
  return children
}
