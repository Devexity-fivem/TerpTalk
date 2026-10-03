import { NextResponse } from "next/server"
import { getSiteAnnouncement } from "@/lib/announcement"

// GET — public announcement, safe for all users. The banner itself is
// server-rendered from the layout; this route remains for any other
// consumers that want the sanitized bundle.
export async function GET() {
  return NextResponse.json(await getSiteAnnouncement())
}
