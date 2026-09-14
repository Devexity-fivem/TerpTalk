import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Staff Application",
  description: "Apply to join the TerpTalk staff team.",
  robots: { index: false, follow: false },
})

export default function StaffApplicationLayout({ children }: { children: React.ReactNode }) {
  return children
}
