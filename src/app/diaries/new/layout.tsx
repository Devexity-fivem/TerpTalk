import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Create a New Grow Diary",
  description: "Start documenting your cannabis grow on TerpTalk.",
  robots: { index: false, follow: false },
})

export default function DiariesNewLayout({ children }: { children: React.ReactNode }) {
  return children
}
