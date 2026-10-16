# digital-invite: API contract (for the front end)

This is the contract for **Frontend Builder**. The server code is in `app/api/`. The machine-readable OpenAPI spec is served at `GET /docs/json`, with a browsable UI at `GET /docs`. If this document and OpenAPI disagree about field-level schemas, OpenAPI is generated from the code and wins. This document explains the auth model, the flows and the shapes.

- **Base URL (dev):** `http://localhost:4000`. Every path below is absolute (`/api/...`).
- **Format:** JSON (`content-type: application/json`) unless noted otherwise.
  - Dates: `YYYY-MM-DD` strings.
  - Timestamps: ISO 8601 UTC.
  - Money: integer **cents**, with `currency` (always `"CAD"` for now).
- **i18n:** user-facing catalogue strings are maps such as `{"en": "Self-serve"}`. Invitation content is keyed by language. English is the default.
- **Front-end routes that the API's links point to.** Please implement these pages:
  - `${WEB_URL}/auth/<token>`: one-time link landing page. Covers set password, reset, magic login and co-host invite.
  - `${WEB_URL}/app/<eventId>`: host panel.
  - `${WEB_URL}/admin/events/<eventId>`: studio admin.
  - `${WEB_URL}/checkout/success?session_id=<id>`: success page. `${WEB_URL}/pricing?checkout=canceled[&draft=<id>]`: cancel page.
  - `${WEB_URL}/unsubscribe?token=<t>`: guest unsubscribe.
  - `${INVITE_BASE_URL}/<slug>` (dev: `http://localhost:3000/i/<slug>`): the guest invitation.
    - Query params: `?g=<personalToken>` (personal link), `?preview=<previewToken>` (draft preview), `?lang=fr`, `?rsvp=<guestId>&edit=<editToken>` (edit link from the confirmation email).

---

## 1. Auth model

| Concept | Details |
|---|---|
| Session | `POST /api/auth/login` (or consuming a one-time token) sets an **httpOnly** `sid` cookie (SameSite=Lax, Secure in prod, 30 days) |
| CSRF | The response JSON includes `csrfToken`, which is also set as a readable `csrf_token` cookie. **Every POST/PUT/PATCH/DELETE made with a session must send `x-csrf: <csrfToken>`**, or the API returns `403 CSRF_FAILED`. `GET /api/auth/me` returns the token again after a page reload |
| Fetch | Use `credentials: 'include'`. CORS allows only the exact origins in `CORS_ORIGINS` (dev: `http://localhost:3000`; no wildcards, validated at startup) with credentials; any other origin gets no `Access-Control-Allow-Origin`. Exposed response header: `content-disposition`. Or proxy `/api/*` through Next.js rewrites; behind a proxy, set `TRUST_PROXY=true` on the API |
| Passwords | **Users never receive passwords.** Accounts are created without one and get an emailed **one-time, expiring set-password link** (`/auth/<token>`). Rule: at least 10 characters, letters plus a number or symbol |
| Platform roles | `host` (couples and hosts), `staff` (studio designer), `admin` (studio admin) |
| Event roles | `owner`, `cohost` (full edit, cannot manage members), `viewer` (read-only). Admins can access every event; staff only events where `assignedStaffId` is them |
| Isolation | Another user's event returns **404** (never 403). A role problem returns **403** |
| Exempt from CSRF | `/api/public/*`, `/api/webhooks/*`, `/api/dev/mock-checkout/*` (protected by its own pay token instead), and the auth bootstrap endpoints (`login`, `register`, `magic-link`, `password/forgot`, `token/inspect`, `token/consume`, `unsubscribe`) |

### Rate limits (HTTP 429 `RATE_LIMITED`)

| Endpoints | Limit |
|---|---|
| Auth login, token, password | 10 per minute per IP |
| Register, magic link, forgot password | 5 per minute per IP |
| Public RSVP submit and edit | 10 per minute per IP+invitation |
| Public invitation GET | 120 per minute |
| Checkout session | 10 per minute |
| Account lockout | 10 failed logins → 15 minutes (`429 TOO_MANY_ATTEMPTS`) |

## 2. Errors

Every error uses the same shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Some fields are invalid.", "fields": { "info.email": "Invalid email" }, "details": {} } }
```

- `fields` appears only on validation errors. Keys are dot-paths into the request body. Query and param errors are prefixed with `querystring.` or `params.`.
- `details` appears only on some errors (examples: `ALREADY_RESPONDED` → `{guestId}`, `RSVP_CLOSED` → `{reason}`, `VERSION_CONFLICT` → `{currentVersion}`, `GONE` → `{archived:{title,eventDate}}`, `PAYMENT_REQUIRED` → `{plan,eventId}`, `ADDON_PAYMENT_REQUIRED` → `{addon,eventId,checkout,missing:[{code,qty}]}`, `FEATURE_DISABLED` → `{feature}`, `PLAN_NOT_PAID` → `{eventId}`).

| HTTP | code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST`, `INVALID_TOKEN`, `WEBHOOK_SIGNATURE_INVALID` | Bad input |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS` | Not signed in, or wrong credentials |
| 402 | `PAYMENT_REQUIRED` | Self-serve first publish before purchase |
| 402 | `ADDON_PAYMENT_REQUIRED` | A paid event uses (or tries to use) an add-on it hasn't bought: "Publish changes" with a custom song, a renamed link or languages over the cap; a slug change without `custom_link`; more languages after payment. `details.missing` lists `[{code, qty}]`; open the Add-ons checkout (`POST /api/checkout/addons`) with it `details.missing[].qty` is the number of units still short, not the total needed (same for the 422 `INVALID_SELECTION` `details.missing` of pay-to-publish and the add-ons checkout). |
| 400 | `RIGHTS_CONFIRMATION_REQUIRED` | An own-song upload or link without the "I have the rights to use this music" tick |
| 403 | `FORBIDDEN`, `CSRF_FAILED`, `RSVP_CLOSED` | Role, archived, CSRF, or replies closed |
| 403 | `FEATURE_DISABLED` | The feature is switched off by an env flag (`FEATURE_OWN_SONG=false`: every own-song path) |
| 404 | `NOT_FOUND` | Not found, or no access |
| 409 | `CONFLICT`, `VERSION_CONFLICT`, `ALREADY_RESPONDED`, `REVISION_NOT_ALLOWED`, `BRIEF_LOCKED`, `PLAN_NOT_PAID` | State conflict (`PLAN_NOT_PAID`: add-ons checkout before the plan is paid) |
| 410 | `GONE` | Archived invitation |
| 413 / 415 | `PAYLOAD_TOO_LARGE` / `UNSUPPORTED_MEDIA_TYPE` | Upload problems |
| 422 | `INVALID_SELECTION`, `BRIEF_INCOMPLETE`, `CHANNEL_NOT_AVAILABLE`, `GIFT_PAYOUT_REQUIRED`, `GIFT_REGISTRY_URL_REQUIRED` | Business rule. `GIFT_PAYOUT_REQUIRED`: a cash/both gift block without one complete payout method; `GIFT_REGISTRY_URL_REQUIRED`: a registry/both gift block without an https registry link |
| 429 | `RATE_LIMITED`, `TOO_MANY_ATTEMPTS` | Slow down |
| 500 | `INTERNAL_ERROR` | Show a generic message |

## 3. Pagination

List endpoints that accept `?cursor=&limit=` (default limit 50, max 200) return:

```json
{ "items": [ ... ], "nextCursor": "b64url-or-null" }
```

To get the next page, pass `nextCursor` back as `cursor`. Some lists add extras, such as `counts` on guests and invitees.

---

## 4. Health and docs

| Method | Path | Auth | Response |
|---|---|---|---|
| GET | `/health` (also `/api/health`) | none | `{"status":"ok","db":"ok","time":"…","version":"0.1.0","paymentDriver":"mock","emailDriver":"console","storageDriver":"local"}` |
| GET | `/docs`, `/docs/json` | none | Swagger UI / OpenAPI 3 |

### Security headers (every response)

| Header | Value |
|---|---|
| `Content-Security-Policy` | JSON API: `default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`. `/docs`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains`, **production only** (not sent in dev or tests) |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` (and `frame-ancestors 'none'` in the CSP): no API response can be framed |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Resource-Policy` | `cross-origin`, so the web app can embed signed asset and music URLs in `<img>`/`<audio>`; the signature controls access |
| `Cross-Origin-Opener-Policy` | `same-origin` |

There is no `X-Powered-By` or `Server` header.

## 5. Public catalogue (marketing site)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/public/catalogue` | Plans, extras, themes, block sections, languages, dietary tags |
| GET | `/api/public/themes?product=wedding_invite` | `{items: Theme[]}`, active and coming-soon themes. Each theme lists the products it fits in `products[]` (the single `product` field was removed); the filter matches `products` |
| GET | `/api/public/themes/:key` | One theme (includes `defaultConfig` and `demoSlug`) |
| GET | `/api/public/music` | Royalty-free library: `{items:[{id,title,artist,durationS,moodTags,url,license}]}`. `url` is absolute and playable in an `<audio>` element, or `null` if a track has no file |
| GET | `/api/public/music/files/:file` | Streams a library MP3 (`audio/mpeg`, `Accept-Ranges: bytes`, `206` for `Range`, cached for a day). `404` for an unknown file |
| GET | `/api/public/reviews?cursor=&limit=` | `{items:[{id, displayName, location, text, isSample, createdAt}], nextCursor, count, onlySamples}`. See "Testimonials" below |
| POST | `/api/public/contact` | `{name,email,topic?:"general"|"partner"|"order"|"press",message,consent:true,website?}` → 201. `website` is a honeypot; leave it empty |

`GET /api/public/catalogue` (abridged):

```json
{
  "currency": "CAD",
  "taxNote": "Prices exclude sales tax, which is calculated at checkout.",
  "plans": [
    { "code": "diy", "product": "wedding_invite", "serviceMode": "self_serve", "name": {"en":"Self-serve"}, "description": {"en":"…"},
      "features": [{"en":"All designs"}], "basePriceCents": 9900, "currency": "CAD", "includedBlocks": null, "extraBlockPriceCents": 0,
      "maxLanguages": 2, "revisionRounds": 0, "unlimitedRevisions": false, "deliveryDays": null, "includesAllExtras": false,
      "hasRsvp": true, "usesSections": false, "steps": ["theme","extras","languages","info","summary"] },
    { "code": "experience", "serviceMode": "studio", "basePriceCents": 24900, "includedBlocks": 5, "extraBlockPriceCents": 800, "…": "…" }
  ],
  "extras": [ { "code": "own_song", "name": {"en":"Your own song"}, "description": {"en":"…"}, "priceCents": 1500, "currency": "CAD", "available": true } ],
  "planExtras": { "diy": ["own_song","extra_language","custom_link"], "experience": ["own_song","custom_monogram","extra_language","photo_cover_film","rush_design","custom_link"] },
  "themes": [ { "key": "evening", "products": ["wedding_invite","save_the_date","birthday","bridesmaid"], "name": {"en":"Evening"}, "isPopular": true, "demoSlug": null, "status": "active", "defaultConfig": {"palette": {"background":"#12143A","accent":"#F4A93A","…":"…"}, "cover": {"type":"glow"}} } ],
  "sections": [ { "key": "our_story", "label": "Our story" } ],
  "languages": [ { "code": "en", "label": "English" } ],
  "dietaryTags": ["gluten_free","lactose_free","vegetarian","vegan","nut","fruit","other"],
  "extraBriefSections": { "own_song": "own_song", "custom_monogram": "custom_monogram", "photo_cover_film": "photo_cover_film", "custom_link": "custom_link" },
  "defaultRsvpSettings": { "deadline": null, "mealOptions": [], "maxCompanions": 4, "mode": "auto" }
}
```

`plans[].steps` lists the checkout wizard steps for that plan. `planExtras` lists which extras each plan can add. `maxLanguages`: diy 2, experience (Signature) 3, premium (Couture) 5, std/birthday/bridesmaid 1; each `extra_language` adds one. Couture's "all add-ons included" (`includesAllExtras`) covers every add-on **except `extra_language`**. `extras` in quote/session/add-ons bodies accepts codes or `{code, qty}` objects.

**Add-ons.** All prices are CAD **placeholders**. The set is defined in one file (`api/src/lib/addons.ts`), so read it from the catalogue rather than hard-coding it.

| code | name | price | plans | effect |
|---|---|---|---|---|
| `own_song` | Your own song | 1500 | diy, std, experience, premium, birthday, bridesmaid | adds brief section `own_song` → `config.music`. Self-serve: using a custom song (`config.music.assetId`/`externalUrl`) requires it. An upload or link needs a rights tick (§9). Behind the env flag `FEATURE_OWN_SONG` (default on): when off, the catalogue omits it and every own-song path returns `403 FEATURE_DISABLED` |
| `custom_monogram` | Custom monogram | 2500 | std, experience, premium, birthday, bridesmaid | adds brief section `custom_monogram` (`letters`, `glowColor`) → `config.cover.initials` / `glowColor` |
| `extra_language` | Extra language | 2000 per unit | **all plans incl. Couture** (never included: charged on Couture too) | +1 to the plan's `maxLanguages` **per unit**: send `{"code":"extra_language","qty":2}` (or repeat the code) → one quote line with `qty: 2`. A qty lower than the languages need → 422; **excess units are quietly trimmed** to what's needed (quote/order show the trimmed qty), in the plan checkout and the add-ons checkout. Paid units are never removed |
| `photo_cover_film` | Photo cover film | 4500 | std, experience, premium, birthday | adds brief section `photo_cover_film` (`photos`: up to 10 asset ids) |
| `custom_link` | Custom link name | 1900 | **all plans** (included in Couture) | the host chooses the invitation slug with `PATCH /api/events/:id/invitation/slug` (self-serve and studio co-hosts); studio briefs also get section `custom_link {slug, note}`. Unlimited changes; old slugs keep working |
| `rush_design` | Rush design | 6900 | std, experience, premium, birthday, bridesmaid | sets `event.express = true` (studio priority) |

Removed codes: `custom_music` (now `own_song`), `wax_seal`, `custom_color`, `illustration`, `animated_video`, `express` (now `rush_design`), `custom_domain` and `reminder_pack` (reminders are free on every plan). Checkout rejects them with `422 INVALID_SELECTION`.

**Themes.** There are six seeded designs: `evening`, `harbour`, `meadow`, `citrus`, `lilac` and `nocturne`. Each has `products: ["wedding_invite","save_the_date","birthday","bridesmaid"]`, so every design works for every product. Theme ids are UUIDs that differ per database, so always look themes up by `key`. The retired keys `coastal-linen`, `garden-watercolour`, `monochrome-editorial`, `minimal-type`, `warm-dusk`, `travel-postcard`, `std-reveal` and `birthday-letter` now return 404, and existing invitations were moved to a replacement design.

**Testimonials.** `/api/public/reviews` may return an empty list; hide the section when `items` is empty. The items seeded today are **sample copy** (`isSample: true`, and `onlySamples: true` when every item is a sample). Show a visible "Sample review" label on them, and never a star rating, "verified" badge or platform logo. Names are returned as written (no masking), and there is no `rating`, `verified` or `average` any more.

Plan codes: `diy` (self-serve), `std` (save the date), `experience` (studio "Signature"), `premium` (studio "Couture"), `birthday`, `bridesmaid`. **Prices are placeholders pending confirmation.**

## 6. Checkout (public, no login needed)

1. `PUT /api/checkout/drafts/:draftId`
   - Generate `draftId` (a UUID) on the client and call this at every wizard step. It records the abandoned cart. Returns 204.
   - Body: `{plan?, lastStep?, themeKey?, sections?, extras?, languages?, info?:{partner1?,partner2?,honoree?,eventDate?,venue?,email?,phone?,message?}, vision?, utm?, abandoned?}`. `info.letter` was removed and returns `400` (`fields["info.letter"]`).
2. `POST /api/checkout/quote` → server-side price preview `{plan, themeKey, sections, extras, languages, lines:[{kind, code, label, qty, unitPriceCents, totalCents}], subtotalCents, currency, taxNote}`. `POST /api/checkout/session` and `POST /api/checkout/addons` return `{url, orderId, orderNumber, sessionId, extras, lines, subtotalCents, currency}`: the lines actually charged after server-side add-back/trimming, same shape as the quote (tax is added by the payment provider). For pay-to-publish send `eventId` (owner/co-host): a missing `themeKey`, `languages` or `extras` then use the event's saved invitation theme, languages and `selectedExtras` (the checkout session does the same). An explicit `themeKey` wins and is validated; with no theme at all → 422 `INVALID_SELECTION` "Please choose a design" (`fields.themeKey`).
   ```json
   // request
   { "plan": "experience", "themeKey": "harbour", "sections": ["our_story","timeline","faq","dress_code","gift_list","accommodation","custom:Kids corner"], "extras": ["own_song"], "languages": ["en","fr"] }
   // response
   { "plan": "experience", "themeKey": "harbour", "sections": ["our_story", "…", "custom:kids-corner"], "extras": ["own_song"], "languages": ["en","fr"],
     "lines": [ {"kind":"plan","code":"experience","label":"Signature","qty":1,"unitPriceCents":24900,"totalCents":24900},
                {"kind":"extra_block","code":"extra_block","label":"Additional information block","qty":2,"unitPriceCents":800,"totalCents":1600},
                {"kind":"extra","code":"own_song","label":"Your own song","qty":1,"unitPriceCents":1500,"totalCents":1500} ],
     "subtotalCents": 28000, "currency": "CAD", "taxNote": "Sales tax is calculated at checkout based on your billing address." }
   ```
   - Custom blocks are written as `custom:<Name>`.
   - Errors: `422 INVALID_SELECTION` (unknown theme or extra, a retired add-on code, too many languages, theme for the wrong product), `400` for an unknown plan. Non-repeatable add-ons are counted once; `extra_language` once per unit.
3. `POST /api/checkout/session` (optional header `Idempotency-Key`; when sent together with `draftId`, a pending session from the last 10 minutes is reused).
   ```json
   // request (new studio or self-serve purchase)
   { "plan": "experience", "themeKey": "harbour", "sections": ["our_story","timeline","faq"], "extras": [], "languages": ["en"],
     "draftId": "uuid", "vision": "Relaxed lakeside, sage + sand",
     "info": { "partner1": "Robin", "partner2": "Sky", "eventDate": "2027-07-10", "venue": "Pier 21", "email": "robin@example.com", "phone": null },
     "consents": { "terms": true, "privacy": true }, "promoCode": null }
   // response
   { "url": "https://checkout.stripe.com/… (or http://localhost:4000/api/dev/mock-checkout/mock_cs_…)", "orderId": "uuid", "orderNumber": "ORD-2026-01001", "sessionId": "cs_test_… | mock_cs_…", "subtotalCents": 24900, "currency": "CAD" }
   ```
   - **Redirect the browser to `url`.**
   - Birthday and bridesmaid plans need `info.honoree` (or `partner1`). Every other plan needs `partner1` and `partner2`. All plans need `eventDate`.
   - **Paying for an existing self-serve event (pay to publish):** while logged in as the owner, send `{ "plan": "diy", "eventId": "<eventId>", "extras"?: [...], "info": {"email": "x@x.x"}, "consents": {...} }`. `extras` defaults to the event's `selectedExtras`; languages come from the event. Add-ons the invitation already uses are required: `own_song` for a custom song, `custom_link` for a renamed link, one `extra_language` per language over 2 (`422 INVALID_SELECTION` with `fields["extras.<code>"]` and `details.missing=[{code,qty}]` otherwise). The email is replaced with the account email. Errors: `409` if already paid, `422` for a plan other than `diy`. After payment `selectedExtras` is cleared and the add-ons count as purchased.
5. **Add-ons checkout** (a paid event, self-serve or studio; owner or co-host): `GET /api/events/:id/addons` → `{eventId, plan, paid, purchased:[{code,qty}], included:[code], available:[{code,name,priceCents,currency,maxQty?}], missing:[{code,qty}]}` feeds the dialog (`missing` = what the draft uses but isn't paid). `POST /api/checkout/addons/quote` `{eventId, extras}` → `{plan, extras, lines, subtotalCents, currency, taxNote}`, then `POST /api/checkout/addons` `{eventId, extras:[{code, qty?}], languages?, consents}` (header `Idempotency-Key` re-uses an identical pending session) → `{url, orderId, orderNumber, sessionId, subtotalCents, currency}`; redirect to `url` exactly like the plan checkout. `extra_language` units are trimmed to what's needed: (`languages` if sent — the list the host wants, e.g. after a 402 on PATCH languages — else the event's languages) − plan cap − units already paid; on payment that `languages` list is applied to the event. Errors: unpaid event → `409 PLAN_NOT_PAID`; too few `extra_language` units for those languages → `422 INVALID_SELECTION` with `fields["extras.extra_language"]` and `details.missing=[{code:'extra_language',qty}]` (same shape as pay-to-publish; no order, nothing saved); empty `extras` (also after trimming) → 400; not offered on the plan, retired, included in the plan (Couture) or `rush_design` after delivery → `422 INVALID_SELECTION`; a non-repeatable add-on already bought → `409 CONFLICT` (`extra_language` can be bought again); `own_song` with the flag off → `403 FEATURE_DISABLED`. Paying creates an order with `kind: "addons"` and `plan: null`: studio brief sections are added (to `newSections` if the brief is locked) and `rush_design` sets `express`. Refunding an add-on order revokes only those add-ons; the invitation stays live. `verify` returns `order.kind` and `order.extras`.
4. The success page calls `GET /api/checkout/session/:sessionId/verify`, which returns `{ valid, status: "pending_payment"|"paid"|"canceled"|"refunded"|"unknown", order: {id, number, plan, subtotalCents, taxCents, totalCents, currency, eventId|null} }`.
   - Poll for a few seconds while `status` is `pending_payment`. The webhook usually lands first.
   - Once paid, the buyer gets an email with a set-password link (or a login link if they already have a password). Tell them to check their inbox. **No password is shown or emailed.**

**What payment creates:**
- A studio plan creates an account if needed, plus an event (`serviceMode: studio`, stage `order_received`), a brief and a draft invitation.
- A `diy` purchase for an existing event sets `paid: true`, which unlocks publishing.
- New invitations get an automatic link made of the names plus 4 random characters, e.g. `maya-theo-7k2q`. Choosing a link needs the `custom_link` add-on.

**Mock driver (dev, default):** redirect the buyer to `url` exactly as you would with Stripe. It opens an API-hosted test page with "Pay (test)" and "Cancel" buttons; nothing is charged. Pay answers with a 303 to `${WEB_URL}/checkout/success?session_id=…`, Cancel with a 303 to `${WEB_URL}/pricing?checkout=canceled`. The page's forms carry a per-session **pay token**; `POST …/complete` and `…/cancel` without that exact token return `403 FORBIDDEN`, so a session id alone (from a success URL or a log) cannot settle an order, and the page can only settle its own session. Do not call these endpoints from the web app; let the buyer use the page.

## 7. Auth endpoints

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/login` | `{email,password}` | 200 Me (+ cookies) · 401 `INVALID_CREDENTIALS` · 429 `TOO_MANY_ATTEMPTS` |
| POST | `/api/auth/logout` | – | 204 (cookies cleared) |
| GET | `/api/auth/me` | – | 200 Me · 401 |
| PATCH | `/api/auth/me` | `{name?, locale?}` | 200 Me |
| POST | `/api/auth/password/change` | `{currentPassword,newPassword}` | 204 (other sessions revoked) |
| POST | `/api/auth/register` | `{email,name?,locale?}` | **202 always**; emails a set-password link (or a login link if the account already has a password) |
| POST | `/api/auth/magic-link` | `{email}` | 204 always; emails a login link if the account exists |
| POST | `/api/auth/password/forgot` | `{email}` | 204 always; emails a reset link |
| POST | `/api/auth/token/inspect` | `{token}` | `{valid:false}` or `{valid:true,purpose:"set_password"|"reset_password"|"login"|"cohost_invite",email,requiresPassword,expiresAt,event:{id,title}|null}` |
| POST | `/api/auth/token/consume` | `{token,password?,name?}` | 200 Me + `{purpose, joinedEventId}` and signs in · 400 `INVALID_TOKEN` (used, expired or invalid) · 400 `VALIDATION_ERROR` `fields.password` if a password is required |
| GET | `/api/auth/unsubscribe?token=` | – | `{status:"ready"|"already"|"invalid"}` |
| POST | `/api/auth/unsubscribe` | `{token}` | `{status:"done"|"already"|"invalid"}` |

**Me:**

```json
{ "user": { "id": "uuid", "email": "host@example.com", "name": "Maya Lindqvist", "role": "host", "locale": "en", "hasPassword": true, "createdAt": "…", "lastLoginAt": "…", "disabled": false },
  "role": "host",
  "memberships": [ { "eventId": "uuid", "role": "owner", "title": "Maya & Theo", "serviceMode": "studio" } ],
  "csrfToken": "TJ_f44Mmp7…" }
```

**`/auth/<token>` page flow:**
1. Call `inspect`.
2. If `requiresPassword`, show the "choose password" form. Otherwise auto-consume.
3. Call `consume`.
4. Redirect to `/app/<joinedEventId or first membership>`. Admin and staff go to `/admin`.

## 8. Host: events

Every route below needs a session. The `:id` path param is the event UUID. The **Auth** column gives the minimum event role.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/events` | any user | `{items: Event[]}` for my memberships |
| POST | `/api/events` | any user | Create a **self-serve** draft: `{product?:"wedding_invite"|"save_the_date"|"birthday", hostNames:{partner1?,partner2?,honoree?}, eventDate?, timezone?, venueName?, venueAddress?, languages?:["en"], extras?:[], themeKey?, sections?:["our_story","timeline","faq"]}` → 201 Event. `extras` = add-ons picked in the Extras step (diy add-ons only), stored as `selectedExtras`. Languages over the diy cap (2) are **not rejected**: `selectedExtras` holds exactly the `extra_language` units the languages need (added or removed automatically; excess units sent in `extras` are trimmed), charged at pay-to-publish. `422 INVALID_SELECTION` only for an unsupported language code or more than 8 languages |
| GET | `/api/events/:id` | viewer | Event + `myRole`, `daysToEvent`, `brief{status,locked,newSections,completion{done,total,missing}}`, `revisions{max,used,open}` (studio only) |
| PATCH | `/api/events/:id` | cohost | `{hostNames?, eventDate?, timezone?, venueName?, venueAddress?, languages?, selectedExtras?, notifyOnRsvp?, remindersEnabled?, reminderDaysBefore?}`. The title is derived from the names. Applies immediately (event details and RSVP settings are never drafted). `selectedExtras` only on an unpaid self-serve event (409 after paying). Languages: before payment, `selectedExtras` is kept at exactly the `extra_language` units the languages need (added when they grow, removed when they shrink); after payment, over the cap → `402 ADDON_PAYMENT_REQUIRED` `details.missing=[{code:'extra_language',qty:n}]`. Unsupported code or more than 8 → `422 INVALID_SELECTION` |
| GET | `/api/events/:id/stats` | viewer | Live stats (below) |
| PATCH | `/api/events/:id/invites-sent` | cohost | `{total}`: manual "invites sent" count, used when there are no invitees |
| GET | `/api/events/:id/activity?cursor&limit` | viewer | Paginated `{id,action,actorType,data,createdAt}` |
| GET | `/api/events/:id/stream` | viewer | **SSE** (below) |
| GET | `/api/events/:id/rsvp-settings` | viewer | RsvpSettings |
| PATCH | `/api/events/:id/rsvp-settings` | cohost | RsvpSettings (partial OK) |
| GET | `/api/events/:id/members` | viewer | `{items:[{userId,role,user{id,email,name},createdAt}], pendingInvites:[{email,role,expiresAt}]}` |
| POST | `/api/events/:id/members` | **owner** | `{email, role?:"cohost"|"viewer"}` → 202. Emails a co-host invite link |
| PATCH | `/api/events/:id/members/:userId` | owner | `{role}` |
| DELETE | `/api/events/:id/members/:userId` | owner | 204 |
| GET | `/api/events/:id/qr?format=png|svg&size=1024&inviteeId=&download=1` | viewer | QR image of the share link, or of a personal link when `inviteeId` is set |
| GET | `/api/events/:id/share-kit` | viewer | `{url, published, texts{<lang>}, textLanguage, untranslatedLanguages[], supportedTextLanguages[], whatsapp, sms, email{subject,body,mailto}, qr{png,svg}}`. See "Share texts" below |
| GET | `/api/events/:id/export-all` | owner | Full JSON data export (download) |
| POST | `/api/events/:id/delete-request` | owner | 202. Notifies the studio |

**Share texts.** Ready-to-paste messages exist only for **`en` and `fr`** (`supportedTextLanguages`). The French copy is hand-written: gender-neutral, with verb agreement for couples and single hosts, and French dates such as « samedi 19 juin 2027 » and « 1er mai 2027 ».
- `texts` contains only the event languages that have a template, so English is never returned under another language's key. Event languages without one are listed in `untranslatedLanguages`. Let the host write those texts themselves.
- `whatsapp`, `sms` and `email` use the primary language's template, or English if it has none. `textLanguage` says which one was used.
- Locale codes are matched on their base language, so `fr-CA` uses `fr`.

**Event:**

```json
{ "id": "uuid", "product": "wedding_invite", "planCode": "experience", "serviceMode": "studio", "title": "Maya & Theo",
  "hostNames": {"partner1":"Maya","partner2":"Theo"}, "eventDate": "2027-06-19", "timezone": "America/Toronto",
  "venueName": "Willowmere Estate", "venueAddress": "400 Lakeshore Rd, …", "primaryLanguage": "en", "languages": ["en","fr"],
  "productionStage": "review", "express": false, "maxRevisionRounds": 2, "designApprovedAt": null, "highSeasonNotice": false,
  "invitesSentManual": 0, "remindersEnabled": true, "reminderDaysBefore": 14, "notifyOnRsvp": true,
  "paid": true, "paidAt": "…", "deliveredAt": null, "archiveAfter": "2027-08-19", "createdAt": "…",
  "invitation": { "id": "uuid", "slug": "maya-and-theo", "url": "http://localhost:3000/i/maya-and-theo", "status": "published", "kind": "wedding_invite", "publishedAt": "…", "version": 1, "publishedVersion": 1 },
  "selectedExtras": [], "purchasedExtras": ["own_song"], "maxLanguages": 3,
  "myRole": "owner", "daysToEvent": 246,
  "brief": { "status": "submitted", "locked": true, "newSections": [], "completion": { "done": 11, "total": 11, "missing": [] } },
  "revisions": { "max": 2, "used": 1, "open": false } }
```

- `productionStage` values: `order_received → brief_received → in_queue → designing → review → delivered`.
- Self-serve events have `serviceMode: "self_serve"`, ignore `productionStage`, and use `paid` to gate publishing.
- Writes are rejected (403) once the date passes `archiveAfter`, which is 2 months after the event.

**Stats:**

```json
{ "invitesSent": 8, "invitesSentSource": "invitees", "invited": 8, "replied": 4, "waiting": 4, "awaiting": 4, "generalLinkReplies": 3,
  "responses": 7, "confirmed": 5, "declined": 2, "pending": 1, "totalAttendees": 11, "responseRate": 0.5, "confirmedRate": 0.714,
  "averageParty": 2.2, "responsesExceedInvites": false }
```

- `invited` = guest-list entries; `replied` = invited guests with a yes/no RSVP; `waiting` = invited with no response (`invited − replied`; `awaiting` is the same value, kept for existing clients). `responseRate = replied / invited` (null without a guest list). `generalLinkReplies` = general-link RSVPs (no guest-list entry), reported separately and never in the rate. `responses`, `confirmed`, `declined` and headcounts include every RSVP. The "not responded" campaign segment uses the same `waiting` definition.

**RsvpSettings:**

```json
{ "deadline": "2027-05-01", "requireEmail": true, "mealOptions": ["beef","salmon","vegetarian"], "maxCompanions": 3, "allowChildren": true,
  "allergyChecklist": true, "extraEvents": ["welcome_drinks","farewell_brunch"],
  "customQuestions": [ {"id":"song","label":"Which song gets you on the dance floor?","type":"text","required":false}, {"id":"shuttle","label":"Will you take the shuttle?","type":"yes_no","required":true} ],
  "mode": "auto" }
```

In `customQuestions`, `id` is `[a-z0-9_]{1,40}`, `type` is `"text"` or `"yes_no"`, and `required` is optional (default false). When `required` is true, a public RSVP with `attendance:"yes"` must answer the question; otherwise the API returns `400` with `fields["answers.<id>"]`.

`mode` controls when replies are accepted:
- `auto`: open until the end of the `deadline` day.
- `open`: always open.
- `closed`: closed.

`mealOptions: []` means meals aren't asked.

**SSE.** Open the stream with `new EventSource('/api/events/<id>/stream', { withCredentials: true })`.
- On connect the server sends `ready`.
- Then any of these events: `guest.created`, `guest.updated`, `guest.deleted`, `stats.updated`, `stage.changed`, `brief.updated`, `revision.updated`, `invitation.updated`.
- Each `data` is JSON `{type, eventId, data, at}`. For guest events, the inner `data` is `{guest: Guest}`. For `stats.updated`, it is a Stats object.
- A ping is sent every 25 seconds. The client reconnects automatically after 5 seconds.

## 9. Host: invitation (theme engine)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/events/:id/invitation` | viewer | Invitation (**draft copy**) + `editable` (true for self-serve) + `canPublish` |
| PUT | `/api/events/:id/invitation` | cohost, **self-serve only** | `{themeKey?, locale?, content?, config?, musicRightsConfirmed?}`. `themeKey`, `content` and `config` write the **draft only**; the live page doesn't change. `locale` applies immediately. Sending `slug` → `400 VALIDATION_ERROR` with `fields.slug` = "The link is changed with PATCH /api/events/:id/invitation/slug." (same for the admin `PUT /api/admin/invitations/:id`). On a studio event, hosts get 403 |
| GET | `/api/events/:id/invitation` (also `GET /api/admin/invitations/:invitationId`) | read | Invitation (draft + live state). Owners, co-hosts and studio also get `previousSlugs: [{oldSlug, createdAt}]` (newest first, from `invitation_slug_redirects`) and `customLinkLocked` (true once the slug was renamed or `custom_link` is on a paid order), so the editor can lock Custom link after a reload. Viewers don't get these two fields |
| PATCH | `/api/events/:id/invitation/slug` | cohost (self-serve **and** studio), studio staff/admin | **Primary route for the custom link name.** `{slug}` → 200 `{slug, url, previousSlugs[]}`. Applies **immediately** (not drafted). Hosts need `custom_link` (bought, or included in Couture); before a self-serve payment, picking a link adds `custom_link` to `selectedExtras` (charged at checkout); otherwise `402 ADDON_PAYMENT_REQUIRED` with `details.missing=[{code:'custom_link',qty:1}]`. The slug is **normalised first** (lowercased, runs of hyphens collapsed to one, leading/trailing hyphens stripped; the response returns the normalised slug), then checked: format `^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$` (3–60) → 400; reserved word or `demo-*` → `400 VALIDATION_ERROR` `fields.slug='reserved'`; taken or another invitation's old slug → `409 CONFLICT`. The old slug goes to `invitation_slug_redirects`; going back to one of your own previous slugs is allowed. Viewers 403; CSRF required |
| POST | `/api/events/:id/invitation/publish` | cohost | Publish / **Publish changes**: snapshots the draft as version n+1 and sets `publishedVersion = n+1`. Only the first publish needs payment (**402 `PAYMENT_REQUIRED`**). Self-serve: if the draft uses an unpaid add-on (custom song → `own_song`, renamed link → `custom_link`, languages over the cap → `extra_language` × n) → **402 `ADDON_PAYMENT_REQUIRED`** `details.missing[{code, qty}]` → open the Add-ons checkout |
| POST | `/api/events/:id/invitation/discard-draft` | cohost | Resets the draft to the live snapshot. 409 if nothing was published yet |
| POST | `/api/events/:id/invitation/unpublish` | cohost | Back to draft |
| POST | `/api/events/:id/invitation/preview-token` | cohost | Rotates the preview link |
| GET | `/api/events/:id/invitation/versions` | viewer | Published snapshots |
| POST | `/api/events/:id/invitation/rollback` | cohost | `{version}` copies that snapshot into the **draft**; it goes live only via publish |

**Invitation:**

```json
{ "id": "uuid", "eventId": "uuid", "kind": "wedding_invite", "slug": "maya-and-theo", "url": "http://localhost:3000/i/maya-and-theo",
  "previewUrl": "http://localhost:3000/i/maya-and-theo?preview=…", "status": "draft|published|archived", "locale": "en",
  "theme": { "id": "uuid", "key": "harbour", "name": {"en":"Harbour"} },
  "content": { "en": { "hero": {…}, "sections": {…}, "footer": {…} }, "fr": {…} },
  "config": { "palette": {…}, "fonts": {…}, "cover": {…}, "opening": {…}, "music": {…}, "sectionOrder": [...], "hiddenSections": [] },
  "version": 2, "publishedVersion": 2, "hasUnpublishedChanges": true, "draftChangedAt": "…", "publishedAt": "…", "archivedAt": null, "updatedAt": "…", "editable": false, "canPublish": false }
```

`config.cover.type` is `glow` (the lantern opening; default), `photo` or `none`. `illustration` and `video` were removed (existing rows were migrated to `glow`). `config.palette` and `config.cover` reject unknown keys (e.g. `envelopeColor`, `sealColor`). `palette.onPrimary` is button text on `primary`, and `palette.glow` is the highlight colour (`--inv-glow`).

`config.music` is `{trackId, assetId, externalUrl, volume, autoplayOnOpen}`. A library `trackId` needs nothing else. A couple's own song (`assetId` of a `kind=music` upload, or an `https://` `externalUrl`) needs a rights confirmation for that file or link: uploads record one, `POST /api/events/:id/music-rights` records one, or send `musicRightsConfirmed: true` in the same PUT. Otherwise `400 RIGHTS_CONFIRMATION_REQUIRED`.

**Draft vs live.** `content`/`config`/`theme` are always the draft. Guests see the snapshot `publishedVersion` (`?preview=<token>` shows the draft). `hasUnpublishedChanges` = `publishedVersion` is null or `draftChangedAt > publishedAt`; show "Publish changes" / "Discard" when true. Unpublish keeps `publishedVersion` for history; the page 404s until published again. Admin `PUT /api/admin/invitations/:id` follows the same rule.

**`content[lang]`** has three parts: `hero`, `sections` (an object keyed by section key) and `footer`. Content is capped at 300 KB. Unknown section keys are rejected.

The schema blocks below are **generated from the zod schemas** by `npm run contract` (in `app/api`). They are exact: `?` marks an optional field, `≤N` is a maximum length, and every string is trimmed.

<!-- GENERATED:settings:start -->
**RsvpSettings** (all fields optional on PATCH): `{ deadline?: "YYYY-MM-DD" \| null; requireEmail?: boolean; mealOptions?: string(min 1, ≤40)[] (≤10); maxCompanions?: int(0…19); allowChildren?: boolean; allergyChecklist?: boolean; extraEvents?: string(/^[a-z0-9_]{1,40}$/)[] (≤10); customQuestions?: ({ id: string(/^[a-z0-9_]{1,40}$/); label: string(min 1, ≤200); type: "text" \| "yes_no"; required?: boolean })[] (≤10); mode?: "auto" \| "open" \| "closed" }`

**Invitation `config`** (strict — unknown keys rejected): `{ palette?: { background?: "#RRGGBB"; surface?: "#RRGGBB"; primary?: "#RRGGBB"; onPrimary?: "#RRGGBB"; accent?: "#RRGGBB"; glow?: "#RRGGBB"; text?: "#RRGGBB"; muted?: "#RRGGBB" }; fonts?: { display?: string(≤60); body?: string(≤60); script?: string(≤60) }; cover?: { type?: "glow" \| "photo" \| "none"; initials?: string(≤6); glowColor?: "#RRGGBB"; posterAssetId?: uuid \| null; mediaAssetId?: uuid \| null }; opening?: { animation?: string(/^[a-z0-9_-]{1,40}$/); durationMs?: int(0…10000) }; music?: { trackId?: uuid \| null; assetId?: uuid \| null; externalUrl?: string(/^https:\/\//, ≤500) \| null; volume?: number(0…1); autoplayOnOpen?: boolean }; sectionOrder?: string(≤80)[] (≤40); hiddenSections?: string(≤80)[] (≤40) }`

**Public RSVP body** (`POST /api/public/invitations/:slug/rsvps`): `{ fullName: string(min 1, ≤100); email?: email(≤255) \| null \| ""; primaryMeal?: string(≤40) \| null; primaryDietary?: string(≤300) \| null; dietaryTags?: ("gluten_free" \| "lactose_free" \| "vegetarian" \| "vegan" \| "nut" \| "fruit" \| "other")[] (≤7); companions?: ({ type?: "adult" \| "child"; fullName: string(min 1, ≤100); meal?: string(≤40) \| null; dietary?: string(≤300) \| null })[] (≤19); extraEvents?: Record<string, "yes" \| "no">; answers?: Record<string, string(≤1000) \| boolean>; message?: string(≤1000) \| null; language?: string(≤20) \| null; g?: string(≤100); attendance: "yes" \| "no"; website?: string(≤200); captchaToken?: string(≤4000) }`
<!-- GENERATED:settings:end -->

<!-- GENERATED:sections:start -->
| key | invitation `content[lang].sections[key]` shape |
|---|---|
| `invitation_text` | `{ heading?: string(≤200); body?: string(≤5000) }` |
| `venue` | `{ heading?: string(≤200); items?: { label?: string(≤80); name: string(≤200); address?: string(≤400); startsAt?: string(≤40); endsAt?: string(≤40); mapQuery?: string(≤400); lat?: number(-90…90); lng?: number(-180…180); note?: string(≤1000) }[] (≤10) }` |
| `rsvp` | `{ heading?: string(≤200); intro?: string(≤1000); thankYouYes?: string(≤1000); thankYouNo?: string(≤1000) }` |
| `our_story` | `{ text?: string(≤5000); milestones?: { year: string(≤10); title: string(≤120); text: string(≤1000); photo?: uuid }[] (≤20); heading?: string(≤200) }` |
| `timeline` | `{ rows?: { time: string(≤10); title: string(≤120); description?: string(≤500) }[] (≤50); heading?: string(≤200) }` |
| `pre_wedding` | `{ date?: string(≤20); location?: string(≤300); details?: string(≤2000); heading?: string(≤200) }` |
| `menu` | `{ main?: string(≤500); courses?: string(≤2000); heading?: string(≤200) }` |
| `dress_code` | `{ text?: string(≤2000); palette?: "#RRGGBB"[] (≤8); heading?: string(≤200) }` |
| `accommodation` | `{ rows?: { name: string(≤120); address: string(≤300); url?: string(≤500); note?: string(≤300) }[] (≤50); heading?: string(≤200) }` |
| `transport` | `{ rows?: { type: string(≤60); time: string(≤10); from?: string(≤200); to?: string(≤200); note?: string(≤300) }[] (≤50); heading?: string(≤200) }` |
| `activities` | `{ rows?: { name: string(≤120); date: string(≤40); details?: string(≤1000) }[] (≤50); heading?: string(≤200) }` |
| `gift_list` | `{ mode?: "cash" \| "registry" \| "both"; note?: string(≤1000); registryUrl?: string(≤500) \| ""; registries?: { name?: string(≤120); url: string(≤500) }[] (≤10); interacEmail?: email(≤255); bank?: { holder?: string(≤120); bank?: string(≤120); institutionNumber?: string(/^\d{3}$/); transitNumber?: string(/^\d{5}$/); accountNumber?: string(/^\d{7,12}$/); iban?: string(≤50); bic?: string(/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/); reference?: string(≤120) }; heading?: string(≤200) }` |
| `photos` | `{ intro?: string(≤500); rows?: { assetId: uuid; name?: string(≤200) }[] (≤30); heading?: string(≤200) }` |
| `countdown` | `{ startAt?: string(≤30); heading?: string(≤200) }` |
| `faq` | `{ rows?: { question: string(≤300); answer: string(≤2000) }[] (≤50); heading?: string(≤200) }` |
| `custom:<slug>` | `{ content?: string(≤5000); title?: string(≤120) }` |

`hero`: `{ tagline?: string(≤200); title?: string(≤200); subtitle?: string(≤300); dateText?: string(≤120); backgroundAssetId?: uuid \| null }` · `footer`: `{ signature?: string(≤200) }`

**Brief data** (`PATCH /api/events/:id/brief` → `data[key]`) uses the same shapes without `heading`, plus the extra-only sections:

| brief key | shape |
|---|---|
| `own_song` | `{ description?: string(≤500); url?: string(≤500) \| ""; assetId?: uuid \| null; libraryTrackId?: uuid \| null; rightsConfirmed?: boolean }` |
| `custom_monogram` | `{ letters?: string(≤6); glowColor?: "#RRGGBB"; note?: string(≤500) }` |
| `photo_cover_film` | `{ description?: string(≤2000); photos?: uuid[] (≤10) }` |
| `custom_link` | `{ slug?: string(≤200) \| ""; note?: string(≤300) }` |
| `custom:<slug>` | `{ content?: string(≤5000) }` |
| `rsvp` | RsvpSettings (below) |
<!-- GENERATED:sections:end -->

Notes:
- **Gifts are display-only.** Lanternly never collects, processes or holds money; the block only shows the couple's own instructions. `gift_list` is `{mode: "cash"|"registry"|"both", note, registries:[{name?, url}], registryUrl?, interacEmail?, bank?, heading?}` and **rejects unknown keys** (e.g. `amount`, `paymentLink`, `currency`, card fields → 400).
  - `note` is the couple's message (≤1000), **optional** in every mode.
  - `registries` (≤10, each `{name?, url}` with an `https://` URL; `registryUrl` is a single-link alternative). **`registry` and `both` need at least one link** → `422 GIFT_REGISTRY_URL_REQUIRED` `fields["content.<lang>.sections.gift_list.registries"]`.
  - **`cash` and `both` need one complete payout method** the guest uses on their own: `interacEmail`, **or** `bank.institutionNumber` + `transitNumber` + `accountNumber`, **or** `bank.iban` → otherwise `422 GIFT_PAYOUT_REQUIRED` (`fields["content.<lang>.sections.gift_list.interacEmail"]` and `…gift_list.bank`). Checks run in order: payout (422), then registry (422).
  - Money instruction fields: `interacEmail` (Interac e-Transfer) and `bank` {`holder`, `bank`, `institutionNumber` (3 digits), `transitNumber` (5), `accountNumber` (7–12), optional `iban` (≤34 without spaces) and `bic` (8 or 11), `reference`}; unknown `bank` keys are rejected.
  - The public page returns only these display fields (`registries` merges `registryUrl` in as `{url}`). The brief uses the same shape; mode rules apply when the invitation is saved and in brief completion, not on brief autosave.
- Custom blocks (`custom:<slug>`) use `content` for the body text, plus an optional `title` in the invitation. There are no `text` or `photoAssetIds` fields.
- `our_story.milestones[].photo` is an asset id (uuid) from `/api/events/:id/assets`. Resolve it through the public `assets` map.
- `photos.rows[].assetId` and `photo_cover_film.photos[]` are asset ids too.
- `countdown.startAt` is free text up to 30 characters. Use local `YYYY-MM-DDTHH:mm`.

Music comes from `config.music` and resolves to a track from `/api/public/music` (`trackId`) or an uploaded audio asset (`assetId`). The public invitation's `music.url` is absolute either way (the library file URL, or a signed asset URL).

The 8 seeded library tracks are **placeholders**: original 8-second synthesized chords (`durationS: 8`), served from `/api/public/music/files/<name>.mp3`. They will be replaced with licensed tracks before launch, so don't hard-code file names or durations. In the admin API, `url` is stored as given: library files are kept API-relative (`/api/public/music/files/…`) and made absolute in public responses.

## 10. Host: guests (RSVP responses)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/events/:id/guests?status=all|yes|no|pending&q=&trash=false&cursor&limit` | viewer | `{items: Guest[], nextCursor, counts:{all,yes,no,pending,trash}}` |
| POST | `/api/events/:id/guests` | cohost | Manual add (for example, a phone RSVP): `{fullName, email?, phone?, attendance?:"yes"|"no"|"pending", primaryMeal?, primaryDietary?, dietaryTags?, companions?:[{type?,fullName,meal?,dietary?}], extraEvents?, answers?, message?, notes?, inviteeId?}` → 201 Guest (`source:"manual"`) |
| GET | `/api/events/:id/guests/:guestId` | viewer | Guest |
| PATCH | `/api/events/:id/guests/:guestId` | cohost | Partial of the same body. Setting attendance to `no` unseats the guest |
| DELETE | `/api/events/:id/guests/:guestId[?permanent=true]` | cohost | Moves to trash, or permanently deletes an already-trashed guest. Returns 204 |
| POST | `/api/events/:id/guests/:guestId/restore` | cohost | Guest |
| POST | `/api/events/:id/guests/export` | viewer | `{format?:"xlsx"|"csv", status?:"all"|"yes"|"no"|"pending", includeHeader?:true, columns?:[…]}` → **file download** (see below) |

**Guest:**

```json
{ "id": "uuid", "fullName": "Eleanor Vance", "email": "eleanor@example.com", "phone": null, "attendance": "yes", "partySize": 3,
  "primaryMeal": "salmon", "primaryDietary": null, "dietaryTags": ["gluten_free"],
  "companions": [ {"id":"uuid","type":"adult","fullName":"Marcus Vance","meal":"beef","dietary":null}, {"id":"uuid","type":"child","fullName":"Ivy Vance","meal":"vegetarian","dietary":"Lactose intolerant"} ],
  "extraEvents": {"welcome_drinks":"yes"}, "answers": {"song":"September","shuttle":true}, "message": "So happy for you!", "notes": null,
  "source": "rsvp_form|manual", "language": "en", "submittedAt": "…", "updatedAt": "…", "deletedAt": null,
  "invitee": { "id": "uuid", "firstName": "Eleanor", "lastName": "Vance", "householdName": "The Vance family" } }
```

**Export:**
- The xlsx file has two sheets: **Guests** (one row per main guest) and **Companions**.
- CSV contains the main guests only.
- Response headers: `content-type` is spreadsheetml or `text/csv`; `content-disposition: attachment; filename="guests-<title>-<date>.xlsx"`.
- Columns: `fullName, email, phone, attendance, partySize, primaryMeal, primaryDietary, dietaryTags, companionsCount, extraEvents, answers, message, notes, source, submittedAt`.
- Default columns: `fullName, email, attendance, partySize, primaryMeal, primaryDietary, companionsCount, message, submittedAt`.
- Values starting with `= + - @` are prefixed with `'` to prevent formula injection.
- Use `fetch` and save the response as a blob. The request is a POST, so include `x-csrf`.

## 11. Host: invitees (households and personal links)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/events/:id/invitees?status=&q=&cursor&limit` | viewer | `{items: Invitee[], nextCursor, counts:{<status>:n}}` |
| POST | `/api/events/:id/invitees` | cohost | `{firstName, lastName?, householdName?, email?, phone?, language?, maxPartySize?:1, knownCompanions?:[{fullName,type?}], groupLabel?, notes?}` → 201 Invitee. Phone numbers are normalised to E.164, with +1 as the default country code |
| POST | `/api/events/:id/invitees/import?commit=false|true` | cohost | Upload **multipart** (`file`: .csv or .xlsx), **raw CSV** (`content-type: text/csv`) or JSON `{rows:[{…}]}`. With `commit=false` you get a preview: `{rows, errors:[{row,message,fields?}], valid, invalid}`. With `commit=true` the response is 201 `{created, errors}`. Recognised headers include: first name, last name, household, email, phone, language, party size, group, notes |
| PATCH | `/api/events/:id/invitees/:inviteeId` | cohost | Partial |
| DELETE | `/api/events/:id/invitees/:inviteeId` | cohost | 204. The old link stops working |
| GET | `/api/events/:id/invitees/:inviteeId/link` | viewer | `{url, text, language, whatsappUrl, smsUrl, mailto, qrPng}`. `text` and the mailto subject use the invitee's `language`, then the event's primary language, then English (only `en` and `fr` have templates); `language` says which one was used. WhatsApp and SMS links are prefilled with the invitee's phone number when there is one |
| POST | `/api/events/:id/invitees/:inviteeId/rotate-token` | cohost | Issues a new token; the old link stops working. Returns Invitee |
| POST | `/api/events/:id/invitees/:inviteeId/mark-sent` | cohost | `{channel?:"whatsapp"|"sms"|"email"|"link"|"qr"}`, recorded after manual sharing |

**Invitee:**

```json
{ "id": "uuid", "householdName": "The Vance family", "firstName": "Eleanor", "lastName": "Vance", "email": "eleanor@example.com", "phone": "+14165550142",
  "language": null, "maxPartySize": 4, "knownCompanions": [{"fullName":"Marcus Vance","type":"adult"}], "groupLabel": "family",
  "status": "not_sent|sent|opened|responded|bounced|opted_out", "sentAt": "…", "lastOpenedAt": "…", "openCount": 2, "respondedAt": "…",
  "optedOut": false, "notes": null, "createdAt": "…", "personalUrl": "http://localhost:3000/i/maya-and-theo?g=5k84aCyyuFB5ME2jHLYPOQ" }
```

Personal tokens are 128-bit random and URL-safe. Each household's `maxPartySize` caps its party (the main guest plus companions).

## 12. Host: campaigns (bulk send / reminders; email only for now)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/events/:id/campaigns/preview` | cohost | `{channel?:"email", segment?}` → `{count, sample:[{id,firstName,lastName,email}]}` |
| POST | `/api/events/:id/campaigns` | cohost | `{kind:"invite"|"reminder"|"update"|"thank_you", channel?:"email", segment?, subject?:{en:"…"}, body?:{en:"…"}, scheduledAt?}` → 201 Campaign |
| GET | `/api/events/:id/campaigns` | viewer | `{items: Campaign[]}` |
| GET | `/api/events/:id/campaigns/:campaignId` | viewer | Campaign + `results:{total, byStatus}` + `recipients:[{messageId,inviteeId,name,to,status,error,sentAt}]` |
| POST | `/api/events/:id/campaigns/:campaignId/cancel` | cohost | Only possible while `scheduled` |

`segment` options: `{statuses?:["not_sent","sent","opened","responded","bounced"], notResponded?:true, attending?:true, inviteeIds?:[uuid], groupLabel?:"family"}`. Only invitees with an email address who haven't opted out are included.

Errors:
- `409` if the invitation isn't published.
- `422` if no recipients match.
- `422 CHANNEL_NOT_AVAILABLE` for `whatsapp` or `sms` (stubs only for now; use the `wa.me` links from `share-kit` or `/link` instead).

Delivery:
- Campaigns are dispatched by the background worker, respecting quiet hours (09:00–21:00 in the event's time zone).
- In dev, emails go to the console driver and are **never sent**. They are printed to the API log, and admins can list them at `GET /api/dev/outbox`.
- Campaign status: `scheduled → running → done | canceled`.
- Automatic RSVP-deadline reminders (`automatic: true`) are created by the daily job when `remindersEnabled` is set.

## 13. Host: seating (2D planner)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/events/:id/seating` | viewer | Full state (below) |
| PUT | `/api/events/:id/seating` | cohost | **Full replace** `{version, layout, tables, assignments}`. Fails with **409 `VERSION_CONFLICT`** (`details.currentVersion`) if someone else saved first. Reload and reapply |
| POST | `/api/events/:id/seating/auto-arrange` | viewer (preview) / cohost (`apply:true`) | `{keepPartiesTogether?:true, apply?:false}` → `{applied:false, version, assignments, unseated}` or `{applied:true, unseated, seating}` |

```json
{ "version": 1,
  "layout": [ { "id": "floor-1", "kind": "dance_floor|stage|bar|entrance|cake|dj|buffet|other", "label": "Dance floor", "x": 360, "y": 200, "w": 180, "h": 120, "rotation": 0 } ],
  "tables": [ { "id": "client-uuid", "label": "Table 1 · Lakeside", "shape": "round|rect|square|u_shape|serpentine|head", "seats": 8, "note": null,
                "x": 200, "y": 300, "rotation": 0, "used": 5, "overBy": 0, "kidsCount": 1, "dietaryCount": 2 } ],
  "assignments": [ { "id": "uuid", "tableId": "uuid", "guestId": "uuid|null", "companionId": "uuid|null", "seatIndex": null } ],
  "parties": [ { "guestId": "uuid", "name": "Eleanor Vance", "partySize": 3,
                 "members": [ { "kind": "guest|companion", "id": "uuid", "fullName": "Eleanor Vance", "type": "adult|child", "meal": "salmon", "dietary": null, "seated": true } ] } ],
  "stats": { "confirmedPeople": 13, "seated": 10, "unseated": 3, "tables": 4, "seats": 32 } }
```

Rules:
- **Table ids are UUIDs generated by the client.** Keep them stable between saves.
- Each assignment has exactly one of `guestId` (the main guest) or `companionId`.
- Only confirmed (`yes`) people can be seated, and each person at most once.
- Over-capacity is allowed and reported through `overBy`.
- Coordinates are free-form canvas units, from -10000 to 10000.
- When a guest declines, they are removed from seating automatically.

## 14. Studio flow for hosts (brief, assets, revisions, approval)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/events/:id/brief` | viewer | `{sections:[{key,label}], customBlockNames, data:{<section>:{…}}, status:"not_started"|"in_progress"|"submitted"|"archived", locked, newSections, completion, submittedAt}` |
| PATCH | `/api/events/:id/brief` | cohost | Autosave `{data:{<section>:{…}}}`, merged per section. Returns **409 `BRIEF_LOCKED`** after submit, except for `newSections` the studio added |
| POST | `/api/events/:id/brief/submit` | cohost | **422 `BRIEF_INCOMPLETE`** (`details.missing`) if required fields are missing. Locks the brief and moves the stage to `brief_received` |
| GET | `/api/events/:id/assets?kind=` | viewer | `{items:[{id,kind,originalName,mime,bytes,url,createdAt}]}`. `url` is signed and expires in 7 days |
| POST | `/api/events/:id/assets?kind=brief_photo|illustration_ref|cover|gallery|music` | cohost | **multipart/form-data**, field `file`. Images (jpeg, png, webp, heic) up to 15 MB; audio (mp3, m4a, aac) up to 20 MB. The content is sniffed. `kind=music` (own song; `403 FEATURE_DISABLED` when `FEATURE_OWN_SONG=false`) needs the multipart field `rightsConfirmed=true` **before** the file part (or `?rightsConfirmed=true`), else `400 RIGHTS_CONFIRMATION_REQUIRED`; the tick is stored. Returns 201 Asset |
| GET | `/api/events/:id/music-rights` | viewer | Both music-rights routes return `403 FEATURE_DISABLED` when `FEATURE_OWN_SONG=false`.  `{items:[{id,userId,userName,assetId,url,statement,confirmedAt}]}` for "Rights confirmed by <name> on <date>" |
| POST | `/api/events/:id/music-rights` | cohost | `{assetId? \| url?, confirmed: true}` (exactly one target) → 201 `{id, confirmedAt, userId, statement}`. `confirmed: false` → 400 `RIGHTS_CONFIRMATION_REQUIRED`. Stores who, the event, the file or link, the statement text, the time, a hashed IP and the user agent |
| DELETE | `/api/events/:id/assets/:assetId` | cohost | 204 |
| GET | `/api/events/:id/revisions` | viewer | `{maxRounds, unlimited, used, remaining, open, canSubmit, canApprove, stage, draftUrl, approvedAt, items:[Revision]}` |
| POST | `/api/events/:id/revisions` | cohost | `{request}` (5 to 5000 characters) → 201. Only allowed when `canSubmit`: stage `review`, no open round, rounds remaining, and not approved. Otherwise **409 `REVISION_NOT_ALLOWED`** |
| POST | `/api/events/:id/revisions/:revisionId/comments` | cohost, studio | `{body}` → 201 |
| POST | `/api/events/:id/approve` | cohost | Final approval, irreversible. Only allowed when `canApprove` |

Revision: `{id, round, request, status:"submitted"|"in_progress"|"completed", staffNote, createdAt, resolvedAt, comments:[{id,body,createdAt,author:{id,name,role}}]}`.

## 15. Public guest endpoints (no auth, no CSRF)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/public/invitations/:slug?lang=&g=&preview=` | Everything needed to render the invitation (below). Renders the **live snapshot** (`publishedVersion`); a valid `preview` renders the draft. 404 when unpublished, unless `preview` is valid. **410 `GONE`** when archived. Old slugs (rows in `invitation_slug_redirects`): a **page request** (`Accept` prefers `text/html`) gets **301** → `${INVITE_BASE_URL}/<current slug>` with the query string kept (`?g=`, `?lang=`, …); a JSON request gets 200 with `invitation.redirectedFrom` = the old slug, so the web route `/i/<old>` should 301 to `/i/<invitation.slug>` keeping its query. All `/api/public/invitations/:slug/*` routes (RSVP, open, calendar) accept old slugs and act on the current invitation |
| POST | `/api/public/invitations/:slug/open` | `{g?, lang?}` → 204. Open analytics; marks the invitee `opened` |
| POST | `/api/public/invitations/:slug/rsvps` | Submit an RSVP (below). Optional header `Idempotency-Key` makes retries return the same result |
| GET | `/api/public/invitations/:slug/rsvps/:guestId?editToken=|g=` | Read my reply (Guest subset). Returns 404 if neither credential matches |
| PATCH | `/api/public/invitations/:slug/rsvps/:guestId` | Edit my reply. Same body as submit, plus `editToken` (or `g`) |
| GET | `/api/public/invitations/:slug/calendar.ics` | `text/calendar` download |
| GET | `/api/files/:token` | Signed asset download (URLs come from the API) |

**GET invitation** (abridged):

```json
{ "invitation": { "id": "uuid", "slug": "maya-and-theo", "redirectedFrom": null, "kind": "wedding_invite", "status": "published", "version": 1, "publishedVersion": 1, "defaultLanguage": "en", "preview": false, "demo": false },
  "theme": { "key": "harbour", "defaultConfig": { "palette": {…}, "fonts": {…}, "cover": {…}, "opening": {…}, "music": {…} } },
  "config": { "palette": {…}, "cover": { "type": "glow", "initials": "M&T", "glowColor": "#FF9C7A" }, "music": {…}, "sectionOrder": ["hero","invitation_text","countdown","our_story","timeline","venue","dress_code","accommodation","transport","gift_list","faq","rsvp"], "hiddenSections": [] },
  "languages": ["en","fr"], "lang": "en",
  "content": { "hero": { "tagline": "Together with their families", "title": "Maya & Theo", "subtitle": "are getting married", "dateText": "Saturday, June 19, 2027" },
               "sections": { "timeline": { "heading": "The day", "rows": [ {"time":"15:30","title":"Ceremony","description":"On the lawn by the water"} ] }, "…": {} },
               "footer": { "signature": "With love, Maya & Theo" } },
  "event": { "title": "Maya & Theo", "hostNames": {…}, "eventDate": "2027-06-19", "timezone": "America/Toronto", "venueName": "Willowmere Estate", "venueAddress": "…" },
  "rsvp": { "open": true, "closedReason": null, "deadline": "2027-05-01", "requireEmail": true, "mealOptions": ["beef","salmon","vegetarian"], "maxCompanions": 3,
            "allowChildren": true, "allergyChecklist": true, "dietaryTags": ["gluten_free","…"], "extraEvents": ["welcome_drinks","farewell_brunch"],
            "customQuestions": [ {"id":"song","label":"…","type":"text"} ] },
  "invitee": { "firstName": "Eleanor", "lastName": "Vance", "householdName": "The Vance family", "maxPartySize": 4, "knownCompanions": [], "language": null, "existingResponse": null },
  "assets": { "<assetId>": { "url": "http://localhost:4000/api/files/…", "mime": "image/jpeg", "kind": "cover" } },
  "music": { "title": "Harbour Morning", "artist": "Studio Library", "url": null, "license": "…", "volume": 0.5, "autoplayOnOpen": true },
  "calendarUrl": "http://localhost:4000/api/public/invitations/maya-and-theo/calendar.ics" }
```

- Rendering: merge `theme.defaultConfig` with `config`. Render the sections in `config.sectionOrder`, skipping `hiddenSections` and any key that has no content.
- Asset ids found anywhere in the content or config resolve through `assets`.
- `rsvp` is `null` for save-the-dates.
- `closedReason` is one of `deadline_passed`, `closed`, `archived`, `preview` or `not_applicable`.
- `invitee` is set only when `?g=` is valid. Otherwise it is `null`, with no error.
- `rsvp.maxCompanions` already reflects the household cap.
- If `invitee.existingResponse` is set, show the reply and an edit form instead of a new form.
- `demo: true` means the invitation is a theme demo. RSVPs are accepted but not stored.

**Submit an RSVP:**

```json
// POST /api/public/invitations/maya-and-theo/rsvps
{ "g": "demoVanceFamily0001", "fullName": "Eleanor Vance", "email": "eleanor@example.com", "attendance": "yes",
  "primaryMeal": "salmon", "primaryDietary": null, "dietaryTags": ["gluten_free"],
  "companions": [ { "type": "adult", "fullName": "Marcus Vance", "meal": "beef" }, { "type": "child", "fullName": "Ivy", "meal": "vegetarian", "dietary": "Lactose intolerant" } ],
  "extraEvents": { "welcome_drinks": "yes" }, "answers": { "song": "September", "shuttle": true }, "message": "Congrats!", "language": "en",
  "website": "" }
// 201
{ "id": "guest-uuid", "editToken": "…", "attendance": "yes", "partySize": 3 }
```

Validation:
- The server enforces RsvpSettings: a valid meal is required when `mealOptions` is set, for the guest and for each companion; companions are capped by `maxCompanions` or the household; children are rejected when `allowChildren` is false; when `requireEmail` is set, email is required **only when `attendance` is `yes`**; a decline needs just the name (general and personal links alike).
- Errors come back as `400 VALIDATION_ERROR` with `fields`, e.g. `primaryMeal`, `companions`, `companions.0.meal`, `companions.0.type`, `email`.
- Unknown `extraEvents` and `answers` keys are dropped.
- A decline (`no`) needs only `fullName`.
- `website` is a honeypot. Leave it empty and hide it from users.

Errors:
- `403 RSVP_CLOSED` (with `details.reason`).
- `409 ALREADY_RESPONDED` (with `details.guestId`) when a personal-link household has already replied. Switch to edit mode.
- `404` for an invalid or rotated personal token.
- `429` when rate-limited.

After a successful submit:
- Store `{guestId, editToken}` (for example in localStorage) so the guest can edit later.
- If an email was given, the guest gets a confirmation email with an edit link: `/i/<slug>?rsvp=<guestId>&edit=<editToken>`.
- Hosts are notified if `notifyOnRsvp` is on.

## 16. Studio admin (`/api/admin/*`, role staff or admin)

Staff see only events assigned to them. Admin-only: deleting events and managing users.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/admin/events?stage=&product=&serviceMode=&q=&sort=&cursor&limit` | Pipeline list (Event + `briefStatus`, `briefCompletion`, `rsvp{confirmed,declined,pending}`, `assignedStaff`) |
| GET | `/api/admin/board` | `{columns:[{stage,count}]}` |
| POST | `/api/admin/events` | Manual order (phone or bank transfer): `{email, plan, hostNames, eventDate?, venueName?, themeKey?, sections?, extras?, languages?, adminNote?, markPaid?, sendAccessEmail?}` → 201. Emails a set-password link, never a password. With `markPaid` (default true) it creates a real paid order: `paymentProvider: "manual"`, `createdByAdminId`, plan and add-on lines priced by the server (`extra_language` as one line with qty n, trimmed to exactly what the languages need, missing units added; `extras` takes codes or `{code, qty}`), plus an `order.manual_created` audit entry. Its add-ons count as purchased (e.g. raise `maxLanguages`); refunds follow the normal rules. Admin only (staff → 403). |
| GET | `/api/admin/events/:id` | Event + `adminNote, assignedStaffId, deliveryEmailSentAt, deliveryEmailSentCount, deletionRequestedAt, progress, daysToEvent, brief, revisions, members, orders, stats` |
| PATCH | `/api/admin/events/:id` | `{hostNames?, title?, eventDate?, timezone?, venueName?, venueAddress?, languages?, productionStage?, express? (rush priority, set automatically by `rush_design`), adminNote?, maxRevisionRounds?, assignedStaffId?, highSeasonNotice?}` |
| DELETE | `/api/admin/events/:id` | **admin**: soft delete |
| POST | `/api/admin/events/:id/stage` | `{stage}` or `{advance:true}`. Notifies the host where relevant |
| POST | `/api/admin/events/:id/send-access` | Resends the owner's set-password or login link |
| GET/PATCH | `/api/admin/events/:id/brief` | Read, or edit even when locked (`{data}`) |
| POST | `/api/admin/events/:id/brief/sections` | `{sections:[…], notify?}` adds sections; the host is asked to complete them |
| POST | `/api/admin/events/:id/emails` | `{template:"draft_ready"|"invitation_ready"|"std_ready"|"custom", note?, subject?, body?}` queues an email to the host |
| PATCH | `/api/admin/revisions/:revisionId` | `{status?:"submitted"|"in_progress"|"completed", staffNote?, notify?}` |
| GET/PUT | `/api/admin/invitations/:invitationId` | Studio editor (same body as the host PUT) |
| POST | `/api/admin/invitations/:invitationId/generate-from-brief` | Fills the draft content from the brief |
| POST | `/api/admin/invitations/:invitationId/{preview-token,publish,unpublish,discard-draft,rollback}` | Same semantics as the host versions; `rollback` takes `{version}`. Admins can set `slug` without the add-on (old slug kept as an alias) |
| GET | `/api/admin/invitations/:invitationId/versions` | |
| GET | `/api/admin/orders?status=&q=&cursor&limit`, `/api/admin/orders/:orderId` | Orders with items, tax and totals |
| POST | `/api/admin/orders/:orderId/refund` | **Manual orders only; admin (staff/hosts 403), CSRF.** `{reason}` (1–500 chars, required) → 200 `{id, number, status:'refunded', refundedAt, source:'manual', kind}`. No money moves; same effects as a Stripe refund (plan order → event unpaid, invitation archived, its add-ons revoked; add-ons order → only that order's add-ons revoked, invitation stays live). Audit `order.manual_refunded` (admin id, reason). Checkout orders → 409 `CONFLICT` (refund in Stripe); already refunded / not paid → 409 |
| GET | `/api/admin/checkout-drafts?abandoned=&cursor&limit` | Abandoned carts |
| GET/POST/PATCH/DELETE | `/api/admin/themes[/:themeId]` | Theme catalogue (DELETE retires the theme). Body takes `products[]` (1–4 product types, default all); a single `product` returns 400 |
| GET/POST/PATCH | `/api/admin/music[/:trackId]` | Music library `{title, artist, license, url?, durationS, moodTags?, active?}` |
| GET/POST/PATCH | `/api/admin/users[/:userId]` | **admin**. POST `{email, name?, role?:"staff"|"admin"}` emails a set-password link. PATCH `{role?, disabled?, name?}` |
| POST | `/api/admin/users/:userId/send-reset` | **admin**. Emails a reset link; admins never see or set passwords |
| GET | `/api/admin/messages?eventId=&template=&status=&cursor&limit` | Email log (no secrets or tokens) |
| GET/POST/PATCH | `/api/admin/reviews[/:reviewId]` | Testimonials moderation. POST `{displayName, location?, text, orderId?, isSample?, published?}`; PATCH `{displayName?, location?, text?, isSample?, published?}`. **No `rating`**: sending it returns 400. Only publish real reviews with the customer's consent, and flag placeholder copy with `isSample` |
| GET | `/api/admin/metrics` | `{currency, orders{<status>:n}, revenueLast30Days{totalCents,taxCents,orders}, revenueAllTime{…}, stages{…}, events{self_serve,studio}, rsvpsLast30Days}` |

## 17. Webhooks (server-to-server)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/api/webhooks/stripe` | `Stripe-Signature` header, verified against the raw body with `STRIPE_WEBHOOK_SECRET` | Handles `checkout.session.completed` and `checkout.session.async_payment_succeeded` (order paid and provisioned, tax and total taken from Stripe), `checkout.session.expired` and `checkout.session.async_payment_failed` (canceled), and `charge.refunded` (refunded). Idempotent per event id; a duplicate returns `{received:true,duplicate:true}`. Bad signatures and live-mode events return 400 |
| POST | `/api/webhooks/email` | `x-webhook-secret` header | `{events:[{providerMessageId, type:"delivered"|"bounced"|"opened"|"failed"}]}`, for a future real email provider |

## 18. Dev-only helpers (not registered in production)

These routes exist only when `DEV_ROUTES_ENABLED` is true (default: true outside production). With `NODE_ENV=production` they are never registered, and setting `DEV_ROUTES_ENABLED=true` in production stops the API at startup. They are hidden from `/docs`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/api/dev/outbox?to=&limit=` | **admin session** (401 / 403 otherwise) | Emails the console driver "sent", newest first, including one-time links. Hosts testing locally can read the same emails in the API log |
| GET | `/api/dev/mock-checkout/:sessionId` | none (the session id is unguessable) | Mock payment page (HTML, `Cache-Control: no-store`, un-frameable). Only with the mock payment driver |
| POST | `/api/dev/mock-checkout/:sessionId/complete?redirect=false` / `cancel` | body `token` (form field or JSON) = the pay token embedded in that session's page | 403 `FORBIDDEN` without the right token; `complete` returns 409 `CONFLICT` if the order is canceled or refunded. JSON reply `{ok, orderId, status, eventId, successUrl}`; with `Accept: text/html` it answers with a 303 |
| POST | `/api/dev/run-jobs` | **admin session + `x-csrf`** | Runs one worker pass now → `{processed}` |

## 19. Generated endpoint reference

This table is generated from the OpenAPI document by `npm run contract`. It lists every route with its exact query parameters and JSON body. Boolean query parameters accept **only** `true`, `false`, `1` or `0`; anything else returns `400 VALIDATION_ERROR`.

<!-- GENERATED:endpoints:start -->
| Method | Path | Query | Body (JSON) | Summary |
|---|---|---|---|---|
| GET | `/health` |  |  | Liveness + DB check |
| GET | `/api/public/catalogue` |  |  | Plans, extras, themes, sections and languages |
| GET | `/api/public/themes` | `product?: "wedding_invite" \| "save_the_date" \| "birthday" \| "bridesmaid"` |  |  |
| GET | `/api/public/themes/:key` |  |  |  |
| GET | `/api/public/music` |  |  | Royalty-free music library |
| GET | `/api/public/music/files/:file` |  |  | Stream a library track (MP3, supports Range requests) |
| GET | `/api/public/reviews` | `cursor?: string(≤200); limit?: int(1…100)` |  | Published testimonials. Sample (placeholder) copy has isSample: true; label it as such. May be empty. |
| POST | `/api/public/contact` |  | `{ name: string(min 1, ≤100); email: email(≤255); topic?: "general" \| "partner" \| "order" \| "press"; message: string(min 5, ≤5000); consent: true; website?: string(≤200) }` |  |
| PUT | `/api/checkout/drafts/:draftId` |  | `{ plan?: "diy" \| "std" \| "experience" \| "premium" \| "birthday" \| "bridesmaid"; lastStep?: string(≤40); themeKey?: string(≤80); sections?: string(≤80)[] (≤40); extras?: string(≤40)[] (≤20); languages?: string(≤30)[] (≤12); info?: { partner1?: string(≤80); partner2?: string(≤80); honoree?: string(≤80); eventDate?: "YYYY-MM-DD"; venue?: string(≤200); email?: string(≤255); phone?: string(≤40); message?: string(≤3000) }; vision?: string(≤1500); utm?: Record<string, string(≤200)>; abandoned?: boolean }` | Upsert abandoned-cart draft (called on each wizard step) |
| POST | `/api/checkout/quote` |  | `{ plan: "diy" \| "std" \| "experience" \| "premium" \| "birthday" \| "bridesmaid"; themeKey?: string(≤80); sections?: string(≤80)[] (≤40); extras?: (string(≤40) \| { code: string(≤40); qty?: int(1…20) })[] (≤20); languages?: string(≤30)[] (≤12); eventId?: uuid }` | Server-side price preview. Without themeKey, the event's saved theme is used when eventId is sent; with no theme at all → 422 'Please choose a design' |
| POST | `/api/checkout/session` |  | `{ plan: "diy" \| "std" \| "experience" \| "premium" \| "birthday" \| "bridesmaid"; themeKey?: string(≤80); sections?: string(≤80)[] (≤40); extras?: (string(≤40) \| { code: string(≤40); qty?: int(1…20) })[] (≤20); languages?: string(≤30)[] (≤12); draftId?: uuid; eventId?: uuid; vision?: string(≤1500); info: { partner1?: string(≤80); partner2?: string(≤80); honoree?: string(≤80); eventDate?: "YYYY-MM-DD"; venue?: string(≤200); email: string; phone?: string(≤40); message?: string(≤3000) }; consents: { terms: true; privacy: true }; promoCode?: string(≤60) }` | Create order + payment checkout session; returns redirect URL. Pay to publish: add-ons the event uses must be in extras, else 422 INVALID_SELECTION when extra_language units fall short: details.missing[].qty = units still short (not the total needed). |
| POST | `/api/checkout/addons/quote` |  | `{ eventId: uuid; extras: (string(≤40) \| { code: string(≤40); qty?: int(1…20) })[] (≤20); languages?: string(≤30)[] (≤8) }` | Price add-ons for an already paid event (owner). 422 INVALID_SELECTION when extra_language units fall short: details.missing[].qty = units still short (not the total needed). |
| POST | `/api/checkout/addons` |  | `{ eventId: uuid; extras: (string(≤40) \| { code: string(≤40); qty?: int(1…20) })[] (≤20); languages?: string(≤30)[] (≤8); consents: { terms: true; privacy: true } }` | Add-ons-only checkout for an already paid event (cohost); returns redirect URL. 422 INVALID_SELECTION when extra_language units fall short: details.missing[].qty = units still short (not the total needed). |
| GET | `/api/checkout/session/:sessionId/verify` |  |  |  |
| POST | `/api/webhooks/stripe` |  |  | Stripe events (signature verified) |
| POST | `/api/webhooks/email` |  |  | Email delivery events (x-webhook-secret) |
| POST | `/api/auth/login` |  | `{ email: email(≤255); password: string(min 1, ≤200) }` |  |
| POST | `/api/auth/logout` |  |  |  |
| GET | `/api/auth/me` |  |  |  |
| PATCH | `/api/auth/me` |  | `{ name?: string(min 1, ≤100); locale?: string(/^[a-z]{2}(-[A-Z]{2})?$/) }` |  |
| POST | `/api/auth/password/change` |  | `{ currentPassword: string(≤200); newPassword: string(min 10, ≤200) }` |  |
| POST | `/api/auth/register` |  | `{ email: email(≤255); name?: string(≤100); locale?: string(≤10) }` |  |
| POST | `/api/auth/magic-link` |  | `{ email: email(≤255) }` |  |
| POST | `/api/auth/password/forgot` |  | `{ email: email(≤255) }` |  |
| POST | `/api/auth/token/inspect` |  | `{ token: string(min 10, ≤200) }` | Check a one-time link before showing the form |
| POST | `/api/auth/token/consume` |  | `{ token: string(min 10, ≤200); password?: string(min 10, ≤200); name?: string(≤100) }` |  |
| GET | `/api/auth/unsubscribe` | `token: string(≤300)` |  |  |
| POST | `/api/auth/unsubscribe` |  | `{ token: string(≤300) }` |  |
| GET | `/api/events` |  |  | Events I belong to |
| POST | `/api/events` |  | `{ product?: "wedding_invite" \| "save_the_date" \| "birthday"; hostNames: { partner1?: string(≤80); partner2?: string(≤80); honoree?: string(≤80) }; eventDate?: "YYYY-MM-DD"; timezone?: string(≤64); venueName?: string(≤200); venueAddress?: string(≤400); languages?: string(≤30)[] (≤50); extras?: (string(≤40) \| { code: string(≤40); qty?: int(1…20) })[] (≤20); themeKey?: string(≤80); sections?: string(≤80)[] (≤30) }` | Create a self-serve event (free draft; publishing requires the self-serve plan) |
| GET | `/api/events/:id` |  |  |  |
| PATCH | `/api/events/:id` |  | `{ hostNames?: { partner1?: string(≤80); partner2?: string(≤80); honoree?: string(≤80) }; eventDate?: "YYYY-MM-DD"; timezone?: string(≤64); venueName?: string(≤200); venueAddress?: string(≤400); languages?: string(≤30)[] (≤50); selectedExtras?: (string(≤40) \| { code: string(≤40); qty?: int(1…20) })[] (≤20); notifyOnRsvp?: boolean; remindersEnabled?: boolean; reminderDaysBefore?: int(1…60) }` | Edit event details. Paid event with languages over the cap → 402 ADDON_PAYMENT_REQUIRED: details.missing[].qty = units still short (not the total needed). |
| GET | `/api/events/:id/addons` |  |  | Purchased, available and missing add-ons (feeds the Add-ons checkout dialog) |
| GET | `/api/events/:id/stats` |  |  |  |
| PATCH | `/api/events/:id/invites-sent` |  | `{ total: int(0…100000) }` |  |
| GET | `/api/events/:id/activity` | `cursor?: string(≤200); limit?: int(1…100)` |  |  |
| GET | `/api/events/:id/stream` |  |  |  |
| GET | `/api/events/:id/rsvp-settings` |  |  |  |
| PATCH | `/api/events/:id/rsvp-settings` |  | `{ deadline?: "YYYY-MM-DD"; requireEmail?: boolean; mealOptions?: string(min 1, ≤40)[] (≤10); maxCompanions?: int(0…19); allowChildren?: boolean; allergyChecklist?: boolean; extraEvents?: string(/^[a-z0-9_]{1,40}$/)[] (≤10); customQuestions?: ({ id: string(/^[a-z0-9_]{1,40}$/); label: string(min 1, ≤200); type: "text" \| "yes_no"; required?: boolean })[] (≤10); mode?: "auto" \| "open" \| "closed" }` |  |
| GET | `/api/events/:id/members` |  |  |  |
| POST | `/api/events/:id/members` |  | `{ email: email(≤255); role?: "cohost" \| "viewer" }` |  |
| PATCH | `/api/events/:id/members/:userId` |  | `{ role: "cohost" \| "viewer" }` |  |
| DELETE | `/api/events/:id/members/:userId` |  |  |  |
| GET | `/api/events/:id/qr` | `format?: "png" \| "svg"; size?: int(128…2048); inviteeId?: uuid; download?: "0" \| "1" \| "true" \| "false"` |  |  |
| GET | `/api/events/:id/share-kit` |  |  |  |
| GET | `/api/events/:id/export-all` |  |  | Data export (JSON) of everything stored for this event |
| POST | `/api/events/:id/delete-request` |  |  |  |
| GET | `/api/events/:id/brief` |  |  |  |
| PATCH | `/api/events/:id/brief` |  | `{ data: Record<string, unknown> }` | Autosave: merge section data |
| POST | `/api/events/:id/brief/submit` |  |  |  |
| GET | `/api/events/:id/assets` | `kind?: "brief_photo" \| "illustration_ref" \| "cover" \| "gallery" \| "music"` |  |  |
| POST | `/api/events/:id/assets` | `kind: "brief_photo" \| "illustration_ref" \| "cover" \| "gallery" \| "music"; rightsConfirmed?: "0" \| "1" \| "true" \| "false"` |  | multipart/form-data upload, field "file" |
| GET | `/api/events/:id/music-rights` |  |  | Own-song rights confirmations ("Rights confirmed by <name> on <date>") |
| POST | `/api/events/:id/music-rights` |  | `{ assetId?: uuid; url?: string(≤500); confirmed: boolean }` | Record "I have the rights to use this music" for an uploaded song or a song link |
| DELETE | `/api/events/:id/assets/:assetId` |  |  |  |
| GET | `/api/events/:id/revisions` |  |  |  |
| POST | `/api/events/:id/revisions` |  | `{ request: string(min 5, ≤5000) }` |  |
| POST | `/api/events/:id/approve` |  |  | Approve the final design (irreversible) |
| POST | `/api/events/:id/revisions/:revisionId/comments` |  | `{ body: string(min 1, ≤3000) }` |  |
| GET | `/api/events/:id/invitation` |  |  |  |
| PUT | `/api/events/:id/invitation` |  | `{ themeKey?: string(≤80); locale?: string(≤20); content?: Record<string, { hero?: { tagline?: string(≤200); title?: string(≤200); subtitle?: string(≤300); dateText?: string(≤120); backgroundAssetId?: uuid }; sections?: Record<string, unknown>; footer?: { signature?: string(≤200) } }>; config?: { palette?: { background?: "#RRGGBB"; surface?: "#RRGGBB"; primary?: "#RRGGBB"; onPrimary?: "#RRGGBB"; accent?: "#RRGGBB"; glow?: "#RRGGBB"; text?: "#RRGGBB"; muted?: "#RRGGBB" }; fonts?: { display?: string(≤60); body?: string(≤60); script?: string(≤60) }; cover?: { type?: "glow" \| "photo" \| "none"; initials?: string(≤6); glowColor?: "#RRGGBB"; posterAssetId?: uuid; mediaAssetId?: uuid }; opening?: { animation?: string(/^[a-z0-9_-]{1,40}$/); durationMs?: int(0…10000) }; music?: { trackId?: uuid; assetId?: uuid; externalUrl?: string(/^https:\/\//, ≤500); volume?: number(0…1); autoplayOnOpen?: boolean }; sectionOrder?: string(≤80)[] (≤40); hiddenSections?: string(≤80)[] (≤40) }; musicRightsConfirmed?: boolean }` | Self-serve editor save. content/config/theme go to the draft; locale applies immediately. The link is changed with PATCH …/invitation/slug |
| PATCH | `/api/events/:id/invitation/slug` |  | `{ slug: string(≤200) }` | Custom link name (custom_link): change the invitation slug. Applies immediately; the old slug 301-redirects. 402 ADDON_PAYMENT_REQUIRED: details.missing[].qty = units still short (not the total needed). |
| POST | `/api/events/:id/invitation/publish` |  |  | Publish / Publish changes. Unpaid add-ons in use → 402 ADDON_PAYMENT_REQUIRED: details.missing[].qty = units still short (not the total needed). |
| POST | `/api/events/:id/invitation/discard-draft` |  |  | Reset the draft to the live version |
| POST | `/api/events/:id/invitation/unpublish` |  |  |  |
| POST | `/api/events/:id/invitation/preview-token` |  |  | Rotate the preview link |
| GET | `/api/events/:id/invitation/versions` |  |  |  |
| POST | `/api/events/:id/invitation/rollback` |  | `{ version: int(1…9007199254740991) }` |  |
| GET | `/api/events/:id/guests` | `status?: "all" \| "yes" \| "no" \| "pending"; q?: string(≤100); trash?: "0" \| "1" \| "true" \| "false"; cursor?: string(≤200); limit?: int(1…200)` |  |  |
| POST | `/api/events/:id/guests` |  | `{ fullName: string(min 1, ≤100); email?: email(≤255) \| ""; primaryMeal?: string(≤40); primaryDietary?: string(≤300); dietaryTags?: ("gluten_free" \| "lactose_free" \| "vegetarian" \| "vegan" \| "nut" \| "fruit" \| "other")[] (≤7); companions?: ({ type?: "adult" \| "child"; fullName: string(min 1, ≤100); meal?: string(≤40); dietary?: string(≤300) })[] (≤19); extraEvents?: Record<string, "yes" \| "no">; answers?: Record<string, string(≤1000) \| boolean>; message?: string(≤1000); language?: string(≤20); phone?: string(≤40); attendance?: "yes" \| "no" \| "pending"; notes?: string(≤2000); inviteeId?: uuid }` | Manually add a guest (e.g. phone RSVP) |
| GET | `/api/events/:id/guests/:guestId` |  |  |  |
| PATCH | `/api/events/:id/guests/:guestId` |  | `{ fullName?: string(min 1, ≤100); email?: email(≤255) \| ""; primaryMeal?: string(≤40); primaryDietary?: string(≤300); dietaryTags?: ("gluten_free" \| "lactose_free" \| "vegetarian" \| "vegan" \| "nut" \| "fruit" \| "other")[] (≤7); companions?: ({ type?: "adult" \| "child"; fullName: string(min 1, ≤100); meal?: string(≤40); dietary?: string(≤300) })[] (≤19); extraEvents?: Record<string, "yes" \| "no">; answers?: Record<string, string(≤1000) \| boolean>; message?: string(≤1000); language?: string(≤20); phone?: string(≤40); attendance?: "yes" \| "no" \| "pending"; notes?: string(≤2000); inviteeId?: uuid }` |  |
| DELETE | `/api/events/:id/guests/:guestId` | `permanent?: "0" \| "1" \| "true" \| "false"` |  | Move to trash, or ?permanent=true to delete a trashed guest |
| POST | `/api/events/:id/guests/:guestId/restore` |  |  |  |
| POST | `/api/events/:id/guests/export` |  | `{ format?: "xlsx" \| "csv"; includeHeader?: boolean; status?: "all" \| "yes" \| "no" \| "pending"; columns?: ("fullName" \| "email" \| "phone" \| "attendance" \| "partySize" \| "primaryMeal" \| "primaryDietary" \| "dietaryTags" \| "companionsCount" \| "extraEvents" \| "answers" \| "message" \| "notes" \| "source" \| "submittedAt")[] (≤20) }` | Download guests as xlsx (sheets Guests + Companions) or csv |
| GET | `/api/events/:id/invitees` | `status?: "not_sent" \| "sent" \| "opened" \| "responded" \| "bounced" \| "opted_out"; q?: string(≤100); cursor?: string(≤200); limit?: int(1…200)` |  |  |
| POST | `/api/events/:id/invitees` |  | `{ householdName?: string(≤120); firstName: string(min 1, ≤80); lastName?: string(≤80); email?: email(≤255) \| ""; phone?: string(≤40); language?: string(≤20); maxPartySize?: int(1…20); knownCompanions?: ({ fullName: string(min 1, ≤100); type?: "adult" \| "child" })[] (≤19); groupLabel?: string(≤60); notes?: string(≤2000) }` |  |
| POST | `/api/events/:id/invitees/import` | `commit?: "0" \| "1" \| "true" \| "false"` |  |  |
| PATCH | `/api/events/:id/invitees/:inviteeId` |  | `{ householdName?: string(≤120); firstName?: string(min 1, ≤80); lastName?: string(≤80); email?: email(≤255) \| ""; phone?: string(≤40); language?: string(≤20); maxPartySize?: int(1…20); knownCompanions?: ({ fullName: string(min 1, ≤100); type?: "adult" \| "child" })[] (≤19); groupLabel?: string(≤60); notes?: string(≤2000) }` |  |
| DELETE | `/api/events/:id/invitees/:inviteeId` |  |  |  |
| GET | `/api/events/:id/invitees/:inviteeId/link` |  |  |  |
| POST | `/api/events/:id/invitees/:inviteeId/rotate-token` |  |  | Invalidate the old personal link and issue a new one |
| POST | `/api/events/:id/invitees/:inviteeId/mark-sent` |  | `{ channel?: "whatsapp" \| "sms" \| "email" \| "link" \| "qr" }` | Mark as sent after sharing manually (e.g. WhatsApp) |
| POST | `/api/events/:id/campaigns` |  | `{ kind: "invite" \| "reminder" \| "update" \| "thank_you"; channel?: "email" \| "whatsapp" \| "sms"; segment?: { statuses?: ("not_sent" \| "sent" \| "opened" \| "responded" \| "bounced")[] (≤6); notResponded?: boolean; attending?: boolean; inviteeIds?: uuid[] (≤5000); groupLabel?: string(≤60) }; subject?: Record<string, string(≤200)>; body?: Record<string, string(≤5000)>; scheduledAt?: ISO datetime }` | Schedule a bulk invite / reminder / update / thank-you (email channel; WhatsApp coming later) |
| GET | `/api/events/:id/campaigns` |  |  |  |
| POST | `/api/events/:id/campaigns/preview` |  | `{ channel?: "email" \| "whatsapp" \| "sms"; segment?: { statuses?: ("not_sent" \| "sent" \| "opened" \| "responded" \| "bounced")[] (≤6); notResponded?: boolean; attending?: boolean; inviteeIds?: uuid[] (≤5000); groupLabel?: string(≤60) } }` | Count recipients for a segment |
| GET | `/api/events/:id/campaigns/:campaignId` |  |  |  |
| POST | `/api/events/:id/campaigns/:campaignId/cancel` |  |  |  |
| GET | `/api/events/:id/seating` |  |  | Tables, floor layout, assignments and confirmed parties |
| PUT | `/api/events/:id/seating` |  | `{ version: int(0…9007199254740991); layout?: ({ id: string(≤64); kind: "dance_floor" \| "stage" \| "bar" \| "entrance" \| "cake" \| "dj" \| "buffet" \| "other"; label?: string(≤60); x: number; y: number; w: number(0…5000); h: number(0…5000); rotation?: number(-360…360) })[] (≤100); tables: ({ id: uuid; label: string(min 1, ≤60); shape: "round" \| "rect" \| "square" \| "u_shape" \| "serpentine" \| "head"; seats: int(1…60); note?: string(≤300); x?: number(-10000…10000); y?: number(-10000…10000); rotation?: number(-360…360) })[] (≤200); assignments: { tableId: uuid; guestId?: uuid; companionId?: uuid; seatIndex?: int(0…59) }[] (≤2000) }` | Full replace with optimistic version check (409 VERSION_CONFLICT) |
| POST | `/api/events/:id/seating/auto-arrange` |  | `{ keepPartiesTogether?: boolean; apply?: boolean }` | Propose (or apply) seats for unseated guests |
| GET | `/api/public/invitations/:slug` | `lang?: string(≤20); g?: string(≤100); preview?: string(≤100)` |  | Everything needed to render a guest invitation |
| POST | `/api/public/invitations/:slug/open` |  | `{ g?: string(≤100); lang?: string(≤20) }` | Open analytics ping |
| POST | `/api/public/invitations/:slug/rsvps` |  | `{ fullName: string(min 1, ≤100); email?: email(≤255) \| ""; primaryMeal?: string(≤40); primaryDietary?: string(≤300); dietaryTags?: ("gluten_free" \| "lactose_free" \| "vegetarian" \| "vegan" \| "nut" \| "fruit" \| "other")[] (≤7); companions?: ({ type?: "adult" \| "child"; fullName: string(min 1, ≤100); meal?: string(≤40); dietary?: string(≤300) })[] (≤19); extraEvents?: Record<string, "yes" \| "no">; answers?: Record<string, string(≤1000) \| boolean>; message?: string(≤1000); language?: string(≤20); g?: string(≤100); attendance: "yes" \| "no"; website?: string(≤200); captchaToken?: string(≤4000) }` | Submit an RSVP |
| GET | `/api/public/invitations/:slug/rsvps/:guestId` | `editToken?: string(≤100); g?: string(≤100)` |  | Read my own reply (editToken or personal link token) |
| PATCH | `/api/public/invitations/:slug/rsvps/:guestId` |  | `{ fullName: string(min 1, ≤100); email?: email(≤255) \| ""; primaryMeal?: string(≤40); primaryDietary?: string(≤300); dietaryTags?: ("gluten_free" \| "lactose_free" \| "vegetarian" \| "vegan" \| "nut" \| "fruit" \| "other")[] (≤7); companions?: ({ type?: "adult" \| "child"; fullName: string(min 1, ≤100); meal?: string(≤40); dietary?: string(≤300) })[] (≤19); extraEvents?: Record<string, "yes" \| "no">; answers?: Record<string, string(≤1000) \| boolean>; message?: string(≤1000); language?: string(≤20); g?: string(≤100); attendance: "yes" \| "no"; website?: string(≤200); captchaToken?: string(≤4000); editToken?: string(≤100) }` | Edit my reply |
| GET | `/api/public/invitations/:slug/calendar.ics` |  |  |  |
| GET | `/api/files/:token` |  |  |  |
| GET | `/api/admin/events` | `stage?: "order_received" \| "brief_received" \| "in_queue" \| "designing" \| "review" \| "delivered"; product?: "wedding_invite" \| "save_the_date" \| "birthday" \| "bridesmaid"; serviceMode?: "self_serve" \| "studio"; q?: string(≤100); sort?: "eventDate" \| "createdAt"; cursor?: string(≤200); limit?: int(1…200)` |  | Pipeline list (staff see assigned events only) |
| POST | `/api/admin/events` |  | `{ email: email(≤255); plan: "diy" \| "std" \| "experience" \| "premium" \| "birthday" \| "bridesmaid"; hostNames: { partner1?: string(≤80); partner2?: string(≤80); honoree?: string(≤80) }; eventDate?: "YYYY-MM-DD"; venueName?: string(≤200); themeKey?: string(≤80); sections?: string(≤80)[] (≤30); extras?: (string(≤40) \| { code: string(≤40); qty?: int(1…20) })[] (≤20); languages?: string(≤30)[] (≤50); adminNote?: string(≤2000); markPaid?: boolean; sendAccessEmail?: boolean }` | Manual order (phone / bank transfer). Emails a set-password link — never a password. |
| GET | `/api/admin/board` |  |  | Kanban column counts for studio events |
| GET | `/api/admin/events/:id` |  |  |  |
| PATCH | `/api/admin/events/:id` |  | `{ hostNames?: { partner1?: string(≤80); partner2?: string(≤80); honoree?: string(≤80) }; title?: string(min 1, ≤160); eventDate?: "YYYY-MM-DD"; timezone?: string(≤64); venueName?: string(≤200); venueAddress?: string(≤400); languages?: string(≤30)[] (≤50); productionStage?: "order_received" \| "brief_received" \| "in_queue" \| "designing" \| "review" \| "delivered"; express?: boolean; adminNote?: string(≤5000); maxRevisionRounds?: int(0…99); assignedStaffId?: uuid; highSeasonNotice?: boolean }` |  |
| DELETE | `/api/admin/events/:id` |  |  | Soft-delete an event and its guests (admin only) |
| POST | `/api/admin/events/:id/stage` |  | `{ stage: "order_received" \| "brief_received" \| "in_queue" \| "designing" \| "review" \| "delivered" } \| { advance: true }` |  |
| POST | `/api/admin/events/:id/send-access` |  |  | Email the owner a set-password / sign-in link |
| GET | `/api/admin/events/:id/brief` |  |  |  |
| PATCH | `/api/admin/events/:id/brief` |  | `{ data: Record<string, unknown> }` | Edit brief at any time (even locked) |
| POST | `/api/admin/events/:id/brief/sections` |  | `{ sections: string(≤80)[] (≤20); notify?: boolean }` | Add sections to a brief; host is asked to complete & resubmit |
| PATCH | `/api/admin/revisions/:revisionId` |  | `{ status?: "submitted" \| "in_progress" \| "completed"; staffNote?: string(≤5000); notify?: boolean }` |  |
| GET | `/api/admin/invitations/:invitationId` |  |  |  |
| PUT | `/api/admin/invitations/:invitationId` |  | `{ themeKey?: string(≤80); locale?: string(≤20); content?: Record<string, { hero?: { tagline?: string(≤200); title?: string(≤200); subtitle?: string(≤300); dateText?: string(≤120); backgroundAssetId?: uuid }; sections?: Record<string, unknown>; footer?: { signature?: string(≤200) } }>; config?: { palette?: { background?: "#RRGGBB"; surface?: "#RRGGBB"; primary?: "#RRGGBB"; onPrimary?: "#RRGGBB"; accent?: "#RRGGBB"; glow?: "#RRGGBB"; text?: "#RRGGBB"; muted?: "#RRGGBB" }; fonts?: { display?: string(≤60); body?: string(≤60); script?: string(≤60) }; cover?: { type?: "glow" \| "photo" \| "none"; initials?: string(≤6); glowColor?: "#RRGGBB"; posterAssetId?: uuid; mediaAssetId?: uuid }; opening?: { animation?: string(/^[a-z0-9_-]{1,40}$/); durationMs?: int(0…10000) }; music?: { trackId?: uuid; assetId?: uuid; externalUrl?: string(/^https:\/\//, ≤500); volume?: number(0…1); autoplayOnOpen?: boolean }; sectionOrder?: string(≤80)[] (≤40); hiddenSections?: string(≤80)[] (≤40) }; musicRightsConfirmed?: boolean }` |  |
| POST | `/api/admin/invitations/:invitationId/generate-from-brief` |  |  | Fill invitation content/config from the brief (draft) |
| POST | `/api/admin/invitations/:invitationId/preview-token` |  |  |  |
| POST | `/api/admin/invitations/:invitationId/publish` |  |  |  |
| POST | `/api/admin/invitations/:invitationId/discard-draft` |  |  | Reset the draft to the live version |
| POST | `/api/admin/invitations/:invitationId/unpublish` |  |  |  |
| GET | `/api/admin/invitations/:invitationId/versions` |  |  |  |
| POST | `/api/admin/invitations/:invitationId/rollback` |  | `{ version: int(1…9007199254740991) }` |  |
| POST | `/api/admin/events/:id/emails` |  | `{ template: "draft_ready" \| "invitation_ready" \| "std_ready" \| "custom"; note?: string(≤2000); subject?: string(≤200); body?: string(≤5000) }` |  |
| GET | `/api/admin/orders` | `status?: "draft" \| "pending_payment" \| "paid" \| "refunded" \| "canceled"; q?: string(≤100); cursor?: string(≤200); limit?: int(1…200)` |  |  |
| POST | `/api/admin/orders/:orderId/refund` |  | `{ reason: string(min 1, ≤500) }` | Refund a MANUAL order (admin only; no money moves). Same effects as a Stripe refund. Checkout orders → 409 (refund in Stripe); already refunded → 409 |
| GET | `/api/admin/orders/:orderId` |  |  |  |
| GET | `/api/admin/checkout-drafts` | `abandoned?: "0" \| "1" \| "true" \| "false"; cursor?: string(≤200); limit?: int(1…200)` |  |  |
| GET | `/api/admin/themes` |  |  |  |
| POST | `/api/admin/themes` |  | `{ key: string(/^[a-z0-9-]{2,60}$/); products?: ("wedding_invite" \| "save_the_date" \| "birthday" \| "bridesmaid")[] (≤4); name: Record<string, string(≤2000)>; description?: Record<string, string(≤2000)>; moodTags?: string(≤30)[] (≤10); previewVideoUrl?: string; posterUrl?: string; demoSlug?: string(≤80); isNew?: boolean; isPopular?: boolean; status?: "active" \| "coming_soon" \| "retired"; defaultConfig?: Record<string, unknown>; sort?: int(-9007199254740991…9007199254740991) }` |  |
| PATCH | `/api/admin/themes/:themeId` |  | `{ key?: string(/^[a-z0-9-]{2,60}$/); products?: ("wedding_invite" \| "save_the_date" \| "birthday" \| "bridesmaid")[] (≤4); name?: Record<string, string(≤2000)>; description?: Record<string, string(≤2000)>; moodTags?: string(≤30)[] (≤10); previewVideoUrl?: string; posterUrl?: string; demoSlug?: string(≤80); isNew?: boolean; isPopular?: boolean; status?: "active" \| "coming_soon" \| "retired"; defaultConfig?: Record<string, unknown>; sort?: int(-9007199254740991…9007199254740991) }` |  |
| DELETE | `/api/admin/themes/:themeId` |  |  | Retire a theme (kept for existing invitations) |
| GET | `/api/admin/music` |  |  |  |
| POST | `/api/admin/music` |  | `{ title: string(min 1, ≤120); artist: string(min 1, ≤120); license: string(min 1, ≤200); url?: string; durationS: int(1…3600); moodTags?: string(≤30)[] (≤10); active?: boolean }` |  |
| PATCH | `/api/admin/music/:trackId` |  | `{ title?: string(min 1, ≤120); artist?: string(min 1, ≤120); license?: string(min 1, ≤200); url?: string; durationS?: int(1…3600); moodTags?: string(≤30)[] (≤10); active?: boolean }` |  |
| GET | `/api/admin/users` | `role?: "host" \| "staff" \| "admin"; q?: string(≤100); cursor?: string(≤200); limit?: int(1…200)` |  |  |
| POST | `/api/admin/users` |  | `{ email: email(≤255); name?: string(≤100); role?: "staff" \| "admin" }` | Invite a studio team member (set-password link by email) |
| PATCH | `/api/admin/users/:userId` |  | `{ role?: "host" \| "staff" \| "admin"; disabled?: boolean; name?: string(≤100) }` |  |
| POST | `/api/admin/users/:userId/send-reset` |  |  | Email a password reset link (admins never see or set passwords) |
| GET | `/api/admin/messages` | `eventId?: uuid; template?: string(≤60); status?: "queued" \| "sending" \| "sent" \| "delivered" \| "failed" \| "bounced" \| "opened"; cursor?: string(≤200); limit?: int(1…200)` |  |  |
| GET | `/api/admin/reviews` |  |  |  |
| POST | `/api/admin/reviews` |  | `{ displayName: string(min 1, ≤100); location?: string(≤100); text: string(min 1, ≤3000); orderId?: uuid; isSample?: boolean; published?: boolean }` |  |
| PATCH | `/api/admin/reviews/:reviewId` |  | `{ displayName?: string(min 1, ≤100); location?: string(≤100); published?: boolean; isSample?: boolean; text?: string(min 1, ≤3000) }` |  |
| GET | `/api/admin/metrics` |  |  |  |
<!-- GENERATED:endpoints:end -->

## 20. Enum reference

- `product`: `wedding_invite | save_the_date | birthday | bridesmaid`
- `serviceMode`: `self_serve | studio`
- `productionStage`: `order_received | brief_received | in_queue | designing | review | delivered`
- `attendance`: `yes | no | pending` (public submit takes `yes | no` only)
- invitee `status`: `not_sent | sent | opened | responded | bounced | opted_out`
- order `status`: `draft | pending_payment | paid | canceled | refunded`
- member `role`: `owner | cohost | viewer`; user `role`: `host | staff | admin`
- dietary tags: `gluten_free | lactose_free | vegetarian | vegan | nut | fruit | other`
- block sections: `our_story, timeline, pre_wedding, menu, dress_code, accommodation, transport, activities, gift_list, photos, countdown, faq`, plus custom blocks. Send `custom:<Display Name>` (1–60 chars) in a selection. The server stores it as `custom:<slug>` (e.g. `custom:Our Pets` → `custom:our-pets`) and keeps the display name in `brief.customBlockNames`. Read and write content with the slug key. Core sections that are always present: `hero, invitation_text, venue, rsvp`
