# InstantRCcard — Railway-only primary release

This archive is for the Railway service only. Railway is the single canonical application, JSON writer and Google Sheet mirror for `https://instantrccard.in/`. No Render proxy configuration is included or required. The Railway-only build disables the legacy secondary-deployment and upstream-proxy targets.

## Deploy on Railway

```text
Runtime: Node.js 20+
Build command: npm install
Start command: npm start
Health check: GET /api/health

Build marker: wallet-direct-v8-railway-primary
```

The server binds to `0.0.0.0` and uses Railway's supplied `PORT`. Deploy the extracted package as a Railway service, attach the custom domain, and configure the variables in `.env.example` through Railway Variables. Do not commit a real `.env`, JSON database, provider token, Sheet secret or VAPID private key.

## Required Railway variables

```text
RC_API_URL=https://api.apnirc.xyz/api/b2b/get-rc
RC_API_TOKEN=your-private-provider-token
ADMIN_MOBILE=your-owner-mobile
SESSION_SECRET=one-long-fixed-random-secret
SHEET_WEBHOOK_URL=your-private-Apps-Script-exec-url
SHEET_SYNC_SECRET=the-private-Sheet-secret
APP_TIME_ZONE=Asia/Kolkata
```

Optional background notification delivery uses `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and `WEB_PUSH_SUBJECT`. In-app notifications work without VAPID keys while the dashboard is open.

Remove or leave blank any old `PRIMARY_API_URL`, `PROXY_TO_PRIMARY`, `CROSS_DEPLOY_PRIMARY_URL` or `CROSS_DEPLOY_SYNC_SECRET` variables. This package hard-disables those secondary-deployment paths.

## Google Sheet recovery and mirror

1. Deploy `apps-script/Code.gs` and `apps-script/Index.html` as the private Apps Script Web App.
2. Run `setupInstantRCcard` once using the existing Sheet.
3. Keep the same `/exec` URL and matching `SHEET_SYNC_SECRET` in Railway.
4. Deploy or restart the Railway service. It restores users, wallets, transactions, RC downloads, ads, settings, rates, notifications and top-up requests before accepting traffic.

Production durability remains JSON plus Google Sheet mirror; SQL, SQLite, paid storage and mandatory persistent volumes are not used. The local JSON file is a cache/fallback only.

## Live updates and notifications

- In-app notification records are written before Google Sheet notification mirroring.
- Web Push delivery begins immediately after notification persistence.
- In-app notification polling runs every 5 seconds.
- User wallet/session/transaction refresh runs every 5 seconds while the dashboard is open.
- Admin KPI and top-up request refresh runs every 5 seconds.
- Wallet recharge, top-up approval/rejection and RC download events are deduplicated by event data where applicable.

## Health check after deployment

Open `https://instantrccard.in/api/health` and confirm: 

```json
{
  "build": "wallet-direct-v8-railway-primary",
  "proxyToPrimary": false,
  "primaryApiConfigured": false,
  "storage": "json+google-sheet",
  "durableStore": "google-sheet-mirror",
  "sheetSyncConfigured": true,
  "restore": { "status": "success" }
}
```

Also confirm the restored user, transaction and RC-download counts match the Sheet before allowing new signups.

## Safety

The archive contains no production data, no secrets, no `.env`, no `node_modules`, no SQL/SQLite files and no `storage.js`. Keep `SESSION_SECRET` fixed across redeploys and rotate any provider, Sheet or VAPID credential that was ever exposed.
