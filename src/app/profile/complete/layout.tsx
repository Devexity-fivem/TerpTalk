import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Complete Your Profile",
  description: "Finish setting up your TerpTalk profile.",
  robots: { index: false, follow: false },
})

export default function CompleteYourProfileLayout({ children }: { children: React.ReactNode }) {
  return children
}
