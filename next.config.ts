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

// Our public Blob store's host, derived from BLOB_STORE_ID (store_<id>,
// set in production). The optimizer must name the account host — a
// wildcard would proxy ANY Vercel Blob store's images through our
// image-optimization quota. Empty locally/CI → no remote patterns.
const publicBlobHost = process.env.BLOB_STORE_ID
  ? `${process.env.BLOB_STORE_ID.replace(/^store_/, "").toLowerCase()}.public.blob.vercel-storage.com`
  : "";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  images: {
    // Only our own public Blob store is optimized (see publicBlobHost).
    // Member media is served through the auth-aware /api/media proxy,
    // and breeder/affiliate images are external attribution links;
    // neither goes through the optimizer.
    remotePatterns: publicBlobHost
      ? [{ protocol: "https", hostname: publicBlobHost, pathname: "/**" }]
      : [],
  },
  // Inlined into the client bundle at build time so BlobImage applies
  // the same host check as remotePatterns.
  env: { NEXT_PUBLIC_BLOB_PUBLIC_HOST: publicBlobHost },
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
