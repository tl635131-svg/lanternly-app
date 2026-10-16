# Front-end handoff for QA recheck

Written Fri Oct 16, 2026, 1:30 PM ET. Next.js 16.4.2 web app at `app/web`, dev on http://localhost:3000. It talks to the API on :4000 through the same-origin `/api` proxy.

## Run state at handoff
- `npx tsc --noEmit`: clean. `npx eslint .`: clean. `next build` (production): passes.
- Dev server on :3000 is up. The API on :4000 is healthy.
- Screenshots: `app/web/screenshots/`, named `NN-name--desktop.png` (1280 px) and `NN-name--mobile.png` (390 px). Regenerate with `DEMO_PASSWORD=… ADMIN_COOKIE_JAR=/path/to/admin.jar python3 scripts/screenshots.py [filter,filter]`. The script no longer has a hard-coded password; it reads `DEMO_PASSWORD`.

## Demo logins (dev seed)
Passwords come from `SEED_ADMIN_PASSWORD` / `SEED_DEMO_PASSWORD` in `api/.env` (not repeated here). You can also sign in with a magic link from `/login`; in dev, the link is printed in the API log.

| Login | Role | Use it for |
|---|---|---|
| `admin@example.com` | admin | Studio console `/admin`, manual orders, refunds |
| `designer@example.com` | staff | Console without admin-only actions (refund is hidden; API returns 403) |
| `host@example.com` | host (studio, Couture) | Studio event `fce4537a-2bf4-421e-b1a2-bcdbe2015e28`: guests, seating, studio invitation, add-ons |
| `partner@example.com` | host (co-host) | Same studio event |
| `diy@example.com` | host (self-serve diy) | Self-serve event `e11648c2-5af9-4fe7-9145-476469e8dc25`: editor, publish, wizard |
| (no login) | guest | `/i/maya-and-theo`, `/i/maya-and-theo?g=demoVanceFamily0001`, `/i/demo-meadow` |

## Checks run for this handoff
- **Headers on dev :3000:** `curl -I localhost:3000/` returns:
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`
  - CSP `script-src 'self' 'nonce-…' 'strict-dynamic' 'unsafe-eval'` (eval in dev only), `frame-ancestors 'none'`, `object-src 'none'`
  - No `X-Powered-By`.
- **Headers on production (`next build` + `next start` on :3197):**
  - CSP `script-src 'self' 'nonce-…' 'strict-dynamic'`: no `unsafe-inline` or `unsafe-eval` for scripts.
  - `upgrade-insecure-requests`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
  - Every `<script>` carries the per-request nonce, and the page loads and hydrates.
  - `style-src` keeps `'unsafe-inline'` because of React `style` attributes.
- **npm audit:** `npm audit --omit=dev` finds 0 vulnerabilities. Full `npm audit` finds 5 high, all one dev-only chain: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces` (GHSA-vfj7-8cjw-p6xm, `<=3.0.3`). There is no patched `braces`; 3.0.3 is the latest. npm's only "fix" is downgrading `eslint-config-next` to 14.2.35, which breaks with Next 16, so I didn't apply it.
- **Old-slug redirect:** `curl -o /dev/null -w '%{http_code} %{redirect_url}' 'localhost:3000/i/qa-fe-old-11214?g=abc&lang=fr'` gives `308 http://localhost:3000/i/qa-fe-new-7429?g=abc&lang=fr`. The production server gives the same.
- **Real 404:** `/i/does-not-exist` returns HTTP 404.

## QA items

| Item | Status | Where / how to verify | Screenshot |
|---|---|---|---|
| **H-02** Seating auto-arrange preview | Fixed | host@ → `/app/fce4537a…/seating` → **Suggest seats**. A preview banner shows the counts, with **Keep these seats** / **Undo**. Nothing is saved until you keep it (`components/host/seating.tsx`). | `36-seating-suggest-preview` |
| **M-03** Guest UI in French | Fixed | `/i/maya-and-theo?lang=fr`: "Ouvrir l'invitation", section labels, RSVP and gift labels come from typed en/fr dictionaries (`lib/invite-i18n.tsx`). | `35-invite-french` |
| **M-04** Web headers, `poweredByHeader`, CSP nonce | Fixed | `curl -I localhost:3000/` and a production `next start` (see checks above). Static headers live in `next.config.ts` (`poweredByHeader: false`). The per-request nonce CSP lives in `proxy.ts`. `app/layout.tsx` reads `x-nonce`. | none (header check) |
| **M-06** Web npm audit | Partial | Runtime deps are clean (`--omit=dev`: 0). 5 high remain in the dev-only ESLint chain (`braces`), which has no upstream patch (details above). | none |
| **M-07** Studio admin console | Fixed | admin@ → `/admin`: pipeline board/list, event detail (overview, brief, revisions, invitation, orders), orders and checkout drafts, catalogue (styles, music, reviews), team, emails. Role-gated: host@ → `/admin` is blocked. | `40-admin-pipeline`, `41`–`52`, `54-admin-blocked-for-hosts` |
| **M-08** Tap targets | Fixed | At 375 px: nav links, login text buttons, invite links and seating unseat chips all reach ≥44 px (the `.tap-44` hit area or `size-11`). | `19-seating--mobile`, `04-login--mobile` |
| **M-09** Contrast AA | Fixed | Invite colours go through `ensureContrast` (≥4.6:1) in `lib/palette.ts`. Dashboard countdown labels and the footer use AA tokens. The editor shows live contrast readouts. | `30-invite-opening`, `13-editor-self-serve` |
| **L-10** Long names in the phone preview | Fixed | diy@ editor → Content → Names as shown: enter a long string. It wraps and scales (`.inv-names` clamp plus container queries). | `13-editor-self-serve` |
| **L-11** Editor tabs on mobile | Fixed | 375 px editor: short tab labels (Style / Content / Sections / Music / Link), all reachable, with a scroll cue. | `13-editor-self-serve--mobile` |
| **L-20** Near-copied phrases | Fixed (front end) | Seating empty state: "No tables yet. Draw your room, or we'll suggest a layout from your guest list." The revisions phrase was the back end's and is reworded. | `19-seating` (empty state shows only with no tables) |
| L-12 / L-13 / L-14 / L-16 / L-17 / L-18 / L-19 | Fixed in phase 3 | I re-checked L-12 this round (`/i/does-not-exist` → 404). The others were fixed in phase 3 and not re-tested this round. | `34-invite-not-found`, `08-not-found` |
| L-21 codename | Not done (out of scope) | Left alone as instructed. | none |
| **N-25** Old-slug redirect | Fixed (308 kept, per the final ruling) | Server-side `permanentRedirect` in `app/i/[slug]/page.tsx` → 308 to the current slug, keeping `?g=` / `?lang=` / `?preview=`. Verified with curl above. | `39-editor-link` (shows previous links) |
| **N-28** (FE side) Add-ons checkout units vs languages | Fixed | The add-ons dialog sends the unit count computed from `languages`. On 402 `ADDON_PAYMENT_REQUIRED` or 422 `INVALID_SELECTION` with `details.missing`, it rebuilds the cart and retries once. An empty cart after trimming (400) is handled (`components/host/addons.tsx`). Pay-to-publish uses `missing` too. | `26-studio-add-extras`, `14-editor-publish-checkout` |
| **N-30** (FE side) Admin create over the language cap | Fixed | Manual order form: languages over the plan cap no longer block. The server adds the units to the order, and the success message plus the order show the added line. A 402/422 shows the shortfall next to Languages. | `53-admin-manual-order` |
| **N-31** (FE side) Manual orders trim units | Fixed | After create, the form reads the order's `extra_language` qty and reports it. If you type 6 for 4 languages on Std, you see "You entered 6; charged for 3 Extra language units, which is all the languages need." | `53-admin-manual-order` |
| **Admin `{code, qty}`** | Fixed | `lib/admin.ts` `adminExtras()` (`ADMIN_EXTRAS_AS_OBJECTS = true`) sends `extras: [{code:"extra_language", qty:n}, {code, qty:1}…]`. Verified live: qty 6 for 4 languages on Std → order line qty 3. | `53-admin-manual-order` |
| **Admin refund UI, escaped reasons** | Fixed | admin@ → event → Orders → a manual paid order → **Refund** (admin only, manual orders only). Reason is required (max 500). Sends `x-csrf`. Handles 403 / 409 / 404. Afterwards the order shows Refunded and the event's add-ons refresh. The reason is read from the event audit trail (`order.manual_refunded`) and rendered as a React text node only; there is no `dangerouslySetInnerHTML` or markdown anywhere in the admin console. The test order ORD-2026-01036 has the reason `<script>alert(1)</script><b>QA html reason</b>`, shown literally. | `55-admin-refund-dialog`, `56-admin-refunded-html-reason` |

## Phase 5 product-decision UI

| Decision | Status | Where / how to verify | Screenshot |
|---|---|---|---|
| Own song: upload with "I have the rights to use this music" tick | Fixed | diy@ editor → Music. The tick sends `rightsConfirmed` on upload and `musicRightsConfirmed` on save. 400 `RIGHTS_CONFIRMATION_REQUIRED` shows inline. 403 `FEATURE_DISABLED` hides the upload controls. 402 opens the add-ons path. | `38-editor-music-own-song` |
| Language limits (diy 2 / Signature 3 / Couture 5, CA$20 per extra; prices from the catalogue) | Fixed | Editor → Content → Languages shows "1 / 2". Adding over the cap auto-adds `extra_language` (the response `selectedExtras` is read back and the added units/price shown). Removing languages reflects what the API returns. After payment, 402 routes to the add-ons checkout. | `37-editor-languages-gifts`, `25-new-invitation-languages` |
| Published invite edits go to a draft; "Publish changes" / "Discard draft" | Fixed | Editor header chips: Live / Draft / Unpublished changes. Draft preview, Publish changes, and Discard draft (with confirmation). The subtitle explains that style/content/sections/music save to the draft, while event details, reply form and link save instantly ("Saved instantly" vs "Draft · goes live when you publish" tags). | `13-editor-self-serve`, `37-editor-languages-gifts` |
| Gifts: Interac email, institution (3) / transit (5) / account (7–12), IBAN + BIC optional; message optional; display only | Fixed | Editor → Sections → add Gifts. Fields show by mode, with client validation. 422 `GIFT_PAYOUT_REQUIRED` shows on the payout group and 422 `GIFT_REGISTRY_URL_REQUIRED` on registries. Only whitelisted fields are sent. Guests see the message and details only, with no payment buttons or amounts. | `30`/`31` invite (seed gifts); no dedicated editor screenshot (gap) |
| `reminder_pack` removed | Fixed | No UI reference. It's kept only in `RETIRED_EXTRAS` (`lib/types.ts`) so stale selections are filtered out. | none |
| diy wizard: Style → Extras → Languages → Details → Review; pay dialog includes add-ons | Fixed | diy@ → `/app` → **New invitation**. A live server quote is shown. Create sends `extras`, and PATCH sends `selectedExtras`. The publish/pay dialog lists the selected add-ons with locked minimums for those in use. | `23`/`24`/`25-new-invitation-*`, `14-editor-publish-checkout` |
| Custom link (CA$19, all plans, included in Couture): slug editor | Fixed | Editor → Link: live validation (3–60, a–z 0–9 and hyphens, reserved words). Uses the server-normalised `slug` from the PATCH response. 409 means taken; 402 offers the add-on. Previous links are listed and keep working (308). Also shown on studio events. | `39-editor-link`, `15-studio-invitation` |
| Add-ons after payment (`POST /api/checkout/addons`) | Fixed | Studio host → Invitation → **Add extras**, or the overview "Add extras". Uses an Idempotency-Key. Handles 409 `PLAN_NOT_PAID` and `CONFLICT`. Redirects to the returned `url`. Checkout success has an add-ons message. | `26-studio-add-extras` |
| Legacy fields no longer sent (`product`, `rating`, `info.letter`, illustration/video covers) | Fixed | Covers are glow/photo/none only; old illustration/video configs are mapped to glow on load. Reviews show "Sample review" with no rating. | `48-admin-catalogue-styles`, `50-admin-catalogue-reviews` |
| Gift "cash" mode is display only | Fixed | No amounts or pay buttons on the guest page. | `31-invite-personal-link` |

## Tamil script font
- Noto Sans Tamil (SIL OFL 1.1, from google/fonts `ofl/notosanstamil`) is self-hosted at `public/fonts/NotoSansTamil-tamil.woff2`. It's a variable font (wght 100–900), with width pinned to 100, subset to the Tamil block, and 49 KB.
- The licence is at `public/fonts/NotoSansTamil-OFL.txt`.
- `@font-face` has `unicode-range: U+0B80-0BFF`, so it's only downloaded when a page shows Tamil. I checked this: `/pricing` makes no request, and adding Tamil text loads it from 'self' with no CSP errors.
- The font is defined in `theme/brand.ts` (`scriptFonts`), and `theme/css.ts` (`fontStack`, invite tokens) puts it in every stack right after the primary font, before the system fonts. For example, `"Manrope","Noto Sans Tamil",ui-sans-serif,…`, and the same after the display fonts.
- The Tamil language chip (தமிழ்) renders correctly in `37` and `53`.

## QA round 4 (front end)
Checks after these changes: `tsc --noEmit` clean, `eslint .` clean, production build OK (built into `.next-build`, then tsconfig.json restored and `.next-build` removed). :3000 stayed up.

| Item | Status | What changed / how verified | Screenshots |
|---|---|---|---|
| **N-32** pay-to-publish quote (HIGH) | Fixed | `components/host/editor.tsx` PayDialog: the quote and session always send `eventId` plus `themeKey` (the invitation's saved theme). Any add-ons the server reports in `details.missing` are added and locked. After a rename, Custom link shows as locked ("Your link was changed to /i/…"). If the event has no theme, the 422 shows "Choose a design first." with a **Go to Style** button that opens the theme tab, and Continue is disabled. **E2E check on :4000:** fresh DIY event created via admin (no email) → no theme: notice shown → picked Citrus, renamed the link → quote CA$118 with custom link locked; request body had `eventId` + `themeKey: "citrus"` → mock checkout paid (ORD-2026-01042, CA$133.34, `purchasedExtras: ["custom_link"]`) → Publish → v1, public page 200 → unpublished and soft-deleted (public link 404). | `57-pay-dialog-no-design`, `58-pay-dialog-quote-locked-link` |
| **N-33** preview iframe blocked | Fixed | `proxy.ts`: `frame-src 'self' https://www.google.com https://maps.google.com`. On `/i` and `/i/*` only: `frame-ancestors 'self'` + `X-Frame-Options: SAMEORIGIN`. Everywhere else: `frame-ancestors 'none'` + `DENY` (`next.config.ts` only sets DENY on non-`/i` paths). Nonce/strict-dynamic script-src unchanged. Checked the production headers for `/`, `/admin` (DENY/'none') and `/i/maya-and-theo` (SAMEORIGIN/'self'). Studio preview renders with no CSP errors. | `15-studio-invitation` |
| **N-34** staff see Orders/Team | Fixed | `components/admin/shell.tsx`: Orders and Team are admin-only. Staff who open those URLs directly get an "Admins only" block that links back to the pipeline. Checked with designer@: nav shows Pipeline, Catalogue, Emails only. | `59-admin-staff-admins-only` |
| **N-35** guest tap targets ≥44px | Fixed (guest pages only) | `app/invite.css`: ghost buttons (Add to calendar, Directions), RSVP inline pills, FAQ rows, EN/FR switch, floating buttons, stepper, credit link. Also the skip link (`app/layout.tsx`). Measured 0 interactive targets under 44px on `/i/*`, including with the RSVP form expanded. Studio/admin left at ≥24px as ruled. | `30`, `31`, `32` |
| **N-36** sideways scroll at 375px | Fixed | Grid items get `min-w-0` / `minmax(0,1fr)` (home hosts grid, admin event detail grids, admin metrics). Stat figures use clamped font sizes (`app/ds.css`). `<main>` on home uses `overflow-x-clip`. scrollWidth = 375 on `/`, `/admin` and the admin event tabs. | `01`, `40`, `41`, `42`, `43` (mobile) |
| **N-37** small UI bugs | Fixed | (a) Duplicate "(optional)" removed (registry row label). (b) The Gifts accordion is now controlled: errors force it open and it stays open once they're fixed. (c) The Dialog primitive ignores close/cancel events bubbling from a nested dialog, so a refund closes only the refund dialog. (d) **Invites sent** = invitees with `sentAt` (falls back to the manual count, labelled "counted by you"). (e) **Waiting** has one definition in `lib/reply-counts.ts` (sent households with no reply + unlinked pending guests), used by the overview, the Replies summary tile and the Waiting tab (studio demo: 4/4/4). | `11`, `14`, `18`, `55`, `56` |
| **N-38** Latin font licences | Fixed | OFL files added to `public/fonts/`: Bricolage Grotesque, DM Sans, Fraunces, Inter, Manrope, Instrument Serif (from google/fonts, no Reserved Font Names). Sources are listed in `public/fonts/README.txt`. | — |
| **L-15** mock checkout page | Not ours | Left to the back end, untouched. | — |

Notes for round 4:
- ~~Backend gap: GET invitation lacked `previousSlugs`~~. Resolved by the back end; see N-39 below.
- ~~"100% replied" alongside Waiting > 0~~. Resolved; see N-40 below.
- The screenshot script stubs the guest `/open` ping, so retakes don't write to the DB. Pages with an iframe are captured at viewport size, because Chromium paints iframes blank in full-page captures.
- **Test data left from the N-32 E2E:** order ORD-2026-01042 and customer `qa-fe-r4-1792173326@example.com` (the event `bc9f7375…` was unpublished and soft-deleted).

## N-39 / N-40 (front end, after round 4)
Checks: `tsc --noEmit` clean, `eslint .` clean, production build OK. It was built into a separate `.next-n39` (QA's `.next-build` wasn't touched), then tsconfig.json was restored and `.next-n39` removed. :3000 stayed up; :4000 and :3197 weren't touched.

| Item | Status | What changed / how verified | Screenshots |
|---|---|---|---|
| **N-39** pay dialog: Custom link unlocked after a reload; checkout total higher than quoted | Fixed | **Lock after reload:** the pay dialog locks Custom link when the invitation has `customLinkLocked` (or any `previousSlugs`). Both `previousSlugs` shapes are handled: GET gives `{oldSlug, createdAt}`, the slug PATCH gives strings (`slugHistory()` in `lib/types.ts`). Previous links (with dates) are shown on the editor Link card and the studio admin Invitation tab. **No silent changes at checkout:** the dialog no longer re-adds required add-ons on its own and redirects. If `POST /api/checkout/session` answers 422 `missing`, or answers 200 with `extras`/`subtotalCents`/`currency` that differ from what was quoted, the dialog stays open and shows the server's line items and new subtotal ("Plus tax at payment."). The added items are locked, and a plain note explains why ("Your link was already changed to /i/…, so Custom link stays included." or the generic "We updated your total because some items are required. Please review before paying."). The button becomes **Confirm and pay · total**. Nothing redirects until it's clicked. The notice is `role="status"` + `aria-live="polite"` and gets focus. Button height is 44px. Continue is also disabled while the quote is out of date. **Verified against the live :4000 with mock checkout, nothing paid:** fresh unpaid DIY event → Citrus → renamed link → reload → Custom link ticked and locked ("Your link was changed to /i/qa-fe-n39-92bf61"). Simulated older API (`customLinkLocked`/`previousSlugs` stripped in the browser) → untick → quote CA$99 → Continue → real session 422 → dialog shows CA$99 → CA$118 with Custom link locked, focus on the notice, URL unchanged → Confirm → mock checkout showing ORD-2026-01047, Self-serve CA$99 + Custom link CA$19 = CA$118. Simulated stale quote (browser stub under-prices to CA$99) → real session returned CA$118 → review shown from the server's lines → Confirm went to the held checkout (ORD-2026-01048, CA$118) with no second session. | `60-pay-dialog-custom-link-locked-after-reload`, `60-pay-dialog-review-new-total` |
| **N-40** reply rate vs Waiting | Fixed | `lib/reply-counts.ts` `replySummary()` uses the new stats fields: `invited`, `replied`, `waiting`, `generalLinkReplies`, and `responseRate` (null without a guest list). It falls back to the guest list on older APIs. Host overview "Replies" tile: "63% of 8 invited · +2 via general link". Replies page rate card: "5 of 8 on your guest list replied" plus "+2 replies via the general link (not in the rate)". The Waiting tile, the Waiting tab and the overview all use `waiting`. With no guest list: "—" and "No guest list yet" instead of a percentage. `pct()` renders null as "—". The Waiting tab lists guest-list households with no reply; reply forms marked waiting that aren't on the guest list are listed under their own heading and aren't counted. **Studio demo:** 63% replied, Waiting 3 on the overview, summary tile and tab (no more "100% replied" with Waiting 4). DIY demo: "No guest list yet". | `11-overview-studio`, `12-overview-self-serve`, `18-replies` |

Notes:
- The review step depends on the back end returning `extras`/`lines`/`subtotalCents` from `POST /api/checkout/session` (live). On an older API that returns only `subtotalCents`, the dialog still compares the subtotal. With neither, it relies on the 422 `missing` path.
- `60-pay-dialog-review-new-total` simulates an older API in the browser (fields stripped), because with the live lock the box can't be unticked. The real checkout answers 422 and creates nothing. Screens 60-* need `N39_EVENT` and `N39_COOKIE_JAR`, a renamed, unpaid self-serve test event and its owner's session; they're skipped otherwise.
- The previous-links lists (editor Link card, admin Invitation tab) have no screenshot. Neither demo invitation has a renamed link, and renaming one would change the demo data. To check by hand: rename a test event's link, then open Invitation → Link.
- **Test data:** event `92bf61d7…` ("Nia & Oto", `qa-fe-n39-1792176153@example.com`) was soft-deleted (old link 404). Its three unpaid mock orders ORD-2026-01046/01047/01048 (`pending_payment`) remain as history. Nothing was paid.

## Known gaps / notes
1. **M-06:** 5 high in the dev-only ESLint toolchain (`braces`, no upstream fix). Runtime is clean.
2. **Missing screenshots:** none of the Gifts editor section, the "Unpublished changes" state on a live invite, or the manual-order success message (the success message shows briefly). Verify these by hand using the steps above.
3. **No audit-log view:** the admin console has no standalone audit-log screen. The refund reason is the only audit text shown (in the order dialog), and it's plain text. The host overview activity feed shows only RSVP names/attendance.
4. **`/i/does-not-exist`:** the 404 page uses the default site title (cosmetic).
5. **QA test data in the dev DB, created during this round:**
   - Events "Ana & Bo" (`c7e64f3a…`, now published at `/i/qa-fe-new-7429`, with old slugs `qa-fe-old-11214` and `ana-bo-97fy`) and `bbc9b864…` (its order ORD-2026-01036 is refunded with an HTML reason).
   - Customers `qa-units-*@example.com`.
   - No emails were sent (`sendAccessEmail: false`).
   - Earlier QA rounds' "Adm & …" events crowd the pipeline board in `40`.
6. **L-21 codename:** left alone as instructed.
