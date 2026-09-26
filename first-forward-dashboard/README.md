# First Forward Dashboard

Live, colourful dashboard website built directly on top of the Google Sheet
**"Agent Performance & Stock Report"** (EIR · StockDataa · REPORT · Performer Report …).

Koi database nahi, koi manual upload nahi — website Google Sheet se live data padhti hai
(Google Visualization API / `gviz`). Sheet update → website update (cache 2 min).

## Pages

| Page | Kya dikhata hai |
| --- | --- |
| **Dashboard** | Colourful KPI cards (MTD, VC4, Commercial, Avg/day, Projected, Replacements, Chassis/Wrong VRN, Stock, Active agents, GV share, Tag status) + 13 charts (daily line current vs last month, class mix donut, monthly by class, issuance vs replacement, First Forward vs GV Partner, top TLs, top agents, stock by class, tag status, weekday pattern, VRN type, last 14 days) |
| **Trend** | Daily / Weekly / Monthly / **Last vs Current** — dimension: Total, Class (VC4 / VC20 / VC5+), Type, Channel, VRN type. TL aur Agent filter ke saath. |
| **Stock** | StockDataa se inventory: class-wise, TL × class matrix, agent-wise stock + current-month issuance + stock-days (searchable). |
| **Performance** | REPORT sheet ka agent performance dashboard — overview, agents, TLs, alerts, agent drawer (full 78-column detail). |
| **Sheets (left sidebar)** | Har tab ka full view: EIR, Payout Pivot Table 7, Performer Report, Agent iD, ARM Master, StockDataa, Biomatric Devices, REPORT, High De-Growth/Inactive, Top Performer, Search Dashboard, ARM. Chhoti sheets poori load hoti hain (client search + sort); badi sheets (EIR ~60k, StockDataa ~1 lakh rows) Google se page-wise aati hain — 100 rows per page, server-side search, column sort, CSV download. |

## Requirements

* Google Sheet **"Anyone with the link can view"** hona chahiye (abhi hai).
* Node.js 18+ (Render par default 20).

## Local run

```bash
npm start            # http://localhost:8080
PORT=3000 npm start  # kisi aur port par
```

## GitHub par upload

1. GitHub par new repository banao (e.g. `First-Forward-Dashboard`).
2. Is folder ki **saari files** (folder structure same rakh ke) upload karo — ZIP se: "Add file → Upload files" mein
   sab files drag karo (`js/` folder ke saath). Ya git se:

   ```bash
   git init
   git add .
   git commit -m "First Forward Dashboard"
   git branch -M main
   git remote add origin https://github.com/<your-user>/First-Forward-Dashboard.git
   git push -u origin main
   ```

## Render par deploy

**Option A – Blueprint (1 click):** Render → *New +* → *Blueprint* → repo select karo (isme `render.yaml` hai) → Apply.

**Option B – Manual:** Render → *New +* → *Web Service* → repo connect karo →

| Setting | Value |
| --- | --- |
| Runtime | Node |
| Build Command | *(blank rakho)* — koi dependency nahi hai |
| Start Command | `npm start` |
| Instance type | Free (kaafi hai) |
| Health check path | `/api/health` |

Deploy ke baad URL milega: `https://first-forward-dashboard.onrender.com` (naam aap choose karoge).
Free plan par 15 min idle ke baad pehla open ~30-50 sec leta hai (normal hai).

### Environment variables (sab optional)

| Variable | Default | Kaam |
| --- | --- | --- |
| `PORT` | `8080` (Render khud set karta hai) | Server port |
| `SHEET_ID` | sheet ki current ID | Dusri sheet use karni ho to (saath mein `js/config.js` ka `sheetId` bhi badlo) |
| `CACHE_SECONDS` | `120` | Google responses ka server cache. `0` = no cache |
| `DASH_USER` / `DASH_PASSWORD` | – / – | `DASH_PASSWORD` set karte hi poori site par login (Basic Auth) lag jaata hai. User default `admin` |
| `FRAME_PROTECTION` | – | `1` = site ko kisi aur website ke iframe mein khulne se roko |
| `GVIZ_BASE` | `https://docs.google.com` | Sirf local testing ke liye (mock server). Production mein set mat karo |
| `DOWNLOAD_ZIP` | – | Kisi ZIP ka path do to topbar mein "⬇️ Download ZIP" button + setup guide dikhta hai (`/download/first-forward-dashboard.zip`). Sirf hand-over/preview ke liye; Render par set mat karo |

## Sheet / column mapping badalna ho to

Sab kuch `js/config.js` mein hai:

* `sheetId` – Google Sheet ID
* `sheets[]` – tabs ki list (left sidebar isi se banta hai; tab ka naam **exact** hona chahiye, `gid` pata ho to daal do)
* `eir` – EIR ke column letters (date `AA`, class `D`, type `P`, agent `J`/`L`, TL `BA`, GV `AW`/`AX`, master `AU` …)
* `stock` – StockDataa ke column letters
* `report` – REPORT tab ka gid

Agar Google Sheet mein koi column add/delete ho jaaye to sirf yahan letters update karo, website khud adjust ho jaayegi.

## Structure

```
server.js            Node server: static files + /api/gviz proxy (cache, optional password)
index.html           App shell (sidebar, topbar, drawer)
styles.css           Colourful theme, KPI cards, charts, tables
js/config.js         Sheet ID, tabs, column mapping
js/util.js           Helpers (formatting, dates, CSV download, toast)
js/data.js           Google gviz client (proxy → direct Google fallback)
js/charts.js         Zero-dependency SVG/CSS charts (lines, bars, hbars, donut, spark)
js/model.js          EIR / StockDataa aggregate queries + summaries
js/dashboard.js      Dashboard page
js/trend.js          Trend page (daily / weekly / monthly / last vs current)
js/stock.js          Stock page
js/performance.js    Performance page (REPORT sheet)
js/sheets.js         Generic sheet viewer (full / paged)
js/app.js            Router, sidebar, refresh, drawer
render.yaml          Render blueprint
manifest.webmanifest, icon-192.png, icon-512.png   "Add to Home Screen" support
```

## Notes

* Server proxy fail ho (ya site static hosting par ho) to browser seedha Google se data le leta hai — site phir bhi chalti hai.
* Auto refresh: har 5 min (tab visible ho to) + topbar ka ↻ button (force fresh).
* Mobile friendly: sidebar hamburger menu se khulta hai.
