import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Admin",
  description: "TerpTalk administration panel.",
  robots: { index: false, follow: false },
})

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children
}
