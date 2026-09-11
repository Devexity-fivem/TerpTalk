import { prisma } from "@/lib/prisma"

const PRUNE_AGE_MS = 3 * 24 * 60 * 60 * 1000 // 3 days
const PRUNE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

const globalWithPrune = globalThis as typeof globalThis & {
  __lastChatPruneAt?: number
}

export async function pruneChatMessages(): Promise<number> {
  const cutoff = new Date(Date.now() - PRUNE_AGE_MS)
  const result = await prisma.chatMessage.deleteMany({
    where: { createdAt: { lt: cutoff } },
  })
  if (result.count > 0) {
    console.log(`[chat-cleanup] pruned ${result.count} chat messages older than 3 days`)
  }
  return result.count
}

export async function pruneChatMessagesIfDue(): Promise<void> {
  const last = globalWithPrune.__lastChatPruneAt ?? 0
  if (Date.now() - last < PRUNE_INTERVAL_MS) return
  globalWithPrune.__lastChatPruneAt = Date.now()
  try {
    await pruneChatMessages()
  } catch (error) {
    console.error("[chat-cleanup] prune failed:", error)
  }
}
