# Railway-only deployment

1. Back up the Google Sheet and deploy the private Apps Script mirror. Run `setupInstantRCcard` once so Web_Transactions has source/target and downloadType columns.
2. Deploy this package on Railway with `npm install` and `npm start`.
3. Login as Main Admin and open **Admin control center → User wallet history**. It must show only the search field and **Search & view** button. Enter a mobile, email or unambiguous name and verify the summary/table appears immediately.
4. Open Admin access, grant **User wallet history** to an Admin Assistant, and verify the assistant can search only when the permission is checked. Remove the permission and verify the API/UI is blocked.
5. Verify selected-user history includes Recharge, Debit and RC charges with time, vehicle, From/To, amount, balance, note, status and ID.
6. Confirm `/api/health` shows `wallet-direct-v8-railway-primary`, `proxyToPrimary=false`, JSON + Google Sheet storage and successful restore.
7. Confirm `/sw.js` contains `instant-rccard-shell-v24`; hard refresh or reinstall an old PWA once after deployment.
