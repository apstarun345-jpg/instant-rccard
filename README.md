# InstantRCcard — direct Node website

A blue-and-white Node website for secure RC front-and-back downloads.

## Included

- Mobile + password accounts
- Cookie-based login that survives browser refreshes
- Separate wallet per mobile number
- `MParivahan RC`: ₹10, A4 page PNG with front above back, matching the attached A4 reference
- `RC Card`: ₹15, compact output with two standard card-size faces stacked front above back, without an A4 canvas
- Charge is deducted only after both front and back RC images are available
- Automatic download after the selected format is chosen
- Installable PWA from Chrome or Android browser
- Admin-only user search and wallet recharge
- Server-side RC provider token
- JSON storage for a small single-instance deployment
- Optional Google Sheet mirror for accounts and wallet/RC transactions

## Run locally

Node.js 20+ is recommended.

```bash
cp .env.example .env
# Edit .env and set RC_API_TOKEN and ADMIN_MOBILE.
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
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /api/account/transactions`
- `POST /api/rc/purchase`
- `POST /api/admin/users/search`
- `POST /api/admin/recharge`
- `GET /api/admin/transactions`

## Storage and production

The direct version stores users and transactions in `data/instant-rccard.json`. Keep the `data` directory on a persistent disk when deploying. For a high-traffic/public service, replace the JSON store with PostgreSQL/MySQL, add rate limiting, email/SMS verification, HTTPS, backups and a privacy notice.

Set `ADMIN_MOBILE` before creating the admin account. The account created with that mobile number receives the admin role. To mirror data into Google Sheets, set `SHEET_WEBHOOK_URL` to the Apps Script `/exec` URL and use the same `SHEET_SYNC_SECRET` in the Node environment and Apps Script Script Properties. If the provider token has been shared publicly, rotate it before production use.
