import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Site Controls",
  description: "TerpTalk site-wide controls.",
  robots: { index: false, follow: false },
})

export default function SiteControlsLayout({ children }: { children: React.ReactNode }) {
  return children
}
