# InstantRCcard — Railway or Render deployment

Use the same `InstantRCcard-Railway-Render-Final.zip` package on either platform. There is no platform-specific application code.

## Required service settings

- Runtime: Node.js 20 or newer
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`
- Do not set a fixed `PORT`; Railway or Render supplies it automatically.
- The server already binds to `0.0.0.0`.

## Required environment variables

Set these in the platform dashboard. Do not commit them to Git or put them in a public ZIP:

```text
RC_API_URL=https://api.apnirc.xyz/api/b2b/get-rc
RC_API_TOKEN=your-private-provider-token
ADMIN_MOBILE=your-owner-mobile
SESSION_SECRET=one-long-fixed-random-secret
SHEET_WEBHOOK_URL=your-private-Apps-Script-exec-url
SHEET_SYNC_SECRET=the-same-private-sheet-secret
APP_TIME_ZONE=Asia/Kolkata
SUPPORT_WHATSAPP=your-support-mobile
```

`SHEET_WEBHOOK_URL` and `SHEET_SYNC_SECRET` are required for durable production storage. The local JSON file is only a fallback/cache and must not be the only source of truth. The updated Apps Script performs a one-time-safe recovery migration from older `Users` and `Transactions` sheets into `Web_Accounts`, `Web_Users` and `Web_Transactions`, so do not create duplicate accounts while recovering.

## Notifications

The app includes notification polling, in-app alerts and background Web Push for installed Android/laptop apps. Generate VAPID keys once with `npx web-push generate-vapid-keys`, then set these Railway/Render variables:

```text
WEB_PUSH_VAPID_PUBLIC_KEY=...
WEB_PUSH_VAPID_PRIVATE_KEY=...
WEB_PUSH_SUBJECT=mailto:your-admin-email@example.com
```

Each admin/user must open the installed app on each device, open the account menu and tap **Enable notifications** once. Main Admin and Assistant Admins receive events allowed by their permissions: new user, top-up request and RC download/recharge activity. A user receives their own wallet-credit and RC-download alerts. Without VAPID keys, in-app polling alerts still work while the app is open, but background OS notifications cannot be delivered.

## Running Render and Railway together

Two Node deployments do not share live in-memory state. Google Sheet is the durable mirror and is normally loaded at startup, so a request created on Render will not automatically appear in an already-running Railway admin list. For one-way Render-to-Railway top-up replication, add the same private `CROSS_DEPLOY_SYNC_SECRET` to both services and add this only to Render:

```text
CROSS_DEPLOY_PRIMARY_URL=https://your-railway-domain.up.railway.app
CROSS_DEPLOY_SYNC_SECRET=the-same-private-random-secret-on-both
```

Railway needs only:

```text
CROSS_DEPLOY_SYNC_SECRET=the-same-private-random-secret-on-both
```

After redeploying both services, a Render top-up request is forwarded to Railway, upserted into Railway's admin request list, and a Railway-side admin notification is created for every permitted recharge admin. Each origin still needs its own device notification permission/subscription. This is one-way replication; use one canonical admin approval service and do not approve the same request on both deployments.

## Railway

1. Create a new Railway service from the extracted package or its Git repository.
2. Confirm the service uses `npm install` and `npm start`.
3. Add the environment variables above in **Variables**.
4. Generate a public domain.
5. Open `/api/health` and confirm:
   - `sheetSyncConfigured: true`
   - `storage: "json+google-sheet"`
   - `durableStore: "google-sheet-mirror"`
   - `build: "wallet-direct-v8-cross-sync-fast"`
   - `webPushConfigured: true` after the three Web Push variables are saved (it is intentionally false until then)
   - Render: `crossDeployPrimaryConfigured: true` and `crossDeploySyncConfigured: true`
   - Railway primary: `crossDeploySyncConfigured: true` (primary URL can remain false)

## Render

1. Create a **Web Service** from the extracted package or its Git repository.
2. Runtime: **Node**.
3. Build command: `npm install`.
4. Start command: `npm start`.
5. Add the environment variables above.
6. Add `/api/health` as the health-check path if the dashboard exposes that setting.
7. For a no-sleep production service, choose an always-on paid Render instance. Render Free can sleep after inactivity; application code cannot remove that platform-level sleep.

## Recovery order for existing users and history

1. **Do not create more accounts yet.** First make a copy/backup of the current Google Sheet. Do not delete the old `Users` or `Transactions` tabs.
2. Deploy the matching `apps-script/Code.gs` as the private Apps Script Web App, run `setupInstantRCcard` once, and update the existing Web App deployment to the new version using the same `/exec` URL.
3. The migration imports old `Users` and `Transactions` rows into `Web_Accounts`, `Web_Users` and `Web_Transactions`, preserving wallets, password hashes, user roles and RC transaction history. It is safe to run more than once.
4. Deploy the Node package to Railway or Render with the same `SHEET_WEBHOOK_URL`, `SHEET_SYNC_SECRET`, `SESSION_SECRET`, `ADMIN_MOBILE` and provider token.
5. Restart the Node service. It waits for the Sheet snapshot before listening, so old users and transactions are loaded before anyone can create another account.
6. Open `/api/health` and confirm `restore.status` is `success`, then check `restore.users`, `restore.transactions` and `restore.rcDownloads`. `sheetAccounts` and `sheetTransactions` show how many records came from the Sheet.
7. Test one old user by mobile/name/password, then check the Admin KPI users and RC-download details before allowing new signups.

The mirror uses compact display IDs (`u1`, `u2`, `T1`, `T2`) and preserves internal UUIDs in separate columns.

## Security

Rotate any provider, Sheet or session credentials that were ever exposed. Never upload or package `data/instant-rccard.json`.
