# InstantRCcard — Railway-only primary release

Railway-only package for `https://instantrccard.in/`. Railway is the single canonical JSON writer and Google Sheet mirror. Render proxy and legacy cross-deployment targets are hard-disabled.

## Deploy

```text
Runtime: Node.js 20+
Build: npm install
Start: npm start
Health: GET /api/health
Build: wallet-direct-v8-railway-primary
```

Required Railway variables: `RC_API_URL`, `RC_API_TOKEN`, `ADMIN_MOBILE`, fixed `SESSION_SECRET`, `SHEET_WEBHOOK_URL`, `SHEET_SYNC_SECRET` and `APP_TIME_ZONE=Asia/Kolkata`. Remove or leave blank `PRIMARY_API_URL`, `PROXY_TO_PRIMARY`, `CROSS_DEPLOY_PRIMARY_URL` and `CROSS_DEPLOY_SYNC_SECRET`.

Deploy `apps-script/Code.gs` and `apps-script/Index.html` privately, run `setupInstantRCcard` once, then use its `/exec` URL and matching secret in Railway. Production storage is JSON plus Google Sheet mirror; SQL and SQLite are not used.

## Instant, detailed wallet sync

Admin Recharge and Debit persist the user/admin balances and transaction rows first. User and admin in-app notifications are persisted before the response. Google Sheet writes continue in the background with retries so a slow Sheet cannot delay the wallet response. User balance/history polls every second, notifications poll every 1.5 seconds, and admin live history refreshes every 2 seconds. All API reads use no-store cache headers.

User history now shows the balance after each wallet change and who added/debited it. Admin history shows transaction time, From/User name and mobile, To/Admin name and mobile, type, amount, balance after, direction, note/reference, and both debit and matching admin-credit rows. The admin transaction Refresh button forces a fresh server request and shows a refresh result.

The Admin Wallet control is split into styled Recharge Wallet and Debit Wallet cards. Recharge adds to the selected user. Debit subtracts from the selected user, credits the executing admin, and rejects negative/self/insufficient cases.

## Ten-row pagination everywhere

Wallet history, RC wallet payment requests, Users and RC Card rates, recent rate changes, delegated-admin user lists, KPI detail lists, and user/admin transaction tabs are loaded in server-side pages of exactly 10 records. Each relevant view always shows numbered page buttons, Previous, Next, current-page status, and ellipsis behavior for large histories, including a disabled one-page state. CSV export fetches all user pages without changing the visible ten-row table.

Wallet recharge/debit/credit rows remain in the Wallet transactions tab; RC rows remain separate in RC downloads. Startup uses the supplied animated logo splash, v21 PWA icons, and the cache-busted `instant-rccard-shell-v23` service-worker shell. Google Sheet mirror columns preserve source/target names and mobiles for wallet transactions.

Expected health: `build=wallet-direct-v8-railway-primary`, `proxyToPrimary=false`, `primaryApiConfigured=false`, `storage=json+google-sheet`, `durableStore=google-sheet-mirror`, `restore.status=success`.

No production data, secrets, `.env`, `node_modules`, SQL/SQLite files or `storage.js` are included.
