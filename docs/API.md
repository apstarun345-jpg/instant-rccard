# InstantRCcard — API Reference

Base URL (production): `https://instant-rccard.onrender.com`
Base URL (local dev): `http://localhost:4173`

All endpoints accept and return `application/json; charset=utf-8` unless noted.
All requests must use `credentials: 'same-origin'` so the session cookie is sent.

---

## Security headers & authentication

Every request goes through a hardened pipeline:

- **CORS**: same-origin only. The Node server does not emit `Access-Control-Allow-Origin` for cross-site callers, so the API is not directly callable from a different domain in a browser.
- **Session cookie**: `instant_rccard_session`. `HttpOnly`, `SameSite=Lax`, `Secure` in production (HTTPS). 7-day expiry. HMAC-SHA256 signed with `SESSION_SECRET`.
- **CSRF**: For any unsafe method (POST/PUT/DELETE/PATCH) the request must include:
  - Cookie `instant_rccard_csrf=<token>` (set by `GET /api/auth/csrf`)
  - Header `X-CSRF-Token: <same token>`
  Both must match. Missing/mismatched → `403 CSRF_MISSING` / `CSRF_MISMATCH`.
- **Rate limits** (per IP, sliding 60-second window):
  | Bucket | Non-strict | Strict (`ENABLE_STRICT_RATE_LIMITS=1`) |
  |--------|-----------:|---------------------------------------:|
  | global | 600 / min  | 240 / min                              |
  | `/api/auth/*` (signup/login/forgot/logout) | 30 / min | 10 / min |
  | `/api/rc/*` (purchase) | 10 / min | 3 / min |
  | `/api/admin/*` | 120 / min | 30 / min |
  | `/api/public/stats` | 240 / min | 60 / min |
  | `/api/ads` | 240 / min | 60 / min |
  Over-limit → `429 RATE_LIMITED` with `Retry-After` header.
- **Login lockout**: 5–20 failed logins (configurable via `LOGIN_LOCKOUT_THRESHOLD`) inside a 1-hour window lock that mobile+IP for 1 hour (`LOGIN_LOCKOUT_WINDOW`).
- **Required response headers on every response**:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: no-referrer`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()`
  - `Cross-Origin-Opener-Policy: same-origin`
  - `Cross-Origin-Resource-Policy: same-origin`
  - `Content-Security-Policy: default-src 'self'; …; frame-ancestors 'none'`
  - `Strict-Transport-Security` (HTTPS only)
  - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Audit log**: every signup, login success/failure/lock, password reset, admin recharge and RC purchase is recorded with timestamp, IP and event metadata.

---

## Endpoints

### Health & public

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/health` | Liveness check; reports whether `RC_API_TOKEN`, admin mobile and Sheet mirror are configured. |
| `GET`  | `/api/public/stats` | `{ users, downloads, rating, rcCardPrice }` — public counters. |
| `GET`  | `/api/ads` | Active advertisement banners. |
| `GET`  | `/api/auth/csrf` | Issue / refresh CSRF cookie + return token. |

### Auth

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/auth/signup` | `{ name, email, mobile, password }` | `{ success, user }` + session cookie |
| `POST` | `/api/auth/login`  | `{ username (mobile/email), password }` | `{ success, user }` + session cookie |
| `POST` | `/api/auth/forgot-password` | `{ email, mobile, newPassword, confirmPassword }` | `{ success, message }` |
| `POST` | `/api/auth/logout` | (empty) | `{ success }` + clears session cookie |
| `GET`  | `/api/auth/session` | — | `{ success, user }` or `{ success: false, message }` |

### Account

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/account/transactions` | Last 30 wallet/RC transactions for the logged-in user. |

### RC purchase

| Method | Path | Body | Returns |
|--------|------|------|---------|
| `POST` | `/api/rc/purchase` | `{ vrn: "RJ14AB1234", downloadType: "rc-card" \| "mparivahan" }` | `{ success, data: { vrn, front, back, downloadType }, wallet, charged, requiredPrice }` |

- `mparivahan` → `{ success: false, code: "COMING_SOON" }`.
- `rc-card` with insufficient balance → `{ success: false, code: "LOW_BALANCE", wallet, requiredPrice, downloadType }`.
- On success, `front` and `back` are `data:image/...;base64,...` strings the frontend renders to a downloadable PNG.

### Admin (requires `role === 'admin'`)

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `POST` | `/api/admin/users/search` | `{ query }` (mobile or email) | Find user, return profile + last 10 transactions + default rate. |
| `POST` | `/api/admin/users/set-rate` | `{ query, price, clear }` | Set / clear a per-user RC rate. |
| `POST` | `/api/admin/recharge` | `{ mobile, amount, note }` | Credit a user's wallet, write transaction. |
| `GET`  | `/api/admin/transactions` | — | Last 50 transactions site-wide. |
| `GET`  | `/api/admin/stats?from=YYYY-MM-DD&to=YYYY-MM-DD` | — | KPIs and optional date range. |
| `POST` | `/api/admin/settings/rating` | `{ rating }` | Update public rating (0–5). |
| `POST` | `/api/admin/settings/baseline` | `{ usersBaseline, downloadsBaseline }` | Add to the public counters. |
| `POST` | `/api/admin/settings/rc-price` | `{ price }` | Default RC Card rate (₹1–₹1000). |
| `GET`  | `/api/admin/ads` | — | All ads (active + hidden). |
| `POST` | `/api/admin/ads` | `{ title, imageData }` (data-URL) | Add a banner. |
| `POST` | `/api/admin/ads/:id` | — | Toggle active/hidden. |
| `DELETE` | `/api/admin/ads/:id` | — | Delete an ad. |

---

## Error envelope

```json
{ "success": false, "message": "Localized message", "code": "MACHINE_CODE" }
```

Common codes: `RATE_LIMITED`, `CSRF_MISSING`, `CSRF_MISMATCH`, `SECRET_MISMATCH`, `LOW_BALANCE`, `COMING_SOON`, `INVALID_JSON`, `PAYLOAD_TOO_LARGE`.

---

## Example: signup + buy RC

```bash
# 1) Bootstrap CSRF token (also sets the cookie)
curl -c cookies.txt https://instant-rccard.onrender.com/api/auth/csrf
TOKEN=$(jq -r .csrfToken < cookies.json)

# 2) Signup
curl -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $TOKEN" \
  -d '{"name":"Asha","email":"asha@example.com","mobile":"9876500001","password":"strongpass"}' \
  https://instant-rccard.onrender.com/api/auth/signup

# 3) Buy RC Card (after admin recharge)
curl -b cookies.txt -c cookies.txt \
  -H "Content-Type: application/json" -H "X-CSRF-Token: $TOKEN" \
  -d '{"vrn":"RJ14AB1234","downloadType":"rc-card"}' \
  https://instant-rccard.onrender.com/api/rc/purchase
```

---

## Provider integration (server-side only)

The Node server proxies calls to `https://api.apnirc.xyz/api/b2b/get-rc` using the `RC_API_TOKEN` env var.
The token is **never** exposed to the browser, mobile clients, or static files. If you rotate the token, restart the Render service so the new value is loaded from the environment.
