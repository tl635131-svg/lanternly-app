"""Capture every screen at desktop (1280) and mobile (390) into ./screenshots.

Needs the API (localhost:4000) and the web dev server (localhost:3000) running with
the local demo seed. Run: python3 scripts/screenshots.py [only-substring]
Demo credentials are the local dev seed accounts from app/api/README.md.
"""
import asyncio, os, re, sys
from playwright.async_api import async_playwright

BASE = os.environ.get("WEB_URL", "http://localhost:3000")
OUT = os.path.join(os.path.dirname(__file__), "..", "screenshots")
PW = os.environ["DEMO_PASSWORD"]  # dev seed password (SEED_DEMO_PASSWORD); never hardcode it
STUDIO = "fce4537a-2bf4-421e-b1a2-bcdbe2015e28"
DIY = "e11648c2-5af9-4fe7-9145-476469e8dc25"
HOST, SELF = "host@example.com", "diy@example.com"
# Studio console screens need a staff/admin session. Sign in as admin@example.com in a browser or with
# curl (-c jar), then pass the cookie jar: ADMIN_COOKIE_JAR=/path/to/jar. Without it they're skipped.
ADMIN = "admin"
ADMIN_JAR = os.environ.get("ADMIN_COOKIE_JAR")
# N-39 pay-dialog screens need a QA test event whose link was renamed (unpaid, self-serve) and its owner's session:
# N39_EVENT=<event id> N39_COOKIE_JAR=/path/to/jar. Without them they're skipped.
N39 = "n39"
N39_EVENT = os.environ.get("N39_EVENT", "")
N39_JAR = os.environ.get("N39_COOKIE_JAR")

# (name, path, login, action)
SCREENS = [
    ("01-home", "/", None, None),
    ("02-pricing", "/pricing", None, None),
    ("03-start-wizard", "/start?plan=experience", None, None),
    ("04-login", "/login", None, None),
    ("05-set-password-invalid-link", "/auth/not-a-real-token-123", None, None),
    ("06-checkout-success-unverified", "/checkout/success?session_id=cs_unknown", None, None),
    ("07-unsubscribe", "/unsubscribe?token=invalid", None, None),
    ("08-not-found", "/this-page-does-not-exist", None, None),
    ("10-dashboard-events", "/app", HOST, None),
    ("11-overview-studio", f"/app/{STUDIO}", HOST, None),
    ("12-overview-self-serve", f"/app/{DIY}", SELF, None),
    ("13-editor-self-serve", f"/app/{DIY}/invitation", SELF, None),
    ("14-editor-publish-checkout", f"/app/{DIY}/invitation", SELF, "publish"),
    ("15-studio-invitation", f"/app/{STUDIO}/invitation", HOST, None),
    ("16-guests", f"/app/{STUDIO}/guests", HOST, None),
    ("17-guest-share-qr", f"/app/{STUDIO}/guests", HOST, "share"),
    ("18-replies", f"/app/{STUDIO}/replies", HOST, None),
    ("19-seating", f"/app/{STUDIO}/seating", HOST, None),
    ("20-settings", f"/app/{STUDIO}/settings", HOST, None),
    ("21-brief", f"/app/{STUDIO}/brief", HOST, None),
    ("22-revisions", f"/app/{STUDIO}/revisions", HOST, None),
    ("30-invite-opening", "/i/maya-and-theo?g=demoVanceFamily0001", None, None),
    ("31-invite-personal-link", "/i/maya-and-theo?g=demoVanceFamily0001", None, "open"),
    ("32-invite-general-link-rsvp", "/i/maya-and-theo", None, "open"),
    ("33-rsvp-confirmation", "/i/demo-meadow", None, "rsvp"),
    ("34-invite-not-found", "/i/no-such-couple", None, None),
    ("35-invite-french", "/i/maya-and-theo?lang=fr", None, "open"),
    ("36-seating-suggest-preview", f"/app/{STUDIO}/seating", HOST, "click:Suggest seats"),
    # Phase 5: draft vs live, languages, own song, custom link, add-ons, new-draft wizard
    ("23-new-invitation-style", "/app", SELF, "steps:click:New invitation"),
    ("24-new-invitation-extras", "/app", SELF, "steps:click:New invitation|click:Continue"),
    ("25-new-invitation-languages", "/app", SELF, "steps:click:New invitation|click:Continue|click:Continue"),
    ("37-editor-languages-gifts", f"/app/{DIY}/invitation", SELF, "steps:tab:Content"),
    ("38-editor-music-own-song", f"/app/{DIY}/invitation", SELF, "steps:tab:Music"),
    ("39-editor-link", f"/app/{DIY}/invitation", SELF, "steps:tab:Link"),
    ("26-studio-add-extras", f"/app/{STUDIO}/invitation", HOST, "steps:click:Add extras"),
    ("40-admin-pipeline", "/admin", ADMIN, None),
    ("41-admin-pipeline-list", "/admin", ADMIN, "click:List"),
    ("42-admin-event-overview", f"/admin/events/{STUDIO}", ADMIN, None),
    ("43-admin-event-brief", f"/admin/events/{STUDIO}", ADMIN, "click:Brief"),
    ("44-admin-event-revisions", f"/admin/events/{STUDIO}", ADMIN, "click:Revisions"),
    ("45-admin-event-invitation", f"/admin/events/{STUDIO}", ADMIN, "click:Invitation"),
    ("46-admin-orders", "/admin/orders", ADMIN, None),
    ("47-admin-checkout-drafts", "/admin/orders", ADMIN, "click:Checkout drafts"),
    ("48-admin-catalogue-styles", "/admin/catalogue", ADMIN, None),
    ("49-admin-catalogue-music", "/admin/catalogue", ADMIN, "click:Music"),
    ("50-admin-catalogue-reviews", "/admin/catalogue", ADMIN, "click:Reviews"),
    ("51-admin-team", "/admin/team", ADMIN, None),
    ("52-admin-emails", "/admin/messages", ADMIN, None),
    ("53-admin-manual-order", "/admin", ADMIN, "click:Manual order"),
    ("54-admin-blocked-for-hosts", "/admin", HOST, None),
    # QA test events (created during the round-3 recheck): refund confirm, and a refunded order whose reason is raw HTML
    ("55-admin-refund-dialog", "/admin/events/c7e64f3a-e2f7-4eca-b447-5ef2b942b249", ADMIN, "steps:text:Orders|text:ORD-2026-01035|click:Refund"),
    ("56-admin-refunded-html-reason", "/admin/events/bbc9b864-d7e9-4d3f-a4df-3af92b1893d0", ADMIN, "steps:text:Orders|text:ORD-2026-01036"),
    # N-39: Custom link locked after a reload (customLinkLocked), and the review step when the server's order differs.
    # The review screen simulates an older API (no customLinkLocked/previousSlugs), so the box can be unticked; the
    # real checkout then answers 422 and nothing is created.
    ("60-pay-dialog-custom-link-locked-after-reload", f"/app/{N39_EVENT}/invitation", N39, "publish"),
    ("60-pay-dialog-review-new-total", f"/app/{N39_EVENT}/invitation", N39, "n39review"),
]


async def scroll_all(pg):
    h = await pg.evaluate("document.body.scrollHeight")
    for y in range(0, h + 400, 400):
        await pg.evaluate(f"window.scrollTo(0,{y})")
        await pg.wait_for_timeout(50)
    await pg.evaluate("window.scrollTo(0,0)")
    await pg.wait_for_timeout(700)


STATES: dict = {}


def admin_cookies(jar=None):
    out = []
    for line in open(jar or ADMIN_JAR):
        parts = line.strip().split("\t")
        if len(parts) == 7 and parts[5] in ("sid", "csrf_token"):
            out.append({"name": parts[5], "value": parts[6], "url": BASE})
    return out


async def login_once(browser, email):
    """Sign in once per account (the API rate-limits logins) and reuse the cookies."""
    if email == ADMIN:
        STATES[ADMIN] = admin_cookies()
        return
    if email == N39:
        STATES[N39] = admin_cookies(N39_JAR)
        return
    ctx = await browser.new_context()
    r = await ctx.request.post(f"{BASE}/api/auth/login", data={"email": email, "password": PW})
    assert r.ok, f"login failed for {email}: {r.status}"
    STATES[email] = await ctx.cookies()
    await ctx.close()


async def shoot(browser, name, path, login, action, width):
    ctx = await browser.new_context(viewport={"width": width, "height": 844 if width < 600 else 900},
                                    device_scale_factor=1, is_mobile=width < 600, has_touch=width < 600)
    if login:
        await ctx.add_cookies(STATES[login])
    pg = await ctx.new_page()
    # Screenshots must not write data: the guest "opened" ping is answered locally instead of reaching the API.
    await pg.route("**/api/public/invitations/*/open", lambda r: r.fulfill(status=204, body=""))
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    if action == "n39review":
        async def strip(route):
            resp = await route.fetch()
            d = await resp.json()
            d.pop("customLinkLocked", None)
            d.pop("previousSlugs", None)
            await route.fulfill(response=resp, json=d)
        await pg.route(re.compile(r".*/api/events/[^/]+/invitation$"), strip)
    await pg.goto(BASE + path, wait_until="networkidle")
    await pg.wait_for_timeout(1200)
    if await pg.locator("iframe").count():  # invitation preview iframe: let it hydrate and fade in
        await pg.wait_for_timeout(5000)
    full = True
    if action in ("open", "rsvp"):
        await pg.get_by_role("button", name=re.compile(r"^(Open invitation|Ouvrir l.invitation)$")).click()
        await pg.wait_for_timeout(2600)
        await scroll_all(pg)
    if action == "rsvp":
        rs = pg.locator("#s-rsvp")
        await rs.scroll_into_view_if_needed()
        await rs.get_by_label("Your full name").fill("Robin Example")
        await rs.get_by_role("radio", name="Joyfully, yes").click()
        email = rs.get_by_label("Email")
        if await email.count():
            await email.first.fill("robin@example.com")
        meals = rs.locator("[role=radiogroup][aria-labelledby] [role=radio]")
        if await meals.count():
            await meals.first.click()
        await rs.locator("button[type=submit]").click()
        await pg.wait_for_timeout(1500)
        await rs.scroll_into_view_if_needed()
        full = False
    if action == "publish":
        await pg.get_by_role("button", name="Publish").first.click()
        await pg.wait_for_timeout(1200)
        full = False
    if action == "n39review":
        await pg.get_by_role("button", name="Publish").first.click()
        await pg.wait_for_timeout(2500)
        dlg = pg.get_by_role("dialog")
        await dlg.locator("#extra-custom_link").uncheck()
        await pg.wait_for_timeout(2000)
        await dlg.get_by_text("I accept the terms of service").click()
        await dlg.get_by_text("I accept the privacy policy").click()
        await dlg.get_by_role("button", name=re.compile("^Continue to payment")).click()
        await dlg.locator("[role=status]").wait_for(timeout=15000)
        await pg.wait_for_timeout(800)
        full = False
    if action == "share":
        await pg.get_by_role("button", name="Share").first.click()
        await pg.wait_for_timeout(1200)
        full = False
    if action and action.startswith("steps:"):
        for st in action[6:].split("|"):
            kind, label = st.split(":", 1)
            if kind == "tab":
                loc = pg.get_by_role("radio", name=label, exact=True).or_(pg.get_by_role("tab", name=label, exact=True))
            elif kind == "text":  # partial name, any of button/radio/tab (e.g. "Orders 1", an order number)
                loc = pg.get_by_role("radio", name=label).or_(pg.get_by_role("tab", name=label)).or_(pg.get_by_role("button", name=label))
            else:
                loc = pg.get_by_role("button", name=label, exact=True)
            await loc.last.click() if kind == "click" and label == "Continue" else await loc.first.click()
            await pg.wait_for_timeout(1300)
        full = not any(x in action for x in ("New invitation", "Add extras", "ORD-"))
    if action and action.startswith("click:"):
        await pg.get_by_role("button", name=action[6:], exact=True).or_(pg.get_by_role("radio", name=action[6:], exact=True)).or_(pg.get_by_role("tab", name=action[6:], exact=True)).first.click()
        await pg.wait_for_timeout(1500)
        full = "Manual order" not in action
    if action is None and not path.startswith("/i/"):
        await scroll_all(pg)
    if await pg.locator("iframe").count():  # Chromium paints iframes blank in full-page captures; use the viewport
        await pg.evaluate("window.scrollTo(0,0)")
        await pg.wait_for_timeout(800)
        full = False
    out = os.path.join(OUT, f"{name}--{'desktop' if width >= 600 else 'mobile'}.png")
    await pg.screenshot(path=out, full_page=full)
    await ctx.close()
    return out, errors


async def main():
    only = sys.argv[1] if len(sys.argv) > 1 else ""
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for email in {s[2] for s in SCREENS if s[2] and (s[2] != ADMIN or ADMIN_JAR) and (s[2] != N39 or (N39_JAR and N39_EVENT)) and (not only or any(any(o in x[0] for o in only.split(","))  for x in SCREENS if x[2] == s[2]))}:
            await login_once(browser, email)
        for name, path, login, action in SCREENS:
            if only and not any(o in name for o in only.split(",")):
                continue
            if login == ADMIN and not ADMIN_JAR:
                print("skip", name, "(set ADMIN_COOKIE_JAR for studio console screens)")
                continue
            if login == N39 and not (N39_JAR and N39_EVENT):
                print("skip", name, "(set N39_EVENT and N39_COOKIE_JAR)")
                continue
            for w in (1280, 390):
                try:
                    out, errs = await shoot(browser, name, path, login, action, w)
                    print("ok ", os.path.relpath(out), ("ERR " + "; ".join(errs[:3])) if errs else "")
                except Exception as e:  # keep going so one failure doesn't stop the run
                    print("FAIL", name, w, str(e).splitlines()[0])
        await browser.close()

asyncio.run(main())
