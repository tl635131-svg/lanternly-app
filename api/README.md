# digital-invite — API

Back end for the digital wedding / event invitation platform. It serves two product modes from one codebase:

- **Self-serve.** Hosts build their invitation in the editor. Creating one is free; publishing requires the self-serve (`diy`) plan.
- **Studio (done-for-you).** A paid order provisions an event with a brief, production stages, revision rounds and approval. The studio team publishes.

Guests open a public share link or a personal household link (unguessable token) and RSVP with meals, plus-ones, dietary notes and custom questions. Hosts get live stats, xlsx/CSV export, a 2D seating planner and bulk email campaigns. Bulk email uses a console driver in dev, so **nothing is ever actually sent**.

> The full HTTP contract for the front end is in [`../api-contract.md`](../api-contract.md). OpenAPI is served at `GET /docs` (UI) and `GET /docs/json`, and `npm run openapi` writes `openapi.json`.

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node 20 + TypeScript (ESM, run with `tsx`) |
| HTTP | Fastify 5, `fastify-type-provider-zod` (zod 4 validates every body/query/param) |
| DB | PostgreSQL 17 + Prisma 6 (migrations in `prisma/migrations`) |
| Auth | DB sessions in an httpOnly `sid` cookie + CSRF token (`x-csrf` header), argon2id passwords, one-time hashed tokens |
| Payments | Driver interface: `mock` (default) or `stripe` (Checkout Sessions, **test mode only**, automatic tax) |
| Email | Provider interface: `console` driver (logs + in-memory dev outbox). WhatsApp/SMS are stubs reporting "unavailable" |
| Storage | `local` disk driver behind an interface (S3-ready stub), signed expiring file URLs |
| Jobs | DB-backed queue (`jobs` table, `FOR UPDATE SKIP LOCKED`) + worker (in-process or standalone) |
| Exports | exceljs (xlsx), CSV with formula-injection guard, QR via `qrcode`, `.ics` calendar |
| Tests | Vitest 4 against a dedicated Postgres test DB |

## Quick start

```bash
cd app/api
cp .env.example .env          # then edit DATABASE_URL / APP_SECRET / seed passwords
npm install
npm run db:migrate            # apply migrations (prisma migrate deploy)
npm run db:seed               # catalogue (CAD), themes, add-ons, music, sample testimonials, demo accounts & events
npm run dev                   # http://localhost:4000  (in-process worker included)
curl http://localhost:4000/health
```

### Database (local)

PostgreSQL 17 runs locally on port 5432 on the dev box:

```bash
sudo pg_ctlcluster 17 main start          # no systemd on the box
# one-time setup (already done on the box):
sudo -u postgres psql -c "CREATE ROLE digital_invite LOGIN PASSWORD 'devpassword' CREATEDB;"
sudo -u postgres createdb -O digital_invite digital_invite
sudo -u postgres createdb -O digital_invite digital_invite_test
```

`devpassword` is a local-only dev credential. Use a real secret anywhere else.

### Seeded demo data (dev)

| Account | Role | Password |
|---|---|---|
| `admin@example.com` | studio admin | `SEED_ADMIN_PASSWORD` |
| `designer@example.com` | studio designer (staff, assigned to the demo event) | `SEED_ADMIN_PASSWORD` |
| `host@example.com` | owner of the studio demo "Maya & Theo" | `SEED_DEMO_PASSWORD` |
| `partner@example.com` | co-host of "Maya & Theo" | `SEED_DEMO_PASSWORD` |
| `diy@example.com` | owner of an unpaid self-serve draft "Priya & Sam" | `SEED_DEMO_PASSWORD` |

Seed passwords exist only so local demo logins work. Real accounts are only ever set up through emailed set-password links.

Seeded content:
- **Published invitation** `maya-and-theo`: EN + FR, every section filled, music, 8 households with personal links, 9 RSVPs including plus-ones and children, 4 tables with assignments, 1 completed revision round and a paid order.
- **Theme demo** `demo-meadow`: a sandbox where RSVPs are accepted but not stored.
- **Catalogue**: 6 plans, 6 add-ons, 6 themes, 8 placeholder music tracks and 3 sample testimonials.
- **Add-ons** (`src/lib/addons.ts`, the one place to change the set; CAD placeholder prices): `own_song` 15, `custom_monogram` 25, `extra_language` 20 (all plans, buyable more than once, +1 language each), `photo_cover_film` 45, `rush_design` 69, `custom_link` 19 (all plans; choose the invitation link). Couture (`premium`) includes all of them except `extra_language`, which is charged on every plan. `reminder_pack` is retired (checkout → 422; reminders are free). To swap the set, edit `ADDONS` (and add removed codes to `RETIRED_ADDON_CODES`), then re-run the seed.
- **Themes** (`src/lib/themes.ts`, from design-review.md O5): `evening`, `harbour`, `meadow`, `citrus`, `lilac`, `nocturne`, each with `products` = all four product types. Cover types are `glow` (default), `photo` and `none`.
- **Testimonials**: the three in `design/sample-copy.md`, seeded with `isSample: true` (no rating, no "verified"). Set `SEED_SAMPLE_REVIEWS=false` to seed none (and remove existing samples).
- **Originality migration** (`20261016160000_lanternly_originality` plus the seed): an earlier seed used reference-derived add-ons, themes, envelope covers and fabricated reviews. On an existing database, re-running the seed:
  - deletes the retired add-on codes;
  - moves invitations, versions, orders and drafts off retired themes, then deletes those themes;
  - restyles invitations still on a retired theme's untouched default palette or fonts;
  - refreshes the seeded demo rows;
  - removes the fabricated reviews.

  The migration rewrites `cover.type: envelope` → `glow` (`sealColor` → `glowColor`) and renames brief sections (`custom_music` → `own_song`, `custom_wax_seal` → `custom_monogram`). Nothing else is deleted, and no reset is needed.
- **Spec-gap migrations** (`20261016180000_spec_gaps`, `20261016181500_draft_publish_rights_links`, plus the seed). Data is kept:
  - `themes.product` becomes `products[]`, and `reviews.rating` is dropped;
  - `illustration`/`video` covers become `glow`;
  - `reminder_pack` is deactivated;
  - `max_languages` is set to diy 2 / experience 3 / premium 5;
  - invitations get `published_version` and `draft_changed_at`. A published invite whose content had drifted from its last snapshot gets a fresh snapshot, so guests keep seeing what they saw;
  - adds `invitation_slug_aliases`, `events.selected_extras`, `orders.kind` and `music_rights_confirmations`.
- **Spec-names migration** (`20261016190000_spec_names`): renames `invitation_slug_aliases` → `invitation_slug_redirects` (column `slug` → `old_slug`; rows, keys and indexes kept) and makes `orders.plan_code` nullable (null for add-on-only orders).
- **Music placeholders**: `assets/music/*.mp3` are original 8-second chords synthesized with ffmpeg (sine tones; nothing sampled). The seed copies them into the storage driver under `library/music/` and sets each track's `url` to `/api/public/music/files/<name>.mp3` (made absolute in API responses). Re-seeding never replaces a URL an admin has changed. Replace them with licensed tracks before launch.
- **Share texts**: ready-to-paste invitation texts exist for `en` and `fr` (`src/lib/share-text.ts`). Other event languages are listed as `untranslatedLanguages` rather than getting English text.

Try `GET /api/public/invitations/maya-and-theo` or the personal link `?g=demoVanceFamily0001`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Watch mode server on `PORT` (4000) with the in-process worker |
| `npm start` | Server without watch |
| `npm run worker` | Standalone job worker (set `RUN_WORKER_IN_PROCESS=false` on the API) |
| `npm test` | Vitest suite against `digital_invite_test`. Applies migrations and the idempotent seed first; never wipes data |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run db:migrate` / `db:migrate:dev` | Apply migrations / create a new migration |
| `npm run db:seed` | Idempotent seed |
| `npm run db:reset` | Drop and recreate the dev DB. **Destructive** (manual use only) |
| `npm run db:test:reset` | Wipe the test DB. **Destructive** (manual use only) |
| `npm run openapi` | Write `openapi.json` |
| `npm run contract` | Regenerate `openapi.json` and the GENERATED blocks in `../api-contract.md` (section shapes, settings, endpoint reference) from the zod schemas |
| `npm run contract:check` | Fail if `openapi.json` or the contract's generated blocks are out of date (also run by the tests) |
| `scripts/gen-placeholder-music.sh` | Re-synthesize the placeholder MP3s in `assets/music/` with ffmpeg |

## Environment variables

See `.env.example`; every variable is documented inline. The important ones:

- `DATABASE_URL`: Postgres connection string.
- `APP_SECRET` (≥ 32 chars): signs file URLs, unsubscribe tokens and cookies. In production the app refuses to boot with a dev or test secret.
- `WEB_URL`, `INVITE_BASE_URL`, `API_PUBLIC_URL`, `CORS_ORIGINS`: link building and CORS. Auth links take the form `${WEB_URL}/auth/<token>`; guest links take the form `${INVITE_BASE_URL}/<slug>?g=<token>`.
- `COOKIE_SECURE`: defaults to true in production, which requires it.
- `FEATURE_OWN_SONG` (default `true`): the own-song add-on (song upload or link, plus the rights tick). Set it to `false` and `own_song` disappears from the catalogue (`extras`, `planExtras`, `extraBriefSections`, `GET /api/events/:id/addons`). Every own-song path then returns `403 FEATURE_DISABLED`: checkout lines, the Extras step, `kind=music` uploads, the music-rights routes, brief `own_song`, and a custom song in the editor. Library tracks keep working.
- `TRUST_PROXY=true` behind a proxy or Next.js rewrites, so per-IP rate limits see real client IPs.
- `DEV_ROUTES_ENABLED` (default `true` outside production): registers `/api/dev/*` (mock checkout, admin-only outbox and job runner). Never registered with `NODE_ENV=production`; setting it to `true` there stops the API at startup.
- `PAYMENT_DRIVER` (`auto|mock|stripe`), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_AUTOMATIC_TAX`, `CURRENCY=CAD`.
- `EMAIL_DRIVER=console`, `EMAIL_FROM`, `STUDIO_INBOX`, `EMAIL_WEBHOOK_SECRET`.
- `STORAGE_DRIVER=local`, `STORAGE_LOCAL_DIR`, `SIGNED_URL_TTL_SECONDS`.
- `RUN_WORKER_IN_PROCESS`, `WORKER_POLL_MS`, `QUIET_HOURS_ENABLED`.
- Rate limits: `RATE_LIMIT_ENABLED`, `RATE_LIMIT_AUTH_PER_MIN` (10), `RATE_LIMIT_RSVP_PER_MIN` (10), `RATE_LIMIT_MULTIPLIER`.

## Architecture

```
src/
  server.ts            HTTP server + in-process worker
  worker.ts            standalone worker entry
  app.ts               buildApp(): plugins, swagger, auth hooks, error format, routes
  config.ts            zod-validated env (+ live-Stripe-key guard, prod safety checks)
  db.ts                Prisma client
  lib/                 auth (sessions, CSRF, authz, one-time tokens), crypto, password (argon2id),
                       errors, pagination, slug, theme-engine, brief schemas, catalogue, serializers, ics, bus (SSE)
  services/            orders, pricing, provisioning, payments/, messaging/ (+ email templates), storage/,
                       guests, seating, export, stats, campaigns, invitations, jobs/ (queue + worker)
  routes/              one Fastify plugin per area (auth, events, brief, revisions, invitation, guests,
                       invitees, campaigns, seating, public, public-invitations, checkout, webhooks, files, admin, dev)
prisma/                schema, migrations (incl. hand-written constraints), seed
tests/                 vitest suites + helpers (cookie-jar client with CSRF)
```

**Roles.**
- **Platform role** `User.role`: `host | staff | admin`.
- **Per-event membership** `EventMember.role`: `owner | cohost | viewer`.

Every event route goes through `requireEventAccess(req, eventId, 'read'|'write'|'owner')`:
- Non-members get **404**, so the API never reveals that an event exists.
- Viewers are read-only.
- Archived events are read-only for hosts.
- Admins see all events. Staff see only events assigned to them.
- `/api/admin/*` requires `staff` or `admin`. Some actions (delete, user management) are admin-only.

**Accounts and passwords.**
- Nobody ever chooses, sees or receives a password by email.
- Accounts are created without a password, through checkout, self-serve register, co-host invite or an admin manual order. The user gets a **one-time, expiring set-password link**.
- Tokens are 256-bit random values. Only their sha256 hash is stored. They are consumed atomically, and issuing a new link invalidates older ones.
- Token lifetimes: set-password 72 h, reset 60 min, login link 20 min, co-host invite 7 days.
- Passwords are hashed with argon2id.
- 10 failed logins lock the account for 15 minutes. Changing or resetting the password revokes other sessions.
- Emails that carry a one-time token are delivered immediately and are never queued, so raw tokens never sit in the jobs table.

**Sessions and CSRF.**
- Login sets an httpOnly `sid` cookie (only its hash is stored) and a readable `csrf_token` cookie. The CSRF value is also returned in the JSON response.
- Every mutating request made with a session must send `x-csrf: <token>`.
- Public guest endpoints, auth bootstrap endpoints and webhooks are exempt.

**Theme engine.** An invitation is made of three parts:
- `theme`: a designer skin, referenced by key.
- `config` JSON: palette, fonts, cover, opening animation, music, section order, hidden sections.
- `content` JSON per language: `{hero, sections:{<key>:{…}}, footer}`.

All three are validated with strict zod schemas, and content is capped at 300 KB. Publishing snapshots a version, and you can roll back to it later.

**Live stats.**
- `GET /api/events/:id/stream` is an SSE feed with these events: `guest.created|updated|deleted`, `stats.updated`, `stage.changed`, `brief.updated`, `revision.updated` and `invitation.updated`.
- The feed runs on an in-process bus. To run more than one API instance, swap it for Postgres LISTEN/NOTIFY or Redis.

## Worker and jobs

`jobs` table job types:
- `send_message`
- `dispatch_campaign`: expands a campaign into one message per invitee.
- `rsvp_deadline_reminders`: daily.
- `archive_events`: daily.
- `cleanup_tokens`: daily.

How the queue runs:
- Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so several workers can run at once.
- Failed jobs retry with backoff (1 min, 5 min, 30 min, 2 h).
- Jobs stuck in "running" are released after 10 minutes.
- Bulk sends respect quiet hours (21:00–09:00 in the event's time zone).
- Messages carry idempotency keys, so a retry never double-sends.

Running it:
- By default the worker runs inside the API process (`RUN_WORKER_IN_PROCESS=true`).
- In production, run `npm run worker` as its own process.
- In dev you can trigger a pass manually with `POST /api/dev/run-jobs`.

## Email and messaging

`services/messaging` defines a `ChannelProvider` interface.
- The only email driver is `console`. It **never sends**: it logs each message and keeps the latest 200 in a dev outbox. `GET /api/dev/outbox` needs an **admin session** (sign in as `admin@example.com`) and is not registered in production; anyone else can read the same emails in the API log. Tests read the outbox directly through `getDevOutbox()` in `tests/helpers.ts`.
- WhatsApp and SMS providers exist only as stubs with `available=false`. Requests to use them get `422 CHANNEL_NOT_AVAILABLE`. Hosts can still share personal links through the `wa.me` links in the share kit.
- A real provider (Resend, Postmark or SES) can be added later by implementing `send()`. No such provider is wired up.

## Storage

`services/storage` defines a `StorageDriver` interface.
- `LocalDiskStorage` writes to `STORAGE_LOCAL_DIR`. The `s3` driver is a stub ready to be implemented.
- Uploads are checked by kind and by magic bytes: images up to 15 MB (jpeg, png, webp, heic), audio up to 20 MB (mp3, m4a, aac).
- Files are served only through HMAC-signed, expiring URLs: `GET /api/files/:token`.

## Payments: switching from mock to Stripe test mode

- With no Stripe key, `PAYMENT_DRIVER=auto` uses the **mock driver**. `POST /api/checkout/session` returns a URL to a local test page (`/api/dev/mock-checkout/:sessionId`) with **Pay (test)** and **Cancel** buttons. Paying simulates a 13% tax and fulfils the order. The page's forms carry a per-session HMAC **pay token**, and `POST …/complete` and `…/cancel` refuse requests without it (403), so the page can settle only its own session and a bare session id can't mark an order paid. Tests use the `mockCheckout()` helper.
- **Live keys are refused at startup** (`sk_live_`/`rk_live_`). Webhook events with `livemode: true` are rejected.

To use Stripe **test mode**:
1. In the Stripe dashboard, switch to **Test mode** and copy the `sk_test_…` secret key. To get `STRIPE_AUTOMATIC_TAX=true` working, enable Stripe Tax in test mode and set an origin address. Otherwise set it to `false`.
2. In `.env`, set:
   ```
   PAYMENT_DRIVER=stripe
   STRIPE_SECRET_KEY=sk_test_...
   ```
3. Forward webhooks locally with the Stripe CLI, then put the printed `whsec_…` value into `STRIPE_WEBHOOK_SECRET`:
   ```
   stripe listen --forward-to localhost:4000/api/webhooks/stripe
   ```
4. Restart `npm run dev`, then pay with test card `4242 4242 4242 4242`.

How the Stripe driver builds sessions:
- Line items are created on the fly with `price_data` in CAD, `tax_behavior: exclusive` and tax code `txcd_10000000`.
- Sessions use `automatic_tax`, require a billing address and allow promo codes.
- Sessions are created with an idempotency key per order.

The webhook:
- Verifies the signature against the raw body.
- Handles `checkout.session.completed`, `async_payment_succeeded`, `expired`, `async_payment_failed` and `charge.refunded`.
- Is idempotent per event id (`processed_webhook_events`). Order fulfilment also row-locks the order.
- `GET /api/checkout/session/:id/verify` is a fallback for when the webhook is delayed.

## Tests

```bash
npm test
```

There are 137 tests in 13 files:

| File | Covers |
|---|---|
| `auth.test.ts` | Login, sessions, lockout, set-password, reset, magic link, change password, auth rate limit |
| `authz.test.ts` | 404 isolation, role checks, staff assignment, viewer read-only, co-host invite, archived read-only, CSRF |
| `invites.test.ts` | Event and invitation CRUD, theme-engine validation, publish/402, preview, 410 archived, seeded demo |
| `guests.test.ts` | Personal links, rotation, import, public RSVP rules, edit flow, idempotency, honeypot, demo sandbox, RSVP rate limit, manual guests, xlsx/CSV export, campaign → worker → console email |
| `seating.test.ts` | Tables, positions, assignments, capacity, version conflicts, validation, auto-arrange, unseat on decline |
| `checkout.test.ts` | Quotes, mock checkout end to end, idempotent session, self-serve purchase, cancel; Stripe webhook signature (valid, invalid, tampered), idempotency, live-mode rejection, expiry and refund; email webhook secret |
| `studio.test.ts` | Stages, revision rules, comments, approval, admin publish |
| `query-bool.test.ts` | Strict boolean query params (`false`/`0` really mean false; `yes` → 400) across import commit, guest trash/permanent, QR download, mock-checkout redirect and admin abandoned filter |
| `catalog-originality.test.ts` | The six add-ons and prices, retired codes (incl. `reminder_pack`) rejected, `extra_language` qty and Couture inclusion, rush sets express, `info.letter` → 400, the six themes (exact designer colours, every product, glow cover, strict cover/palette), demo copy has no reference motifs, sample testimonials flagged, and an empty reviews list handled |
| `qa-security.test.ts` | QA fixes: a decline needs no email even when `requireEmail` is on (general and personal links) while yes still does; outbox admin-only (401/403/200); run-jobs needs admin + CSRF; mock checkout complete/cancel need that session's pay token (missing, wrong, other session's → 403; page form → 303); security headers (CSP, nosniff, DENY, no-referrer, no HSTS outside prod, no `X-Powered-By`/`Server`); `/docs` CSP; CORS echoes only the configured origin |
| `spec-gaps.test.ts` | Theme `products[]` (single `product` → 400), reviews without rating, glow/photo/none covers, diy extras and language limits (2/3/5 + extra_language), pay-to-publish required add-ons, draft vs live (publish changes, discard, rollback into draft, public snapshot, preview), Canadian gift fields, music rights (400 without tick, endpoint, upload field, stored row), custom_link slugs (validation, aliases, RSVP on old slug, 402 ADDON_REQUIRED), add-on checkout and refund, admin slug |
| `spec-names.test.ts` | Names aligned with spec/: `PATCH …/invitation/slug` (response shape, reserved → `fields.slug='reserved'`, 409, viewer 403, CSRF, studio co-host 402 / Couture included / admin, PUT `{slug}` → 400), display-only gifts (message optional, `GIFT_PAYOUT_REQUIRED` without a complete payout method, payment fields rejected, registry needs an https link → 422, public page shows display fields only), QA round 3 (add-ons checkout short of units → 422 with `details.missing`, nothing saved; admin language cap = plan cap + units, max 8), manual admin orders (paid `manual` order with admin, lines and audit entry; units raise the cap; refunds; admin only; extra_language auto-added at server price; `POST /api/admin/orders/:orderId/refund` for manual orders), `invitation_slug_redirects(old_slug)` + 301 for page requests keeping `?g=`/`?lang=` + JSON `redirectedFrom`, `FEATURE_OWN_SONG=false` → catalogue hides own_song and every own-song path is 403 `FEATURE_DISABLED`, Publish changes → 402 `ADDON_PAYMENT_REQUIRED` with `details.missing`, add-ons checkout errors (`PLAN_NOT_PAID`, 400/422/409, rush after delivery, Couture extra_language, idempotency) and `GET /api/events/:id/addons` |
| `contract-fixes.test.ts` | Required custom questions, French share texts (share kit and personal links, untranslated languages omitted), placeholder music URLs that stream (`audio/mpeg`, Range), contract/OpenAPI in sync |

Before the tests run, the test setup applies migrations and runs the idempotent seed. It never resets the database, and each test creates its own uniquely named records.

## Plans, add-ons and editing rules

- **Entitlements** (`src/services/entitlements.ts`): plan limits plus purchased add-ons (paid orders of either `kind`, i.e. `plan` or `addons`). An unpaid self-serve event also counts its `selectedExtras`. Language limit = `plans.max_languages` + the number of `extra_language` units.
- **Languages before payment**: an unpaid draft over its cap is never rejected. `selectedExtras` holds exactly the `extra_language` units the languages need, and units are added or removed automatically. Checkout (plan and add-ons) quietly trims excess units. The add-ons checkout takes an optional target `languages` list, which is applied on payment. Paid units are never removed. Only an unsupported code or more than 8 languages returns 422. After payment, going over the cap returns `402 ADDON_PAYMENT_REQUIRED`.
- **Self-serve checkout**: the diy wizard steps are `theme, extras, languages, info, summary`. Chosen add-ons go to `events.selected_extras`. Pay to publish defaults `extras` to them and requires add-ons already in use (custom song, renamed link, extra languages).
- **Add-ons checkout** (`GET /api/events/:id/addons`, `POST /api/checkout/addons[/quote]`): for paid events (owner or co-host). Orders have `kind: addons` and `plan_code` null. Refunding such an order revokes only its add-ons. Using an unpaid add-on after payment (slug change, more languages, "Publish changes" with a custom song / renamed link / extra languages) returns `402 ADDON_PAYMENT_REQUIRED` with `details.missing [{code, qty}]`. An unpaid event gets `409 PLAN_NOT_PAID`.
- **Draft / publish**: invitation theme, content and config edits are drafts. Publish creates snapshot n+1 and sets `published_version`. The public page renders that snapshot. `discard-draft` resets the draft; rollback copies into the draft. Event details, RSVP settings, slug and locale apply immediately.
- **Gifts (display-only)**: no money is ever handled. Allowed fields: `mode`, `note` (the couple's message), `registries` / `registryUrl` (https), `interacEmail` and `bank`; any other key gets a 400. `note` is optional (up to 1000 characters). Cash and both modes need one complete payout method: `interacEmail`, or bank institution + transit + account numbers, or an IBAN (otherwise `422 GIFT_PAYOUT_REQUIRED`). Registry and both need at least one https registry link (`422 GIFT_REGISTRY_URL_REQUIRED`). The public page returns only these fields.
- **Music rights**: an own song (upload or link) needs a rights tick. Each tick is a row in `music_rights_confirmations`: user, event, asset or URL, statement text, time, HMAC-hashed IP and user agent. Uploads need `rightsConfirmed=true`.
- **Links**: automatic slugs look like `maya-theo-7k2q`. With `custom_link` (or Couture), hosts change the link with `PATCH /api/events/:id/invitation/slug`. Input is normalised first: lowercased, hyphen runs collapsed, leading and trailing hyphens stripped. The route returns `{slug, url, previousSlugs}` with the normalised slug. The rules: 3–60 characters, `a-z0-9-`, reserved words and `demo-*` blocked, and the link must be unique. Sending `slug` in `PUT …/invitation` (host or admin) returns 400 with `fields.slug` pointing to the PATCH route. Old slugs live in `invitation_slug_redirects(old_slug)` and are never reusable by another invitation. Page requests (`Accept: text/html`) for an old slug get a 301 to `${INVITE_BASE_URL}/<current>` with the query kept. JSON requests get `invitation.redirectedFrom`. RSVPs, opens and the calendar on old slugs act on the current invitation.

## Security headers and CORS

`@fastify/helmet` is registered globally (`src/app.ts`):
- CSP for a JSON API: `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`. `/docs` gets a CSP that allows Swagger UI's own scripts and styles (`'self'`, plus inline styles) and still sets `frame-ancestors 'none'`. The mock checkout page sets its own strict CSP.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, and `Cross-Origin-Resource-Policy: cross-origin` so the web app can embed signed asset and music URLs.
- HSTS only in production. There is no `X-Powered-By` or `Server` header.
- CORS: only the exact origins in `CORS_ORIGINS`, with credentials. Wildcards and paths are rejected at startup.

## Dependency audit

`npm audit` on 2026-10-16: **0 vulnerabilities** (before: 8, of which 2 critical, 3 high and 3 moderate).
- `vitest` 3.2 → 4.1.12 (fixes tinypool prototype pollution (critical) and the `@vitest/mocker` path traversal). Dev only.
- `overrides` in `package.json`:
  - `exceljs` → `uuid@^11.1.1`. exceljs 4.4.0 is the latest release and only uses `uuid.v4()`; uuid 11 still ships CommonJS. The xlsx export test (writes and re-reads a workbook) passes, and the uuid code path (conditional-format extensions) was checked by hand.
  - `@prisma/config` → `deepmerge-ts@^8.0.2` (stack exhaustion, high). This affects the Prisma CLI, a dev dependency. `prisma validate`, `generate`, `migrate status` and `migrate deploy` (test setup) all work.
- Install with npm ≥ 10 (`npx npm@10 install` if your system npm is older). npm 9.2 crashes building the vitest 4 tree.
- Remove the overrides once exceljs and Prisma 6 ship fixed ranges, or after moving to Prisma 7.

## Production notes (not deployed)

- Required settings: `NODE_ENV=production`, `COOKIE_SECURE=true`, a strong `APP_SECRET`, `TRUST_PROXY=true` behind a proxy, and a separate worker process.
- Dev routes (`/api/dev/*`) are not registered in production, and `DEV_ROUTES_ENABLED=true` with `NODE_ENV=production` refuses to boot.
- HSTS (`max-age=31536000; includeSubDomains`) is sent only when `NODE_ENV=production`; serve the API over HTTPS.
- Before launch:
  - Replace the console email driver with a real provider.
  - Implement the S3 storage driver.
  - Move the SSE bus and the rate-limit store to Redis if you scale horizontally.

## Manual admin orders

`POST /api/admin/events` with `markPaid: true` (the default) records the sale as a real paid order: `payment_provider = 'manual'`,
`created_by_admin_id` = the admin, plan / add-on lines priced by `computeQuote` (no design needed; `extra_language` units = exactly what the languages need; `extras` takes codes or `{code, qty}`),
and an `order.manual_created` activity entry. Entitlements read paid orders, so these add-ons count as purchased. There is no
complimentary field, so the amount is always the server price. Migration `20261016200000_manual_orders` adds the column and backfills a
manual plan-only order for every event marked paid without a paid/refunded order (old manual sales never stored their add-ons).

Refunds of manual orders: `POST /api/admin/orders/:orderId/refund {reason}` (admin, CSRF). It runs the same `refundOrder` logic as
the Stripe `charge.refunded` webhook and logs `order.manual_refunded` (admin id + reason). No money moves. Checkout orders → 409.

Quote/checkout theme (N-32): `POST /api/checkout/quote` takes an optional `eventId` (owner/co-host). A missing `themeKey`, `languages`
or `extras` then falls back to the event's saved invitation theme, languages and `selectedExtras` (pay-to-publish checkout already did
this). Explicit `themeKey` wins and is validated; no theme at all → 422 "Please choose a design". The mock checkout page is UTF-8
(header + meta) and shows amounts like CA$249.00 in the order currency.

Editor link state (N-39): the invitation GETs add `previousSlugs [{oldSlug, createdAt}]` and `customLinkLocked`. RSVP stats (N-40):
`invited`, `replied`, `waiting` (shared definitions in `src/services/stats.ts`, also used by the "not responded" campaign segment),
`generalLinkReplies` separate; `responseRate = replied / invited`. Checkout create responses return `extras`, `lines`, `subtotalCents`
and `currency`, matching the quote.

## Deploy to Render (free plan, demo)

`app/render.yaml` is a Render Blueprint for the whole app: a free Postgres (`lanternly-db`), the API (`lanternly-api`,
`rootDir: api`) and the web app (`lanternly-web`, `rootDir: web`). Nothing has been deployed yet.

**Steps**
1. Push `app/` (with `render.yaml` at its root) to a Git repo Render can read.
2. Render Dashboard → **New → Blueprint** → choose the repo → **Apply**. Render creates the database and both services.
3. API build: `npm ci --include=dev && npm run build` (`prisma generate` + `tsc -p tsconfig.build.json` → `dist/`).
   API start: `npm run start:render` → `scripts/render-start.sh`: `prisma migrate deploy` → `node dist/scripts/seed-if-empty.js`
   (seeds catalogue + demo data only when there are no users) → `exec node dist/src/server.js` on `0.0.0.0:$PORT`.
   (Free services have no `preDeployCommand`, so migrations run at start.) Health check: `/health` (checks the DB).
4. Web build: `npm ci --include=dev && npm run build`; start: `API_ORIGIN="https://$API_HOST" npm start`; health check `/healthz`.
5. Open `https://lanternly-web.onrender.com` (or the name Render gives). Demo logins: `admin@example.com`, `designer@example.com`,
   `host@example.com`, `partner@example.com`, `diy@example.com`, all with **DEMO_PASSWORD** (Dashboard → lanternly-api → Environment).

**API environment (set by the Blueprint)**

| Var | Value |
| --- | --- |
| `NODE_VERSION` / `NODE_ENV` | `20` / `production` |
| `DATABASE_URL` | `fromDatabase lanternly-db connectionString` (internal URL) |
| `APP_SECRET` | `generateValue` (the API's single secret: sessions, CSRF, signed URLs) |
| `DEMO_PASSWORD` | `generateValue` (demo logins; used only on the first start with an empty DB) |
| `WEB_HOST` | `fromService lanternly-web RENDER_EXTERNAL_HOSTNAME` → `WEB_URL`, `INVITE_BASE_URL`, `CORS_ORIGINS` |
| `API_PUBLIC_URL` | not set: defaults to Render's `RENDER_EXTERNAL_URL` |
| `COOKIE_SECURE` / `TRUST_PROXY` | `true` / `true` (HSTS is on in production) |
| `PAYMENT_DRIVER` / `EMAIL_DRIVER` / `STORAGE_DRIVER` | `mock` / `console` / `local` |
| `ALLOW_MOCK_PROVIDERS_IN_PRODUCTION` | `true` (required for the mock/console drivers in production; loud startup banner) |
| `DEV_ROUTES_ENABLED` | `false` (production refuses `true`; only the mock checkout page stays reachable) |
| `RUN_WORKER_IN_PROCESS` | `true` (job worker runs inside the API process) |
| `FEATURE_OWN_SONG`, `SEED_SAMPLE_REVIEWS`, `LOG_LEVEL` | `true`, `true`, `info` |

`COOKIE_DOMAIN` stays unset: the browser only talks to the web origin (its `/api` proxy forwards to the API), so cookies are
host-only there, and `onrender.com` is a public suffix anyway. With a custom domain, set `WEB_URL` (and `API_PUBLIC_URL`) explicitly.

**Fail-fast checks in production:** missing/invalid variables are listed one per line at startup; `COOKIE_SECURE` must be true and
`APP_SECRET` real; `WEB_URL`, `API_PUBLIC_URL` and `INVITE_BASE_URL` must not point at localhost; `DEV_ROUTES_ENABLED` must be false;
mock payments / console email need `ALLOW_MOCK_PROVIDERS_IN_PRODUCTION=true`; live Stripe keys are always refused.

**Caveats (free plan)**
- Free web services sleep after 15 minutes without traffic; the next request takes about a minute (the web's first `/api` call also
  wakes the API, so the first page can take longer). The in-process job worker (reminders, scheduled sends) doesn't run while asleep.
- The free Postgres expires 30 days after creation (14-day grace to upgrade, then it is deleted) and has no backups; 1 GB max.
- Uploads (photos, own songs, generated files) are on the local disk, which is wiped on every restart, redeploy and spin-down.
  The bundled library music is re-copied on every start, so library tracks survive restarts; host uploads do not.
- Payments are mock only (the mock checkout page is served by the API; nothing is charged). Email is console only: nothing is sent, so
  sign-up confirmations, set-password links and password resets can't be received; use the demo logins.
- The seed runs only on an empty database, so later catalogue/price changes in `prisma/seed.ts` are not applied to an existing deploy.

**Local production check:** `npm run build`, then with a scratch database and production env (no `.env` in the folder),
`npm run start:render`. A second run prints `skipping the demo seed`.
