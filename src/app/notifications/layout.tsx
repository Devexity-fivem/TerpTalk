import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Notifications",
  description: "Your TerpTalk notifications.",
  robots: { index: false, follow: false },
})

export default function NotificationsLayout({ children }: { children: React.ReactNode }) {
  return children
}
