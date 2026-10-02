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
  // Content-Security-Policy lives in src/proxy.ts — it carries a
  // per-request nonce, so it cannot be a static config header (two CSP
  // headers would intersect and block every nonced script).
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  images: {
    // Public Vercel Blob stores only — member media is served through
    // the auth-aware /api/media proxy, and breeder/affiliate images are
    // external attribution links; neither goes through the optimizer.
    remotePatterns: [{ protocol: "https", hostname: "**.public.blob.vercel-storage.com" }],
  },
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
