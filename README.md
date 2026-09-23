# InstantRCcard — Apps Script Sheet mirror

This Apps Script is the private Google Sheet mirror and durable restore source for the direct Node website. Visitors use the Render Node URL, not the Apps Script URL.

## Required setup

1. Use a private Google Sheet, then open **Extensions → Apps Script**.
2. Paste `Code.gs` and keep an HTML file named `Index` if you also want the legacy Apps Script page.
3. In **Project Settings → Script properties**, set:

```text
SHEET_SYNC_SECRET = same secret used by the Node service
ADMIN_MOBILE = your admin mobile
RC_API_TOKEN = provider token if the legacy Apps Script UI is used
```

4. Run `setupInstantRCcard` once and authorize permissions.
5. Deploy as a Web App:
   - Execute as: **Me**
   - Who has access: **Anyone** or your organization
6. Put the `/exec` URL in Render as `SHEET_WEBHOOK_URL`.

## Sheets created

- `Users` and `Transactions`: legacy Apps Script database
- `Web_Users` and `Web_Transactions`: direct Node mirror
- `Web_Accounts`: private durable account records, including password hashes/salts, recovery email and delegated admin permissions
- `Web_Ads`: public advertisement mirror
- `Web_Settings`: homepage rating, public counters and default RC Card rate
- `adminPermissions` is mirrored as JSON in both `Web_Users` and `Web_Accounts`, and is restored by `webSnapshot_()`
- `rcCardPrice`, `rcRateUpdatedAt` and `rcRateUpdatedBy` are mirrored with the account so custom user rates survive unrelated updates and restore; a blank rate is only treated as an intentional clear when its update timestamp is present
- `supportWhatsapp` and `paymentQr` are mirrored in `Web_Settings` so Main Admin's wallet/help WhatsApp configuration survives restore
- `Web_RateLog`: admin custom-rate audit history
- `Web_TopupRequests`: durable wallet payment-request ledger, including the client payment reference.
- `Web_Notifications`: durable in-app notification history and read state.
- `Web_PushSubscriptions`: one row per subscribed user/device endpoint so background push survives a Node restart/redeploy; stale or unsubscribed endpoints are removed.
- `Web_Accounts.userId` and `Web_Users.userId` now use short display IDs such as `u1`, `u2`; the original internal UUID is retained in `internalUserId` for safe session/data restoration.
- `Web_Transactions.id` now uses short display IDs such as `T1`, `T2`; the original internal UUID is retained in `internalTransactionId`. Existing long IDs in all three mirror sheets are migrated when the mirror is initialized. Each row keeps request ID, user/mobile, requested amount, final approved amount, status, timestamps, approver and rejection reason. The row is upserted on creation and on every approval/rejection, so restart/redeploy cannot recreate or double-credit a request.

The Node service requests a private snapshot at the Apps Script `/exec` URL during startup. This restores users, wallets, transactions, advertisements, custom RC Card rates, the custom-rate audit ledger, support/QR settings, global pricing, admin settings, notification history/read state and push subscriptions after a Render/Railway restart or redeploy when the local JSON file is not persistent. On the first request after this version is deployed, `ensureWebMirrorSheets_()` also imports any older `Users` and `Transactions` rows into the direct Node mirror instead of replacing them with only newly created accounts. Legacy Apps Script SHA-256 password hashes are accepted once and upgraded to the current Node scrypt format after login. Critical Node mutations wait for the mirror response before returning success. The rate ledger is also used to recover a custom rate when an older account row has an empty `rcCardPrice` cell.

After deploying a new Apps Script version, update the existing Web App deployment to that version; editing the project alone does not update the `/exec` URL. Keep the spreadsheet private. Passwords are stored only as hashes/salts, but the account mirror still contains sensitive account metadata.
