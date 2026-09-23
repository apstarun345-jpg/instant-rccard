# Railway-only deployment

1. Back up the Google Sheet and deploy the private Apps Script mirror. Run `setupInstantRCcard` once so the Web_Transactions mirror can add source/target and downloadType columns.
2. Deploy this package on Railway with `npm install` and `npm start`.
3. Set provider, admin, fixed session, Sheet and timezone variables. Do not set proxy or cross-deployment variables.
4. Verify `/api/health` shows `wallet-direct-v8-railway-primary`, JSON + Google Sheet storage, and successful restore counts.
5. Login as Main Admin, open **Admin control center → Wallet control → User wallet history** from the visible sidebar option, enter a user's mobile, email or exact name, and confirm the summary/table show credits, debits, RC charges, vehicle numbers, time, From/To and IDs.
6. Open Admin access, grant only **User wallet history** to an Admin Assistant, login as that assistant, and verify the selected-user history works. Remove the permission and verify the endpoint/UI is blocked.
7. Test normal user Recharge/Debit/RC purchase and confirm both the user ledger and selected-admin ledger refresh after the mutation.
8. Click the Admin transaction Refresh and selected-user wallet history Refresh buttons and confirm fresh server responses.
9. Confirm `/sw.js` contains `instant-rccard-shell-v24` and the manifest references the v21 PWA icons; reinstall an old PWA once if its old cache remains.
