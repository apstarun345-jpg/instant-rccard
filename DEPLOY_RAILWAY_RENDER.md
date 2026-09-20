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

## Railway

1. Create a new Railway service from the extracted package or its Git repository.
2. Confirm the service uses `npm install` and `npm start`.
3. Add the environment variables above in **Variables**.
4. Generate a public domain.
5. Open `/api/health` and confirm:
   - `sheetSyncConfigured: true`
   - `storage: "json+google-sheet"`
   - `durableStore: "google-sheet-mirror"`

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
6. Test one old user by mobile/name/password, then check the Admin KPI users and RC-download details before allowing new signups.

The mirror uses compact display IDs (`u1`, `u2`, `T1`, `T2`) and preserves internal UUIDs in separate columns.

## Security

Rotate any provider, Sheet or session credentials that were ever exposed. Never upload or package `data/instant-rccard.json`.
