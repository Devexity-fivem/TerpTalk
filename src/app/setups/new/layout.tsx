import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Share a New Grow Setup",
  description: "Show off your grow tent, lights, and equipment on TerpTalk.",
  robots: { index: false, follow: false },
})

export default function SetupsNewLayout({ children }: { children: React.ReactNode }) {
  return children
}
