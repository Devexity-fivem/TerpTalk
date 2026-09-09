# TerpTalk Operations

## Monitoring

- Vercel Analytics and Function Logs provide request latency, error rates, and build status.
- Database metrics are available in the Neon dashboard (connection count, disk usage, slow queries).
- The `admin/stats` endpoint gives basic in-app counts; `admin/security` lists recent security events.

## Backups

- Neon provides automated point-in-time backups and daily snapshots. Configure the backup retention in the Neon project settings.
- For additional protection, schedule `pg_dump` exports to a separate storage account. A sample backup script is at `scripts/backup.ts`.
- Test restore procedures before launch and after major schema changes.

## Recovery

- The application is stateless except for the database. Redeploying the same `DATABASE_URL` restores service.
- If a bad migration is applied, pause deploys, restore the Neon backup to a new branch, update `DATABASE_URL`, and investigate the failing migration.
- If `NEXTAUTH_SECRET` or `IP_HASH_SALT` changes, existing sessions and rate-limit IP hashes become invalid or change values; plan for user re-login.

## Incident response

1. **Detect**: monitor Vercel/Neon alerts and security-event logs.
2. **Contain**: rotate any suspected secrets (Pusher, Blob, NextAuth), ban offending accounts via `admin/users`, and increase rate-limit windows if under abuse.
3. **Investigate**: query `SecurityEvent` by `type` and `ipHash` windows.
4. **Recover**: restore from backup if data integrity is affected.
5. **Review**: update `SECURITY.md`, rate limits, or validation rules based on findings.

See `INCIDENT_RESPONSE.md` for a more detailed playbook.

## Common issues

| Symptom | Likely cause | Fix |
|---|---|---|
| `P3006` migration error | shadow DB missing an index the migration tries to drop | ensure migrations use `IF EXISTS` and run `npx prisma migrate status` |
| `Unauthorized` on every request | `NEXTAUTH_SECRET` mismatch or cookie issue | verify `NEXTAUTH_URL` and secret in production |
| Uploads fail | `BLOB_READ_WRITE_TOKEN` missing | add the token in Vercel env and redeploy |
| Chat not realtime | Pusher credentials or CSP `connect-src` | check keys and `next.config.ts` directives |
| High DB load | polling endpoints or rate-limit writes | review `RateLimit` cleanup and endpoint usage |

## Maintenance

- Run `npx prisma migrate status` after every deploy.
- Rotate `NEXTAUTH_SECRET` and `IP_HASH_SALT` periodically; note that this invalidates active sessions and rate-limit buckets.
- Keep dependencies up to date (`npm audit`).
- Review `admin/security` regularly for brute-force, recovery, and moderation anomalies.

## Rollback

- Vercel: promote the previous production deployment.
- Database: restore from Neon backup to a new branch and point `DATABASE_URL` at it.
- Schema: do not revert an already-applied migration file; add a new migration that reverses the change.
