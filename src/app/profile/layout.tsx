import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Your Profile",
  description: "Manage your TerpTalk profile and account.",
  robots: { index: false, follow: false },
})

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return children
}
