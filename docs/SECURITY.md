# InstantRCcard — Security Model

This document explains the hardening applied to the InstantRCcard Node backend and frontend, and the trade-offs you should be aware of before deploying to production.

## 1. Threat model — what's protected, what isn't

### What's protected ✅

| Threat | Mitigation |
|---|---|
| Brute-force login | Per-mobile + per-IP failed-login counter; lockout after `LOGIN_LOCKOUT_THRESHOLD` failures inside `LOGIN_LOCKOUT_WINDOW` seconds (default 20 attempts/hour → lock 1h). |
| Cross-site request forgery | Double-submit CSRF cookie. Every POST/PUT/DELETE/PATCH must carry matching `instant_rccard_csrf` cookie and `X-CSRF-Token` header. SPA bootstrap is `/api/auth/csrf`. |
| Mass scraping / abuse | Per-IP sliding-window rate limit (configurable, "strict" preset for production). |
| Session tampering | HMAC-SHA256 signed cookie (`instant_rccard_session = userId.expiry.signature`) with `SESSION_SECRET`. |
| Password compromise | scrypt (N=2^14, 64-byte digest) with random per-user salt. Never stored or transmitted in plaintext. |
| XSS / script injection | `script-src 'self'`, `frame-ancestors 'none'`, no inline JS in app.js, strict `Content-Security-Policy`. |
| Clickjacking | `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'`. |
| MIME sniffing | `X-Content-Type-Options: nosniff`. |
| Mixed content / downgrade | `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` (HTTPS only). |
| Side-channel attacks on cookies / passwords | `crypto.timingSafeEqual()` for every equality check. |
| Cross-origin window attacks | `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`. |
| Path traversal | Reject any URL containing `..` or `%2e%2e`. |
| Public enumeration of admin endpoints | All `/api/admin/*` require `role === 'admin'`; non-admins get `403 Admin access required.`. |
| Audit trail | Every signup, login (success/fail/lock), password reset, admin recharge and RC purchase is logged with timestamp + IP. |

### What's **not** perfect (intentional / out of scope)

- **Source code visibility.** `app.js`, `index.html`, `styles.css` are still served as static assets. No client-side code is truly hidden. We minimise what an attacker can extract by:
  - Keeping the provider token (`RC_API_TOKEN`), admin mobile, and session secret on the server only.
  - Keeping all wallet/RC transactions behind session + CSRF + admin checks.
  - Hashing passwords with scrypt so even a leaked database doesn't give plaintext credentials.
  - Generating RC images server-side and only returning data-URLs after wallet deduction.
- **Session storage.** The in-memory database (`data/instant-rccard.json`) is fine for single-instance Render free tier; if you scale horizontally you must use the Apps Script Sheet mirror or move to a real DB.
- **DDoS at the network layer.** Rate limits are per Node process and don't replace a CDN/WAF. Render's free tier has no WAF — if you expect hostile traffic, put the service behind Cloudflare.

## 2. Backend hardening (added in this patch)

### Files added/changed
- `security.js` — new module exporting:
  - `rateLimit({ route, limit, windowMs })` per-route sliding-window limiter.
  - `csrfMiddleware`, `csrfCookieFromHeader`, `issueCsrfToken`, `setCsrfCookie`.
  - `sharedSecretMiddleware` — optional pre-shared client secret (set `CLIENT_SHARED_SECRET` to enable).
  - `hardenedSecurityHeaders(isHttps)` — full CSP, HSTS, COOP, CORP, Permissions-Policy.
  - `isLoginLocked`, `recordLoginFailure`, `recordLoginSuccess`, `lockoutSecondsRemaining`.
  - `audit(event, details)` and `getRecentAudit()`.
- `server.js` — wired all of the above into the request handler.
- `.env.example`, `.gitignore` — secure defaults.
- `app.js` — auto-bootstraps CSRF on every unsafe request and retries once if rejected.

### Configuration knobs

| Env var | Default (strict) | Purpose |
|---|---|---|
| `ENABLE_STRICT_RATE_LIMITS=1` | off / on | Tightens all rate limits (recommended in production). |
| `LOGIN_LOCKOUT_THRESHOLD=8` | 20 (8 strict) | Failures before lockout. |
| `LOGIN_LOCKOUT_WINDOW=3600` | 3600 | Lockout duration in seconds. |
| `CSRF_TTL=43200` | 12h | CSRF cookie lifetime. |
| `CLIENT_SHARED_SECRET` | empty | If set, all `/api/*` requests must echo this value in `X-Client-Secret` header. Generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. |
| `TRUSTED_PROXIES` | empty | Comma-separated IPs allowed to set X-Forwarded-For. |

### Production startup validation

If `NODE_ENV=production` and any of `RC_API_TOKEN`, `SESSION_SECRET`, `ADMIN_MOBILE` is missing, the server **refuses to start**. This catches "I forgot to set env vars" deploys.

### Audit log

Every security-relevant event prints `[audit] event_name {...}` to stderr (visible in Render's log stream) and is kept in memory for the last 500 events.

Sample audit lines you'll see:
```
[audit] signup_success {"mobile":"9876500001","ip":"127.0.0.1"}
[audit] login_failed {"mobile":"9876500001","ip":"203.0.113.42"}
[audit] login_locked {"mobile":"9876500001","ip":"203.0.113.42","reason":"mobile","retryAfter":3600}
[audit] password_reset {"mobile":"9876500001","ip":"203.0.113.42"}
[audit] rc_purchase {"mobile":"9876500001","vrn":"RJ14AB1234","price":15,"downloadType":"rc-card","ip":"203.0.113.42"}
[audit] admin_recharge {"adminMobile":"9999999999","target":"9876500001","amount":100,"ip":"203.0.113.42"}
[audit] csrf_block {"ip":"203.0.113.42","path":"/api/auth/login"}
```

## 3. Anti-cloning measures

If someone downloads your repo and tries to host a clone:

1. **They don't get `RC_API_TOKEN`.** The provider will reject their calls. Even if they sign up for their own token, the cloned server won't have admin recharges or transaction history. (You should also rotate the token if it has ever been exposed.)
2. **They don't get `SESSION_SECRET`.** Sessions on the clone would be invalid (and their sessions wouldn't carry over from your real deployment).
3. **The clone still works as a generic demo** but won't talk to the real RC provider or honor user balances. Your real customers stay safe because their accounts live in `data/instant-rccard.json` on the *real* server.
4. **Code is licensed to you.** Add a `LICENSE` file with your chosen terms (MIT/Apache-2.0/proprietary) and a copyright header — this gives you legal standing against clone sites.

For stronger protection:

- **Add `LICENSE`** at the repo root declaring your copyright + license.
- **Server fingerprinting** — set a non-secret `BUILD_TAG` env var and have the server include it in `X-Powered-By`-style response. Clone operators usually miss these.
- **Periodic token rotation** — every 90 days, regenerate `RC_API_TOKEN`, `SESSION_SECRET`, and `CLIENT_SHARED_SECRET` (if enabled) in Render's env dashboard and restart. Existing cookies stop working — users have to log in again.

## 4. Render deployment checklist

1. Set all env vars from `.env.example` to real values in Render → Environment.
2. `SESSION_SECRET`: paste a 64-char hex from `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
3. `RC_API_TOKEN`: paste from your RC provider dashboard. Mark Render's secret as "secret" so it's not exposed in the UI.
4. `ADMIN_MOBILE`: the 10-digit mobile of the account you want to be admin.
5. `NODE_ENV=production` — enables fatal-startup validation.
6. `ENABLE_STRICT_RATE_LIMITS=1` — recommended for public-facing sites.
7. If you want the SPA to talk to a clone-safe endpoint, also set `CLIENT_SHARED_SECRET`.
8. After deploy, watch the Render log for `[audit] …` lines during your own login/signup to confirm everything is wired up.

## 5. Reporting issues

Found a security bug? Please email `security@yourdomain` (replace with your real contact). Do not open a public GitHub issue.
