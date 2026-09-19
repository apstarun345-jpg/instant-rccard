# InstantRCcard — kaunsi file kya karti hai (file map)

Poora code alag-alag files me hai. Har file ka kaam neeche diya hai:

| File | Kaam |
| --- | --- |
| `server.js` | Backend server (Node.js, koi external package nahi). Website serve karta hai, signup/login/session cookie, wallet, admin panel, RC provider API ko server-side token se call karta hai aur JSON me data save karta hai. |
| `index.html` | Poora HTML markup — login/signup screen, dashboard, wallet, admin panel, popups. Isme ab koi CSS ya JS inline nahi hai. |
| `styles.css` | Poora design (blue & white theme) — layout, buttons, cards, modals, mobile responsive rules. `index.html` isse `<link rel="stylesheet">` se load karta hai. |
| `app.js` | Poora frontend JavaScript — form handling, API calls, session check, RC card fetch/download, admin controls, ads ticker, toasts. |
| `sw.js` | Service worker (PWA offline cache) taaki site "Install app" se phone me app ki tarah install ho sake. |
| `manifest.webmanifest` | PWA manifest — app ka naam, colour, icon aur install settings. |
| `icon-192.png`, `icon-512.png` | App icons (home screen / install ke liye). |
| `whatsapp.png` | WhatsApp support button ka icon. |
| `package.json` | Project info + `npm start` command (`node --env-file-if-exists=.env server.js`). |
| `.env.example` | Saare environment settings ka sample (token, admin mobile, session secret, Sheet mirror). Isko copy karke `.env` banaiye. |
| `.gitignore` | Git me kya upload nahi hona chahiye (`.env`, `data/`, `node_modules/`). |
| `README.md` | Setup, run aur API routes ki jaankari. |
| `data/instant-rccard.json` | Server chalu hone par khud ban jati hai — users, wallet transactions, ads isme save hote hain. `data/` folder git me nahi jaata. |

## Naya file banane ki zarurat kab padegi

- `apps-script/Code.gs` — sirf tab chahiye jab Google Sheet mirror use karna ho (Render ke restart par accounts wapas laane ke liye). `SHEET_WEBHOOK_URL` + `SHEET_SYNC_SECRET` set karte hi Node us Sheet se snapshot maangta hai; us waqt Sheet side ka Apps Script hona chahiye.

## Run karne ka tareeka (short)

```bash
cp .env.example .env      # Windows: copy .env.example .env
# .env me RC_API_TOKEN, ADMIN_MOBILE, SESSION_SECRET bhar dijiye
npm start
```

Phir browser me `http://localhost:4173` kholiye. `index.html` ko double-click karke mat kholiye — us case me koi backend nahi hota, isliye login/wallet/RC sab kaam nahi karega.
