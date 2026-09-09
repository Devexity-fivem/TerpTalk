import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Authentication",
  description: "Sign in, sign up, or recover your TerpTalk account.",
  robots: { index: false, follow: false },
})

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
