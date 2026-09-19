# InstantRCcard — direct Node website

A blue-and-white Node website for secure RC front-and-back downloads.

> Final package note: this source was reconciled against the latest GitHub main upload available on 19 September 2026 and the newer deployed KPI, user-rate and admin build. The latest email+mobile login and simplified logout controls are retained; the newer admin functionality is not discarded.

## Included

- Installable PWA from Chrome/Android browser without Play Store
- Email + mobile + password signup/login (dono details required; SMS/OTP nahi)
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
- Admin **Users & rates** tab: naam/mobile/email search, per-user RC Card rate, bulk rate apply, block/unblock and CSV export
- Per-user RC rate audit log (purana rate → naya rate, kaun admin ne badla)
- Service worker update notice so a new deploy is never stuck behind an old cached page
- Server-side RC provider token
- JSON storage as a local fallback/cache
- Optional Google Sheet mirror for accounts, wallet/RC transactions and ads

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
- `POST /api/rc/purchase`
- `POST /api/admin/users/search`
- `GET /api/admin/users?q=name|mobile|email` (user list + rate summary + rate log)
- `POST /api/admin/users/set-rate` (per-user RC Card rate set/clear)
- `POST /api/admin/users/bulk-rate` (sabhi users par ek rate, `confirm: true` zaroori)
- `POST /api/admin/users/status` (account block/unblock)
- `POST /api/admin/recharge`
- `GET /api/admin/transactions`
- `GET /api/admin/ads`
- `POST /api/admin/ads`
- `POST /api/admin/ads/:id` to show/hide
- `DELETE /api/admin/ads/:id`

## User-wise RC rate (admin)

Admin panel me **Users & rates** tab kholo (top nav ke **User rates** button se bhi seedha khulta hai):

1. Search box me user ka naam, mobile ya email daalo (ya **Show all**).
2. User row ke `RC RATE ₹` box me naya rate likho aur **Set rate** dabao.
3. **Default** button us user ka custom rate hata deta hai aur global default rate wapas lag jaata hai.
4. Ek hi rate sabhi users par lagane ke liye **Sabhi users par apply karo** use karo — button dobara click karne par hi confirm hota hai, aur admin account chhoot jaata hai.
5. `Block` / `Unblock` se account disable/enable hota hai; blocked user login nahi kar sakta.
6. **CSV download** current list (rate ke saath) export karta hai.

Rate change hone par us user ke download popup, wallet alert aur account panel me wahi rate dikhta hai, aur wallet se wahi amount deduct hota hai. Har change audit log me time, admin aur purana/naya rate ke saath record hota hai. Global default rate **Admin KPI dashboard → Default RC Card rate** se set karo; custom rate wale users par default ka asar nahi padta.

## Storage and production

The direct version stores users, transactions and local ad data in `data/instant-rccard.json`. On a host without a persistent disk, configure the private Apps Script mirror and deploy the updated `apps-script/Code.gs`; the Node service restores accounts, wallets, transactions and ads from the private Sheet snapshot on startup. Keep `SESSION_SECRET` fixed in Render so an existing session cookie remains valid across restarts.

Set `ADMIN_MOBILE` before creating the admin account. The account created with that mobile number receives the admin role. Set `SHEET_WEBHOOK_URL` to the Apps Script `/exec` URL and use the same `SHEET_SYNC_SECRET` in Node and Apps Script. If the provider token has been shared publicly, rotate it before production use.
