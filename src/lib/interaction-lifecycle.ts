import { Prisma } from "@prisma/client"
import { prisma, runTxWithRetry } from "@/lib/prisma"
import { lockInteractionKey } from "@/lib/interaction-state"

// ─── Serialized interaction lifecycle transactions ─────────────────
// Every supported social interaction key (follow/react/repost/comment)
// transitions through ONE shared mechanism: a transaction that first
// takes the per-key PostgreSQL advisory locks, then performs the
// interaction mutation and its progression transition on the same
// client. Because the locks are transaction-scoped and every
// add/remove/drain/parent-delete path for a key uses them, concurrent
// transitions serialize by commit — never by request arrival, timestamp,
// or drain scheduling.
//
//   runKeyedTx(keys, body)   — Serializable + retry, for transactions
//                              that write progression state (cap checks
//                              need Serializable parity with awardProgression).
//   runKeyedTxRO(keys, body) — ReadCommitted, for removal transactions
//                              that only delete rows and enqueue intents.
//
// `keys` may be a single key or an array; arrays are sorted before
// locking so multi-key transactions acquire in a deterministic global
// order — deadlock-free by construction.
//
// Content-scope locks (`content:{scope}:{id}`) serialize child
// interactions against deletion of their parent target: a reaction,
// repost, or comment create holds the content lock of the moment /
// thread / diary / update it targets, and every parent delete path
// holds the same lock — so a child award can never commit after the
// parent's reversal sweep has already drained.
//
// The body receives the locked TransactionClient `tx`; pass it to
// awardProgression/reverseProgressionByKey via their `db`/`opts.db`
// parameters so ledger writes join the same commit.

// Exported for delete paths that run inside a caller-owned transaction
// (not runKeyedTx) — same sorted deterministic acquisition order.
export async function lockInteractionKeys(tx: Prisma.TransactionClient, keys: string | string[]): Promise<void> {
  const list = Array.isArray(keys) ? [...new Set(keys)].sort() : [keys]
  for (const k of list) await lockInteractionKey(tx, k)
}

async function lockKeys(tx: Prisma.TransactionClient, keys: string | string[]): Promise<void> {
  await lockInteractionKeys(tx, keys)
}

export function runKeyedTx<T>(
  keys: string | string[],
  body: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return runTxWithRetry(() =>
    prisma.$transaction(
      async (tx) => {
        await lockKeys(tx, keys)
        return body(tx)
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    )
  )
}

export function runKeyedTxRO<T>(
  keys: string | string[],
  body: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  // runTxWithRetry covers 40P01 deadlocks (P2034) — ReadCommitted can't
  // produce serialization aborts, but row-lock cycles are still possible.
  // Bodies are tx-rollback safe: a retried attempt re-runs from scratch.
  return runTxWithRetry(() =>
    prisma.$transaction(async (tx) => {
      await lockKeys(tx, keys)
      return body(tx)
    })
  )
}

// Content-scope lock key for a parent target — shared by every child
// interaction on that target and by the target's own delete paths.
export function contentLockKey(scope: "moment" | "thread" | "diary" | "update", id: string): string {
  return `content:${scope}:${id}`
}
