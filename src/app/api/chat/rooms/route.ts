import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

// Get chat rooms
export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      )
    }

    const rooms = await prisma.chatRoom.findMany({
      where: { isPrivate: false },
      orderBy: { order: "asc" },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        _count: {
          select: { messages: true },
        },
      },
    })

    return NextResponse.json({ rooms })
  } catch (error) {
    console.error("Failed to fetch chat rooms:", error)
    return NextResponse.json(
      { error: "Failed to load chat rooms" },
      { status: 500 }
    )
  }
}
