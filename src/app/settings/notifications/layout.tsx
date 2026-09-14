import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Notifications & Privacy",
  description: "TerpTalk notification and privacy settings.",
  robots: { index: false, follow: false },
})

export default function NotificationsPrivacyLayout({ children }: { children: React.ReactNode }) {
  return children
}
