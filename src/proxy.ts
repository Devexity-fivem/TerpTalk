import { NextRequest, NextResponse } from "next/server"

/**
 * Per-request CSP nonce. The header on the request lets Next.js attach
 * the nonce to framework/runtime scripts during render; the same policy
 * on the response is what the browser enforces. Removing 'unsafe-inline'
 * from script-src means any injected inline script without this nonce is
 * blocked — the only app inline script is the theme init in layout.tsx,
 * which reads the nonce from the x-nonce request header.
 *
 * ld+json blocks and inline `style` attributes are not governed by
 * script-src/style-src-nonces, so only JS scripts carry the nonce.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64")
  const isDev = process.env.NODE_ENV === "development"

  const csp = [
    "default-src 'self'",
    // 'strict-dynamic' lets nonce'd scripts load their own children (Next
    // runtime chunks); the explicit hosts cover third-party loaders.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com https://va.vercel-scripts.com${isDev ? " 'unsafe-eval'" : ""}`,
    // style attributes are used pervasively (React inline styles) —
    // style-src 'unsafe-inline' is required and low-risk.
    "style-src 'self' 'unsafe-inline'",
    // Breeder-hosted strain photos are linked with attribution, not
    // re-hosted — img-src enumerates the verified breeder hosts in the
    // catalog (scripts/seed-strains-data.cjs breederImageUrl values) plus
    // verified affiliate-partner product image hosts (cdn.shopify.com for
    // Clone to Home, mars-hydro.com for Mars Hydro).
    "img-src 'self' data: blob: https://*.vercel-storage.com https://*.public.blob.vercel-storage.com https://img.sensiseeds.com https://shop.greenhouseseeds.nl https://dutch-passion.com https://www.seriousseeds.com https://brothersgrimmseeds.com https://www.dinafem.org https://www.barneysfarm.com https://nirvanashop.com https://dnagenetics.com https://www.g13labs.com https://www.royalqueenseeds.com https://2fast4buds.com https://cdn.shopify.com https://www.humboldtseeds.net https://resinseeds.net https://www.mars-hydro.com",
    "font-src 'self' data:",
    `connect-src 'self' https://*.pusher.com wss://*.pusher.com https://va.vercel-scripts.com https://challenges.cloudflare.com${isDev ? " ws: wss:" : ""}`,
    "frame-ancestors 'none'",
    // MediaEmbed renders youtube-nocookie / vimeo iframes; Turnstile
    // renders its challenge iframe on auth pages.
    "frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'self'",
  ].join("; ")

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set("x-nonce", nonce)
  requestHeaders.set("Content-Security-Policy", csp)

  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set("Content-Security-Policy", csp)
  return response
}

export const config = {
  matcher: [
    // Everything that renders HTML; skips API routes, Next internals,
    // and prefetch probes. Public assets (sw.js, icons) still match —
    // the CSP header on them is harmless.
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
}
