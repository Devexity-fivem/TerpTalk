import { notFound } from "next/navigation"
import { prisma } from "@/lib/prisma"
import ProfileClient from "./profile-client"

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const decoded = decodeURIComponent(username)

  const profile = await prisma.profile.findUnique({
    where: { username: decoded },
    select: { id: true },
  })

  if (!profile) {
    notFound()
  }

  return <ProfileClient />
}
