# Deploying the web app (Render)

The web app (Next.js 16) runs as one Render **web service** (`lanternly-web`) in the shared Blueprint `app/render.yaml`. It serves every page and forwards `/api/*` to the API, so the browser only ever talks to one HTTPS origin. Cookies are first-party there, and the CSP can stay `'self'`.

## How the proxy works
- `app/api/[...path]/route.ts` forwards every `/api/*` request to the API. It reads the target **at request time**, so one build can be pointed anywhere. The old `next.config.ts` rewrites were removed: rewrites are compiled into the build output at `next build` time, so a target set only at start would be ignored.
- It passes through:
  - the method, body, query and headers, including the `Cookie` and `x-csrf` headers;
  - every `Set-Cookie` on the way back (`getSetCookie()`, so multiple cookies survive);
  - redirects (`redirect: "manual"`; a `Location` on the API's own origin is rewritten to a relative path);
  - streamed responses: SSE `/api/events/:id/stream` is not buffered.
- It adds `x-forwarded-host`, `x-forwarded-proto` and `x-forwarded-for`. Set `TRUST_PROXY=true` on the API.
- If the API is unreachable (asleep or starting), it returns `502 UPSTREAM_UNAVAILABLE` with a friendly message.
- Cookies are set by the API as `HttpOnly` (`sid`), `SameSite=Lax`, and `Secure` when `COOKIE_SECURE=true` (the default in production). They arrive through the proxy, so they're host-only on the web's domain. Leave `COOKIE_DOMAIN` unset: `onrender.com` is a public suffix.
- `/healthz` is the web's own health check. It returns 200 without calling the API, so a sleeping API never fails the web's deploy. `/healthz?deep=1` also checks the API. `/health` passes the API's health through.

## Environment variables (web)
| Var | Required | Example | Notes |
|---|---|---|---|
| `API_ORIGIN` | one of these two | `https://lanternly-api.onrender.com`, `lanternly-api:10000`, `http://localhost:4000` | Where `/api/*` goes. A full URL, or a bare `host:port` (gets `http://`). Read per request. Aliases: `INTERNAL_API_URL`, `API_URL`. Wins over `API_HOST`. |
| `API_HOST` | one of these two | `lanternly-api.onrender.com` | A bare public hostname. The web uses `https://API_HOST`. Set from the API's `RENDER_EXTERNAL_HOSTNAME` in the Blueprint. |
| `PUBLIC_BASE_URL` | no | `https://lanternly-web.onrender.com` | Absolute URLs in metadata (Open Graph). Falls back to `RENDER_EXTERNAL_URL` (set by Render), then the request host. Alias: `NEXT_PUBLIC_SITE_URL`. |
| `PORT` | set by Render | `10000` | `npm start` binds `0.0.0.0:$PORT`. |
| `NODE_ENV` | yes | `production` | |
| `NODE_VERSION` | yes on Render | `20` | Matches `.nvmrc` (20.19.2) and `engines` (20.x). |
| `NEXT_TELEMETRY_DISABLED` | no | `1` | |

With no API variable set, it falls back to `http://localhost:4000` for local dev. No secrets are needed by the web.

**Set on the API, not the web, but required for the web to work:** `WEB_URL` / `INVITE_BASE_URL` / `CORS_ORIGINS` must be the web's public URL. The API derives them from `WEB_HOST`. These feed share links, QR codes, emails, auth links and the mock-checkout return URL. Also set `COOKIE_SECURE=true` and `TRUST_PROXY=true`.

## Commands
```bash
# build (clean checkout; dev deps are needed for Tailwind and TypeScript, even with NODE_ENV=production)
npm ci --include=dev && npm run build
# start (Render sets PORT)
npm start            # = next start -H 0.0.0.0 -p ${PORT:-3000}
```
Fonts are self-hosted in `public/fonts`, so the build needs no network beyond npm. `output: "standalone"` isn't used: `next start` needs `node_modules`, which Render keeps from the build.

## Render Blueprint: web block
The `lanternly-web` entry in `app/render.yaml` was reviewed and fixed. A copy is in `web/render.web-service.yaml`:

```yaml
  - type: web
    name: lanternly-web
    runtime: node
    plan: free
    rootDir: web
    buildCommand: npm ci --include=dev && npm run build
    startCommand: npm start
    healthCheckPath: /healthz
    autoDeployTrigger: commit
    envVars:
      - key: NODE_VERSION
        value: "20"
      - key: NODE_ENV
        value: production
      - key: API_HOST
        fromService:
          name: lanternly-api
          type: web
          envVarKey: RENDER_EXTERNAL_HOSTNAME
      - key: NEXT_TELEMETRY_DISABLED
        value: "1"
```

If `API_HOST` comes through empty (the cross-service reference to Render's built-in variable didn't resolve), set `API_ORIGIN=https://<api-service>.onrender.com` on the web service in the Dashboard. It wins over `API_HOST`, and no redeploy of the build is needed, only a restart.

## Security headers on one HTTPS origin
- The CSP is set per request with a nonce by `proxy.ts`:
  - `frame-src 'self'` (plus Google Maps);
  - `frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` on `/i/*` only;
  - `frame-ancestors 'none'` and `DENY` everywhere else;
  - `upgrade-insecure-requests` and HSTS in production.
- The studio/editor phone preview frames `/i/<slug>` from the same origin. `localPath()` always makes `/i/…` links relative, so the frame stays on the web's origin even if the API's `WEB_URL` differs.
- The mock checkout page is served by the API, on its own domain or through the proxy. It posts to its signed `/complete` / `/cancel` routes and 303s back to `${WEB_URL}/checkout/success`. Nothing in the web UI uses dev-only routes (outbox, job runner).

## Free-plan notes
- **Cold starts:** both services sleep after 15 minutes idle. The first page load can take about a minute, and the first `/api` call then wakes the API (the proxy returns 502 with a retry message if the API isn't up yet).
- **Uploads aren't persistent:** they're wiped on restart, redeploy or spin-down. The web hides missing photos on guest pages, turns off the music button if the song fails to load, and shows "File unavailable" tiles in the studio and editor.
- **Build memory:** `next build` peaked well under 2 GB locally. If a 512 MB build fails with an out-of-memory error, use a larger plan for the build.
