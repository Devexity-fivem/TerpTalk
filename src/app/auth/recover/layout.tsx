import type { Metadata } from "next"
import { buildMetadata } from "@/lib/seo"

export const metadata: Metadata = buildMetadata({
  title: "Recover Account",
  description: "Recover your TerpTalk account with your recovery phrase.",
})

export default function RecoverAccountLayout({ children }: { children: React.ReactNode }) {
  return children
}
