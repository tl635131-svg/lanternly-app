/**
 * Typed API client. All calls go to same-origin `/api/*`, which app/api/[...path]/route.ts forwards
 * to the Fastify API (API_ORIGIN), so the httpOnly `sid` cookie is first-party.
 * Mutating requests made with a session carry `x-csrf` (api-contract.md §1).
 */
export class ApiError extends Error {
  status: number;
  code: string;
  fields?: Record<string, string>;
  details?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
    this.details = details;
  }
}

let csrfToken: string | null = null;
export const setCsrf = (t: string | null | undefined) => {
  csrfToken = t ?? null;
};
function readCsrfCookie(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
export const getCsrf = () => csrfToken ?? readCsrfCookie();

type Opts = { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined | null>; headers?: Record<string, string>; raw?: boolean; signal?: AbortSignal };

const FRIENDLY: Record<string, string> = {
  RATE_LIMITED: "That was a lot of requests at once. Please wait a moment and try again.",
  TOO_MANY_ATTEMPTS: "Too many sign-in attempts. Your account is paused for 15 minutes.",
  CSRF_FAILED: "Your session security check expired. Please refresh the page.",
  INTERNAL_ERROR: "Something went wrong on our side. Please try again.",
};

export async function api<T = unknown>(path: string, opts: Opts = {}): Promise<T> {
  const method = (opts.method ?? (opts.body !== undefined ? "POST" : "GET")).toUpperCase();
  let url = path;
  if (opts.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    const s = qs.toString();
    if (s) url += (url.includes("?") ? "&" : "?") + s;
  }
  const headers: Record<string, string> = { accept: "application/json", ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData || typeof opts.body === "string") body = opts.body as BodyInit;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  if (method !== "GET" && method !== "HEAD") {
    const t = getCsrf();
    if (t) headers["x-csrf"] = t;
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, credentials: "include", signal: opts.signal, cache: "no-store" });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "NETWORK", "We couldn't reach the server. Check your connection and try again.");
  }
  if (!res.ok) {
    let payload: { error?: { code?: string; message?: string; fields?: Record<string, string>; details?: Record<string, unknown> } } = {};
    try {
      payload = await res.json();
    } catch {
      /* non-JSON error */
    }
    const code = payload.error?.code ?? `HTTP_${res.status}`;
    throw new ApiError(res.status, code, FRIENDLY[code] ?? payload.error?.message ?? `Request failed (${res.status})`, payload.error?.fields, payload.error?.details);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/** POST that downloads a file (e.g. guest export) and saves it via a blob URL. */
export async function downloadPost(path: string, body: unknown, fallbackName: string) {
  const res = await api<Response>(path, { method: "POST", body, raw: true });
  const cd = res.headers.get("content-disposition") ?? "";
  const m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
  const name = m ? decodeURIComponent(m[1]) : fallbackName;
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** The API may return absolute file URLs on its own origin (API_PUBLIC_URL); route them through our same-origin proxy. */
export function proxied(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url, "http://x");
    if (u.pathname.startsWith("/api/")) return u.pathname + u.search;
  } catch {
    /* keep as is */
  }
  return url;
}

/**
 * Turn API links to pages this app serves (`/i/…`, `/auth/…`, `/api/…`) into same-origin relative links, whatever
 * origin the API put in front (its WEB_URL). Opening or framing them then always stays on this site, so the preview
 * iframe passes `frame-src 'self'` even if the API's WEB_URL differs from the public address. Links meant for
 * sharing (copy, QR) keep the API's absolute URL.
 */
export function localPath(url: string): string {
  try {
    const u = new URL(url, "http://relative.invalid");
    if (/^\/(i|auth|api)(\/|$)/.test(u.pathname)) return u.pathname + u.search + u.hash;
    if (typeof window !== "undefined" && u.origin === window.location.origin) return u.pathname + u.search + u.hash;
  } catch {
    /* ignore */
  }
  return url;
}
