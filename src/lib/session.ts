// Request-scoped session deduplication.
//
// Every getServerSession() call re-runs the NextAuth session callback,
// which issues a fresh user.findUnique. Pages that go through
// generateMetadata + layout + page (and helpers like requireStaff) were
// paying one DB read per call site per request.
//
// React cache() scopes the memoized result to the current request's render
// pass — matching calls share one result, and nothing is shared across
// requests, so sessionVersion/banned checks stay authoritative. Outside a
// render scope (route handlers, scripts) cache() is a passthrough: each
// call still hits the database, never a stale cross-request copy.
import { cache } from "react"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

/** getServerSession deduplicated per request render. */
export const getSession = cache(() => getServerSession(authOptions))
