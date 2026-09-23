/* Yadav Parking — SPA */
'use strict';

/* ================= state ================= */
const S = {
  token: localStorage.getItem('yp_token') || '',
  user: JSON.parse(localStorage.getItem('yp_user') || 'null'),
  view: 'home',
  summary: null,        // public summary (shop, rates)
  stats: null,          // admin stats
  passes: [],
  passFilter: 'live',
  passQuery: '',
  notifications: [],
  notifOpen: false,
  payments: [],
  customers: [],
  reportsFrom: null,
  authMode: 'login',
  bookForm: { vehicleTypeId: '', passType: 'hourly', hours: 12, advance: '', advanceMethod: 'cash' }
};

const $app = document.getElementById('app');
let pollTimer = null;

/* ================= helpers ================= */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n) { return '₹' + (Number(n) || 0).toLocaleString('en-IN'); }
function fmtDate(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function fmtDateTime(ts) {
  if (!ts) return '-';
  return new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}
function fmtMonth(ym) {
  const [y, m] = ym.split('-');
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short' });
}
function timeLeft(endAt) {
  const ms = endAt - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h < 1) return m + ' min';
  if (h < 48) return h + ' ghante ' + (m ? m + 'm' : '');
  const d = Math.floor(h / 24);
  return d + ' din' + (h % 24 ? ' ' + (h % 24) + 'h' : '');
}
function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  document.getElementById('toast-wrap').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2600);
  setTimeout(() => el.remove(), 3000);
}

/* ================= api ================= */
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (S.token) headers['Authorization'] = 'Bearer ' + S.token;
  const res = await fetch(path, {
    method: opts.method || (opts.body ? 'POST' : 'GET'),
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    if (res.status === 401 && S.token) { logout(false); }
    throw new Error(data.error || 'Kuch galat ho gaya');
  }
  return data;
}

/* ================= session ================= */
function saveSession(token, user) {
  S.token = token; S.user = user;
  localStorage.setItem('yp_token', token);
  localStorage.setItem('yp_user', JSON.stringify(user));
  if (window.AndroidBridge?.setSyncToken) {
    try { window.AndroidBridge.setSyncToken(token); } catch {}
  }
}
function logout(reload = true) {
  api('/api/auth/logout', { body: {} }).catch(() => {});
  S.token = ''; S.user = null;
  localStorage.removeItem('yp_token');
  localStorage.removeItem('yp_user');
  if (reload) location.reload();
}
const isAdmin = () => S.user?.role === 'admin';

/* ================= boot ================= */
async function boot() {
  try {
    S.summary = await api('/api/public/summary');
  } catch {
    $app.innerHTML = `<div class="boot-splash"><div class="boot-logo">📡</div>
      <div class="boot-name">Server se connect nahi ho paya</div>
      <div class="boot-sub">Internet check karke app dobara kholin</div></div>`;
    return;
  }
  if (S.token) {
    try {
      const me = await api('/api/auth/me');
      S.user = me.user;
      localStorage.setItem('yp_user', JSON.stringify(me.user));
    } catch { /* token expired -> logout(false) already fired inside api() */ }
  }
  if (S.user) {
    await refreshAll();
    show(S.view || 'home');
    startPolling();
  } else {
    show('auth');
  }
}

async function refreshAll() {
  const jobs = [loadSummary(), loadNotifications()];
  if (S.user?.role === 'admin') jobs.push(loadStats());
  await Promise.allSettled(jobs);
}

async function loadSummary() {
  try { S.summary = await api('/api/public/summary'); } catch {}
  if (S.user?.role === 'admin') {
    try {
      const cfg = await api('/api/config');
      Object.assign(S.summary, cfg.config);
      const full = await api('/api/vehicle-types');
      S.summary.vehicleTypes = full.vehicleTypes;
    } catch {}
  }
}
async function loadStats() {
  try { S.stats = await api('/api/stats'); } catch {}
}
async function loadNotifications() {
  if (!S.token) return;
  try {
    const d = await api('/api/notifications');
    const prev = S.notifications;
    S.notifications = d.notifications || [];
    notifyAndroid(prev, S.notifications);
    updateBadge();
  } catch {}
}

/* Android native notifications (new items only, persistently deduped) */
function notifyAndroid(prevList, nextList) {
  if (!window.AndroidBridge?.notify) return;
  let seen;
  try { seen = new Set(JSON.parse(localStorage.getItem('yp_seen_notif') || '[]')); }
  catch { seen = new Set(); }
  const fresh = nextList.filter((n) => !seen.has(n.id)).slice(0, 4);
  for (const n of fresh) {
    try { window.AndroidBridge.notify(n.title, n.message); } catch {}
    seen.add(n.id);
  }
  if (fresh.length) {
    const arr = [...seen].slice(-200);
    try { localStorage.setItem('yp_seen_notif', JSON.stringify(arr)); } catch {}
  }
}
function updateBadge() {
  const btn = document.getElementById('bell-btn');
  if (!btn) return;
  const n = S.notifications.length;
  btn.querySelector('.badge')?.remove();
  if (n > 0) {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = n > 9 ? '9+' : n;
    btn.appendChild(b);
  }
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const prevView = S.view;
    await refreshAll();
    if (!S.notifOpen) render(); // current screen silently refresh
    else renderNotifSheet();
    void prevView;
  }, 45000);
}

/* ================= router ================= */
const VIEWS = ['home', 'passes', 'book', 'rates', 'reports', 'profile'];
function show(view) {
  S.view = view;
  render();
  window.scrollTo(0, 0);
}
function render() {
  if (!S.user) { renderAuth(); return; }
  const map = {
    home: renderHome, passes: renderPasses, book: renderBook,
    rates: renderRates, reports: renderReports, profile: renderProfile
  };
  const fn = map[S.view] || renderHome;
  const navHtml = isAdmin() ? navAdmin() : navCustomer();
  const fabHtml = isAdmin() && (S.view === 'home' || S.view === 'passes') ? `<button class="fab" onclick="show('book')" title="Naya pass">＋</button>` : '';
  const shell = (inner) => `
    <div class="screen">
      ${headerHtml()}
      <div class="content">${inner}</div>
    </div>
    ${navHtml}${fabHtml}`;
  const out = fn();
  if (out && typeof out.then === 'function') {
    $app.innerHTML = shell(`<div class="empty"><div class="e-icon">⏳</div><div class="e-t">Laa rahe hain…</div></div>`);
    out.then((html) => {
      $app.innerHTML = shell(html);
      updateBadge();
    }).catch((e) => {
      $app.innerHTML = shell(`<div class="empty"><div class="e-icon">😵</div><div class="e-t">${esc(e.message)}</div></div>`);
    });
  } else {
    $app.innerHTML = shell(out);
    updateBadge();
  }
}
function headerHtml() {
  const shop = esc(S.summary?.shopName || 'Yadav Parking');
  const area = esc(S.summary?.area || '');
  return `
    <div class="header">
      <div class="header-row">
        <div>
          <h1>🅿️ ${shop}</h1>
          <div class="sub">${area}</div>
        </div>
        <div class="spacer"></div>
        <button class="icon-btn" id="bell-btn" onclick="openNotifSheet()">🔔</button>
        <button class="avatar-btn" onclick="show('profile')">
          ${esc((S.user.name || '?').slice(0, 1))} <span class="role-chip">${isAdmin() ? 'ADMIN' : 'CUSTOMER'}</span>
        </button>
      </div>
    </div>`;
}
function navAdmin() {
  const item = (v, icon, label) =>
    `<button class="${S.view === v ? 'active' : ''}" onclick="show('${v}')"><span class="ni">${icon}</span>${label}</button>`;
  return `<nav class="bottom-nav">
    ${item('home', '🏠', 'Home')}
    ${item('passes', '🎫', 'Passes')}
    ${item('book', '➕', 'Naya Pass')}
    ${item('reports', '💰', 'Kamai')}
    ${item('profile', '⚙️', 'Setings')}
  </nav>`;
}
function navCustomer() {
  const item = (v, icon, label) =>
    `<button class="${S.view === v ? 'active' : ''}" onclick="show('${v}')"><span class="ni">${icon}</span>${label}</button>`;
  return `<nav class="bottom-nav">
    ${item('home', '🏠', 'Mere Pass')}
    ${item('book', '➕', 'Booking')}
    ${item('rates', '🏷️', 'Rate')}
    ${item('profile', '👤', 'Profile')}
  </nav>`;
}

/* ================= auth ================= */
function renderAuth() {
  const mode = S.authMode;
  $app.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-logo">
        <div class="al">🅿️</div>
        <div class="an">${esc(S.summary?.shopName || 'Yadav Parking')}</div>
        <div class="as">${esc(S.summary?.area || 'Kanakpura, Jaipur')} — Parking Pass System</div>
      </div>
      <div class="card">
        <div class="auth-tabs">
          <button class="${mode === 'login' ? 'on' : ''}" onclick="S.authMode='login';render()">Login</button>
          <button class="${mode === 'signup' ? 'on' : ''}" onclick="S.authMode='signup';render()">Naya Account</button>
        </div>
        <div id="auth-fields">
          ${mode === 'signup' ? `
          <div class="field"><label>Aapka Naam</label><input id="a-name" placeholder="jaise: Ramesh Yadav" autocomplete="name"></div>` : ''}
          <div class="field"><label>Mobile Number</label><input id="a-mobile" type="tel" inputmode="numeric" maxlength="10" placeholder="10 digit mobile" autocomplete="tel"></div>
          <div class="field"><label>Password</label><input id="a-pass" type="password" placeholder="${mode === 'signup' ? 'kam se kam 4 character' : 'apna password'}" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></div>
          ${mode === 'signup' ? `<div class="field"><label>Password (dobara)</label><input id="a-pass2" type="password" placeholder="same password" autocomplete="new-password"></div>` : ''}
          <button class="btn primary block" onclick="doAuth()">${mode === 'login' ? '🔐 Login Karein' : '📝 Account Banayein'}</button>
          <p class="center small muted mt12 mb0">${mode === 'login'
            ? 'Pehli baar? <b>Naya Account</b> banayein. Pehla account admin banta hai.'
            : 'Admin (uncle ji) pehla account banega — uske baad wale sab customer honge.'}</p>
        </div>
      </div>
      ${S.summary?.notice ? `<div class="notice-strip">⚠️ ${esc(S.summary.notice)}</div>` : ''}
    </div>`;
  const mob = document.getElementById('a-mobile');
  mob?.addEventListener('input', () => { mob.value = mob.value.replace(/\D/g, '').slice(0, 10); });
}

async function doAuth() {
  const mobile = document.getElementById('a-mobile')?.value.trim();
  const pass = document.getElementById('a-pass')?.value;
  try {
    if (S.authMode === 'signup') {
      const name = document.getElementById('a-name')?.value.trim();
      const pass2 = document.getElementById('a-pass2')?.value;
      if (pass !== pass2) return toast('Dono password same likhein', 'err');
      const d = await api('/api/auth/signup', { body: { name, mobile, password: pass } });
      saveSession(d.token, d.user);
      toast('Swagat hai, ' + d.user.name + '! 🎉', 'ok');
    } else {
      const d = await api('/api/auth/login', { body: { mobile, password: pass } });
      saveSession(d.token, d.user);
      toast('Welcome back, ' + d.user.name + '! 👋', 'ok');
    }
    S.view = 'home';
    await refreshAll();
    show('home');
    startPolling();
  } catch (e) {
    toast(e.message, 'err');
  }
}

/* ================= HOME (admin dashboard) ================= */
function renderHome() {
  if (!isAdmin()) return renderCustomerHome();
  const st = S.stats;
  if (!st) return `<div class="empty"><div class="e-icon">⏳</div><div class="e-t">Data laa rahe hain…</div></div>`;
  const exp = st.expiring;
  const expiringList = S.notifications.filter((n) => n.kind === 'expiring' || n.kind === 'expired').slice(0, 5);
  const pendingList = S.notifications.filter((n) => n.kind === 'pending').slice(0, 5);
  return `
    <div class="stat-grid">
      <div class="stat amber"><div class="label">💰 Aaj ki Kamai</div><div class="value">${money(st.revenue.today)}</div><div class="hint">Is mahine: ${money(st.revenue.month)}</div></div>
      <div class="stat blue"><div class="label">🎫 Active Passes</div><div class="value">${st.activeTotal}</div><div class="hint">${st.pendingRequests} booking request pending</div></div>
      <div class="stat red"><div class="label">⏰ 24 ghante mein khatam</div><div class="value">${exp.in24h}</div><div class="hint">48h: ${exp.in48h} · 7 din: ${exp.in7d}</div></div>
      <div class="stat green"><div class="label">✅ Total Vasooli</div><div class="value">${money(st.revenue.total)}</div><div class="hint">Baki due: ${money(st.revenue.pendingDue)}</div></div>
    </div>

    ${st.pendingRequests > 0 ? `
    <div class="sec-head"><span class="t">🆕 Booking Requests</span><span class="n">${st.pendingRequests}</span></div>
    <div class="card">
      ${pendingList.length ? pendingList.map((n) => pendingRow(n)).join('') : `<div class="small muted">Requests dekhein: Passes → Pending</div>`}
    </div>` : ''}

    <div class="sec-head">
      <span class="t">🔔 Pass Alerts</span><span class="n">${S.notifications.length}</span>
      <span class="spacer"></span><button onclick="S.passFilter='live';show('passes');loadPasses()">Sab dekhein →</button>
    </div>
    <div class="card">
      ${expiringList.length ? expiringList.map(notifRow).join('') : `
        <div class="empty"><div class="e-icon">✅</div><div class="e-t">Sab theek hai!</div>
        <div class="e-s">Agle ${S.summary?.alertDays || 3} din mein koi pass khatam nahi hoga.</div></div>`}
    </div>

    <div class="sec-head"><span class="t">🚗 Vehicle-wise</span></div>
    <div class="card">
      ${Object.entries(st.byType).map(([id, t]) => `
        <div class="list-item" onclick="S.passFilter='live';show('passes');loadPasses()">
          <div class="li-icon">${t.icon}</div>
          <div class="li-main">
            <div class="li-title">${esc(t.name)}</div>
            <div class="li-sub">${t.active} active · ${t.expired} khatam</div>
          </div>
          <div class="li-end"><div class="top">${money(t.revenue)}</div><div class="bot">total kamai</div></div>
        </div>`).join('')}
    </div>

    <div class="sec-head"><span class="t">📈 Pichhle 6 Mahine</span></div>
    <div class="card">${barChart(st.monthlySeries)}</div>

    <div class="card" style="background:linear-gradient(135deg,#eff6ff,#dbeafe)">
      <div class="row">
        <div style="font-size:26px">🧾</div>
        <div style="flex:1">
          <div style="font-weight:800;color:var(--navy)">Hisab kitab</div>
          <div class="small muted">Kamai, dues aur payment history — sab kuch “Kamai” tab mein.</div>
        </div>
        <button class="btn sm primary" onclick="show('reports')">Kholin</button>
      </div>
    </div>
  `;
}

function barChart(series) {
  const max = Math.max(1, ...series.map((s) => s.amount));
  return `<div class="chart">${series.map((s) => `
    <div class="bar-w">
      <div class="bv">${s.amount ? (s.amount >= 1000 ? (s.amount / 1000).toFixed(1) + 'k' : s.amount) : ''}</div>
      <div class="bar ${s.amount ? '' : 'zero'}" style="height:${Math.max(3, (s.amount / max) * 84)}px"></div>
      <div class="bl">${esc(s.label)}</div>
    </div>`).join('')}</div>`;
}

function notifRow(n) {
  const icon = n.kind === 'expired' ? '⛔' : n.kind === 'expiring' ? '⏰' : '🆕';
  const cls = n.kind === 'expired' ? 'expired' : n.kind === 'expiring' ? 'expiring' : 'pending';
  return `
    <div class="list-item" onclick="openPassSheet('${n.passId}')">
      <div class="li-icon">${icon}</div>
      <div class="li-main">
        <div class="li-title">${esc(n.title)}</div>
        <div class="li-sub">${esc(n.message)}</div>
      </div>
      <span class="tag ${cls}">${n.kind === 'expired' ? 'KHATAM' : n.kind === 'expiring' ? 'JALDI' : 'PENDING'}</span>
    </div>`;
}
function pendingRow(n) {
  return `
    <div class="list-item" onclick="openPassSheet('${n.passId}')">
      <div class="li-icon">🆕</div>
      <div class="li-main">
        <div class="li-title">${esc(n.message.split(' ne ')[0] || 'Customer')}</div>
        <div class="li-sub">${esc(n.message)}</div>
      </div>
      <span class="tag pending">NAYA</span>
    </div>`;
}

/* customer home = mere passes */
async function renderCustomerHome() {
  let passes = [];
  try {
    const d = await api('/api/passes');
    passes = d.passes || [];
  } catch (e) { /* ignore */ }
  const live = passes.filter((p) => p.status === 'active' || p.status === 'expired');
  const other = passes.filter((p) => !['active', 'expired'].includes(p.status));
  const alert = S.notifications[0];
  return `
    ${alert ? `<div class="notice-strip" onclick="openPassSheet('${alert.passId}')" style="cursor:pointer">🔔 ${esc(alert.message)}</div>` : ''}
    ${S.summary?.notice ? `<div class="notice-strip">⚠️ ${esc(S.summary.notice)}</div>` : ''}
    <div class="stat-grid">
      <div class="stat blue"><div class="label">🎫 Mere Pass</div><div class="value">${live.length}</div><div class="hint">chal rahe passes</div></div>
      <div class="stat green"><div class="label">✅ Total Bookings</div><div class="value">${passes.length}</div><div class="hint">ab tak ke</div></div>
    </div>
    <div class="sec-head"><span class="t">🎫 Chal Rahe Passes</span></div>
    <div class="card">
      ${live.length ? live.map((p) => passRow(p)).join('') : `
      <div class="empty"><div class="e-icon">🅿️</div><div class="e-t">Abhi koi pass nahi</div>
      <div class="e-s">Booking tab se apni gadi ka pass book karein.</div></div>`}
    </div>
    ${other.length ? `
    <div class="sec-head"><span class="t">📋 Purane / Requests</span></div>
    <div class="card">${other.map((p) => passRow(p)).join('')}</div>` : ''}
    <div class="sec-head"><span class="t">🏷️ Aaj Ke Rate</span></div>
    <div class="card">${ratesTableHtml()}</div>
  `;
}

/* ================= RATES ================= */
function ratesTableHtml() {
  const vts = (S.summary?.vehicleTypes || []);
  const md = S.summary?.monthlyDays || 30;
  const qd = S.summary?.quarterlyDays || 90;
  return `
    <table class="rate-table">
      <tr><th>Vehicle</th><th>Per ${vts[0]?.rate?.blockHours || 12}h</th><th>Monthly</th><th>Quarterly</th></tr>
      ${vts.map((v) => `<tr>
        <td>${v.icon} ${esc(v.name)}</td>
        <td>${money(v.rate.blockPrice)}</td>
        <td>${money(v.rate.monthlyPrice)}</td>
        <td>${money(v.rate.quarterlyPrice)}</td>
      </tr>`).join('')}
    </table>
    <div class="small muted mt8">Monthly = ${md} din · Quarterly = ${qd} din. Hourly pass ${vts[0]?.rate?.blockHours || 12} ghante ke block mein ginta hai.</div>
  `;
}
function renderRates() {
  if (!isAdmin()) {
    return `<div class="sec-head"><span class="t">🏷️ Parking Rate List</span></div>
      <div class="card">${ratesTableHtml()}</div>
      <div class="card" style="background:linear-gradient(135deg,#fffbeb,#fef3c7)">
        <div class="row"><div style="font-size:24px">📞</div>
        <div class="small" style="color:#92400e"><b>Booking ke liye:</b> uncle ji se parking counter par baat karein ya “Booking” tab se request bhejein.</div></div>
      </div>`;
  }
  const vts = S.summary?.vehicleTypes || [];
  return `
    <div class="sec-head"><span class="t">🏷️ Rate Card (aap set karte hain)</span></div>
    <div class="card">
      ${vts.map((v) => `
      <div class="list-item" onclick="editRateSheet('${v.id}')">
        <div class="li-icon">${v.icon}</div>
        <div class="li-main">
          <div class="li-title">${esc(v.name)}</div>
          <div class="li-sub">${money(v.rate.blockPrice)}/${v.rate.blockHours}h · ${money(v.rate.monthlyPrice)}/m · ${money(v.rate.quarterlyPrice)}/q</div>
        </div>
        ${v.active ? '<span class="tag active">ON</span>' : '<span class="tag closed">OFF</span>'}
        <div style="font-size:18px;color:var(--muted)">›</div>
      </div>`).join('')}
      <button class="btn ghost block mt12" onclick="editRateSheet(null)">➕ Naya Vehicle Type</button>
    </div>
    <div class="sec-head"><span class="t">⚙️ Dukan Settings</span></div>
    <div class="card">
      <button class="btn plain block" onclick="shopSettingsSheet()">🏪 Shop name, notice, alert din badlein</button>
    </div>
  `;
}

function editRateSheet(id) {
  const vt = id ? (S.summary?.vehicleTypes || []).find((v) => v.id === id) : null;
  openSheet(`
    <div class="grab"></div>
    <h2>${vt ? 'Rate Badlein' : 'Naya Vehicle Type'}</h2>
    <div class="sheet-sub">Jo rate yahan set karoge wahi customer ko dikhega aur booking mein lagega.</div>
    <div class="form-row">
      <div class="field"><label>Icon (emoji)</label><input id="r-icon" value="${esc(vt?.icon || '🛵')}" maxlength="4"></div>
      <div class="field"><label>Naam</label><input id="r-name" value="${esc(vt?.name || '')}" placeholder="jaise: E-Rickshaw"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Block (ghante)</label><input id="r-bh" type="number" min="1" value="${vt?.rate?.blockHours ?? 12}"></div>
      <div class="field"><label>Block ka Rate ₹</label><input id="r-bp" type="number" min="0" value="${vt?.rate?.blockPrice ?? 20}"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Monthly ₹</label><input id="r-mp" type="number" min="0" value="${vt?.rate?.monthlyPrice ?? 250}"></div>
      <div class="field"><label>Quarterly ₹</label><input id="r-qp" type="number" min="0" value="${vt?.rate?.quarterlyPrice ?? 600}"></div>
    </div>
    ${vt ? `
    <div class="field row" style="justify-content:space-between">
      <label style="margin:0">Booking mein dikhe?</label>
      <select id="r-active" style="width:110px;border:1.5px solid var(--line);border-radius:10px;padding:8px">
        <option value="1" ${vt.active ? 'selected' : ''}>Haan</option>
        <option value="0" ${!vt.active ? 'selected' : ''}>Nahi (hide)</option>
      </select>
    </div>` : ''}
    <button class="btn primary block" onclick="saveRate('${id || ''}')">💾 Save Karein</button>
    ${vt && !vt.active ? `<button class="btn red block mt8" onclick="deleteRate('${vt.id}')">🗑️ Hata Dein</button>` : ''}
  `);
}
async function saveRate(id) {
  const body = {
    icon: document.getElementById('r-icon')?.value || '🛵',
    name: document.getElementById('r-name')?.value,
    rate: {
      blockHours: Number(document.getElementById('r-bh')?.value || 12),
      blockPrice: Number(document.getElementById('r-bp')?.value || 0),
      monthlyPrice: Number(document.getElementById('r-mp')?.value || 0),
      quarterlyPrice: Number(document.getElementById('r-qp')?.value || 0)
    }
  };
  const activeSel = document.getElementById('r-active');
  if (activeSel && id) body.active = activeSel.value === '1';
  try {
    if (id) await api('/api/vehicle-types/' + id, { method: 'PUT', body });
    else await api('/api/vehicle-types', { body });
    toast('Rate save ho gaya ✅', 'ok');
    closeSheet();
    await loadSummary();
    render();
  } catch (e) { toast(e.message, 'err'); }
}
async function deleteRate(id) {
  if (!confirm('Ye vehicle type hatana hai?')) return;
  try {
    await api('/api/vehicle-types/' + id, { method: 'DELETE' });
    toast('Hata diya gaya', 'ok');
    closeSheet();
    await loadSummary();
    render();
  } catch (e) { toast(e.message, 'err'); }
}

function shopSettingsSheet() {
  const c = S.stats?.shopName ? S.summary : S.summary;
  openSheet(`
    <div class="grab"></div>
    <h2>🏪 Dukan Settings</h2>
    <div class="field"><label>Shop ka Naam</label><input id="s-name" value="${esc(S.summary?.shopName || '')}"></div>
    <div class="field"><label>Area / Pata</label><input id="s-area" value="${esc(S.summary?.area || '')}"></div>
    <div class="field"><label>UPI ID (payment ke liye)</label><input id="s-upi" value="${esc(c?.upiId || '')}" placeholder="yadav@upi"></div>
    <div class="field"><label>Notice (board pe likha)</label><textarea id="s-notice" rows="2">${esc(S.summary?.notice || '')}</textarea></div>
    <div class="form-row">
      <div class="field"><label>Alert kitne din pehle</label><input id="s-alert" type="number" min="1" max="30" value="${S.summary?.alertDays ?? 3}"></div>
      <div class="field"><label>Monthly = kitne din</label><input id="s-md" type="number" min="1" max="60" value="${S.summary?.monthlyDays ?? 30}"></div>
    </div>
    <div class="field"><label>Quarterly = kitne din</label><input id="s-qd" type="number" min="1" max="120" value="${S.summary?.quarterlyDays ?? 90}"></div>
    <button class="btn primary block" onclick="saveShop()">💾 Save Karein</button>
  `);
}
async function saveShop() {
  try {
    await api('/api/config', {
      method: 'PUT',
      body: {
        shopName: document.getElementById('s-name')?.value,
        area: document.getElementById('s-area')?.value,
        upiId: document.getElementById('s-upi')?.value,
        notice: document.getElementById('s-notice')?.value,
        alertDays: Number(document.getElementById('s-alert')?.value || 3),
        monthlyDays: Number(document.getElementById('s-md')?.value || 30),
        quarterlyDays: Number(document.getElementById('s-qd')?.value || 90)
      }
    });
    toast('Settings save ✅', 'ok');
    closeSheet();
    await loadSummary();
    render();
  } catch (e) { toast(e.message, 'err'); }
}

/* ================= PASSES list ================= */
function renderPasses() {
  const filters = [
    ['live', 'Chal rahe'], ['active', 'Active'], ['expiring', 'Jald khatam'],
    ['expired', 'Khatam'], ['pending', 'Requests'], ['closed', 'Closed'], ['all', 'Sabhi']
  ];
  const count = S.passes.length;
  return `
    <div class="search-bar">🔍<input id="pass-q" placeholder="Naam, mobile ya gaadi number se dhundein…" value="${esc(S.passQuery)}"></div>
    <div class="chip-row">
      ${filters.map(([k, l]) => `<button class="chip ${S.passFilter === k ? 'sel' : ''}" onclick="setPassFilter('${k}')">${l}</button>`).join('')}
    </div>
    <div class="sec-head"><span class="t">🎫 Passes</span><span class="n">${count}</span></div>
    <div class="card" id="pass-list">${passListHtml()}</div>
  `;
}
function passListHtml() {
  if (!S.passes.length) {
    return `<div class="empty"><div class="e-icon">🎫</div><div class="e-t">Koi pass nahi mila</div>
      <div class="e-s">Filter badal kar dekhein ya naya pass book karein.</div></div>`;
  }
  return S.passes.map(passRow).join('');
}
function passTag(p) {
  if (p.status === 'pending') return '<span class="tag pending">REQUEST</span>';
  if (p.status === 'closed') return '<span class="tag closed">CLOSED</span>';
  if (p.status === 'expired') return '<span class="tag expired">KHATAM</span>';
  const left = timeLeft(p.endAt);
  const hot = (p.endAt - Date.now()) < 48 * 3600000;
  return `<span class="tag ${hot ? 'expiring' : 'active'}">${hot ? '⏰ ' : ''}${esc(left || '')}</span>`;
}
function passRow(p) {
  return `
    <div class="list-item" onclick="openPassSheet('${p.id}')">
      <div class="li-icon">${p.vehicleIcon || '🏍️'}</div>
      <div class="li-main">
        <div class="li-title">${esc(p.name)}${p.vehicleNo && p.vehicleNo !== '—' ? ` <span class="muted small">· ${esc(p.vehicleNo)}</span>` : ''}</div>
        <div class="li-sub">${esc(p.vehicleLabel)} · ${passTypeNameHindi(p.passType)} · ${fmtDate(p.startAt)} se</div>
      </div>
      <div class="li-end">
        <div class="top">${passTag(p)}</div>
        <div class="bot">${p.due > 0 ? `<span class="tag due">Due ${money(p.due)}</span>` : '<span class="tag paid">Paid ✓</span>'}</div>
      </div>
    </div>`;
}
function passTypeNameHindi(t) { return t === 'monthly' ? 'Monthly' : t === 'quarterly' ? 'Quarterly' : 'Hourly'; }

function setPassFilter(k) {
  S.passFilter = k;
  render();
  loadPasses();
}
async function loadPasses() {
  const q = document.getElementById('pass-q')?.value ?? S.passQuery;
  S.passQuery = q;
  try {
    const d = await api(`/api/passes?status=${encodeURIComponent(S.passFilter)}&q=${encodeURIComponent(q)}`);
    S.passes = d.passes || [];
    const list = document.getElementById('pass-list');
    if (list) list.innerHTML = passListHtml();
    const nEl = document.querySelector('.sec-head .n');
    if (nEl) nEl.textContent = S.passes.length;
  } catch (e) { toast(e.message, 'err'); }
}

/* pass detail sheet */
async function openPassSheet(id) {
  let d;
  try { d = await api('/api/passes/' + id); }
  catch (e) { return toast(e.message, 'err'); }
  const p = d.pass;
  const pays = d.payments || [];
  const left = timeLeft(p.endAt);
  const hot = p.endAt - Date.now() < 48 * 3600000;
  openSheet(`
    <div class="grab"></div>
    <div class="row">
      <h2>${p.vehicleIcon || '🏍️'} ${esc(p.name)}</h2><span class="spacer"></span>${passTag(p)}
    </div>
    <div class="sheet-sub">${esc(p.vehicleLabel)} · ${p.vehicleNo && p.vehicleNo !== '—' ? '🚩 ' + esc(p.vehicleNo) : ''} · 📞 ${esc(p.mobile)}</div>

    <div class="card">
      <div class="tl">
        <span class="tl-dot"></span><span class="tl-lab">${fmtDate(p.startAt)}</span>
        <span class="tl-line"></span>
        <span class="tl-lab">${fmtDate(p.endAt)}</span><span class="tl-dot end"></span>
      </div>
      <div class="kv"><span class="k">Pass Type</span><span class="v">${passTypeNameHindi(p.passType)}${p.hours ? ` (${p.hours} ghante)` : ''}</span></div>
      <div class="kv"><span class="k">${p.status === 'expired' ? 'Khatam hua' : 'Bacha hai'}</span><span class="v" style="color:${hot ? 'var(--red)' : 'var(--green)'}">${p.status === 'expired' ? fmtDateTime(p.endAt) : (left || '-')}</span></div>
      <div class="kv"><span class="k">Total Kiraya</span><span class="v">${money(p.price)}</span></div>
      <div class="kv"><span class="k">Jama hua</span><span class="v" style="color:var(--green)">${money(p.paid)}</span></div>
      <div class="kv"><span class="k">${p.due > 0 ? '🔴 Baki' : '✅ Baki'}</span><span class="v" style="color:${p.due > 0 ? 'var(--red)' : 'var(--green)'}">${money(p.due)}</span></div>
      ${p.note ? `<div class="kv"><span class="k">Note</span><span class="v">${esc(p.note)}</span></div>` : ''}
    </div>

    ${isAdmin() ? `
    <div class="btn-row">
      ${p.status === 'pending' ? `<button class="btn green" onclick="setPassStatus('${p.id}','active')">✅ Confirm Karein</button>
        <button class="btn red" onclick="deletePass('${p.id}')">✖ Reject</button>` : ''}
      ${p.status === 'active' ? `<button class="btn amber" onclick="checkoutPass('${p.id}')">🏁 Checkout</button>` : ''}
      ${['active','expired'].includes(p.status) ? `<button class="btn ghost" onclick="renewSheet('${p.id}')">🔄 Renew</button>` : ''}
      <button class="btn plain" onclick="paymentSheet('${p.id}',${p.due})">💵 Payment</button>
    </div>
    <div class="btn-row mt8">
      <button class="btn plain" onclick="editPassSheet('${p.id}')">✏️ Edit</button>
      <button class="btn red" onclick="deletePass('${p.id}')">🗑️ Delete</button>
    </div>` : `
    <div class="notice-strip" style="margin-top:4px">💡 Payment ya renew ke liye counter par sampark karein.</div>`}

    <div class="sec-head mt12"><span class="t">💵 Payment History</span><span class="n">${pays.length}</span></div>
    <div class="card">
      ${pays.length ? pays.map((x) => `
        <div class="list-item" style="cursor:default">
          <div class="li-icon">💰</div>
          <div class="li-main">
            <div class="li-title">${money(x.amount)} <span class="tag method">${x.method === 'upi' ? 'UPI' : 'CASH'}</span></div>
            <div class="li-sub">${fmtDateTime(x.at)}${x.note ? ' · ' + esc(x.note) : ''}</div>
          </div>
          ${isAdmin() ? `<button class="btn sm red" onclick="deletePayment('${x.id}','${p.id}')">✕</button>` : ''}
        </div>`).join('') : `<div class="small muted center">Abhi koi payment nahi hui</div>`}
    </div>
  `);
}

function paymentSheet(id, due) {
  openSheet(`
    <div class="grab"></div>
    <h2>💵 Payment Leyin</h2>
    <div class="sheet-sub">${due > 0 ? 'Baki: <b>' + money(due) + '</b>' : 'Is pass par sab clear hai — advance bhi le sakte hain.'}</div>
    <div class="form-row">
      <div class="field"><label>Amount ₹</label><input id="pay-amt" type="number" min="1" value="${due > 0 ? due : ''}" placeholder="kitne rupeye?"></div>
      <div class="field"><label>Method</label><select id="pay-method"><option value="cash">💵 Cash</option><option value="upi">📱 UPI</option></select></div>
    </div>
    <div class="field"><label>Note (optional)</label><input id="pay-note" placeholder="jaise: baki jama"></div>
    <button class="btn green block" onclick="addPayment('${id}')">✅ Payment Entry Karein</button>
  `);
}
async function addPayment(id) {
  const amount = Number(document.getElementById('pay-amt')?.value || 0);
  try {
    await api(`/api/passes/${id}/payments`, { body: { amount, method: document.getElementById('pay-method')?.value, note: document.getElementById('pay-note')?.value } });
    toast(money(amount) + ' jama ho gaya ✅', 'ok');
    await Promise.all([loadStats(), loadNotifications()]);
    openPassSheet(id);
    render();
  } catch (e) { toast(e.message, 'err'); }
}
async function deletePayment(pid, passId) {
  try {
    await api('/api/payments/' + pid, { method: 'DELETE' });
    toast('Payment hatayi gayi', 'ok');
    openPassSheet(passId);
    await Promise.all([loadStats(), loadNotifications()]);
    render();
  } catch (e) { toast(e.message, 'err'); }
}

function renewSheet(id) {
  const vts = S.summary?.vehicleTypes || [];
  const cur = S.passes.find((x) => x.id === id);
  const vtId = cur?.vehicleTypeId;
  const vt = vts.find((v) => v.id === vtId);
  openSheet(`
    <div class="grab"></div>
    <h2>🔄 Pass Renew Karein</h2>
    <div class="sheet-sub">Naya period aaj/last date ke baad se shuru hoga, rate automatic lagega.</div>
    <div class="pt-grid">
      <div class="pt-card sel" data-pt="hourly" onclick="selPt(this)"><div class="pt-name">Hourly</div><div class="pt-price">${money(vt?.rate?.blockPrice || 0)}</div><div class="pt-sub">per ${vt?.rate?.blockHours || 12}h</div></div>
      <div class="pt-card" data-pt="monthly" onclick="selPt(this)"><div class="pt-name">Monthly</div><div class="pt-price">${money(vt?.rate?.monthlyPrice || 0)}</div><div class="pt-sub">${S.summary?.monthlyDays || 30} din</div></div>
      <div class="pt-card" data-pt="quarterly" onclick="selPt(this)"><div class="pt-name">Quarterly</div><div class="pt-price">${money(vt?.rate?.quarterlyPrice || 0)}</div><div class="pt-sub">${S.summary?.quarterlyDays || 90} din</div></div>
    </div>
    <div class="field mt8" id="renew-hours-w"><label>Kitne ghante?</label><input id="renew-hours" type="number" min="1" value="${vt?.rate?.blockHours || 12}"></div>
    <button class="btn primary block" onclick="doRenew('${id}')">🔄 Renew Karein</button>
  `);
}
function selPt(el) {
  el.parentElement.querySelectorAll('.pt-card').forEach((x) => x.classList.remove('sel'));
  el.classList.add('sel');
  const w = document.getElementById('renew-hours-w');
  if (w) w.style.display = el.dataset.pt === 'hourly' ? 'block' : 'none';
}
async function doRenew(id) {
  const pt = document.querySelector('.sheet .pt-card.sel')?.dataset.pt || 'hourly';
  const hours = Number(document.getElementById('renew-hours')?.value || 12);
  try {
    const d = await api(`/api/passes/${id}/renew`, { body: { passType: pt, hours } });
    toast('Pass renew ho gaya! Nayi expiry: ' + fmtDate(d.pass.endAt), 'ok');
    closeSheet();
    await Promise.all([loadStats(), loadNotifications()]);
    render();
  } catch (e) { toast(e.message, 'err'); }
}

async function checkoutPass(id) {
  try {
    await api('/api/passes/' + id, { method: 'PUT', body: { status: 'closed' } });
    toast('Checkout ho gaya 🏁', 'ok');
    closeSheet();
    await Promise.all([loadStats(), loadNotifications()]);
    render();
  } catch (e) { toast(e.message, 'err'); }
}
async function setPassStatus(id, status) {
  try {
    await api('/api/passes/' + id, { method: 'PUT', body: { status } });
    toast(status === 'active' ? 'Booking confirm ✅' : 'Status badal gaya', 'ok');
    closeSheet();
    await Promise.all([loadStats(), loadNotifications()]);
    render();
  } catch (e) { toast(e.message, 'err'); }
}
async function deletePass(id) {
  if (!confirm('Pakka delete? Payment history bhi hat jayegi.')) return;
  try {
    await api('/api/passes/' + id, { method: 'DELETE' });
    toast('Pass delete ho gaya', 'ok');
    closeSheet();
    await Promise.all([loadStats(), loadNotifications()]);
    render();
  } catch (e) { toast(e.message, 'err'); }
}

async function editPassSheet(id) {
  let d;
  try { d = await api('/api/passes/' + id); } catch (e) { return toast(e.message, 'err'); }
  const p = d.pass;
  const vts = S.summary?.vehicleTypes || [];
  openSheet(`
    <div class="grab"></div>
    <h2>✏️ Pass Edit Karein</h2>
    <div class="field"><label>Customer ka Naam</label><input id="e-name" value="${esc(p.name)}"></div>
    <div class="form-row">
      <div class="field"><label>Vehicle Type</label><select id="e-vt">${vts.map((v) => `<option value="${v.id}" ${v.id === p.vehicleTypeId ? 'selected' : ''}>${v.icon} ${esc(v.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Gaadi No.</label><input id="e-vno" value="${esc(p.vehicleNo || '')}"></div>
    </div>
    <div class="form-row">
      <div class="field"><label>Start Date</label><input id="e-start" type="date" value="${new Date(p.startAt - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}"></div>
      <div class="field"><label>Total ₹</label><input id="e-price" type="number" value="${p.price}"></div>
    </div>
    <div class="field"><label>Note</label><input id="e-note" value="${esc(p.note || '')}"></div>
    <button class="btn primary block" onclick="savePassEdit('${p.id}')">💾 Save Karein</button>
  `);
}
async function savePassEdit(id) {
  const dateVal = document.getElementById('e-start')?.value;
  const startAt = dateVal ? new Date(dateVal + 'T09:00:00').getTime() : undefined;
  try {
    await api('/api/passes/' + id, {
      method: 'PUT',
      body: {
        name: document.getElementById('e-name')?.value,
        vehicleTypeId: document.getElementById('e-vt')?.value,
        vehicleNo: document.getElementById('e-vno')?.value,
        price: Number(document.getElementById('e-price')?.value || 0),
        note: document.getElementById('e-note')?.value,
        startAt
      }
    });
    toast('Pass update ho gaya ✅', 'ok');
    closeSheet();
    await Promise.all([loadStats(), loadNotifications()]);
    openPassSheet(id);
  } catch (e) { toast(e.message, 'err'); }
}

/* ================= BOOK ================= */
function renderBook() {
  const vts = (S.summary?.vehicleTypes || []).filter((v) => v.active);
  if (!vts.length) return `<div class="empty"><div class="e-icon">🏷️</div><div class="e-t">Koi vehicle type set nahi</div></div>`;
  if (!S.bookForm.vehicleTypeId) S.bookForm.vehicleTypeId = vts[0].id;
  const vt = vts.find((v) => v.id === S.bookForm.vehicleTypeId) || vts[0];
  const pt = S.bookForm.passType;
  const price = calcPrice(vt, pt, S.bookForm.hours);
  const isAdm = isAdmin();
  return `
    <div class="sec-head"><span class="t">➕ ${isAdm ? 'Naya Pass Book Karein' : 'Parking Booking Request'}</span></div>
    <div class="card">
      <div class="field"><label>Customer ka Naam ${isAdm ? '' : '(aapka)'}</label><input id="b-name" placeholder="poora naam likhein" value="${isAdm ? '' : esc(S.user.name || '')}"></div>
      <div class="field"><label>Mobile Number</label><input id="b-mobile" type="tel" inputmode="numeric" maxlength="10" placeholder="10 digit" value="${isAdm ? '' : esc(S.user.mobile || '')}"></div>
      <div class="field"><label>Vehicle Type</label>
        <div class="chips">
          ${vts.map((v) => `<button class="chip ${v.id === vt.id ? 'sel' : ''}" onclick="S.bookForm.vehicleTypeId='${v.id}';render()">${v.icon} ${esc(v.name)}</button>`).join('')}
        </div>
      </div>
      <div class="field"><label>Gaadi Number ${vt.id === 'cycle' ? '(optional)' : ''}</label><input id="b-vno" placeholder="jaise RJ14AB1234" ${vt.id === 'cycle' ? '' : ''}></div>
      <div class="field"><label>Pass Type</label>
        <div class="pt-grid">
          <div class="pt-card ${pt === 'hourly' ? 'sel' : ''}" onclick="S.bookForm.passType='hourly';render()"><div class="pt-name">Hourly</div><div class="pt-price">${money(vt.rate.blockPrice)}</div><div class="pt-sub">per ${vt.rate.blockHours}h</div></div>
          <div class="pt-card ${pt === 'monthly' ? 'sel' : ''}" onclick="S.bookForm.passType='monthly';render()"><div class="pt-name">Monthly</div><div class="pt-price">${money(vt.rate.monthlyPrice)}</div><div class="pt-sub">${S.summary?.monthlyDays || 30} din</div></div>
          <div class="pt-card ${pt === 'quarterly' ? 'sel' : ''}" onclick="S.bookForm.passType='quarterly';render()"><div class="pt-name">Quarterly</div><div class="pt-price">${money(vt.rate.quarterlyPrice)}</div><div class="pt-sub">${S.summary?.quarterlyDays || 90} din</div></div>
        </div>
      </div>
      ${pt === 'hourly' ? `
      <div class="field"><label>Kitne ghante ka pass?</label>
        <div class="chips">
          ${[12, 24, 48, 72].map((h) => `<button class="chip ${S.bookForm.hours === h ? 'sel' : ''}" onclick="S.bookForm.hours=${h};render()">${h}h</button>`).join('')}
          <button class="chip ${![12, 24, 48, 72].includes(S.bookForm.hours) ? 'sel' : ''}" onclick="customHours()">✏️ Custom</button>
        </div>
        ${![12, 24, 48, 72].includes(S.bookForm.hours) ? `<input id="b-hours" type="number" min="1" value="${S.bookForm.hours}" class="mt8" style="width:100%;border:1.5px solid var(--line);border-radius:12px;padding:10px 13px" onchange="S.bookForm.hours=Math.max(1,Number(this.value)||1);render()">` : ''}
      </div>` : ''}
      <div class="field"><label>Start Date</label><input id="b-start" type="date" value="${new Date().toISOString().slice(0, 10)}"></div>
      <div class="price-box">
        <div>
          <div class="pl">Total Kiraya</div>
          <div class="pv">${money(price)} <small>${pt === 'hourly' ? S.bookForm.hours + ' ghante' : pt === 'monthly' ? (S.summary?.monthlyDays || 30) + ' din' : (S.summary?.quarterlyDays || 90) + ' din'}</small></div>
        </div>
        <div style="font-size:30px">🧾</div>
      </div>
      ${isAdm ? `
      <div class="form-row">
        <div class="field"><label>Abhi Payment ₹ (optional)</label><input id="b-adv" type="number" min="0" placeholder="0"></div>
        <div class="field"><label>Method</label><select id="b-adv-m"><option value="cash">💵 Cash</option><option value="upi">📱 UPI</option></select></div>
      </div>
      <div class="field"><label>Manual Rate ₹ (khali = rate card se)</label><input id="b-price" type="number" min="0" placeholder="${price}"></div>` : ''}
      <div class="field"><label>Note (optional)</label><input id="b-note" placeholder="koi khaas baat?"></div>
      <button class="btn ${isAdm ? 'primary' : 'amber'} block" onclick="doBook()">${isAdm ? '✅ Pass Book Karein' : '📩 Booking Request Bhejein'}</button>
      ${!isAdm ? '<div class="small muted center mt8">Request bhejne ke baad admin confirm karega, tab pass active hoga.</div>' : ''}
    </div>
  `;
}
function customHours() {
  const h = prompt('Kitne ghante ka pass?', String(S.bookForm.hours));
  if (h) { S.bookForm.hours = Math.max(1, Number(h) || 12); }
  render();
}
function calcPrice(vt, pt, hours) {
  if (!vt) return 0;
  if (pt === 'monthly') return vt.rate.monthlyPrice;
  if (pt === 'quarterly') return vt.rate.quarterlyPrice;
  const block = Math.max(1, vt.rate.blockHours || 12);
  const h = Math.max(1, Number(hours) || block);
  return Math.ceil(h / block) * vt.rate.blockPrice;
}
async function doBook() {
  const name = document.getElementById('b-name')?.value.trim();
  const mobile = document.getElementById('b-mobile')?.value.trim();
  const vehicleNo = document.getElementById('b-vno')?.value.trim();
  const note = document.getElementById('b-note')?.value.trim();
  const dateVal = document.getElementById('b-start')?.value;
  const startAt = dateVal ? new Date(dateVal + 'T09:00:00').getTime() : Date.now();
  const body = {
    name, mobile, vehicleNo, note,
    vehicleTypeId: S.bookForm.vehicleTypeId,
    passType: S.bookForm.passType,
    hours: S.bookForm.passType === 'hourly' ? S.bookForm.hours : undefined,
    startAt
  };
  if (isAdmin()) {
    const adv = Number(document.getElementById('b-adv')?.value || 0);
    const manual = document.getElementById('b-price')?.value;
    if (adv > 0) { body.advanceAmount = adv; body.advanceMethod = document.getElementById('b-adv-m')?.value; }
    if (manual !== undefined && manual !== '') body.price = Number(manual);
  }
  try {
    const d = await api('/api/passes', { body });
    if (isAdmin()) {
      toast('Pass book ho gaya! 🎫 ' + d.pass.name, 'ok');
      S.view = 'passes'; S.passFilter = 'live';
    } else {
      toast('Request bhej di gayi ✅ Admin confirm karega', 'ok');
      S.view = 'home';
    }
    await Promise.all([loadStats(), loadNotifications(), loadSummary()]);
    show(S.view);
  } catch (e) { toast(e.message, 'err'); }
}

/* ================= REPORTS ================= */
async function renderReports() {
  if (!isAdmin()) return renderCustomerHome();
  if (!S.payments.length) {
    try {
      const d = await api('/api/payments?limit=200');
      S.payments = d.payments || [];
    } catch {}
  }
  const st = S.stats;
  if (!st) return `<div class="empty">⏳</div>`;
  return `
    <div class="sec-head"><span class="t">💰 Kamai Report</span></div>
    <div class="stat-grid">
      <div class="stat green"><div class="label">Aaj</div><div class="value">${money(st.revenue.today)}</div></div>
      <div class="stat blue"><div class="label">Is Mahine</div><div class="value">${money(st.revenue.month)}</div></div>
      <div class="stat amber"><div class="label">Total Kamai</div><div class="value">${money(st.revenue.total)}</div></div>
      <div class="stat red"><div class="label">Baki Due</div><div class="value">${money(st.revenue.pendingDue)}</div></div>
    </div>
    <div class="card"><h3>📈 Mahine-wise Kamai</h3>${barChart(st.monthlySeries)}</div>
    <div class="card">
      <h3>🚗 Vehicle-wise Kamai</h3>
      ${Object.entries(st.byType).map(([id, t]) => `
        <div class="kv"><span class="k">${t.icon} ${esc(t.name)}</span><span class="v">${money(t.revenue)} <span class="muted small">(${t.active} active)</span></span></div>`).join('')}
    </div>
    <div class="sec-head"><span class="t">🧾 Payment History</span><span class="n">${S.payments.length}</span></div>
    <div class="card">
      ${S.payments.length ? S.payments.slice(0, 60).map((x) => `
        <div class="list-item" style="cursor:default">
          <div class="li-icon">${x.method === 'upi' ? '📱' : '💵'}</div>
          <div class="li-main">
            <div class="li-title">${esc(x.name)} · ${esc(x.vehicleLabel)}</div>
            <div class="li-sub">${fmtDateTime(x.at)}${x.note ? ' · ' + esc(x.note) : ''}</div>
          </div>
          <div class="li-end"><div class="top" style="color:var(--green)">+${money(x.amount)}</div><div class="bot">${x.method.toUpperCase()}</div></div>
        </div>`).join('') : '<div class="small muted center">Abhi koi payment nahi</div>'}
    </div>
  `;
}

/* ================= PROFILE ================= */
function renderProfile() {
  const u = S.user;
  return `
    <div class="card center" style="padding:22px">
      <div style="font-size:44px">${isAdmin() ? '👨‍💼' : '🧍'}</div>
      <div style="font-size:19px;font-weight:800;color:var(--navy)">${esc(u.name)}</div>
      <div class="muted small">📞 ${esc(u.mobile)}</div>
      <div class="mt8"><span class="tag ${isAdmin() ? 'active' : 'method'}">${isAdmin() ? 'ADMIN / OWNER' : 'CUSTOMER'}</span></div>
    </div>
    ${isAdmin() ? `
    <div class="sec-head"><span class="t">🗄️ Backup & Data</span></div>
    <div class="card">
      <div class="small muted" style="margin-bottom:10px">Data server ki file mein rehta hai. Mahine mein ek baar backup download karke rakh lein.</div>
      <button class="btn ghost block" onclick="downloadBackup()">⬇️ Backup Download Karein</button>
      <div class="divider"></div>
      <div class="field"><label>Backup file se wapas laayein</label><input type="file" id="restore-file" accept="application/json" style="font-size:12px"></div>
      <button class="btn red block" onclick="restoreBackup()">⬆️ Restore Karein</button>
    </div>
    <div class="sec-head"><span class="t">🏪 Shop</span></div>
    <div class="card">
      <button class="btn plain block" onclick="shopSettingsSheet()">⚙️ Shop Settings Kholin</button>
    </div>` : ''}
    <div class="card">
      <div class="kv"><span class="k">App</span><span class="v">Yadav Parking v1.0</span></div>
      <div class="kv"><span class="k">Kanakpura, Jaipur</span><span class="v">🅿️</span></div>
      <div class="kv"><span class="k">Server</span><span class="v small">${esc(location.host)}</span></div>
    </div>
    <button class="btn red block" onclick="confirmLogout()">🚪 Logout Karein</button>
  `;
}
function confirmLogout() {
  if (confirm('Logout karna hai?')) logout();
}
function downloadBackup() {
  const a = document.createElement('a');
  a.href = '/api/backup?token=' + encodeURIComponent(S.token);
  a.download = '';
  document.body.appendChild(a); a.click(); a.remove();
  toast('Backup download ho raha hai…', 'ok');
}
async function restoreBackup() {
  const f = document.getElementById('restore-file')?.files[0];
  if (!f) return toast('Pehle backup file chunein', 'err');
  if (!confirm('Restore karne se abhi ka data replace ho jayega. Pakka?')) return;
  try {
    const text = await f.text();
    const data = JSON.parse(text);
    const d = await api('/api/backup/restore', { body: { data } });
    toast('Restore ho gaya: ' + d.passes + ' passes', 'ok');
    await refreshAll();
    render();
  } catch (e) { toast('Restore fail: ' + e.message, 'err'); }
}

/* ================= NOTIFICATION SHEET ================= */
function openNotifSheet() {
  S.notifOpen = true;
  renderNotifSheet();
}
function renderNotifSheet() {
  if (!S.notifOpen) return;
  const list = S.notifications;
  openSheetInternal(`
    <div class="grab"></div>
    <h2>🔔 Notifications</h2>
    <div class="sheet-sub">Pass expiry aur booking requests yahan dikhte hain.</div>
    <div class="card">
      ${list.length ? list.map((n) => notifRow(n)).join('') : `
      <div class="empty"><div class="e-icon">🎉</div><div class="e-t">Koi notification nahi</div>
      <div class="e-s">Sab passes theek hain.</div></div>`}
    </div>
  `);
}

/* ================= sheet core ================= */
function openSheet(html) { openSheetInternal(html); }
function openSheetInternal(html) {
  const sh = document.getElementById('sheet');
  sh.innerHTML = html;
  sh.classList.remove('hidden');
  document.getElementById('sheet-backdrop').classList.remove('hidden');
}
function closeSheet() {
  S.notifOpen = false;
  document.getElementById('sheet').classList.add('hidden');
  document.getElementById('sheet-backdrop').classList.add('hidden');
  render();
}

/* ================= global listeners ================= */
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
document.addEventListener('input', (e) => {
  if (e.target?.id === 'pass-q') {
    clearTimeout(window.__qT);
    window.__qT = setTimeout(() => loadPasses(), 300);
  }
  if (e.target?.id === 'b-mobile') {
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10);
  }
});

/* go! */
