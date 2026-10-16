# digital-invite: web front end

This is the Next.js (App Router), React 19, TypeScript and Tailwind v4 front end for the digital wedding invitation platform. Every page reads from and writes to the real API in `../api`. There is no mock data.

## Run it

```bash
# 1. API (see ../api/README.md): it must be on http://localhost:4000
# 2. Web
cd app/web
npm install
npm run dev          # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint (next/core-web-vitals and TypeScript) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run screenshots` | Playwright captures of every screen at 1280 px and 390 px into `screenshots/`. Needs both servers running and the demo seed. Pass a name fragment to capture just one screen, e.g. `python3 scripts/screenshots.py 19-` |

Note: `npm run build` writes to `.next`, the same folder the dev server uses. Stop the dev server before building, then restart it afterwards.

### Environment variables

See `DEPLOY.md` for the full list and the Render setup. In short: `API_ORIGIN` (default `http://localhost:4000`) is where `/api/*` is forwarded, by the route handler `app/api/[...path]/route.ts`, read at request time. `PUBLIC_BASE_URL` is optional. See `.env.example`.

The browser only ever calls same-origin `/api/...`, so the httpOnly session cookie and the `csrf_token` cookie stay first-party. No secrets are needed or stored.

Demo logins come from the local API seed (`../api/README.md`): `host@example.com` (studio event "Maya & Theo"), `diy@example.com` (unpaid self-serve event "Priya & Sam"), with the password from that README.

## Theme and brand: one file

**Everything visual comes from `theme/brand.ts`.** That covers colours, fonts, radii, shadows, the brand name and the logos.

```ts
// theme/brand.ts (last line)
export const brand: Brand = lanternly;   // or hearthAndHour, merrymade
```

- Changing that one line rebrands the whole app: logo, name in titles and footers, palette, type, corner radius and shadows. Three presets are included: `lanternly` (the current default), `hearthAndHour` and `merrymade`. For a new brand, add another `Brand` object in the same file.
- How it works: `theme/css.ts` turns the brand into `--brand-*` CSS custom properties and `@font-face` rules. `app/layout.tsx` injects them into `<head>`. `app/globals.css` maps them to Tailwind tokens with `@theme inline` (`bg-canvas`, `bg-surface`, `text-ink`, `text-muted`, `bg-primary`, `bg-accent`, `bg-night`, `rounded-card`, `shadow-card`, `font-display`, …). Components use only these tokens and contain no hex values.
- Logos are in `public/brand/` (the `logo.light`/`logo.dark`/`symbol` paths in the brand object). Fonts are self-hosted in `public/fonts/`.
- The placeholder look is deliberately neutral: no wax seals, envelopes, burgundy or gold.
- **Design system.** `app/ds.css` holds the `../design/` component classes (`.chip`, `.status`, `.tag`, `.card`, `.card-night`, `.stat`, `.bar`, `.segmented`, `.stepper`, `.phone`, `.empty`, …) inside `@layer components`. Its `:root` aliases the design tokens (`--color-*`, `--elevation-*`, `--glow-*`) onto the `--brand-*` variables, so the design classes follow `brand.ts` too. Rebranding stays a one-line change.
- **One reply status set everywhere:** `<StatusChip tone="attending|declined|maybe|pending">` reads "Coming / Can't come / Maybe / Waiting" (`REPLY_LABEL`). Use `toneForAttendance()` to map the API's `yes/no/pending`.
- **Invitation designs are separate from the app brand.** Each invitation's palette and fonts come from the API (`theme.defaultConfig`, merged with `invitation.config`). `lib/palette.ts` (`invVars`) applies them as `--inv-*` variables on the `.inv` root that `app/invite.css` styles:

  | API palette | Used for |
  |---|---|
  | `primary` / `onPrimary` | button colour / button text |
  | `accent` | highlight text (falls back for contrast) |
  | `glow` (or `cover.glowColor`) | the opening glow, blooms and pins |
  | `text`, `surface`, `background` | ink, raised cards, page |

  Light backgrounds (luminance > 0.4) get `.inv.light`. Font family names from the API ("Fraunces", "Manrope", …) are resolved in `theme/css.ts`.
- Production build check without stopping dev: `NEXT_DIST_DIR=.next-build npx next build`.

## Page map

| Route | Screen | Main API calls |
|---|---|---|
| `/` | Marketing home: hero, invitation styles, how it works, host tools, reviews, pricing teaser | `GET /api/public/catalogue`, `GET /api/public/reviews` |
| `/pricing` | Plans from the catalogue (CA$99 / CA$249 / CA$899), wedding and other tabs, FAQ, `?checkout=canceled` notice | `GET /api/public/catalogue` |
| `/start?plan=` | Studio order wizard: steps come from `plan.steps`, live quote, mock Stripe checkout | `PUT /api/checkout/draft`, `POST /api/checkout/quote`, `POST /api/checkout/session` |
| `/checkout/success` | Payment confirmation: polls verify, then sign-in or set-password next steps | `GET /api/checkout/verify` |
| `/login` | Password sign-in, magic link, forgot password, create a self-serve account | `/api/auth/login`, `/magic-link`, `/password/forgot`, `/register` |
| `/auth/[token]` | One-time link: set password (with strength meter), magic sign-in, co-host invite | `GET/POST /api/auth/tokens/:token` |
| `/unsubscribe` | Email opt-out | `/api/public/unsubscribe` |
| `/app` | Couple dashboard: invitations list; **New invitation** wizard (Style → Extras → Languages → Details → Review; add-ons are charged at publish) | `GET /api/events`, `POST /api/events {product, extras[], languages, themeKey, sections}`, `POST /api/checkout/quote` |
| `/app/[id]` | Overview: countdown, production tracker (studio) or publish card (DIY), stats, share kit, invites-sent, brief and revision summaries, live activity | `GET /api/events/:id`, `/stats`, `/activity`, `/share-kit`, SSE `/stream` |
| `/app/[id]/invitation` | **DIY editor**: edits always go to the **draft**; "Live · version n" + "Unpublished changes" chips, **Publish changes** / **Discard draft** (confirm), draft preview vs live page. Event details, languages, reply form and the link are tagged "Saved instantly". Languages card enforces the plan cap (diy 2 · Signature 3 · Couture 5) with Extra language add-ons. Music: library or **own song** (upload/link behind the required "I have the rights to use this music" tick; hidden on 403 FEATURE_DISABLED). Link: custom slug with live validation, confirm, previous links. Gifts: Interac e-Transfer email, institution/transit/account numbers, optional IBAN/BIC. Pay dialog: plan + add-on rows (locked when the draft uses them), server quote. `402 ADDON_PAYMENT_REQUIRED` opens the Add-ons checkout. **Studio**: read-only preview, link editor, "Add extras", share kit | `GET/PUT /api/events/:id/invitation`, `/publish`, `/discard-draft`, `/unpublish`, `/rollback`, `/preview-token`, `PATCH …/invitation/slug`, `PATCH /api/events/:id`, `/music-rights`, `POST /assets?kind=music`, `GET /api/events/:id/addons`, `POST /api/checkout/{quote,session,addons/quote,addons}` |
| `/app/[id]/guests` | Households: add, edit, delete, CSV import (preview then commit), personal links, WhatsApp/SMS/email share, QR (PNG/SVG), mark sent, rotate link, email campaign preview, general link | `/api/events/:id/invitees*`, `/qr`, `/email-campaigns*` |
| `/app/[id]/replies` | RSVP dashboard: live via SSE with a 30 s polling fallback, filters, search, detail, manual add/edit, trash, restore, permanent delete, export xlsx/csv | `/api/events/:id/guests*`, `/export` |
| `/app/[id]/seating` | 2D seating planner: drag parties onto tables, drag tables and room items, keyboard moves, table grid view, add/edit tables, auto-arrange, versioned save | `GET/PUT /api/events/:id/seating`, `/seating/auto-arrange` |
| `/app/[id]/brief` | Studio brief: autosaving sections, completion bar, submit, locked state, photo and file uploads | `GET/PATCH /api/events/:id/brief`, `/brief/submit`, `GET/POST /assets` |
| `/app/[id]/revisions` | Studio review: draft link, rounds left, request changes, history with comments, approve with confirmation | `/api/events/:id/revisions*`, `/approve` |
| `/app/[id]/settings` | Reply-form settings, notifications and reminders, co-hosts (owner manages roles), change password, export everything (JSON), deletion request | `/rsvp-settings`, `PATCH /api/events/:id`, `/members*`, `/api/auth/password/change`, `/export-all`, `/delete-request` |
| `/i/[slug]` | **Public guest invitation**: mobile-first, original "first light" opening, music toggle, countdown, every section type, maps and calendar, language switch, RSVP through a personal link (`?g=`) or the general link, edit link (`?rsvp=&edit=`), preview (`?preview=`) | `GET /api/public/invitations/:slug`, `/open`, `/rsvps`, `PATCH /rsvps/:id` |
| `/i/[slug]` (after replying) | RSVP confirmation: thank-you, add to calendar, change reply, reply for someone else | |
| `/admin/*` | **Studio console** (staff/admin, role-gated): pipeline board/list with metrics, event detail (stage tracker, details, brief editor, revisions, invitation publish/rollback, orders, emails), orders and checkout drafts, catalogue (styles, music, reviews), team (admin), email log, manual order | `/api/admin/*` |
| any other URL | 404 page | |

## Code layout

- `lib/api.ts`: typed `api<T>()` client (credentials, automatic `x-csrf` on mutations, `ApiError` with `code`/`fields`, friendly messages), `downloadPost` for exports. `lib/types.ts` holds the API types.
- `lib/session.tsx` and `lib/event-context.tsx`: auth guard, current event, and a single shared SSE connection.
- `components/ui/`: primitives (Button, Field, Dialog using native `<dialog>`, Toggle, Skeleton, Empty/Error states, toasts, icons).
- `components/marketing`, `components/auth`, `components/host`, `components/invite`: the screens.

## Accessibility and quality notes

- Semantic landmarks, a skip link, labelled fields with `aria-describedby` hints and errors, visible `:focus-visible` rings, and keyboard support everywhere. That includes seating: Tab to a table, arrows move it, Shift+arrows move it further, Enter edits; parties also have a "Seat at…" select.
- `prefers-reduced-motion` turns off the opening animation, motes and scroll reveals.
- Every data view has loading skeletons, empty states and retryable error states.
- Lint note: the React Compiler advisory rule `react-hooks/set-state-in-effect` is turned off in `eslint.config.mjs`. Copying fetched data into local editable form state is intentional here.

## Known gaps

- Security headers: static ones in `next.config.ts` (nosniff, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy, COOP, HSTS in production, no `X-Powered-By`). The CSP is set per request in `proxy.ts` with a script nonce + `'strict-dynamic'`: no `'unsafe-inline'` for scripts, `'unsafe-eval'` and `ws:` in dev only. The root layout reads `headers()`, so every page renders dynamically (needed for nonces). `style-src` keeps `'unsafe-inline'` for inline style attributes (palette CSS variables). `frame-src` allows Google Maps.
- Guest pages are translated (EN/FR) through `lib/invite-i18n.tsx`. Host and admin screens are English only.
- Old invitation links: `/i/<old-slug>` does a server-side permanent redirect (308) to the current slug, keeping the query string.
- The admin console doesn't embed the visual editor for studio invitations, can't post revision comments (no endpoint), and doesn't offer the admin slug override or Extra-language quantities in the manual order yet.
- Gifts are display-only (we never take money): message (optional), one payout method (Interac email, or institution + transit + account, or IBAN) and registry links (https). Only whitelisted keys are sent. `GIFT_PAYOUT_REQUIRED` shows on the payout section, `GIFT_REGISTRY_URL_REQUIRED` on the registry links.
- Draft-vs-live chips and the "Unpublished changes" banner only appear on a published self-serve invitation; the demo seed's self-serve event is an unpaid draft, so screenshots show the pre-publish state.
- Asset uploads (`POST /assets`) are a separate "Photos & files" card on the brief page. They are not linked to individual brief fields (`photoAssetIds`), and the upload path was not exercised against the API to avoid adding files to the seed data.
- The music toggle shows "not available" because the seeded tracks have `url: null`.
- The Maybe status chip exists, but the API's attendance enum is only `yes/no/pending`, so it never shows.
- The guest list shows delivery state only (Sent / Opened / Replied). Invitees don't carry the reply's attendance, so there's no Coming/Can't come chip per household.
