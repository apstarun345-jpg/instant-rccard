/* App shell: sidebar, hash router, drawer, global actions, auto-refresh. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const ANALYTICS = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard', desc: 'KPIs & charts' },
    { id: 'trend', icon: '📈', label: 'Trend', desc: 'Daily · Monthly · Last vs Current' },
    { id: 'performance', icon: '🏆', label: 'Performance', desc: 'Agents & TLs (REPORT)' },
    { id: 'stock', icon: '📦', label: 'Stock', desc: 'Inventory (StockDataa)' }
  ];
  let current = { page: '', params: {}, token: 0 };
  let refreshTimer = null;

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [pathPart, queryPart] = raw.split('?');
    const segs = pathPart.split('/').filter(Boolean).map(decodeURIComponent);
    const params = {};
    new URLSearchParams(queryPart || '').forEach((v, k) => { params[k] = v; });
    let page = segs[0] || 'dashboard';
    if (page === 'sheet') { params.name = segs.slice(1).join('/'); }
    if (!FF.pages[page]) page = 'dashboard';
    return { page, params };
  }
  function buildHash(page, params) {
    const p = { ...params };
    let path = `#/${page}`;
    if (page === 'sheet') { path += `/${encodeURIComponent(p.name || '')}`; delete p.name; }
    const q = new URLSearchParams();
    Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
  }
  function navigate(page, params) { location.hash = buildHash(page, params || {}); }
  function updateParams(patch) { navigate(current.page, { ...current.params, ...patch }); }

  function renderSidebar() {
    const nav = U.$('#nav');
    const sheets = FF.config.sheets;
    nav.innerHTML = `<div class="nav-sec">Analytics</div>${ANALYTICS.map((a) => `<a class="nav-item" data-page="${a.id}" href="#/${a.id}"><span class="nav-ico">${a.icon}</span><span class="nav-text"><b>${a.label}</b><small>${a.desc}</small></span></a>`).join('')}
      <div class="nav-sec">Sheets <span class="nav-count">${sheets.length}</span></div>${sheets.map((s) => `<a class="nav-item sheet" data-page="sheet" data-name="${esc(s.name)}" href="#/sheet/${encodeURIComponent(s.name)}"><span class="nav-ico">${s.icon || '📄'}</span><span class="nav-text"><b>${esc(s.name)}</b><small>${esc(s.desc || '')}</small></span>${s.big ? '<span class="nav-pill">big</span>' : ''}</a>`).join('')}`;
  }
  function markActive() {
    U.$$('#nav .nav-item').forEach((a) => {
      const on = a.dataset.page === current.page && (current.page !== 'sheet' || a.dataset.name === current.params.name);
      a.classList.toggle('active', on);
    });
    const title = current.page === 'sheet' ? current.params.name : (FF.pages[current.page] && FF.pages[current.page].title) || '';
    U.$('#top-title').textContent = title;
    document.title = `${title} · ${FF.config.appName}`;
  }

  async function renderCurrent(ctx) {
    const { page, params } = parseHash();
    current = { page, params, token: current.token + 1 };
    const token = current.token;
    markActive();
    closeSidebar();
    const main = U.$('#main');
    const root = document.createElement('div');
    root.className = `page page-${page}`;
    main.replaceChildren(root);
    main.scrollTop = 0; window.scrollTo(0, 0);
    try {
      await FF.pages[page].render(root, params, ctx || {});
    } catch (err) {
      console.error(err);
      if (token === current.token) root.innerHTML = U.errorBox(err, 'data-action="refresh"');
    }
    if (token === current.token) updateStatus();
  }
  function updateStatus() {
    const el = U.$('#status');
    const t = FF.data.lastLoadAt;
    el.innerHTML = t ? `<span class="dot live"></span> Live · updated ${U.timeLabel(t)}${FF.data.lastSource === 'direct' ? ' · direct' : ''}` : '<span class="dot"></span> Connecting…';
  }
  function refresh() {
    FF.data.clearCache();
    U.toast('Google Sheet se fresh data la rahe hain…');
    renderCurrent({ fresh: true });
  }

  // ---- drawer -------------------------------------------------------------------
  function openDrawer({ kicker, title, sub, body }) {
    U.$('#drawer-kicker').textContent = kicker || '';
    U.$('#drawer-title').textContent = title || '';
    U.$('#drawer-sub').innerHTML = sub || '';
    U.$('#drawer-body').innerHTML = body || '';
    U.$('#drawer').classList.add('open');
    U.$('#drawer-backdrop').hidden = false;
    document.body.classList.add('no-scroll');
  }
  function closeDrawer() {
    U.$('#drawer').classList.remove('open');
    U.$('#drawer-backdrop').hidden = true;
    document.body.classList.remove('no-scroll');
  }
  function openSidebar() { document.body.classList.add('side-open'); }
  function closeSidebar() { document.body.classList.remove('side-open'); }

  function exportCard(btn) {
    const card = btn.closest('.card') || document;
    const table = card.querySelector('table');
    if (!table) return;
    const rows = [...table.querySelectorAll('tr')].map((tr) => [...tr.children].map((td) => td.textContent.replace(/\s+/g, ' ').trim()));
    U.downloadCsv(`${btn.dataset.name || 'export'}.csv`, rows[0] || [], rows.slice(1));
    U.toast('CSV downloaded');
  }

  function bind() {
    window.addEventListener('hashchange', () => renderCurrent());
    U.$('#menu-btn').addEventListener('click', () => document.body.classList.toggle('side-open'));
    U.$('#side-backdrop').addEventListener('click', closeSidebar);
    U.$('#top-refresh').addEventListener('click', refresh);
    U.$('#drawer-close').addEventListener('click', closeDrawer);
    U.$('#drawer-backdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeSidebar(); } });
    document.addEventListener('click', (e) => {
      const act = e.target.closest('[data-action]');
      if (act) {
        const a = act.dataset.action;
        if (a === 'refresh') refresh();
        else if (a === 'export') exportCard(act);
        else if (a === 'clear-filters') updateParams({ tl: '', agent: '' });
        return;
      }
      const link = e.target.closest('[data-link]');
      if (link && !e.target.closest('a')) { location.hash = link.dataset.link; return; }
      const paramBtn = e.target.closest('button[data-param]');
      if (paramBtn) { updateParams({ [paramBtn.dataset.param]: paramBtn.dataset.value }); }
      const drawerLink = e.target.closest('#drawer a[href^="#/"]');
      if (drawerLink) closeDrawer();
    });
    document.addEventListener('change', (e) => {
      const el = e.target.closest('select[data-param], input[data-param]');
      if (el) updateParams({ [el.dataset.param]: el.value, ...(el.dataset.param === 'tl' ? { agent: '' } : {}), ...(el.dataset.param === 'agent' ? { tl: '' } : {}) });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && FF.data.lastLoadAt && Date.now() - FF.data.lastLoadAt > FF.config.autoRefreshMs) refresh();
    });
    refreshTimer = setInterval(() => {
      if (document.visibilityState === 'visible' && current.page !== 'sheet') { FF.data.clearCache(); renderCurrent({ fresh: true, auto: true }); }
    }, FF.config.autoRefreshMs);
  }

  /* ---------- Project ZIP + setup guide (only when the server was started with DOWNLOAD_ZIP) ---------- */
  function fmtBytes(n) { return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`; }

  function setupGuideHtml(dl) {
    const esc = U.esc || ((v) => String(v));
    return `
      <div class="dl-card">
        <a class="btn primary big" href="${esc(dl.url)}" download="${esc(dl.name)}" id="zip-download-link">⬇️ Download ${esc(dl.name)}</a>
        <div class="dl-meta">${fmtBytes(dl.size)} · poora project (server + website) · koi dependency nahi</div>
      </div>
      <div class="guide">
        <div class="dsec"><h4>Step 1 · ZIP download & extract</h4>
          <ol>
            <li>Upar wale button se ZIP download karo aur <b>extract</b> karo → folder <code>first-forward-dashboard</code> milega (andar <code>server.js</code>, <code>index.html</code>, <code>js/</code> folder…).</li>
          </ol>
        </div>
        <div class="dsec"><h4>Step 2 · GitHub par repository</h4>
          <ol>
            <li><a href="https://github.com/new" target="_blank" rel="noopener">github.com/new</a> kholo → Repository name <code>First-Forward-Dashboard</code> → Public ya Private (dono chalega) → <b>Create repository</b>.</li>
            <li>Nayi repo ke page par <b>"uploading an existing file"</b> link par click karo.</li>
            <li>Extracted folder <b>ke andar</b> ki saari files/folders (<code>js</code> folder samet) drag-drop karo → <b>Commit changes</b>. <small>(Folder ko poora drag karoge to structure apne aap sahi rahega. <code>.gitignore</code> hidden hai — upload na ho to koi dikkat nahi.)</small></li>
          </ol>
          <details><summary>Git command line se karna ho to</summary>
<pre>cd first-forward-dashboard
git init
git add .
git commit -m "First Forward Dashboard"
git branch -M main
git remote add origin https://github.com/&lt;your-username&gt;/First-Forward-Dashboard.git
git push -u origin main</pre></details>
        </div>
        <div class="dsec"><h4>Step 3 · Render par deploy (free)</h4>
          <ol>
            <li><a href="https://dashboard.render.com" target="_blank" rel="noopener">dashboard.render.com</a> → <b>Sign in with GitHub</b>.</li>
            <li><b>New +</b> → <b>Blueprint</b> → apni <code>First-Forward-Dashboard</code> repo select karo → <b>Apply</b>. (Repo mein <code>render.yaml</code> hai, settings khud bhar jaayengi.)</li>
            <li>Ya manual: <b>New +</b> → <b>Web Service</b> → repo connect →
              <table class="kv">
                <tr><td>Runtime</td><td><code>Node</code></td></tr>
                <tr><td>Build Command</td><td><i>blank chhod do</i></td></tr>
                <tr><td>Start Command</td><td><code>npm start</code></td></tr>
                <tr><td>Instance Type</td><td><code>Free</code></td></tr>
              </table>
            </li>
            <li>1–2 min mein live: <code>https://first-forward-dashboard.onrender.com</code> (naam aap choose karoge).</li>
          </ol>
        </div>
        <div class="dsec"><h4>Step 4 · Zaroori baatein</h4>
          <ol>
            <li>Google Sheet ki sharing <b>"Anyone with the link → Viewer"</b> rehni chahiye (abhi hai). Sheet update → website 2 min mein update.</li>
            <li>Password lagana ho: Render → service → <b>Environment</b> → <code>DASH_PASSWORD</code> = apna password (user: <code>admin</code>).</li>
            <li>Free plan par 15 min idle ke baad pehla open 30–50 sec leta hai — normal hai.</li>
            <li>Website mein badlaav (naya tab, column shift): sirf <code>js/config.js</code> edit karke GitHub par replace karo → Render auto-deploy.</li>
          </ol>
        </div>
      </div>`;
  }

  async function setupDownload() {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (!res.ok) return;
      const health = await res.json();
      const dl = health && health.download;
      if (!dl || !dl.url) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'zip-btn';
      btn.className = 'btn primary zip-btn';
      btn.title = 'Project ZIP download + GitHub/Render steps';
      btn.innerHTML = '⬇️ <span>Download ZIP</span>';
      btn.addEventListener('click', () => openDrawer({
        kicker: 'Project files',
        title: 'First Forward Dashboard — ZIP',
        sub: 'ZIP download karo → GitHub par upload → Render par deploy. Neeche poore steps hain.',
        body: setupGuideHtml(dl)
      }));
      U.$('#top-actions').prepend(btn);
      if (location.hash === '#setup' || location.search.includes('setup=1')) btn.click();
    } catch { /* static hosting / offline → no button */ }
  }

  function init() {
    U.$('#brand-name').textContent = FF.config.brand;
    U.$('#sheet-link').href = FF.config.sheetUrl();
    renderSidebar();
    U.initTooltip();
    bind();
    renderCurrent();
    setupDownload();
  }

  FF.app = { navigate, updateParams, refresh, openDrawer, closeDrawer, get current() { return current; } };
  document.addEventListener('DOMContentLoaded', init);
})(window.FF);
