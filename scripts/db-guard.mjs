// db-guard.mjs — fail-safe for mutation-capable test/verification scripts.
//
// Production lives on the Neon `main` branch (compute ep-billowing-dew-*).
// Local dev/tests must use the `dev` branch (ep-old-breeze-*) or any other
// non-production endpoint. Import this module for its side effect at the top
// of any script that writes to the database:
//
//   import "./db-guard.mjs"
//
// To intentionally run against production, set ALLOW_PRODUCTION_DB_TESTS=1.
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const PROD_ENDPOINT_MARKERS = ["ep-billowing-dew"]

let url = process.env.DATABASE_URL
if (!url) {
  try {
    const envPath = fileURLToPath(new URL("../.env", import.meta.url))
    const match = readFileSync(envPath, "utf8").match(/^\s*DATABASE_URL\s*=\s*"?([^"'\n]+)"?\s*$/m)
    url = match?.[1]
  } catch {
    // no .env — let the script surface its own missing-config error
  }
}

try {
  const host = new URL(url).hostname
  if (PROD_ENDPOINT_MARKERS.some((m) => host.includes(m)) && process.env.ALLOW_PRODUCTION_DB_TESTS !== "1") {
    console.error(`[db-guard] REFUSING TO RUN: DATABASE_URL targets the production endpoint (${PROD_ENDPOINT_MARKERS[0]}…).`)
    console.error("[db-guard] Point DATABASE_URL at the dev branch, or set ALLOW_PRODUCTION_DB_TESTS=1 to override.")
    process.exit(1)
  }
} catch {
  // unparseable URL — let the script fail normally
}
