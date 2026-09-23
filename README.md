# InstantRCcard — direct Node website

A blue-and-white Node website for secure RC front-and-back downloads.

## Included

- Installable PWA from Chrome/Android browser without Play Store
- Email + mobile + password signup/login
- Forgot password with email + mobile verification, new password and confirmation show/hide controls
- Cookie-based login that survives browser refreshes
- Durable Google Sheet account restore after Render restarts/redeploys when the Sheet mirror is configured
- Separate wallet per mobile number
- `MParivahan RC`: marked **Coming Soon!** in the customer flow; the future price is ₹10
- `RC Card`: ₹15, compact output with two standard card-size faces stacked front above back, without an A4 canvas
- Charge is deducted only after both front and back RC images are available
- Provider image normalization for base64, data-URL, URL, PNG, JPG and WEBP responses
- `Fetching RC Card` loading popup while the provider image is being fetched
- Horizontal public offer/festival advertisement ticker
- Admin-only user search, wallet recharge and advertisement upload/remove/hide controls
- Server-side RC provider token
- JSON storage as a local fallback/cache
- Optional Google Sheet mirror for accounts, wallet/RC transactions and ads
- Search-engine ready: `/sitemap.xml`, `/robots.txt`, canonical + Open Graph tags, JSON-LD structured data, public "how it works" + FAQ section and Google/Bing site-verification support (see [SEO / Google Search Console](#seo--google-search-console))

## Run locally

Node.js 20+ is recommended.

```bash
cp .env.example .env
# Edit .env and set RC_API_TOKEN, ADMIN_MOBILE and a fixed SESSION_SECRET.
npm start
```

Open:

```text
http://localhost:4173
```

The browser should use the website through the Node server. Do not double-click `public/index.html`; a static file has no secure backend and cannot handle accounts, wallet deduction or the provider token.

## Install as an app

Open the HTTPS website in Chrome. Use the install icon in the address bar or choose **Install InstantRCcard** from the browser menu. On iPhone/iPad, use **Share → Add to Home Screen**. The site includes a manifest, app icons and service worker.

## SEO / Google Search Console

The server generates everything a search engine needs; nothing has to be edited by hand when the domain changes.

| URL | Purpose |
| --- | --- |
| `/sitemap.xml` | Sitemap built from the `PUBLIC_PAGES` list in `server.js` (`lastmod` = last deploy of `index.html`) |
| `/robots.txt` | Allows all crawlers, blocks `/api/`, points to the sitemap |
| `/` | `index.html` is served with an injected `<link rel="canonical">`, `og:url`, `og:image`, optional verification meta tags and JSON-LD (`Organization`, `WebSite`, `WebApplication`) at the `<!--SEO_HEAD-->` marker |
| `/og-image.png` | 1200×630 preview image used by Google, WhatsApp, Facebook and X link previews |

Environment variables:

| Variable | Required | Description |
| --- | --- | --- |
| `SITE_URL` | Recommended | Canonical origin, e.g. `https://www.instantrccard.com`. When empty the origin is derived from the request (`X-Forwarded-Proto` / `Host`), which works on Render out of the box. Set it once you use a custom domain so the `*.onrender.com` copy canonicalises to the real domain. |
| `GOOGLE_SITE_VERIFICATION` | Optional | Content value of the Search Console "HTML tag" method. Rendered as `<meta name="google-site-verification">`. |
| `BING_SITE_VERIFICATION` | Optional | Content value for Bing Webmaster Tools (`msvalidate.01`). |

Alternatively, drop the `googleXXXX.html` verification file from Search Console into the repository root; static files are served from there automatically.

Submit the site (step-by-step Hinglish guide in [GOOGLE-SEARCH-SETUP.md](GOOGLE-SEARCH-SETUP.md)):

1. Deploy, then open `https://<your-domain>/sitemap.xml` and `https://<your-domain>/robots.txt` to confirm both respond.
2. Go to <https://search.google.com/search-console>, add a **URL prefix** property with the exact `https://` domain and verify it (meta tag via `GOOGLE_SITE_VERIFICATION`, or the HTML file, or DNS).
3. **Sitemaps → Add a new sitemap →** enter `sitemap.xml` → Submit.
4. **URL Inspection →** paste the homepage URL → **Request indexing**.
5. Add a new entry to `PUBLIC_PAGES` whenever a new public page is added; the sitemap updates automatically.

## API routes

- `GET /sitemap.xml`
- `GET /robots.txt`
- `GET /api/health`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/account/transactions`
- `GET /api/ads`
- `GET /api/public/stats`
- `POST /api/rc/purchase`
- `POST /api/admin/users/search`
- `POST /api/admin/recharge`
- `GET /api/admin/transactions`
- `GET /api/admin/ads`
- `POST /api/admin/ads`
- `POST /api/admin/ads/:id` to show/hide
- `DELETE /api/admin/ads/:id`

## Storage and production

The direct version stores users, transactions and local ad data in `data/instant-rccard.json`. On a host without a persistent disk, configure the private Apps Script mirror and deploy the updated `apps-script/Code.gs`; the Node service restores accounts, wallets, transactions and ads from the private Sheet snapshot on startup. Keep `SESSION_SECRET` fixed in Render so an existing session cookie remains valid across restarts.

Set `ADMIN_MOBILE` before creating the admin account. The account created with that mobile number receives the admin role. Set `SHEET_WEBHOOK_URL` to the Apps Script `/exec` URL and use the same `SHEET_SYNC_SECRET` in Node and Apps Script. If the provider token has been shared publicly, rotate it before production use.
