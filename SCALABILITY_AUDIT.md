# TerpTalk Scalability Audit — First Pass

## Scope

This audit optimizes the existing Next.js + Prisma + PostgreSQL application for the Vercel Hobby/free tier, targeting 10,000 → 25,000 → 50,000 registered members while avoiding paid infrastructure where possible. No rewrites, framework changes, or new paid services were introduced.

## Current Architecture

- **Frontend:** Next.js App Router, React server components, Tailwind CSS, `lucide-react`.
- **Backend:** Next.js API routes, NextAuth credentials, Prisma ORM.
- **Database:** PostgreSQL via Neon-compatible connection.
- **Storage:** Vercel Blob for user images, data-URI upload with client-side resize.
- **Rate limiting:** Database-backed (`RateLimit` table) using upsert/increment.
- **Connection management:** `prisma` is a global singleton (`src/lib/prisma.ts`), preventing connection explosion in serverless.

## Bottlenecks Found

| Area | Risk | Why |
|---|---|---|
| Profile/leaderboard sorting | Medium | Sitemap and leaderboards order `Profile` by `reputation` without an index. |
| Active members query | Low-Medium | `User.lastSeenAt` sort used for homepage active growers; no dedicated index. |
| Search | High | `Thread.title`, `Thread.content`, and `Post.content` use `contains`/`ILIKE` scans; no text-search index. |
| Yield leaderboard | Medium | Loads all harvested `GrowDiary` rows into memory and groups in JS. |
| Messages conversation list | Medium | Loaded 300 messages to derive conversation list. |
| Homepage stats | Low | `COUNT(*)` queries executed on every homepage load. |

## Fixes Implemented

### Database indexes

Migration: `prisma/migrations/20260928000000_add_scalability_indexes/migration.sql`

- `Profile_reputation_idx` on `Profile(reputation DESC)`
- `User_lastSeenAt_idx` on `User(lastSeenAt DESC)`
- `GrowDiary_harvested_harvestedAt_idx` on `GrowDiary(harvested, harvestedAt)`
- `pg_trgm` extension + GIN trigram indexes on `Thread(title)`, `Thread(content)`, and `Post(content)` to accelerate search.

### Query bounds

- `src/app/leaderboard/yields/page.tsx` now caps harvested diaries at `take: 200` and sorts by `harvestedAt DESC` (uses new composite index).
- `src/app/api/messages/route.ts` conversation-list `take` reduced from 300 to 100.

### Caching

- `src/app/page.tsx` `getStats` is wrapped in `unstable_cache` with 60-second revalidation, avoiding repeated `COUNT(*)` on every homepage load.

### Existing pagination already in place

- Threads paginated (`POSTS_PER_PAGE = 50`).
- Notifications capped at 50.
- Direct messages capped at 100 per conversation, 50 for incremental polling.
- Discover, search, feed, and diaries use explicit `take`/`skip`.
- Image uploads are client-resized to ≤ 300 KB, with server-side magic-byte validation and 4-image limit.

## Capacity Estimate

These are honest, conservative estimates for Vercel Hobby, assuming realistic daily active fractions and burst capacity. They are **not guarantees**.

### 10,000 registered members

- **Daily active users (DAU):** ~500–1,500
- **Concurrent users:** ~20–80
- **Requests per second:** ~1–5 sustained, ~10–20 bursts
- **Likely status:** ✅ Sustainable. The current bounded queries and indexes handle this well.

### 25,000 registered members

- **DAU:** ~1,500–4,000
- **Concurrent:** ~60–200
- **Requests per second:** ~5–20 sustained, ~30–50 bursts
- **Likely status:** 🟡 Works with the current optimizations, but watch: search, feed, and thread view counts. Consider caching more public list pages if CPU or DB connection limits appear.

### 50,000 registered members

- **DAU:** ~3,000–8,000
- **Concurrent:** ~150–500
- **Requests per second:** ~15–40 sustained, ~80–120 bursts
- **Likely status:** 🟠 Vercel Hobby limits will start to bind. The database connection pool, function execution time, and bandwidth are the probable first bottlenecks.

## Upgrade Triggers

Watch these signals before moving to paid tiers:

1. Consistently hitting Vercel function-execution or bandwidth limits.
2. PostgreSQL connection errors or slow queries (> 2 s p95).
3. Search becomes slow despite trigram indexes (likely at 50K+ posts).
4. Image bandwidth/storage grows faster than free tier allows.
5. Polling APIs (`/api/messages`, notifications) consume a large share of invocations.

## Recommended First Upgrades (only when triggers fire)

1. **Database:** Neon Pro or similar for more connections/storage.
2. **Search:** Add `pg_search` or a self-hosted Elasticsearch-style index (last resort, adds cost).
3. **Images:** Vercel Pro or a dedicated image CDN with on-the-fly resizing.
4. **Realtime:** If needed, use Vercel Edge + short-polling with longer intervals; avoid WebSocket clusters until absolutely necessary.

## Remaining Work for a Deeper Pass

- Add cursor/keyset pagination for high-traffic list endpoints if they grow beyond current `take`/`skip`.
- Cache `getLatestDiscussions` and `getTrendingDiscussions` on the homepage.
- Review `prisma.thread.update` view-increment writes; consider a batching strategy if view counts become a write bottleneck.
- Add explicit rate limits for search and messaging if abuse appears.
- Load test realistic traffic before crossing 25K members.

## Verification

- `npm run build`: passes
- `npm run lint`: passes
- Pushed to `master` on GitHub.

## Security

No authorization or permission checks were weakened. All changes are additive (indexes, bounds, caching) and do not expose private data.
