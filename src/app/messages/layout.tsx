import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Messages",
  description: "Private messages on TerpTalk.",
  robots: { index: false, follow: false },
})

export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return children
}
