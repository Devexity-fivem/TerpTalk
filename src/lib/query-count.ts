// Development/test-only query counter.
//
// Counts Prisma queries inside an async-local scope — no query text,
// params, or data are ever captured (count only), so nothing sensitive can
// leak. This is NOT a logger: production has no verbose Prisma query log
// and this module adds exactly one pass-through middleware when first used.
//
// Usage (dev scripts / DB suites):
//   const { result, queries } = await withQueryCount(() => loadFeed(userId))
import { AsyncLocalStorage } from "node:async_hooks"
import { prisma } from "@/lib/prisma"

const scope = new AsyncLocalStorage<{ count: number }>()
let installed = false

function install() {
  if (installed) return
  installed = true
  // Prisma $use middleware — a no-op outside a measured scope.
  prisma.$use(async (params, next) => {
    const s = scope.getStore()
    if (s) s.count++
    return next(params)
  })
}

/** Runs fn and counts the Prisma queries it issues within the async scope. */
export async function withQueryCount<T>(fn: () => Promise<T>): Promise<{ result: T; queries: number }> {
  install()
  const store = { count: 0 }
  const result = await scope.run(store, fn)
  return { result, queries: store.count }
}
