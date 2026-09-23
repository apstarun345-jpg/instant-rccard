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

## Admin control center: selected user wallet history

Inside **Admin control center**, the sidebar now has a clearly visible **User wallet history** option. It opens the protected selected-user wallet ledger panel directly. An admin can enter a user's mobile number, email or exact name and view that user's complete wallet ledger. Search by name returns a result only when the name is unambiguous; otherwise the UI asks for the mobile or email.

The summary shows wallet entry count, total credited, total debited including RC charges, current balance, net movement, RC spend and RC count. The detailed ten-row table shows exact time, transaction type/direction, From name/mobile, To name/mobile, signed amount, balance after, status, note and transaction ID. It includes successful wallet credits/debits and RC purchase charges, so the admin sees the complete balance movement. Numbered pagination, Previous, Next and ellipsis controls remain visible.

The Admin Access panel has a separate **User wallet history** permission. Main Admin always has it. Admin Assistants only see and can use this selected-user history panel when the Main Admin/authorized access manager checks this permission. The server enforces the permission on both search and history APIs; assistants without it receive 403 and cannot read another user's wallet ledger.

## User wallet and RC history

The logged-in user dashboard has a visible **My wallet & RC history** card with three options: **Wallet history**, **My RC downloads**, and **All activity**. The card summary shows total RC downloads, unique vehicle numbers, total RC spend and wallet movement.

Every user wallet row shows exact date/time, credit or debit amount, balance after the transaction, source/destination context, status, note/reference and transaction ID. Every user RC row shows the vehicle registration number, exact date/time, RC format, charged amount, balance after, status, note and transaction ID. New RC purchases persist `downloadType`; older records are inferred safely from their existing note/vehicle data.

## Instant wallet sync

Admin Recharge and Debit persist the user/admin balances and transaction rows first. User and admin in-app notifications are persisted before the response. Google Sheet writes continue in the background with retries so a slow Sheet cannot delay the wallet response. User balance/history polls every second, notifications poll every 1.5 seconds, and admin live history refreshes every 2 seconds. All API reads use no-store cache headers.

Admin platform history shows transaction time, From/User name and mobile, To/Admin name and mobile, type, amount, balance after, direction, note/reference, and both debit and matching admin-credit rows. The admin transaction Refresh button forces a fresh server request and shows a refresh result.

The Admin Wallet control is split into styled Recharge Wallet and Debit Wallet cards. Recharge adds to the selected user. Debit subtracts from the selected user, credits the executing admin, and rejects negative/self/insufficient cases.

## Ten-row pagination everywhere

Selected-user wallet history, user wallet history, RC wallet payment requests, Users and RC Card rates, recent rate changes, delegated-admin user lists, KPI detail lists, and user/admin transaction tabs are loaded in server-side pages of exactly 10 records. Each relevant view always shows numbered page buttons, Previous, Next, current-page status, and ellipsis behavior for large histories, including a disabled one-page state.

Wallet recharge/debit/credit rows remain in the Wallet transactions tab; RC rows remain separate in the platform RC downloads tab. Startup uses the supplied animated logo splash, v21 PWA icons, and the cache-busted `instant-rccard-shell-v24` service-worker shell. Google Sheet mirror columns preserve source/target names and mobiles plus RC download format.

Expected health: `build=wallet-direct-v8-railway-primary`, `proxyToPrimary=false`, `storage=json+google-sheet`, `durableStore=google-sheet-mirror`, `restore.status=success`.

No production data, secrets, `.env`, `node_modules`, SQL/SQLite files or `storage.js` are included.
