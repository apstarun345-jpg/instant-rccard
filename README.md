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

## Agent Performance Report (`/report`)

A separate live dashboard built from the Google Sheet **REPORT** tab (FASTag agent / TL performance). It does not touch the RC Card flow.

- URL: `/report` (also `/report.html`)
- Data: the public Google Sheet is read live — sheet update → website update (no manual import). The sheet must stay shared as **Anyone with the link – Viewer**.
- Flow: browser asks `GET /api/report` (server fetches the sheet CSV and caches it for `REPORT_CACHE_SECONDS`, default 180). If the server cannot reach Google, the browser fetches the sheet directly as a fallback.
- Views: Overview (KPIs, 7-day chart, top agents/TLs, status & stock-alert distribution), Agents table (search, filters, sort, pagination, CSV export, agent detail drawer), TL Summary (TL-level stock/issuance/alerts, TL drawer with its agents), Alerts (dispatch needed, over-stocked, de-growth, went quiet, wrong VRN), WhatsApp summary button.
- Column labels: sections are detected from the sheet's merged headers. A few sheet columns have no sub-header (I, J, K, L, M, AB, AD–AH, BR); name them in `LABEL_OVERRIDES` at the top of `report.js`.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `REPORT_SHEET_ID` | the REPORT sheet | Google Sheet ID |
| `REPORT_SHEET_GID` | `242489821` | Tab (gid) to read |
| `REPORT_CACHE_SECONDS` | `180` | Server-side cache for the sheet CSV |
| `REPORT_FIXTURE_FILE` | – | Local CSV file instead of Google (testing only) |
| `ALLOW_FRAME_EMBED` | – | Set `1` only for iframe previews; removes `X-Frame-Options` |

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

## API routes

- `GET /api/health`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/account/transactions`
- `GET /api/ads`
- `GET /api/public/stats`
- `GET /api/report` (cached Google Sheet CSV for the `/report` dashboard; `?refresh=1` bypasses the cache)
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
