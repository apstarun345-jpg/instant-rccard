# Railway-only deployment

1. Back up the Google Sheet and deploy the private Apps Script mirror. Run `setupInstantRCcard` once so the Web_Transactions mirror can add source/target columns.
2. Deploy this package on Railway with `npm install` and `npm start`.
3. Set provider, admin, fixed session, Sheet and timezone variables. Do not set proxy or cross-deployment variables.
4. Verify `/api/health` shows `wallet-direct-v8-railway-primary`, JSON + Google Sheet storage, and successful restore counts.
5. Test Admin Wallet control: search a user, use the separate Recharge Wallet or Debit Wallet card, confirm the action, and verify user/admin balances and both transaction rows.
6. Confirm the user receives a named wallet notification and sees the updated balance/history within the fast polling interval. Admin history must show From/To names, mobiles, amount, balance, direction and note.
7. Click the Admin transaction Refresh button and confirm a fresh server response. Confirm Wallet history, RC wallet payment requests, Users and RC Card rates, recent rate changes, KPI details, and user/admin transaction tabs show exactly 10 records per page with numbered pages, Previous, Next, and ellipsis where needed.
8. Verify `/sw.js` contains `instant-rccard-shell-v23` and the manifest references the v21 PWA icons; reinstall an old PWA once if its old icon remains cached.
