# Railway-only deployment

1. Back up the Google Sheet and deploy the private Apps Script mirror. Run `setupInstantRCcard` once so Web_Transactions has source/target and downloadType columns.
2. Deploy this package on Railway with `npm install` and `npm start`.
3. Login as Main Admin and open **Admin control center → User wallet history**. Click it and confirm the Wallet control section becomes hidden, the history wrapper and inner history panel become visible, and the sidebar button becomes active.
4. Enter a mobile, email or name. Choose a dropdown suggestion or click **Search & view**. Verify credits, debits, RC charges, vehicle numbers, time, From/To, balance, notes and IDs load immediately.
5. Open Admin access, grant **User wallet history** to an Admin Assistant, and verify the assistant can search only when permission is checked. Remove permission and verify suggestions/history are blocked.
6. Confirm `/api/health` shows `wallet-direct-v8-railway-primary`, `proxyToPrimary=false`, JSON + Google Sheet storage and successful restore.
7. Confirm `/sw.js` contains `instant-rccard-shell-v25`. Close all old site/PWA tabs and reopen the site once so the cache-busted `app.js?v=admin-history-20260923-2` is loaded.
