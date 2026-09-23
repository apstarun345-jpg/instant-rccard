# Google par InstantRCcard list karwane ka poora tarika

Website ka code ab search engines ke liye ready hai. Google par listing ke liye neeche wale steps **ek baar** karne hote hain. Poora process free hai aur sirf aapke Google account se hota hai.

> Sabse important baat: **Google apne aap kisi bhi website ko kabhi bhi "sitemap" me nahi jodta.** Aap Google Search Console me apni website ka sitemap submit karte ho, tab Google use crawl karke apne search results me dikhata hai.

---

## Step 0 — Deploy karo aur check karo (2 minute)

Render par latest code deploy hone ke baad browser me ye 3 URL kholo (apna domain lagao):

| URL | Kya dikhna chahiye |
| --- | --- |
| `https://APKA-DOMAIN/sitemap.xml` | XML jisme `<loc>https://APKA-DOMAIN/</loc>` likha ho |
| `https://APKA-DOMAIN/robots.txt` | `Allow: /` aur `Sitemap: https://APKA-DOMAIN/sitemap.xml` |
| `https://APKA-DOMAIN/og-image.png` | Blue InstantRCcard banner image |

Agar teeno khul rahe hain, aage badho.

### Custom domain hai? `SITE_URL` set karo

Agar aapki site `xyz.onrender.com` ke alawa apne domain (jaise `www.instantrccard.com`) par bhi chalti hai, to Render Dashboard → aapki service → **Environment** me ye variable add karo:

```text
SITE_URL = https://www.instantrccard.com
```

Isse sitemap, canonical link aur social preview hamesha asli domain ka URL dikhayenge, aur Google do alag copies (onrender + custom domain) ko duplicate nahi maanega. Sirf `onrender.com` use kar rahe ho to ye optional hai.

---

## Step 1 — Google Search Console me website add karo (5 minute)

1. <https://search.google.com/search-console> kholo aur apne Gmail se login karo.
2. **Add property** (Property jodein) par click karo.
3. Do option dikhenge — **URL prefix** wala chuno aur apna poora URL dalo, bilkul waise hi jaise browser me khulta hai:
   `https://APKA-DOMAIN/`  (https:// zaroori hai; www hai to www ke saath)
4. **Continue** dabao. Ab Google ownership verify karne ke tarike dikhayega.

## Step 2 — Ownership verify karo

Koi bhi **ek** tarika kaafi hai. Sabse aasan **HTML tag** wala hai:

### Tarika A — HTML tag (recommended, sirf 1 env variable)

1. Search Console me **HTML tag** option kholo. Aisa kuch dikhega:
   `<meta name="google-site-verification" content="AbCdEf123456..." />`
2. Sirf `content="..."` ke andar wala code copy karo (`AbCdEf123456...`).
3. Render Dashboard → aapki service → **Environment** → **Add Environment Variable**:

   ```text
   GOOGLE_SITE_VERIFICATION = AbCdEf123456...
   ```

4. Save karo; Render service khud restart ho jayegi (1–2 minute).
5. Search Console me wapas aakar **Verify** dabao. ✅ Verified aa jayega.

### Tarika B — HTML file upload

1. Search Console se `google1234abcd.html` file download karo.
2. Us file ko is repository ke root me (jahan `index.html` hai) daal kar commit/push karo.
3. Deploy ke baad `https://APKA-DOMAIN/google1234abcd.html` khul jayega → Search Console me **Verify** dabao.

### Tarika C — DNS record (agar apna domain hai)

Search Console jo TXT record dega, use apne domain provider (GoDaddy / Hostinger / Namecheap / Cloudflare) ke DNS me add karo aur Verify dabao. Isme 10 minute se kuch ghante lag sakte hain.

## Step 3 — Sitemap submit karo (1 minute)

1. Search Console me left menu → **Sitemaps** (Indexing section me).
2. "Add a new sitemap" box me sirf itna likho: `sitemap.xml`
3. **Submit** dabao. Status **Success** aana chahiye (kabhi kabhi kuch ghante lagte hain).

## Step 4 — Homepage ki indexing turant request karo (1 minute)

1. Upar search bar me (**URL Inspection**) apna homepage URL paste karo: `https://APKA-DOMAIN/`
2. **Request indexing** par click karo. Google 1–2 din me page crawl kar leta hai (kabhi kabhi 1–2 hafte).

Bas! Google par listing ka kaam yahin poora ho gaya. 🎉

---

## Kitna time lagega?

| Kaam | Samay |
| --- | --- |
| Google pehli baar site crawl kare | 1–7 din |
| `site:APKA-DOMAIN` search par site dikhne lage | 3–14 din |
| Brand name "InstantRCcard" search par top par aana | 2–4 hafte |
| "RC download online" jaise competitive keywords par upar aana | mahine lagte hain — neeche wale tips follow karo |

Progress dekhne ke liye Search Console → **Performance** report kholo. Waha clicks, impressions aur keywords dikhenge.

---

## Top search me aane ke liye aage kya karein (ranking tips)

Code me jo ho sakta tha wo ho gaya — title, description, canonical, structured data, FAQ content aur sitemap. Ranking ab in cheezon par depend karegi:

1. **Bing Webmaster Tools** (<https://www.bing.com/webmasters>) me bhi site add karo — "Import from Google Search Console" ek click me ho jata hai. Yahi listing DuckDuckGo aur Yahoo par bhi dikhati hai. Verification ke liye `BING_SITE_VERIFICATION` env variable support pehle se hai.
2. **Google Business Profile** banao (<https://business.google.com>) — brand name search par right side me card dikhega, WhatsApp number aur website link ke saath.
3. **Backlinks / mentions** — Instagram, Facebook page, YouTube video description, JustDial, IndiaMART, Quora answers, WhatsApp status me apni website ka link dalo. Naye domain ke liye yahi sabse bada signal hai.
4. **Alag pages banao** — jaise `/rc-download-online`, `/rc-card-print`, `/about`, `/contact`, `/privacy-policy`, `/terms`. Har page ek keyword target kare. Privacy policy aur Terms paid service ke liye Google ka trust bhi badhate hain. Naya page banane ke baad `server.js` me `PUBLIC_PAGES` list me uska path add kar do — sitemap me apne aap aa jayega.
5. **Reviews** — users se Google Business Profile par review lo; homepage ki rating ke saath ye real trust banata hai.
6. **Speed & mobile** — site pehle se fast aur PWA hai. Search Console me **Core Web Vitals** aur **Page Experience** report kabhi kabhi check karte raho.
7. **Content update** — offers/festival banners ke saath homepage ka text bhi thoda update karte raho; `sitemap.xml` ka `lastmod` har deploy par khud badal jata hai.

## Common problems

| Problem | Hal |
| --- | --- |
| Search Console: "Sitemap could not be read" | Pehle `https://APKA-DOMAIN/sitemap.xml` browser me kholo. Render free plan par pehli request slow ho sakti hai — 1–2 baar retry karo. |
| Verification fail | `GOOGLE_SITE_VERIFICATION` value me sirf code hona chahiye, poora `<meta ...>` tag nahi. Deploy complete hone ke baad hi Verify dabao. |
| "Discovered – currently not indexed" | Normal hai, naye site ke liye Google kuch din leta hai. Step 4 wali Request indexing 1 baar aur karo aur backlinks banao. |
| `onrender.com` aur custom domain dono index ho gaye | `SITE_URL` env variable set karo (upar Step 0). |
