import type { NextRequest } from "next/server";
import { apiOrigin } from "@/lib/server-env";

/**
 * Same-origin API proxy: the browser only talks to this site, which forwards `/api/*` to the API.
 * A route handler (not a next.config rewrite) so the target is read from API_ORIGIN at request time:
 * rewrites are compiled into the build, which would pin whatever API address existed when `next build` ran.
 * Cookies (incl. every Set-Cookie), the x-csrf header, redirects and streamed responses (SSE) pass through.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Hop-by-hop headers (RFC 9110 §7.6.1) and ones fetch recomputes.
const DROP_REQ = new Set(["host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "upgrade", "te", "trailer", "content-length", "accept-encoding", "expect"]);
const DROP_RES = new Set(["connection", "keep-alive", "transfer-encoding", "upgrade", "trailer", "content-encoding", "content-length", "set-cookie"]);

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const origin = apiOrigin();
  const target = `${origin}/api/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((v, k) => { if (!DROP_REQ.has(k)) headers.set(k, v); });
  // The API sees the visitor's address and the public host/scheme (TRUST_PROXY=true on the API).
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  headers.set("x-forwarded-host", host);
  headers.set("x-forwarded-proto", proto);
  const xff = req.headers.get("x-forwarded-for");
  if (xff) headers.set("x-forwarded-for", xff);
  headers.set("accept-encoding", "identity");

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: req.signal, // closes long-lived streams (SSE) when the browser goes away
    });
  } catch {
    return Response.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "The service is starting up or unavailable. Please try again in a moment." } }, { status: 502 });
  }

  const out = new Headers();
  upstream.headers.forEach((v, k) => { if (!DROP_RES.has(k)) out.set(k, v); });
  for (const c of upstream.headers.getSetCookie()) out.append("set-cookie", c);
  // Keep redirects on our origin when the API points at itself (e.g. API_PUBLIC_URL left at the internal address).
  const loc = upstream.headers.get("location");
  if (loc && loc.startsWith(origin)) out.set("location", loc.slice(origin.length) || "/");
  if (out.get("content-type")?.startsWith("text/event-stream")) out.set("x-accel-buffering", "no");

  return new Response(req.method === "HEAD" || upstream.status === 204 || upstream.status === 304 ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: out });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE, forward as HEAD, forward as OPTIONS };
