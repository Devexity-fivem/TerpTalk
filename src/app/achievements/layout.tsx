import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Achievements",
  description: "Your TerpTalk achievements and badges.",
  robots: { index: false, follow: false },
})

export default function AchievementsLayout({ children }: { children: React.ReactNode }) {
  return children
}
