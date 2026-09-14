import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "My Progress",
  description: "Your TerpTalk progression — level, reputation, quests, challenges, and achievements.",
}

export default function ProgressLayout({ children }: { children: React.ReactNode }) {
  return children
}
