# Railway-only deployment

1. Back up the current Google Sheet.
2. Deploy `apps-script/Code.gs` and `apps-script/Index.html` privately, run `setupInstantRCcard`, and keep the `/exec` URL.
3. Deploy this package on Railway with `npm install` and `npm start`.
4. Set `RC_API_TOKEN`, `ADMIN_MOBILE`, fixed `SESSION_SECRET`, `SHEET_WEBHOOK_URL`, `SHEET_SYNC_SECRET` and `APP_TIME_ZONE` in Railway Variables.
5. Do not set `PRIMARY_API_URL`, `PROXY_TO_PRIMARY`, `CROSS_DEPLOY_PRIMARY_URL` or `CROSS_DEPLOY_SYNC_SECRET`.
6. Attach `https://instantrccard.in/` and open `/api/health`.
7. Confirm build `wallet-direct-v8-railway-primary`, `storage: json+google-sheet`, `durableStore: google-sheet-mirror`, successful restore counts, and an existing-user login before new signups.
8. Test an admin recharge and confirm wallet, transaction list, KPI cards and notification update without manual refresh.
