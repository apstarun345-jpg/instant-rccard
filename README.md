# InstantRCcard — direct Node website

A blue-and-white Node website for secure RC front-and-back downloads.

## Same final package for Railway or Render

`InstantRCcard-Railway-Render-Final.zip` is platform-neutral and can be deployed unchanged on either Railway or Render. Both platforms use the same commands:

```text
Build command: npm install
Start command: npm start
Health check:  GET /api/health
Node runtime: 20+
```

The server reads the platform-provided `PORT`, binds to `0.0.0.0`, and does not require Railway- or Render-specific code. Set the same environment variables from `.env.example` on whichever platform you choose. Configure the private Google Sheet mirror with `SHEET_WEBHOOK_URL` and `SHEET_SYNC_SECRET` so users, wallets, transactions, settings and admin data survive restarts. For Render, use an always-on plan if eliminating free-tier sleep is required; Railway and Render both still need the same durable Sheet configuration.

See `DEPLOY_RAILWAY_RENDER.md` inside the final ZIP for step-by-step deployment settings.

> Final package note: this source was reconciled against the latest GitHub main upload available on 19 September 2026 and the newer deployed KPI, user-rate and admin build. The latest email/mobile login option, welcome flow and user-menu/logout controls are retained; the newer admin functionality is not discarded.

## Included

- Installable PWA from Chrome/Android browser without Play Store
- Username/name, email ya mobile number + password login; signup me email + mobile required (SMS/OTP nahi); logged-in dashboard greeting shows `Hello, <username>`
- Forgot password with email + mobile verification, new password and confirmation show/hide controls
- Cookie-based login that survives browser refreshes
- Durable Google Sheet account restore after Render restarts/redeploys when the Sheet mirror is configured
- Separate wallet per mobile number
- `MParivahan RC`: marked **Coming Soon!** in the customer flow; the future price is ₹10
- `RC Card`: ₹15, selected from the Download RC options and downloaded as a clear PDF in the attached A4/reference layout with front and back faces side by side
- Charge is deducted only after both front and back RC images are available
- RC purchase uses server-side retry/cache plus a browser/server idempotency key, so a slow response or safe retry does not double-charge the wallet
- Google Sheet sync is kept in a background retry outbox after the local durable mutation, so a slow Sheet cannot turn a completed RC charge into a false error response
- Provider image normalization for base64, data-URL, URL, PNG, JPG and WEBP responses
- `Fetching RC Card` loading popup while the provider image is being fetched
- Horizontal public offer/festival advertisement ticker
- Admin-only user search, wallet recharge and advertisement upload/remove/hide controls
- Separate delegated **Admin access** management: existing users can be made admin or removed with granular KPI, recharge, rates, ads, transactions and access permissions
- Permission-aware admin tabs and server-side permission gates so delegated admins only see and use assigned capabilities
- Clear `Main Admin` versus `Admin Assistant` labels; Main Admin sees all-platform data, while assistant KPI/transactions are scoped to that assistant's own attributed activity
- Sticky `Hello, <name>` dashboard greeting that stays visible during scrolling
- KPI admin activity cards for today, current month, last month, all-time and selected date ranges, showing users paid and total amount per admin
- Frozen `Hello, <name>` robot greeting with independent animation plus WhatsApp/email help choices
- Admin **Users & rates** tab: naam/mobile/email search, per-user RC Card rate, bulk rate apply, block/unblock and CSV export
- Per-user RC rate audit log (purana rate → naya rate, kaun admin ne badla)
- Custom user rates remain preserved through admin-access changes, default-rate changes, wallet/status updates and Google Sheet restore
- Main Admin can configure the WhatsApp support number and payment QR from the settings panel; wallet/help links use the configured number
- Android installed-PWA wallet flow tries `whatsapp://send` first, detects whether WhatsApp opened, then falls back to the configured HTTPS `wa.me` link; the hidden durable top-up request remains idempotent with amount, mobile and payment reference
- In-app notification history, unread state and toast alerts for users and permitted admins, plus background Web Push for every separately subscribed Android/laptop device when VAPID keys are configured
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
- `GET /api/notifications/public-key`
- `GET /api/notifications`
- `POST /api/notifications/subscribe`
- `POST /api/notifications/unsubscribe`
- `POST /api/notifications/read`
- `GET /api/account/transactions`
- `GET /api/ads`
- `GET /api/public/stats`
- `POST /api/rc/purchase`
- `POST /api/admin/users/search`
- `GET /api/admin/users?q=name|mobile|email` (user list + rate summary + rate log)
- `POST /api/admin/users/set-rate` (per-user RC Card rate set/clear)
- `POST /api/admin/users/bulk-rate` (sabhi users par ek rate, `confirm: true` zaroori)
- `POST /api/admin/users/status` (account block/unblock)
- `GET /api/admin/users/access?q=name|mobile|email` (delegated admin access search)
- `POST /api/admin/users/access` (make/remove admin and save selected permissions)
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

## Wallet payment requests

User wallet modal me pehle amount enter karta hai, phir payment QR aur exact amount dekhkar **Payment done - send to WhatsApp** choose karta hai. Android installed PWA pehle native WhatsApp deep link try karta hai aur app unavailable hone par configured HTTPS `wa.me` fallback use karta hai. Hidden form server par stable `PENDING` request ID aur client payment reference banata/preserve karta hai; same user ke duplicate clicks ek hi pending request ko re-sync karte hain. WhatsApp text me request ID, payment reference, amount, user mobile, payment instructions aur public QR link hota hai.

Wallet Control me Main Admin aur sirf `recharge` permission wale Assistant Admin ko **RC wallet payment requests** queue milti hai. Approve se pehle credited amount edit kiya ja sakta hai; approval request ko ek hi baar `APPROVED` karta hai, exact edited amount ka ek `RECHARGE` transaction append karta hai aur user wallet update karta hai. Reject wallet ko credit nahi karta. Request status, wallet, user aur transaction Google Sheet mirror me persist hote hain. Google Sheet display IDs compact hain: users `u1`, `u2` aur transactions `T1`, `T2`; original internal UUIDs safe restore ke liye internal columns me retained hain.

## Notifications

Background delivery is opt-in per installed app/device. Generate a VAPID pair with `npx web-push generate-vapid-keys`, configure `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and `WEB_PUSH_SUBJECT` on Railway/Render, then have each phone/laptop account open the account menu and choose **Enable notifications**. The server stores notification history in the durable local/Sheet-backed state and sends Web Push to every saved subscription for that recipient. Admin delivery is filtered by the same `kpi`, `recharge` and `transactions` permission scopes used by the admin UI. In-app polling/toasts still work without VAPID keys while the app is open; background OS delivery is not active until keys are configured and the device subscription is accepted.

If both Render and Railway are kept live, they are still separate Node instances. Set the same `CROSS_DEPLOY_SYNC_SECRET` on both and set `CROSS_DEPLOY_PRIMARY_URL` only on Render to the Railway URL. Render top-up requests are then forwarded to Railway's request list and permitted recharge-admin notifications; use one deployment for approval to avoid duplicate processing. Each PWA origin needs its own notification permission/subscription.

## Storage and production

For production, treat the private Google Sheet mirror as the durable source of truth. The Render filesystem and `data/instant-rccard.json` are only a local cache/fallback and must not be the only store on an ephemeral host. Deploy the current `apps-script/Code.gs`, run `setupInstantRCcard` once, and configure the same `SHEET_WEBHOOK_URL` and `SHEET_SYNC_SECRET` in the Node service. The Node server restores accounts, password hashes, wallets, transactions, ads, support/QR settings, global pricing, delegated admin permissions, the rate audit ledger and wallet payment requests from the Sheet snapshot at startup. The Apps Script snapshot safely imports older `Users` and `Transactions` rows into the Web mirror before restore, so creating a new account cannot replace the old account/history set. Wallet requests use stable IDs and a PENDING/APPROVED/REJECTED state; approval is locked, credits exactly once, appends one RECHARGE transaction, and mirrors the request, user and transaction before returning success. Critical writes wait for the Sheet mirror before returning success, so an immediate process replacement cannot acknowledge a change before it is durably recorded. The rate ledger also recovers custom rates if an older account row has a blank rate column.

After deployment, `GET /api/health` must report `sheetSyncConfigured: true`, `storage: "json+google-sheet"` and `durableStore: "google-sheet-mirror"`. Never upload or package `data/instant-rccard.json`. Keep `SESSION_SECRET` fixed in Render so an existing session cookie remains valid across restarts.

Set `ADMIN_MOBILE` before creating the admin account. The account created with that mobile number receives the owner admin role and cannot be changed through delegated access management. Set `APP_TIME_ZONE=Asia/Kolkata` (or another IANA zone) for Today/current month/last month KPI boundaries. If the provider token has been shared publicly, rotate it before production use.

### Render cold starts

Render Free services sleep after inactivity and show Render's service-waking screen while the container starts. Frontend JavaScript cannot remove that platform-level wait. For a no-sleep production service, use an always-on Render instance/paid plan (recommended) or move the Node service to an always-on host. A scheduled external health check can reduce, but cannot guarantee against, cold starts and is not a replacement for an always-on plan. The app-level startup fallback prevents an additional indefinite wait after the service is running; it cannot make a sleeping free instance wake instantly.
