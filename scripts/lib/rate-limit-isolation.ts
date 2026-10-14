// Suite-boundary rate-limit isolation for the canonical master runner.
//
// Why: every HTTP suite's traffic resolves to the same client identity —
// getClientIp() returns "unknown" when no trusted proxy header is present,
// and test requests send none (TRUST_* is unset; suites that spoof
// X-Forwarded-For do so to prove spoofing does NOT create separate buckets).
// IP-keyed buckets like `search:${hashIp("unknown")}` are therefore shared
// across every suite in the HTTP phase, and a suite asserting a limited
// endpoint can inherit an exhausted bucket left by an earlier suite —
// the exact mechanism behind the bot-verify `/api/search` CI flake.
//
// What this clears (and why each is safe on a shared dev database):
//   - keys containing hashIp("unknown") — every hashed-IP bucket the
//     untrusted-header test client can create. Another developer's real
//     traffic produces different hashes and is never matched.
//   - keys ending in ":unknown" — raw-IP slots (e.g. `pd-case:<uid>:unknown`)
//     that store the unresolved client IP literally.
//   - "register:global" — the global registration ceiling has no IP segment.
//   - "login:", "recover", "restricted" prefixes — username-keyed buckets
//     on shared seeded accounts (admin/mod/TerpBot) that suites exercise
//     repeatedly; the established per-suite convention already clears these
//     ad hoc — this centralizes it.
//   - "chat-bot-", "terpbot:out:" prefixes — room-keyed TerpBot throttles on
//     seeded chat rooms, shared by any suite sending bot commands.
//
// Deliberately NOT cleared: per-user keys (`thread:<uid>`, `reaction:<uid>`,
// …) — each suite creates its own fixture users, so those rows can never
// leak between suites; and per-test spoofed-IP buckets (x-vercel-forwarded-
// for probes) which are unique per test by construction.
//
// Never call this mid-suite — it must run only at suite boundaries so
// intra-suite rate-limit assertions keep their accumulated state.

import "../db-guard.mjs"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { prisma } from "@/lib/prisma"
import { hashIp } from "@/lib/security"

// getClientIp's fallback when no trusted proxy header is present — the
// identity every test-harness request shares.
export const HARNESS_CLIENT_IP = "unknown"

const ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)))

// Resolve a salt the same way the dev server does: injected env first, then
// the local .env file. hashIp() reads process.env, so the resolved value is
// staged into it before the hash is computed — the algorithm itself is never
// reimplemented.
function stageEnvValue(name: string): void {
  if (process.env[name]) return
  const envPath = path.join(ROOT, ".env")
  if (!existsSync(envPath)) return
  const match = readFileSync(envPath, "utf8").match(
    new RegExp(`^\\s*${name}\\s*=\\s*"?([^"'\\n]+)"?\\s*$`, "m")
  )
  if (match) process.env[name] = match[1]
}

/**
 * Delete the rate-limit rows owned by the harness's shared client identity.
 * Throws on database failure — callers must treat a failed clear as a failed
 * suite precondition, never continue into a possibly contaminated suite.
 */
export async function clearHarnessRateLimits(): Promise<{ deleted: number }> {
  stageEnvValue("IP_HASH_SALT")
  stageEnvValue("NEXTAUTH_SECRET")
  const ipHash = hashIp(HARNESS_CLIENT_IP)
  const res = await prisma.rateLimit.deleteMany({
    where: {
      OR: [
        // Every bucket keyed by the harness's hashed client IP.
        { key: { contains: ipHash } },
        // Raw-IP slots that store the unresolved client IP literally.
        { key: { endsWith: `:${HARNESS_CLIENT_IP}` } },
        // Global ceilings with no per-IP segment.
        { key: { in: ["register:global"] } },
        // Username-keyed buckets on shared seeded/test accounts.
        { key: { startsWith: "login:" } },
        { key: { startsWith: "recover" } },
        { key: { startsWith: "restricted" } },
        // Room-keyed TerpBot throttles on seeded chat rooms.
        { key: { startsWith: "chat-bot-" } },
        { key: { startsWith: "terpbot:out:" } },
      ],
    },
  })
  return { deleted: res.count }
}
