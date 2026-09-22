# Railway-only deployment

1. Back up the existing Google Sheet.
2. Deploy `apps-script/Code.gs` and `apps-script/Index.html` privately, run `setupInstantRCcard`, and keep the `/exec` URL.
3. Deploy this package on Railway with `npm install` and `npm start`.
4. Set `RC_API_TOKEN`, `ADMIN_MOBILE`, fixed `SESSION_SECRET`, `SHEET_WEBHOOK_URL`, `SHEET_SYNC_SECRET` and `APP_TIME_ZONE` in Railway Variables.
5. Do not set `PRIMARY_API_URL`, `PROXY_TO_PRIMARY`, `CROSS_DEPLOY_PRIMARY_URL` or `CROSS_DEPLOY_SYNC_SECRET`.
6. Attach `https://instantrccard.in/` and open `/api/health`.
7. Confirm build `wallet-direct-v8-railway-primary`, successful Sheet restore counts, and an existing-user login.
8. Test Admin wallet control: search a user, confirm Recharge, confirm Debit, and verify user wallet decreases while the executing admin wallet increases by the same amount. Confirm `WALLET_DEBIT` and `ADMIN_WALLET_CREDIT` transactions, notifications and Sheet mirror.
9. Verify `/sw.js` contains `instant-rccard-shell-v21`. Reinstall an old PWA once so the new animated startup/logo and v21 icon are used.
