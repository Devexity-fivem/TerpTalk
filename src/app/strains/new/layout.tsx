import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Add a New Cannabis Strain",
  description: "Add strain genetics and growing information to the TerpTalk database.",
  robots: { index: false, follow: false },
})

export default function StrainsNewLayout({ children }: { children: React.ReactNode }) {
  return children
}
