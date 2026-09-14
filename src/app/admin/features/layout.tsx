import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Feature Flags",
  description: "TerpTalk feature flag controls.",
  robots: { index: false, follow: false },
})

export default function FeatureFlagsLayout({ children }: { children: React.ReactNode }) {
  return children
}
