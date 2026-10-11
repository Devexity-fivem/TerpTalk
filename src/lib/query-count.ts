// Development/test-only query counter.
//
// Counts Prisma queries inside an async-local scope — no query text,
// params, or data are ever captured (count only), so nothing sensitive can
// leak. This is NOT a logger: production has no verbose Prisma query log
// and this module adds one pass-through branch inside the client's query
// extension when first used.
//
// Usage (dev scripts / DB suites):
//   const { result, queries } = await withQueryCount(() => loadFeed(userId))
import { AsyncLocalStorage } from "node:async_hooks"

// Singleton on globalThis: tsx can instantiate this module twice across the
// .mts→.ts interop boundary (script vs lib import chains), which would give
// the recorder and the measurer different scopes and silently report 0.
const g = globalThis as unknown as { __qcScope?: AsyncLocalStorage<{ count: number }> }
const scope = (g.__qcScope ??= new AsyncLocalStorage<{ count: number }>())

// Called by the query extension in src/lib/prisma.ts on every operation —
// a no-op outside a measured scope. Prisma 6 removed $use middleware, and
// the query-event emitter fires outside the caller's async context, so the
// extension is the only reliable hook.
export function recordQuery(): void {
  const s = scope.getStore()
  if (s) s.count++
}

/** Runs fn and counts the Prisma queries it issues within the async scope. */
export async function withQueryCount<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  const store = { count: 0 }
  const result = await scope.run(store, fn)
  return { result, queries: store.count }
}
