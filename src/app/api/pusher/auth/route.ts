import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { getPusher } from "@/lib/pusher"
import { unauthorized, forbidden } from "@/lib/security"

// Pusher channel authorization — private chat channels require a session.
// Without this, anyone knowing a room id could subscribe to `chat-<id>`
// and read live community chat anonymously.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return unauthorized()

  const pusher = getPusher()
  if (!pusher) return forbidden()

  const form = await request.formData().catch(() => null)
  const socketId = form?.get("socket_id")
  const channel = form?.get("channel_name")
  if (typeof socketId !== "string" || typeof channel !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  // Only allow our private chat channels
  if (!/^private-chat-[A-Za-z0-9_-]{1,64}$/.test(channel)) {
    return forbidden()
  }

  return NextResponse.json(pusher.authorizeChannel(socketId, channel))
}
