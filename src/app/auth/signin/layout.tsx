import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Sign In",
  description: "Sign in to your TerpTalk account.",
  robots: { index: false, follow: false },
})

export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return children
}
