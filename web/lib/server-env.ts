/** Server-only module: never import this from a client component. */
/**
 * Server-side configuration, read at REQUEST time (not baked in at build time), so one build can be pointed at
 * any API: a Render private-network address (`http://api-service:10000`, or the `hostport` value `api-service:10000`
 * from `fromService`), a public URL (`https://api.example.com`) or local dev (`http://localhost:4000`).
 */
function withScheme(v: string) {
  const s = v.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(s) ? s : `http://${s}`;
}

/** A usable origin: has a host (so `https://` from an empty `https://${API_HOST}` is ignored). */
function valid(v: string | undefined): string | null {
  if (!v || !v.trim()) return null;
  try {
    const u = new URL(withScheme(v));
    return u.hostname ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * Where `/api/*` is forwarded, read per request:
 * 1. API_ORIGIN (or the aliases INTERNAL_API_URL / API_URL): a full URL or a bare host:port;
 * 2. API_HOST, a bare public hostname (Render's RENDER_EXTERNAL_HOSTNAME of the API) → https://API_HOST;
 * 3. http://localhost:4000 for local dev.
 */
export function apiOrigin(): string {
  const env = process.env;
  const explicit = valid(env.API_ORIGIN) ?? valid(env.INTERNAL_API_URL) ?? valid(env.API_URL);
  if (explicit) return explicit;
  const host = env.API_HOST?.trim();
  if (host) return valid(/^https?:\/\//i.test(host) ? host : `https://${host}`) ?? "http://localhost:4000";
  return "http://localhost:4000";
}

/**
 * The public address of the site (e.g. https://invite-web.onrender.com), used for absolute URLs in metadata.
 * PUBLIC_BASE_URL wins; otherwise Render's RENDER_EXTERNAL_URL; otherwise the request's own host (x-forwarded-host/proto).
 */
export function publicBaseUrl(h?: Headers): string | null {
  // RENDER_EXTERNAL_URL is set by Render on every web service (https://<name>.onrender.com).
  const env = process.env.PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || process.env.RENDER_EXTERNAL_URL;
  if (env) return withScheme(env);
  if (!h) return null;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return null;
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
