import { prisma } from "@/lib/prisma"

// Parse @username mentions from text and notify each mentioned user.
// Usernames may contain letters, numbers, underscore, hyphen.
// Skips the actor and dedupes. Fire-and-forget safe — catches its own errors.
export async function notifyMentions(
  text: string,
  actorId: string,
  actorName: string,
  link: string,
  context: string
) {
  try {
    const handles = [...text.matchAll(/@([A-Za-z0-9_-]{2,32})\b/g)]
      .map((m) => m[1])
    if (handles.length === 0) return

    const unique = [...new Set(handles)].slice(0, 10)
    const users = await prisma.profile.findMany({
      where: { username: { in: unique, mode: "insensitive" } },
      select: { userId: true, username: true },
    })

    const targets = users.filter((u) => u.userId !== actorId)
    if (targets.length === 0) return

    await prisma.notification.createMany({
      data: targets.map((u) => ({
        userId: u.userId,
        type: "MENTION",
        title: "You were mentioned",
        content: `${actorName} mentioned you in ${context}`,
        link,
      })),
    })
  } catch (e) {
    console.error("notifyMentions error:", e)
  }
}
