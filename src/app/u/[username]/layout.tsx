import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"

export default async function UsernameLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export async function generateMetadata({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const decoded = decodeURIComponent(username)

  const profile = await prisma.profile.findUnique({
    where: { username: decoded },
    select: { id: true },
  })

  if (!profile) {
    notFound()
  }

  return {}
}
