import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { publicUserSelect } from "@/lib/security"

export async function GET(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ users: [] }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get("q") || ""
  if (!q || q.length < 1) {
    return NextResponse.json({ users: [] })
  }

  const users = await prisma.user.findMany({
    where: {
      banned: false,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { profile: { username: { contains: q, mode: "insensitive" } } },
      ],
    },
    take: 10,
    select: publicUserSelect,
    orderBy: { name: "asc" },
  })

  return NextResponse.json({ users })
}
