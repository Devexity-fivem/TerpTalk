# Beta Launch Checklist

## Pre-deploy (done ✓)

- [x] Invite-only registration (single-use `TERP-` codes, server-enforced)
- [x] 21+ gate enforced server-side + DB captcha
- [x] Rate limiting on all mutation endpoints (DB-backed)
- [x] No password/email in API responses (`publicUserSelect`, E2E-verified)
- [x] Blocking, reporting, moderation queue, admin dashboard
- [x] Soft-delete everywhere; banned users blocked at login + mutations
- [x] Security headers + bcrypt + JWT sessions
- [x] `npm audit` = 0 vulnerabilities
- [x] PostgreSQL migration baseline generated
- [x] Build green; DB-backed pages `force-dynamic` (no stale prerender)
- [x] `npm run backup` + verified backup file
- [x] E2E: 54/54 checks pass

## Deploy day

- [ ] Create Neon project, copy pooled `DATABASE_URL`
- [ ] `vercel login && vercel` (link project)
- [ ] Set env vars: `DATABASE_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET` (fresh), `IP_HASH_SALT` (fresh)
- [ ] `vercel --prod`
- [ ] Seed prod: `DATABASE_URL=… ADMIN_PASSWORD=… MOD_PASSWORD=… npm run seed` — save printed invite codes
- [ ] Smoke test live: register with invite → post → reply → react → report → mod resolve → admin ban → unban → export → delete
- [ ] Verify headers: `curl -I https://<app>.vercel.app` (expect CSP/HSTS/frame-deny)
- [ ] Distribute invites to beta testers + `BETA_TEST_PLAN.md`

## Beta operations

- [ ] Weekly: `npm run backup`, review `/moderation` queue, check `/admin` security events
- [ ] Watch Vercel + Neon dashboards for usage vs free limits
- [ ] Collect tester feedback; triage via reports + MODERATION_GUIDE.md

## Red lines — do not do on prod

- `prisma migrate reset` or `db push --force` — destroys data
- Reuse dev `NEXTAUTH_SECRET`/`IP_HASH_SALT` in production
- Enable image uploads without the pipeline in SECURITY_HARDENING.md
- Share invite codes publicly — hand them to named testers
