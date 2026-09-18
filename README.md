# InstantRCcard — direct Node website

A clean, blue-and-white direct website with:

- Mobile + password accounts
- Cookie-based login that survives browser refreshes
- Separate wallet per mobile number
- ₹15 charge only after front and back RC images are available
- Automatic vertical front-over-back PNG download
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

## API routes

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

Set `ADMIN_MOBILE` before creating the admin account. The account created with that mobile number receives the admin role. To mirror data into Google Sheets, set `SHEET_WEBHOOK_URL` to the Apps Script `/exec` URL and use the same `SHEET_SYNC_SECRET` in the Node `.env` and Apps Script Script Properties. If the provider token has been shared publicly, rotate it before production use.
