# FASTag Agent Performance Report

A **standalone** website built from the Google Sheet **REPORT** tab (agent / TL FASTag performance).
It is completely independent of InstantRCcard — separate folder, separate server, separate deployment.

## How it works

- The dashboard reads the sheet **live**: sheet update → website update. No manual import.
- The sheet must stay shared as **Anyone with the link – Viewer**.
- Data flow in the browser: `GET /api/report` (bundled server caches the CSV for `REPORT_CACHE_SECONDS`, default 180) → if that is unavailable (static hosting), the browser fetches the sheet CSV directly from Google.
- Sections are detected from the sheet's merged header row ("Agent Profile Details", "TL's Master Data", …) so small column shifts don't break the site.

## Views

| Tab | Contents |
| --- | --- |
| Overview | KPI cards, last-7-days chart, top 10 agents / TLs, agent status + TL stock-alert distribution (click to filter) |
| Agents | Search, filters (TL, status, last active, TL stock alert, device, hide 0-issuance), sortable columns, pagination, CSV export, detail drawer with every sheet column |
| TL Summary | TL-level issuance / growth / stock / alerts, drawer with the TL's agents |
| Alerts | Dispatch needed, over-stocked TLs, de-growth agents, "went quiet" follow-up list, wrong VRN |
| Summary button | Copies a WhatsApp-ready daily summary and opens WhatsApp |

Shareable URLs keep the view + filters, e.g. `#view=agents&tl=APN2421`. Auto-refresh every 10 minutes. Installable on phones (manifest + icons).

## Run locally

```bash
cd agent-report
npm start            # http://localhost:8080
```

No dependencies and no build step (Node 18+).

## Deploy (pick one)

**Render – Web Service (recommended, gives caching + optional login)**
1. New → Web Service → this GitHub repo.
2. Root Directory: `agent-report` · Build Command: *(empty)* · Start Command: `npm start`.
3. Add env vars from the table below if needed (e.g. `REPORT_PASSWORD`).

**Render – Static Site / Netlify / Vercel / GitHub Pages / Cloudflare Pages**
Publish the `agent-report` folder as-is (no build). The browser then fetches the sheet directly from Google. Login protection is not available in this mode.

## Environment variables (server mode)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on (Render sets this automatically) |
| `REPORT_SHEET_ID` | the REPORT sheet | Google Sheet ID |
| `REPORT_SHEET_GID` | `242489821` | Tab (gid) to read |
| `REPORT_CACHE_SECONDS` | `180` | Server-side cache for the sheet CSV |
| `REPORT_PASSWORD` | – | If set, the site asks for a login (user `REPORT_USER`, default `admin`) |
| `REPORT_USER` | `admin` | Username for the login prompt |
| `FRAME_PROTECTION` | – | Set `1` to block embedding in iframes |
| `REPORT_FIXTURE_FILE` | – | Local CSV instead of Google (testing only) |

To point the site at a different sheet without the server, edit `SHEET_ID` / `SHEET_GID` at the top of `app.js`.

## Column names

A few sheet columns have no sub-header (I, J, K, L, M, AB, AD–AH, BR). They appear as "Column I" etc. until you name them in `LABEL_OVERRIDES` at the top of `app.js`.
