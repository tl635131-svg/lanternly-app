import type { NextConfig } from "next";

/**
 * The browser only ever talks to this Next.js origin. `/api/*` is forwarded to the Fastify API by the route
 * handler in app/api/[...path]/route.ts, which reads API_ORIGIN at request time (rewrites here would be fixed at
 * build time). The httpOnly session cookie stays first-party (see api-contract.md §1).
 */

const isProd = process.env.NODE_ENV === "production";

/**
 * Security headers (QA M-04). The Content-Security-Policy is set per request with a script nonce in
 * `proxy.ts` (no 'unsafe-inline' for scripts; 'unsafe-eval' and ws: in dev only), together with
 * X-Frame-Options (SAMEORIGIN on /i/* for the host preview iframe, DENY elsewhere). The rest are static.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), autoplay=(self)" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Everything except invitation pages refuses framing (pages also get it from proxy.ts; /i/* gets SAMEORIGIN there).
      { source: "/:path((?!i$|i/).*)", headers: [{ key: "X-Frame-Options", value: "DENY" }] },
    ];
  },
  // Lets `NEXT_DIST_DIR=.next-build next build` verify a production build while `next dev` keeps serving from .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  devIndicators: false,
};

export default nextConfig;
