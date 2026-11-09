import { Prisma } from "@prisma/client"
import { prisma, runTxWithRetry } from "@/lib/prisma"
import { lockInteractionKey } from "@/lib/interaction-state"

// ─── Serialized interaction lifecycle transactions ─────────────────
// Every supported social interaction key (follow/react/repost/comment)
// transitions through ONE shared mechanism: a Serializable transaction
// that first takes the per-key PostgreSQL advisory lock, then performs
// the interaction mutation and its progression transition on the same
// client. Because the lock is transaction-scoped and every add/remove/
// drain path for a key uses it, concurrent transitions on the same
// logical interaction are totally ordered by commit — never by request
// arrival, timestamp, or drain scheduling.
//
//   runKeyedTx(key, body)  — Serializable + retry, for transactions
//                            that write progression state (cap checks
//                            need Serializable parity with awardProgression).
//   runKeyedTxRO(key, body)— ReadCommitted, for removal transactions that
//                            only delete the interaction row and enqueue
//                            the durable reversal intent.
//
// The body receives the locked TransactionClient `tx`; pass it to
// awardProgression/reverseProgressionByKey via their `db`/`opts.db`
// parameters so ledger writes join the same commit.

export function runKeyedTx<T>(
  key: string,
  body: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return runTxWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockInteractionKey(tx, key)
        return body(tx)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  )
}

export function runKeyedTxRO<T>(
  key: string,
  body: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await lockInteractionKey(tx, key)
    return body(tx)
  })
}
