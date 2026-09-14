import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Restricted Account",
  description: "Your TerpTalk account has restricted access.",
  robots: { index: false, follow: false },
})

export default function RestrictedAccountLayout({ children }: { children: React.ReactNode }) {
  return children
}
