import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Sign Up",
  description: "Create your free TerpTalk account and join the cannabis growing community.",
  robots: { index: false, follow: false },
})

export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return children
}
