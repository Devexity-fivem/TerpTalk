# Vercel Free-Tier Cost Control

## Current monthly cost: $0

| Resource | Provider | Free limit | Expected beta usage |
|---|---|---|---|
| Hosting + serverless | Vercel Hobby | 100GB bandwidth, generous function invocations | <5GB, <50k invocations |
| Database | Neon free | 0.5GB storage, autoscaling compute | <50MB, minimal compute |
| Realtime | None (HTTP polling) | — | — |
| Image storage | None (disabled) | — | — |
| Email | None | — | — |

## Watchpoints

1. **Chat polling (3s)** — the main DB traffic driver. ~1,200 reads/hr per active chatter. With 20 concurrent chatters ≈ 24k queries/hr — comfortably inside Neon's free tier, but this is the first thing to optimize if usage grows. Polling already: requires auth, rate-limited (30 msg/min), 2000-char limit, returns only last 50 messages.
2. **View counter** on threads — one UPDATE per page view. Negligible.
3. **Rate-limit table** — a few extra DB writes per mutation. Rows expire; consider `cleanupRateLimits()` on a weekly cron (free on Vercel, 1/day max on Hobby) or opportunistic cleanup.
4. **`force-dynamic` pages** — every page view = a serverless invocation + a few queries. Fine at beta scale.

## What would cost money

- **Realtime chat** → Socket.io needs a long-lived server (Render/Railway ~$5/mo) or Pusher/Ably free tier
- **Image uploads** → Cloudinary free tier or R2 ($0 storage egress); requires the security pipeline first
- **>0.5GB data** → Neon Launch $19/mo
- **Bandwidth-heavy media** → Vercel Pro $20/mo past 100GB
- **Cron >1/day** → Vercel Hobby allows 1 cron/day; use external cron (cron-job.org free) if needed

## Scaling path

Beta (free) → Postgres first (Neon Launch) → then Vercel Pro → then realtime/images as revenue justifies.
