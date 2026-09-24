# 100-User Operating Checklist

How to run TerpTalk through its first ~100 real members. Everything here
uses existing surfaces — no new infrastructure.

## Daily

- **`/ops`** — staff-only overview (user menu → Operations). Read top to bottom:
  - **Activation funnel (7d)** — signups vs onboarding vs first contribution.
    A healthy early ratio: most signups finish onboarding; a third or more
    contribute something.
  - **Unanswered discussions** — anything older than ~24h needs a reply.
    Answer as yourself, or move it where a member can see it.
  - **Open reports / abuse flags** — should be near zero.
  - **Cron tasks pending** — should be 0 after 14:00 UTC (daily TerpBot cron).
- **`/moderation`** — reports queue and abuse flags. Clear anything pending.
- **`/admin` → Feedback** — triage NEW items: set status, add repro notes.
- **Vercel → terp-talk → Logs** — scan for red. `vercel logs terp-talk --since 24h`.

## Weekly

- **`/ops` funnel (30d)** — are signups turning into contributors? Where is
  the drop: signup→onboarding, onboarding→first contribution, or first
  contribution→returning?
- **Community stats** — unique contributors vs new members. If everyone
  posts once and vanishes, the product isn't earning a second visit.
- **`/admin` → Feedback (RESOLVED audit)** — did reported issues actually ship?
- **Rate-limit table on `/ops`** — an endpoint with a climbing count means
  either abuse or a real user hitting a limit during normal use. Check which.
- **Referral diagnostic on `/admin` stats** — `eligibleUnpaid` should stay
  empty; if it fills, referral payout reconciliation needs a look.

## When something breaks

1. Vercel → terp-talk → **Logs** (or `vercel logs <url> --since 1h`) —
   which route, what status, when.
2. `/ops` → **Reliability** — is today's cron still pending? Pending after
   14:00 UTC means the daily job failed or is still running.
3. Reproduce in a browser; file it via the on-site feedback modal so the
   route/device are captured automatically, or as an admin observation.
4. Fix, run `npm run test:fast`, deploy, verify, mark feedback RESOLVED.

## When spam appears

Existing controls — use them, don't build new ones:
- **Report** (any member) → lands in `/moderation` queue.
- **Mod queue** → remove content, warn, suspend (moderators), ban (admin only).
- **Abuse flags** — automated reputation-velocity and reciprocal-pair
  detectors write to `/moderation`; review, don't auto-punish.
- **Rate limits** already cover posting, reactions, follows, chat,
  registration, login. `/ops` shows which endpoints are being hit.
- **Link trust** — new accounts can't post external links until trusted.
- **Turnstile** on registration; login throttles per username + IP.

## When chat breaks

- Check Pusher env vars exist in Vercel (PUSHER_*, NEXT_PUBLIC_PUSHER_*).
- `/api/pusher/auth` should 401 for guests, 200 for members.
- Rooms list comes from `/api/chat/rooms`; messages persist in `ChatMessage`
  (polling fallback works even if realtime drops).
- Look for a stuck/locked room in the DB (`ChatRoom.locked`).

## When signups fall

- `/ops` funnel: if signups drop but traffic holds, check `/auth/signup`
  loads and Turnstile renders (browser test, not just curl).
- Registration failures appear as `RATE_LIMIT_EXCEEDED` /
  `AUTHORIZATION_FAILURE` security events — `/ops` aggregates them.
- If onboarding completion collapses, test `/welcome` → stepper → finish
  in a real browser.

## When users disappear after signup

- `/ops` funnel gap between "Completed onboarding" and "First contribution"
  is the activation leak. Before changing the product, reproduce the
  first-session path yourself: signup → welcome → home → Share something.
- Check unanswered-question age — a new member whose first question sits
  for days won't return.
- `lastSeenAt` drives "returning members": if it's populated but
  contribution is zero, members are looking but not finding a reason to act.

## When a user reports a bug

- The feedback modal captures route + device class automatically.
- Reproduce at the reported route/device width. If it reproduces, fix,
  note the commit in adminNotes, mark RESOLVED. If it doesn't, add your
  repro attempt to adminNotes and ask the reporter — don't close blind.

## Hard rules

- Never seed fake members, posts, or activity to make metrics look better.
- Never show personal message bodies or private diary content in ops tools.
- `/ops` shows aggregates only — no IPs, no raw user agents, no raw emails.
- If a metric won't change a decision, don't add it.
