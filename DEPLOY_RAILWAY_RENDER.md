# InstantRCcard v9 — free Railway primary + Render proxy deployment

The recommended no-extra-database setup keeps both URLs active, but only Railway writes live data:

```text
Render static frontend + same-origin /api proxy
                 ↓
Railway Node API + persistent SQLite primary
                 ↓
Google Sheet asynchronous mirror/backup
```

This avoids duplicate users, wallet races, KPI divergence and cross-deployment write conflicts. The older `CROSS_DEPLOY_*` replication route remains for legacy deployments but is not needed in proxy mode.

## Common service settings

- Runtime: Node.js 20 or newer
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`
- Do not set a fixed `PORT`; Railway or Render supplies it automatically.
- The server binds to `0.0.0.0`.
- Deploy the current `apps-script/Code.gs` and run `setupInstantRCcard` once.

## Railway primary variables

Set these only in the Railway primary service. Never put secret values into frontend code or a public repository.

```text
RC_API_URL=https://api.apnirc.xyz/api/b2b/get-rc
RC_API_TOKEN=your-private-provider-token
ADMIN_MOBILE=your-owner-mobile
SESSION_SECRET=one-long-fixed-random-secret
APP_TIME_ZONE=Asia/Kolkata

FREE_MODE=true
DB_BACKEND=sqlite
DATA_DIR=./data
SQLITE_FILE=./data/instant-rccard.db

SHEET_WEBHOOK_URL=your-private-Apps-Script-exec-url
SHEET_SYNC_SECRET=the-same-private-sheet-secret
SHEET_SYNC_BLOCKING=false

SUPPORT_WHATSAPP=your-support-mobile
WEB_PUSH_VAPID_PUBLIC_KEY=...
WEB_PUSH_VAPID_PRIVATE_KEY=...
WEB_PUSH_SUBJECT=mailto:your-admin-email@example.com
```

### Free Railway storage

The free setup does not require a Railway volume or a separate PostgreSQL service. Local SQLite is the fast runtime store and Google Sheet is the durable restart/recovery mirror. Keep `SHEET_WEBHOOK_URL` and `SHEET_SYNC_SECRET` configured; without them, a free-plan restart can lose data that exists only in the local filesystem.

The free service uses WAL/full synchronous SQLite while it is running. Google Sheet sync is asynchronous by default so user, RC and admin responses stay fast. A sudden platform kill can still happen before a background Sheet request completes. If you prefer a smaller loss window over speed, set `SHEET_SYNC_BLOCKING=true`, but Google Sheet latency will be visible in critical writes.

### Optional stronger upgrade

If a persistent Railway volume is available, mount it at `/data`, change `DATA_DIR=/data` and `SQLITE_FILE=/data/instant-rccard.db`, and keep the Railway primary at one running instance. This changes health from `durableStore: google-sheet-recovery` to `durableStore: sqlite-primary`. For multiple replicas or higher traffic, use shared PostgreSQL instead of separate SQLite files.

## Render proxy variables

Render serves the packaged static frontend and forwards every `/api/*` request to Railway. Set:

```text
PRIMARY_API_URL=https://instant-rccard-production-cc47.up.railway.app
PROXY_TO_PRIMARY=true
```

Render does not need its own provider token, Sheet secret or database for proxy mode. The browser sees the Render origin, while Render forwards the session cookie, request body and API response to Railway. Therefore Render users, admin approvals, KPI cards, wallet changes, settings, ads, transactions and notifications all use the same Railway data.

Do not set these in proxy mode:

```text
CROSS_DEPLOY_PRIMARY_URL=
CROSS_DEPLOY_SYNC_SECRET=
```

Those variables are only for the old one-way replication mode where both services independently process requests. Do not mix the two modes.

## Apps Script mirror

The current Apps Script keeps these Web mirror tabs:

```text
Web_Accounts
Web_Users
Web_Transactions
Web_TopupRequests
Web_Settings
Web_Ads
Web_RateLog
Web_Notifications
Web_PushSubscriptions
```

Google Sheet sync is asynchronous by default. Railway commits to SQLite first, sends the user response, then syncs the changed row in the background. Startup reconciliation retries all local categories; RC and pending top-up rows also have targeted retry handling. Keep `SHEET_SYNC_BLOCKING=false` for fast free responses; set it to true only when you accept slower writes in exchange for waiting on the Sheet mirror.

## Health verification

After Railway deploys, open:

```text
https://instant-rccard-production-cc47.up.railway.app/api/health
```

Expected important fields:

```text
build: wallet-direct-v9-single-primary-sqlite
freeMode: true
storage: sqlite+google-sheet
durableStore: google-sheet-recovery
storageReady: true
sheetSyncConfigured: true
proxyToPrimary: false
```

After Render deploys, open its `/api/health`. In proxy mode it should show Railway's health response because the request is forwarded to the primary.

If `storage` reports `json` or `durableStore` reports `local-json-only`, stop and check `DB_BACKEND`, `DATA_DIR`, `SQLITE_FILE` and the Railway volume before allowing wallet activity.

## Existing-data migration and recovery

1. Back up the current Google Sheet. Do not delete old `Users` or `Transactions` tabs.
2. Deploy the current Apps Script and run `setupInstantRCcard` once.
3. On the first v9 Railway start, if SQLite is empty, the app restores the Web mirror snapshot.
4. If a v8 JSON file is present at the configured legacy path, v9 migrates it once into SQLite and keeps the JSON untouched as an emergency fallback.
5. Do not create duplicate users during this step. Verify the existing user by mobile/name/password.
6. Confirm `/api/health` restore counts and check the Railway admin panel.
7. Configure Render proxy mode only after Railway primary health is green.
8. Test one login, one top-up request, one admin approval, one KPI refresh and one safe repeated RC purchase.

The app uses compact display IDs (`u1`, `u2`, `T1`, `T2`) while preserving internal UUIDs for safe idempotency and restore.

## Notifications

Generate a VAPID pair with:

```bash
npx web-push generate-vapid-keys
```

Configure the three Web Push variables on Railway. Users/admins must enable notifications from the origin they actually use. A Render-origin subscription is forwarded through Render and stored by Railway; a Railway-origin subscription is a separate browser origin. For simple operations, choose one canonical app URL and have users install/enable notifications there.

## Security and operations

- Keep `SESSION_SECRET` fixed on Railway across every restart.
- Rotate provider, Sheet, VAPID and internal secrets if exposed.
- Keep the Google Sheet private.
- Never package `.env`, `data/instant-rccard.json`, `.db`, `.sqlite` or a backup containing passwords.
- Use an always-on Render plan if Render must not sleep. App code cannot remove platform-level free-tier cold starts.
- For higher traffic or multiple independent writers, use one shared PostgreSQL primary instead of separate SQLite files.
