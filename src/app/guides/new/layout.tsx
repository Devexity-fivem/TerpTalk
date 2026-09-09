import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Create a New Grow Guide",
  description: "Write a new cannabis grow guide on TerpTalk.",
  robots: { index: false, follow: false },
})

export default function GuidesNewLayout({ children }: { children: React.ReactNode }) {
  return children
}
