# Yadav Parking — Kanakpura 🅿️

Uncle ji ki parking (Yadav Parking, Kanakpura) ke liye parking pass system:
Android app + website (dono same app) + Node.js server.

## Kya kya hai

- **Rate card aap set karo** — cycle / bike / four-wheeler ke liye hourly block rate,
  monthly aur quarterly rate. Jo set karoge wahi customer ko dikhega.
  Default: bike ₹20/12h, monthly ₹250, quarterly ₹600 (uncle ji ke hisaab se).
- **Customer details bharo → pass book** — naam, mobile, gaadi number, pass type,
  start date. Advance payment bhi usi waqt entry ho jata hai.
- **Customer khud bhi booking request bhej sakta hai** — admin confirm karega tab pass active hoga.
- **Expiry notification** — pass `alertDays` (default 3 din) pehle bacha hua alert
  admin aur customer dono ko dikhta hai; app install ho toh **phone notification** bhi aata hai.
- **Dashboard** — aaj/is mahine/total kamai, kitne pass active, kitne 12h/24h/48h/7 din
  mein khatam honge, kitna due bacha, vehicle-wise hisaab, 6 mahine ka chart.
- **Payment ledger** — cash/UPI har entry, galti se entry ho gayi toh delete bhi.
- **Renew / checkout** — purane pass ko 1 tap mein renew, gaadi nikli toh checkout.
- **Backup/Restore** — poora data JSON file mein download, zaroorat pade toh wapas load.

## Android Studio emulator mein chalana (live testing)

Emulator mein `10.0.2.2` = aapke computer ka khud ka address hota hai.
Android project pehle se hi `http://10.0.2.2:4173/` pe set hai — matlab
**computer pe server chala + emulator mein app Run = seedha kaam karega.**

1. **Node.js install** (ek baar): [nodejs.org](https://nodejs.org) se LTS install karein.
2. **Project download**: GitHub pe is branch (`arena/01a0ce02-instant-rccard`) mein
   **Code → Download ZIP**, ya `git clone` + branch checkout. Folder kholen.
3. **Server chalu karein** (computer pe):
   ```bash
   cd yadav-parking
   node server.js
   # → Yadav Parking server chal raha hai: http://0.0.0.0:4173
   ```
   Ye window band na karein — emulator isi server se baat karega.
4. **Android Studio**: `Open` → `yadav-parking/android` folder chunein.
   Gradle sync hone dein (pehli baar internet se dependencies aayengi, thoda time lagta hai).
5. **Device Manager** (right side panel) → koi bhi phone emulator start karein (API 24+).
6. Upar green **Run ▶** button dabayein. App emulator mein khulegi.
7. App ke andar signup karein — **pehla account admin** banega. Demo rates already set hain.

> Real phone (USB) se test karein toh `10.0.2.2` kaam nahi karega — uske liye
> `strings.xml` mein computer ka WiFi IP daalein (jaise `http://192.168.1.5:4173/`)
> aur phone+laptop same WiFi pe hon. Emulator ke liye `10.0.2.2` hi sahi hai.

**Shortcut (bina Android Studio ke):** Release se `YadavParking-debug.apk`
download karke emulator window pe drag-drop kar dein — install ho jayega
(server aapke computer pe chalna chahiye, warna "Server se connect nahi ho paya" dikhega).

## Chalane ke 2 tarike

### 1. Website / PWA (sabse aasan)
Koi bhi phone ya laptop pe Chrome se server ka URL kholo. Chrome menu →
**Add to Home screen** — app jaisa hi chalega (bina Play Store ke).

### 2. Android app (APK)
`android/` folder ka project GitHub Actions se APK banata hai:
- Push karne pe ya Actions tab → **Build Yadav Parking APK** → Run workflow.
- Artifacts mein `yadav-parking-debug-apk` download karo, phone mein install karo.

APK ka server URL badalna ho toh:
`android/app/src/main/res/values/strings.xml` → `app_base_url` apne server ka URL daalo.

## Server chalana

```bash
cd yadav-parking
node server.js            # http://localhost:4173
```

Environment (optional):
- `PORT` (default 4173)
- `ADMIN_MOBILE` — is number se banega pehla account = admin. Set na karo toh **pehla signup admin** banta hai.
- `DATA_DIR` — data file location (default `./data/yadav-parking.json`)

Render pe deploy: Build command `npm start` (root `yadav-parking/`), Node 20+.
Persistent disk `/opt/render/src/data` laga do toh restart pe data safe rehta hai;
warna Backup download ka use karo.

## Login system

- **Pehla account = ADMIN (owner/uncle ji).** Baaki sab customer bante hain.
- Login sirf mobile number + password se.
- Customer apne hi passes dekh sakta hai; admin sab kuch.

## API (short)

`/api/health`, `/api/public/summary`, `/api/auth/*`, `/api/config`,
`/api/vehicle-types`, `/api/passes`, `/api/passes/:id`,
`/api/passes/:id/renew`, `/api/passes/:id/payments`, `/api/payments`,
`/api/customers`, `/api/stats`, `/api/notifications`,
`/api/backup`, `/api/backup/restore`.

## Test

```bash
PORT=4599 node server.js & node test-api.mjs
```
