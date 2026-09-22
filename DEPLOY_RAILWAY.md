# Railway-only deployment guide

## 1. Prepare the Google Sheet mirror

- Back up the current Google Sheet.
- Upload `apps-script/Code.gs` and `apps-script/Index.html` to the private Apps Script project.
- Run `setupInstantRCcard` once.
- Deploy the Apps Script as a Web App and keep the `/exec` URL private.

## 2. Create or update the Railway service

Use the extracted package or its repository:

```text
Runtime: Node.js 20+
Build command: npm install
Start command: npm start
Health check path: /api/health
```

Do not set a fixed `PORT`; Railway provides it. The app binds to `0.0.0.0`.

## 3. Set Railway Variables

Required:

```text
RC_API_URL=https://api.apnirc.xyz/api/b2b/get-rc
RC_API_TOKEN=<private provider token>
ADMIN_MOBILE=<owner mobile>
SESSION_SECRET=<fixed random secret>
SHEET_WEBHOOK_URL=<Apps Script /exec URL>
SHEET_SYNC_SECRET=<matching Sheet secret>
APP_TIME_ZONE=Asia/Kolkata
```

Optional:

```text
SUPPORT_WHATSAPP=<support mobile>
PUBLIC_RATING=<fallback rating>
WEB_PUSH_VAPID_PUBLIC_KEY=<public key>
WEB_PUSH_VAPID_PRIVATE_KEY=<private key>
WEB_PUSH_SUBJECT=mailto:admin@example.com
```

Do not configure these legacy secondary-deployment variables on this Railway-only release:

```text
PRIMARY_API_URL=
PROXY_TO_PRIMARY=
CROSS_DEPLOY_PRIMARY_URL=
CROSS_DEPLOY_SYNC_SECRET=
```

The packaged build also hard-disables them, so Railway remains the only writer.

## 4. Deploy and verify

After deployment, open:

```text
https://instantrccard.in/
https://instantrccard.in/api/health
```

Expected health values:

```text
build: wallet-direct-v8-railway-primary
proxyToPrimary: false
primaryApiConfigured: false
storage: json+google-sheet
durableStore: google-sheet-mirror
sheetSyncConfigured: true
restore.status: success
```

Check that `restore.users`, `restore.transactions`, `restore.rcDownloads`, `sheetAccounts` and `sheetTransactions` match the intended Google Sheet data.

## 5. Functional smoke test

1. Log in with an existing account.
2. Confirm wallet balance and transaction history.
3. From Main Admin, recharge a test user.
4. Confirm the user wallet and transaction list update without manual refresh.
5. Confirm the admin notification appears within the in-app notification polling interval.
6. Confirm `/api/health` still reports successful Sheet restore and JSON + Google Sheet storage.

Do not create duplicate accounts until the restore counts and one existing-user login are confirmed.
