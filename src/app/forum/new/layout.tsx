import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Start a New Discussion",
  description: "Create a new discussion thread on TerpTalk.",
  robots: { index: false, follow: false },
})

export default function ForumNewLayout({ children }: { children: React.ReactNode }) {
  return children
}
