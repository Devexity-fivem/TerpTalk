import { prisma } from "@/lib/prisma"
import { notifyMany } from "@/lib/notify"

// Parse @username mentions from text and notify each mentioned user.
// Usernames may contain letters, numbers, underscore, hyphen.
// Skips the actor and dedupes. Fire-and-forget safe — catches its own errors.
// Recipient pref/block/ban filtering happens inside notifyMany.
export async function notifyMentions(
  text: string,
  actorId: string,
  actorName: string,
  link: string,
  context: string,
  excludeUserIds: string[] = []
) {
  try {
    // Match the username charset exactly (3-20 chars, no hyphens) so the
    // notifier and the markdown renderer recognize the same handles.
    const handles = [...text.matchAll(/@([A-Za-z0-9_]{3,20})\b/g)]
      .map((m) => m[1])
    if (handles.length === 0) return

    const unique = [...new Set(handles)].slice(0, 10)
    const users = await prisma.profile.findMany({
      where: { username: { in: unique, mode: "insensitive" } },
      select: { userId: true, username: true },
    })

    const excluded = new Set([actorId, ...excludeUserIds])
    const targets = users.filter((u) => !excluded.has(u.userId))
    if (targets.length === 0) return

    await notifyMany(
      targets.map((u) => ({
        userId: u.userId,
        type: "MENTION" as const,
        title: "You were mentioned",
        content: `@${actorName} mentioned you in ${context}`,
        link,
        actorId,
      }))
    )
  } catch (e) {
    console.error("notifyMentions error:", e)
  }
}
