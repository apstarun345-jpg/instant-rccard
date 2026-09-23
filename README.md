# InstantRCcard — Railway-only primary release

Railway-only package for `https://instantrccard.in/`. Railway is the single canonical JSON writer and Google Sheet mirror. Render proxy and legacy cross-deployment targets are hard-disabled.

## Deploy

```text
Runtime: Node.js 20+
Build: npm install
Start: npm start
Health: GET /api/health
Build: wallet-direct-v8-railway-primary
```

Required Railway variables: `RC_API_URL`, `RC_API_TOKEN`, `ADMIN_MOBILE`, fixed `SESSION_SECRET`, `SHEET_WEBHOOK_URL`, `SHEET_SYNC_SECRET` and `APP_TIME_ZONE=Asia/Kolkata`. Remove or leave blank `PRIMARY_API_URL`, `PROXY_TO_PRIMARY`, `CROSS_DEPLOY_PRIMARY_URL` and `CROSS_DEPLOY_SYNC_SECRET`.

Deploy `apps-script/Code.gs` and `apps-script/Index.html` privately, run `setupInstantRCcard` once, then use its `/exec` URL and matching secret in Railway. Production storage is JSON plus Google Sheet mirror; SQL and SQLite are not used.

## Instant, detailed wallet sync

Admin Recharge and Debit persist the user/admin balances and transaction rows first. User and admin in-app notifications are persisted before the response. Google Sheet writes continue in the background with retries so a slow Sheet cannot delay the wallet response. User balance/history polls every second, notifications poll every 1.5 seconds, and admin live history refreshes every 2 seconds. All API reads use no-store cache headers.

User history now shows the balance after each wallet change and who added/debited it. Admin history shows transaction time, From/User name and mobile, To/Admin name and mobile, type, amount, balance after, direction, note/reference, and both debit and matching admin-credit rows. The admin transaction Refresh button forces a fresh server request and shows a refresh result.

The Admin Wallet control is split into styled Recharge Wallet and Debit Wallet cards. Recharge adds to the selected user. Debit subtracts from the selected user, credits the executing admin, and rejects negative/self/insufficient cases.

## Ten-row pagination everywhere

Wallet history, RC wallet payment requests, Users and RC Card rates, recent rate changes, delegated-admin user lists, KPI detail lists, and user/admin transaction tabs are loaded in server-side pages of exactly 10 records. Each relevant view always shows numbered page buttons, Previous, Next, current-page status, and ellipsis behavior for large histories, including a disabled one-page state. CSV export fetches all user pages without changing the visible ten-row table.

Wallet recharge/debit/credit rows remain in the Wallet transactions tab; RC rows remain separate in RC downloads. Startup uses the supplied animated logo splash, v21 PWA icons, and the cache-busted `instant-rccard-shell-v23` service-worker shell. Google Sheet mirror columns preserve source/target names and mobiles for wallet transactions.

Expected health: `build=wallet-direct-v8-railway-primary`, `proxyToPrimary=false`, `primaryApiConfigured=false`, `storage=json+google-sheet`, `durableStore=google-sheet-mirror`, `restore.status=success`.

No production data, secrets, `.env`, `node_modules`, SQL/SQLite files or `storage.js` are included.

## SEO / Google Search Console

The server generates everything a search engine needs for `https://instantrccard.in/`; nothing has to be edited by hand when the domain changes.

| URL | Purpose |
| --- | --- |
| `/sitemap.xml` | Sitemap built from the `PUBLIC_PAGES` list in `server.js` (`lastmod` = last deploy of `index.html`) |
| `/robots.txt` | Allows all crawlers, blocks `/api/` and the stray `/Index.html` copy, points to the sitemap |
| `/` | `index.html` is served with an injected `<link rel="canonical">`, `og:url`, `og:image`, optional verification meta tags and JSON-LD (`Organization`, `WebSite`, `WebApplication`) at the `<!--SEO_HEAD-->` marker. A public "how it works" + FAQ section (with `FAQPage` JSON-LD) sits under the login hero and is hidden after login. |
| `/og-image.png` | 1200×630 preview image used by Google, WhatsApp, Facebook and X link previews |

Server code and deployment notes (`server.js`, `storage.js`, `Code.gs`, `*.md`, `*.patch`, `package*.json`, dotfiles) are no longer downloadable from the static file server.

Environment variables (all optional):

| Variable | Description |
| --- | --- |
| `SITE_URL` | Canonical origin; defaults to `https://instantrccard.in`. Change it only if the domain changes. |
| `GOOGLE_SITE_VERIFICATION` | Content value of the Search Console "HTML tag" method. Rendered as `<meta name="google-site-verification">`. Not needed when the property is verified through Cloudflare DNS. |
| `BING_SITE_VERIFICATION` | Content value for Bing Webmaster Tools (`msvalidate.01`). |
| `CANONICAL_REDIRECT` | Set to `1` to 301-redirect other public hostnames (the `*.up.railway.app` URL, `www.`) to `SITE_URL`. `/api/*`, localhost and `healthcheck.railway.app` are never redirected. |

Alternatively, drop the `googleXXXX.html` verification file from Search Console into the repository root; static files are served from there automatically.

Submit the site (step-by-step Hinglish guide in [GOOGLE-SEARCH-SETUP.md](GOOGLE-SEARCH-SETUP.md)):

1. Deploy, then open `https://instantrccard.in/sitemap.xml` and `https://instantrccard.in/robots.txt` to confirm both respond.
2. Go to <https://search.google.com/search-console>, add a **Domain** property `instantrccard.in` and verify it with the DNS TXT record in Cloudflare (or a **URL prefix** property with `GOOGLE_SITE_VERIFICATION`).
3. **Sitemaps → Add a new sitemap →** enter `sitemap.xml` → Submit.
4. **URL Inspection →** paste `https://instantrccard.in/` → **Request indexing**.
5. Add a new entry to `PUBLIC_PAGES` whenever a new public page is added; the sitemap updates automatically.
