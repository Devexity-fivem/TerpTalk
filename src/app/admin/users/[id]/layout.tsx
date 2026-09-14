import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "User Details",
  description: "TerpTalk user administration.",
  robots: { index: false, follow: false },
})

export default function UserDetailsLayout({ children }: { children: React.ReactNode }) {
  return children
}
