import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "0" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // va.vercel-scripts.com serves the first-party <Analytics/> and
      // <SpeedInsights/> loaders mounted in the root layout — without it
      // CSP silently blocks the only telemetry we have.
      `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://va.vercel-scripts.com${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      // Breeder-hosted strain photos are linked with attribution, not
      // re-hosted — img-src enumerates the verified breeder hosts in the
      // catalog (scripts/seed-strains-data.cjs breederImageUrl values).
      "img-src 'self' data: blob: https://*.vercel-storage.com https://*.public.blob.vercel-storage.com https://img.sensiseeds.com https://shop.greenhouseseeds.nl https://dutch-passion.com https://www.seriousseeds.com https://brothersgrimmseeds.com https://www.dinafem.org https://www.barneysfarm.com https://nirvanashop.com https://dnagenetics.com https://www.g13labs.com https://www.royalqueenseeds.com https://2fast4buds.com https://cdn.shopify.com https://www.humboldtseeds.net https://resinseeds.net",
      "font-src 'self' data:",
      "connect-src 'self' https://*.pusher.com wss://*.pusher.com https://va.vercel-scripts.com" +
        (process.env.NODE_ENV === "development" ? " ws: wss:" : ""),
      "frame-ancestors 'none'",
      // MediaEmbed renders youtube-nocookie / vimeo iframes.
      "frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  experimental: {
    serverSourceMaps: false,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  // Never expose detailed errors to clients in production
  productionBrowserSourceMaps: false,
};

export default nextConfig;
