# TerpTalk Operator Checklist

Minimal incident-response reference for the production deployment.

## Where things live

- **App**: Vercel project `terp-talk` → https://terp-talk.vercel.app
- **DB**: Neon project `misty-shape-71837605`, `main` branch (prod compute `ep-billowing-dew-*`), database `neondb`
- **Images**: Vercel Blob store (prod env `BLOB_READ_WRITE_TOKEN`)
- **Realtime**: Pusher (cluster `us2`)
- **Cron**: `vercel.json` → `GET /api/cron/terpbot` daily at 14:00 UTC, `CRON_SECRET`-authed
- **Logs**: `vercel logs terp-talk` or Vercel dashboard → Logs. Never log secrets — IP addresses are hashed via `IP_HASH_SALT`.

## Something is broken

1. Check the last deployment status: `vercel ls terp-talk --prod` — is the newest one `● Ready`?
2. Check `https://terp-talk.vercel.app/api/stats` — a JSON response means DB connectivity is fine.
3. Pull recent runtime logs: `vercel logs terp-talk --prod` and look for 5xx spikes.
4. If the newest deploy is bad, roll back instantly from the dashboard: Deployments → previous `Ready` → "Promote to Production". Or `vercel promote <deployment-url>`.

## Chat is down

1. Pusher credentials are in prod env (`PUSHER_*`, `NEXT_PUBLIC_PUSHER_*`). Check the Pusher dashboard for the app's connection/error state.
2. `/api/pusher/auth` must return 401 for signed-out users and 200-with-auth for members — probe it directly.
3. Without Pusher the chat falls back to polling — if messages still post via `POST /api/chat/messages`, the realtime layer is degraded but the app works. Say so in #general if it persists.

## Uploads are failing

1. Check the site setting kill-switch first: admin → settings → `IMAGE_UPLOADS_ENABLED` (may have been flipped deliberately).
2. `BLOB_READ_WRITE_TOKEN` must exist in the Vercel production env; check the Blob store in the dashboard for quota.
3. Server-side sanitize (`sharp`) rejects corrupt/oversized images with a 400 — that's a client error, not an outage.

## Database migration failed

1. The build fails before promotion when `prisma migrate deploy` fails — the previous deployment keeps serving; the site is NOT down. Check the failed build's logs (`vercel inspect <url> --logs`).
2. Fix forward: correct the migration, commit, redeploy. Do NOT run `prisma migrate reset` or `migrate dev` against production.
3. If a stale advisory lock is suspected (P1002), the prebuild gate already sweeps idle holders >60s — redeploy once before manual intervention.
4. Note: migration directory names are forward-dated by convention; ordering is lexicographic, never rename old migrations.

## Users cannot sign in

1. Confirm `NEXTAUTH_URL=https://terp-talk.vercel.app` and `NEXTAUTH_SECRET` are still in prod env (env list: `vercel env ls production`).
2. Wrong-password failures are uniform "Invalid credentials" — users may report "can't log in" when it's a forgotten password; point them to /auth/recover (recovery phrase flow — no email exists by design).
3. A user who is banned/suspended sees a distinct post-auth error — check `SecurityEvent` log entries (`LOGIN_FAILURE` reason `banned`/`suspended`) before assuming an auth bug.
4. If sessions are being invalidated globally, check whether `NEXTAUTH_SECRET` changed — that invalidates every JWT at once.

## Spam is happening

1. Registration is Turnstile-gated in production — verify `TURNSTILE_SECRET_KEY` is still set.
2. Per-user write limits already exist (threads 10/hr, posts 30/10min, reactions 120/10min, etc., scaled by tier). Check `SecurityEvent` for `RATE_LIMIT_EXCEEDED` bursts.
3. Moderation tools: reports queue (`/moderation`), member-level actions (suspend/ban) via `/admin/users`. Banning invalidates the session immediately (fresh DB check on every request).
4. A single-member flood: suspend first, then review. Don't raise global limits to accommodate it.

## Routine verification commands

```bash
npx vercel ls terp-talk --prod          # deployments
npx vercel env ls production            # env names (never pull secrets)
npx vercel logs terp-talk               # runtime logs
npm run test:fast                       # local fast gate
npm run test:master                     # full local gate (needs dev server)
```
