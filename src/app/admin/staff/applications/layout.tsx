import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Staff Applications",
  description: "Review TerpTalk staff applications.",
  robots: { index: false, follow: false },
})

export default function StaffApplicationsLayout({ children }: { children: React.ReactNode }) {
  return children
}
