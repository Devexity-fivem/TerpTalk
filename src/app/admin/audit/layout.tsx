import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Audit Log",
  description: "TerpTalk staff audit log.",
  robots: { index: false, follow: false },
})

export default function AuditLogLayout({ children }: { children: React.ReactNode }) {
  return children
}
