// Shared ?page&limit parsing for admin/moderation list endpoints.
// Callers keep their own cap/default — only the clamp logic is shared.
export const MAX_PAGE_SIZE = 100

export function parsePageParams(
  searchParams: URLSearchParams,
  { maxLimit = MAX_PAGE_SIZE, defaultLimit = 50 }: { maxLimit?: number; defaultLimit?: number } = {}
) {
  const page = Math.max(1, Number(searchParams.get("page")) || 1)
  const limit = Math.min(maxLimit, Math.max(1, Number(searchParams.get("limit")) || defaultLimit))
  return { page, limit, skip: (page - 1) * limit }
}
