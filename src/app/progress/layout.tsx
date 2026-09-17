import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "My Progress",
  description: "Your TerpTalk progression — level, reputation, quests, challenges, and achievements.",
  // Owner-only data — the page redirects guests, but keep it out of the index.
  robots: { index: false, follow: false },
}

export default function ProgressLayout({ children }: { children: React.ReactNode }) {
  return children
}
