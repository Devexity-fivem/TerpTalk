import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Creator Application",
  description: "Apply to become a featured TerpTalk creator.",
  robots: { index: false, follow: false },
})

export default function CreatorApplicationLayout({ children }: { children: React.ReactNode }) {
  return children
}
