# Railway-only deployment

1. Back up the Google Sheet and deploy the private Apps Script mirror. Run `setupInstantRCcard` once.
2. Deploy this package on Railway with `npm install` and `npm start`.
3. Set provider, admin, fixed session, Sheet and timezone variables. Do not set proxy or cross-deployment variables.
4. Verify `/api/health` shows `wallet-direct-v8-railway-primary`, JSON + Google Sheet storage, and successful restore counts.
5. Test Admin Wallet control: confirm Recharge, then confirm Debit. User wallet must decrease; executing admin wallet must increase by the same amount.
6. Confirm Wallet transactions and RC downloads are separate, exactly 10 rows load per page, and page numbers/Previous/Next/ellipsis work for both Admin and User.
7. Verify `/sw.js` contains `instant-rccard-shell-v21`; reinstall an old PWA once to replace its cached icon.
