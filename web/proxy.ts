import { NextResponse, type NextRequest } from "next/server";

/**
 * Per-request CSP nonce (QA M-04 / round 2): scripts run only with this nonce ('strict-dynamic'),
 * no 'unsafe-inline' and, in production, no 'unsafe-eval'. Next.js reads the nonce from the request's
 * CSP header and stamps it on its own scripts; the root layout reads `headers()` so every page renders dynamically.
 * Old invitation links (custom_link renames) are handled in app/i/[slug]/page.tsx with a permanent (308) redirect.
 */
const isDev = process.env.NODE_ENV === "development";

/** Invitation pages may be framed by our own origin (the host's phone preview iframe, QA N-33); nothing else may frame anything. */
const framable = (path: string) => path === "/i" || path.startsWith("/i/");

function csp(nonce: string, sameOriginFrames: boolean) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes (palette CSS variables) need this; scripts stay nonce-only.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    // 'self' so dashboard pages can show the invitation preview (/i/…) in an iframe.
    "frame-src 'self' https://www.google.com https://maps.google.com",
    `frame-ancestors ${sameOriginFrames ? "'self'" : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const sameOrigin = framable(req.nextUrl.pathname);
  const policy = csp(nonce, sameOrigin);
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", policy);
  // X-Frame-Options mirrors frame-ancestors for old browsers: SAMEORIGIN on /i/*, DENY everywhere else.
  res.headers.set("X-Frame-Options", sameOrigin ? "SAMEORIGIN" : "DENY");
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|health|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
