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

  function init() {
    U.$('#brand-name').textContent = FF.config.brand;
    U.$('#sheet-link').href = FF.config.sheetUrl();
    renderSidebar();
    U.initTooltip();
    bind();
    renderCurrent();
  }

  FF.app = { navigate, updateParams, refresh, openDrawer, closeDrawer, get current() { return current; } };
  document.addEventListener('DOMContentLoaded', init);
})(window.FF);
