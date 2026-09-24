/*
 * Yadav Parking — Kanakpura
 * Parking pass booking + rate management + payments + expiry notifications.
 * Pure Node.js (no npm dependencies). Data JSON file mein store hoti hai.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'yadav-parking.json');
const ADMIN_MOBILE = (process.env.ADMIN_MOBILE || '').replace(/\D/g, '');
const SESSION_SECRET = process.env.SESSION_SECRET || 'yadav-parking-local';
const SESSION_TTL = 90 * 24 * 3600 * 1000; // 90 din

const DAY = 24 * 3600 * 1000;

/* ---------------- storage ---------------- */
let store = null;
let saveTimer = null;

function defaultStore() {
  return {
    seedVersion: 1,
    users: [],
    sessions: {},
    config: {
      shopName: 'Yadav Parking',
      area: 'Kanakpura, Jaipur',
      upiId: '',
      notice: 'Gadi apne risk par park karein. Kimti saman mat chhodin.',
      alertDays: 3,
      monthlyDays: 30,
      quarterlyDays: 90
    },
    vehicleTypes: [
      { id: 'cycle', name: 'Cycle', icon: '🚲', active: true, rate: { blockHours: 12, blockPrice: 10, monthlyPrice: 100, quarterlyPrice: 300 } },
      { id: 'bike', name: 'Bike', icon: '🏍️', active: true, rate: { blockHours: 12, blockPrice: 20, monthlyPrice: 250, quarterlyPrice: 600 } },
      { id: 'car', name: 'Four Wheeler', icon: '🚗', active: true, rate: { blockHours: 12, blockPrice: 50, monthlyPrice: 700, quarterlyPrice: 2000 } }
    ],
    passes: [],
    payments: []
  };
}

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      store = Object.assign(defaultStore(), raw);
      store.config = Object.assign(defaultStore().config, raw.config || {});
      return;
    }
  } catch (err) {
    console.error('Data load failed, fresh start:', err.message);
  }
  store = defaultStore();
  saveStoreNow();
}

function saveStoreNow() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store));
  fs.renameSync(tmp, DATA_FILE);
}

function saveStore() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { saveStoreNow(); } catch (err) { console.error('Save failed:', err.message); }
  }, 250);
}

/* ---------------- helpers ---------------- */
const uid = (p) => p + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
const now = () => Date.now();
const cleanMobile = (m) => String(m || '').replace(/\D/g, '').slice(-10);

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function publicUser(u) {
  return { id: u.id, name: u.name, mobile: u.mobile, role: u.role, createdAt: u.createdAt };
}

function getSession(req, query) {
  const auth = req.headers['authorization'] || '';
  let token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.headers['cookie'] || '').match(/yp_token=([^;]+)/)?.[1] || '';
  if (!token && query) token = query.get('token') || '';
  if (!token) return null;
  const sess = store.sessions[token];
  if (!sess) return null;
  if (now() - sess.at > SESSION_TTL) { delete store.sessions[token]; saveStore(); return null; }
  const user = store.users.find((u) => u.id === sess.userId);
  if (user) sess.at = now();
  return user ? { user, token } : null;
}

function vehicleLabel(typeId) {
  const vt = store.vehicleTypes.find((v) => v.id === typeId);
  return vt ? vt.name : typeId;
}

function normalizePasses() {
  const t = now();
  for (const p of store.passes) {
    if (p.status === 'active' && p.endAt <= t) p.status = 'expired';
  }
}

function passDurationEnd(passType, startAt, hours) {
  if (passType === 'monthly') return startAt + store.config.monthlyDays * DAY;
  if (passType === 'quarterly') return startAt + store.config.quarterlyDays * DAY;
  const vtHours = Math.max(1, Number(hours) || 12);
  return startAt + vtHours * 3600 * 1000;
}

function priceFor(vt, passType, hours) {
  if (!vt) return 0;
  if (passType === 'monthly') return Number(vt.rate.monthlyPrice) || 0;
  if (passType === 'quarterly') return Number(vt.rate.quarterlyPrice) || 0;
  const block = Math.max(1, Number(vt.rate.blockHours) || 12);
  const h = Math.max(1, Number(hours) || block);
  return Math.ceil(h / block) * (Number(vt.rate.blockPrice) || 0);
}

function passDue(p) {
  const paid = store.payments.filter((x) => x.passId === p.id).reduce((s, x) => s + Number(x.amount || 0), 0);
  return Math.max(0, Number(p.price || 0) - paid);
}

function paidOn(p) {
  return store.payments.filter((x) => x.passId === p.id).reduce((s, x) => s + Number(x.amount || 0), 0);
}

function customerView(p) {
  const vt = store.vehicleTypes.find((v) => v.id === p.vehicleTypeId);
  return { ...p, vehicleLabel: vt ? vt.name : p.vehicleTypeId, vehicleIcon: vt ? vt.icon : '🛵', paid: paidOn(p), due: passDue(p) };
}

function addPayment(pass, amount, method, note, byUser) {
  const entry = {
    id: uid('pay'), passId: pass.id, mobile: pass.mobile, name: pass.name,
    vehicleLabel: vehicleLabel(pass.vehicleTypeId), amount: Math.round(Number(amount)),
    method: method === 'upi' ? 'upi' : 'cash', note: String(note || '').slice(0, 200),
    at: now(), by: byUser ? byUser.mobile : 'system'
  };
  store.payments.push(entry);
  return entry;
}

function notificationsFor(user) {
  normalizePasses();
  const t = now();
  const alertMs = Math.max(0, Number(store.config.alertDays) || 3) * DAY;
  const list = [];
  const isAdmin = user.role === 'admin';
  const passes = store.passes.filter((p) => isAdmin || cleanMobile(p.mobile) === cleanMobile(user.mobile));
  const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);
  for (const p of passes) {
    if (p.status === 'pending') {
      if (!isAdmin) continue;
      list.push({ id: 'pending:' + p.id + ':' + dayKey(p.createdAt), kind: 'pending', passId: p.id,
        title: 'Naya booking request', message: `${p.name} (${vehicleLabel(p.vehicleTypeId)} ${p.vehicleNo || '-'}) ne ${passTypeName(p.passType)} pass request kiya hai. Confirm karein.`, at: p.createdAt });
      continue;
    }
    if (p.status === 'closed') continue;
    const left = p.endAt - t;
    if (left <= 0) {
      list.push({ id: 'expired:' + p.id + ':' + dayKey(t), kind: 'expired', passId: p.id,
        title: 'Pass khatam ho gaya', message: `${p.name} ka ${vehicleLabel(p.vehicleTypeId)} (${p.vehicleNo || '-'}) pass ${daysAgoLabel(p.endAt)} khatam ho gaya. Renew ya checkout karein.`, at: p.endAt });
    } else if (left <= alertMs) {
      list.push({ id: 'expiring:' + p.id + ':' + dayKey(t), kind: 'expiring', passId: p.id,
        title: 'Pass jald khatam hoga', message: `${p.name} ka ${vehicleLabel(p.vehicleTypeId)} (${p.vehicleNo || '-'}) pass ${timeLeftLabel(left)} mein khatam hoga.`, at: t });
    }
  }
  list.sort((a, b) => b.at - a.at);
  return list.slice(0, 50);
}

function passTypeName(t) { return t === 'monthly' ? 'Monthly' : t === 'quarterly' ? 'Quarterly' : 'Hourly'; }
function timeLeftLabel(ms) {
  const h = Math.floor(ms / 3600000);
  if (h < 48) return h + ' ghante';
  return Math.floor(h / 24) + ' din';
}
function daysAgoLabel(ts) {
  const d = Math.floor((now() - ts) / DAY);
  if (d <= 0) return 'aaj';
  if (d === 1) return 'kal';
  return d + ' din pehle';
}

function computeStats() {
  normalizePasses();
  const t = now();
  const inMs = (n) => t + n * 3600 * 1000;
  const active = store.passes.filter((p) => p.status === 'active' || p.status === 'expired');
  const activeLive = active.filter((p) => p.status === 'active');
  const sum = (arr, f) => arr.reduce((s, x) => s + (f(x) || 0), 0);
  const todayStart = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })).getTime();
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const payOf = (from) => store.payments.filter((x) => x.at >= from);

  const byType = {};
  for (const vt of store.vehicleTypes) {
    const list = active.filter((p) => p.vehicleTypeId === vt.id);
    byType[vt.id] = {
      name: vt.name, icon: vt.icon,
      active: list.filter((p) => p.status === 'active').length,
      expired: list.filter((p) => p.status === 'expired').length,
      revenue: 0
    };
  }
  // revenue by vehicle type (passId se link)
  const passById = new Map(store.passes.map((p) => [p.id, p]));
  for (const vt of store.vehicleTypes) {
    const rev = sum(store.payments.filter((x) => passById.get(x.passId)?.vehicleTypeId === vt.id), (x) => x.amount);
    if (byType[vt.id]) byType[vt.id].revenue = rev;
  }

  const monthlySeries = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); d.setHours(0, 0, 0, 0);
    const next = new Date(d); next.setMonth(next.getMonth() + 1);
    const amount = sum(store.payments.filter((x) => x.at >= d.getTime() && x.at < next.getTime()), (x) => x.amount);
    monthlySeries.push({ ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleDateString('en-IN', { month: 'short' }), amount });
  }

  const dueTotal = sum(active.filter((p) => p.status === 'active' || p.status === 'expired'), (p) => passDue(p));

  return {
    shopName: store.config.shopName,
    activeTotal: activeLive.length,
    expiredTotal: active.filter((p) => p.status === 'expired').length,
    pendingRequests: store.passes.filter((p) => p.status === 'pending').length,
    expiring: {
      in12h: activeLive.filter((p) => p.endAt <= inMs(12)).length,
      in24h: activeLive.filter((p) => p.endAt <= inMs(24)).length,
      in48h: activeLive.filter((p) => p.endAt <= inMs(48)).length,
      in7d: activeLive.filter((p) => p.endAt <= inMs(24 * 7)).length
    },
    revenue: {
      today: sum(payOf(todayStart), (x) => x.amount),
      month: sum(payOf(monthStart.getTime()), (x) => x.amount),
      total: sum(store.payments, (x) => x.amount),
      pendingDue: dueTotal
    },
    byType,
    monthlySeries
  };
}

/* ---------------- http helpers ---------------- */
function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 25 * 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { resolve(null); }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain'
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
    });
    res.end(buf);
  });
}

/* ---------------- api router ---------------- */
async function handleApi(req, res, pathname, query) {
  const parts = pathname.split('/').filter(Boolean); // ['api', ...]
  const seg = parts.slice(1);
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
  if (body === null) return sendJson(res, 400, { error: 'Invalid JSON body' });
  const auth = getSession(req, query);
  const user = auth?.user;

  const needAuth = () => { if (!user) { sendJson(res, 401, { error: 'Pehle login karein' }); return true; } return false; };
  const needAdmin = () => { if (!user) { sendJson(res, 401, { error: 'Pehle login karein' }); return true; } if (user.role !== 'admin') { sendJson(res, 403, { error: 'Sirf admin ke liye' }); return true; } return false; };

  /* ----- public ----- */
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, shop: store.config.shopName, time: now() });
  }

  if (req.method === 'GET' && pathname === '/api/public/summary') {
    normalizePasses();
    return sendJson(res, 200, {
      shopName: store.config.shopName, area: store.config.area,
      notice: store.config.notice,
      vehicleTypes: store.vehicleTypes.filter((v) => v.active),
      monthlyDays: store.config.monthlyDays, quarterlyDays: store.config.quarterlyDays,
      activeTotal: store.passes.filter((p) => p.status === 'active').length
    });
  }

  /* ----- auth ----- */
  if (req.method === 'POST' && pathname === '/api/auth/signup') {
    const name = String(body.name || '').trim().slice(0, 60);
    const mobile = cleanMobile(body.mobile);
    const password = String(body.password || '');
    if (name.length < 2) return sendJson(res, 400, { error: 'Naam likhein' });
    if (mobile.length !== 10) return sendJson(res, 400, { error: 'Sahi 10 digit mobile number likhein' });
    if (password.length < 4) return sendJson(res, 400, { error: 'Password kam se kam 4 character ka rakhein' });
    if (store.users.some((u) => u.mobile === mobile)) return sendJson(res, 409, { error: 'Is mobile number se account already hai — login karein' });
    const hasAdmin = store.users.some((u) => u.role === 'admin');
    const role = (ADMIN_MOBILE && mobile === ADMIN_MOBILE) || (!ADMIN_MOBILE && !hasAdmin) ? 'admin' : 'customer';
    const salt = crypto.randomBytes(16).toString('hex');
    const u = { id: uid('u'), name, mobile, salt, passwordHash: hashPassword(password, salt), role, createdAt: now() };
    store.users.push(u);
    const token = crypto.randomBytes(32).toString('hex');
    store.sessions[token] = { userId: u.id, at: now() };
    saveStore();
    return sendJson(res, 200, { token, user: publicUser(u) });
  }

  if (req.method === 'POST' && pathname === '/api/auth/login') {
    const mobile = cleanMobile(body.mobile);
    const password = String(body.password || '');
    const u = store.users.find((x) => x.mobile === mobile);
    if (!u || u.passwordHash !== hashPassword(password, u.salt)) return sendJson(res, 401, { error: 'Mobile number ya password galat hai' });
    if (ADMIN_MOBILE && mobile === ADMIN_MOBILE && u.role !== 'admin') u.role = 'admin';
    const token = crypto.randomBytes(32).toString('hex');
    store.sessions[token] = { userId: u.id, at: now() };
    saveStore();
    return sendJson(res, 200, { token, user: publicUser(u) });
  }

  if (req.method === 'POST' && pathname === '/api/auth/logout') {
    if (auth) { delete store.sessions[auth.token]; saveStore(); }
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/auth/me') {
    if (!user) return sendJson(res, 401, { error: 'Login nahi hai' });
    return sendJson(res, 200, { user: publicUser(user) });
  }

  /* ----- config ----- */
  if (req.method === 'GET' && pathname === '/api/config') {
    return sendJson(res, 200, { config: store.config });
  }
  if (req.method === 'PUT' && pathname === '/api/config') {
    if (needAdmin()) return;
    const c = store.config;
    for (const k of ['shopName', 'area', 'upiId', 'notice']) {
      if (body[k] !== undefined) c[k] = String(body[k]).slice(0, 200);
    }
    for (const k of ['alertDays', 'monthlyDays', 'quarterlyDays']) {
      if (body[k] !== undefined) { const n = Number(body[k]); if (Number.isFinite(n) && n >= 1 && n <= 365) c[k] = Math.round(n); }
    }
    saveStore();
    return sendJson(res, 200, { config: c });
  }

  /* ----- vehicle types / rates ----- */
  if (pathname === '/api/vehicle-types') {
    if (req.method === 'GET') {
      return sendJson(res, 200, { vehicleTypes: store.vehicleTypes });
    }
    if (req.method === 'POST') {
      if (needAdmin()) return;
      const name = String(body.name || '').trim().slice(0, 40);
      if (!name) return sendJson(res, 400, { error: 'Vehicle type ka naam likhein' });
      const vt = {
        id: uid('vt'), name,
        icon: String(body.icon || '🚗').slice(0, 8),
        active: body.active !== false,
        rate: {
          blockHours: clampNum(body.rate?.blockHours, 1, 720, 12),
          blockPrice: clampNum(body.rate?.blockPrice, 0, 100000, 20),
          monthlyPrice: clampNum(body.rate?.monthlyPrice, 0, 100000, 250),
          quarterlyPrice: clampNum(body.rate?.quarterlyPrice, 0, 1000000, 600)
        }
      };
      store.vehicleTypes.push(vt);
      saveStore();
      return sendJson(res, 200, { vehicleType: vt });
    }
  }
  if (seg[0] === 'vehicle-types' && seg[1]) {
    const vt = store.vehicleTypes.find((v) => v.id === seg[1]);
    if (!vt) return sendJson(res, 404, { error: 'Vehicle type nahi mila' });
    if (req.method === 'PUT') {
      if (needAdmin()) return;
      if (body.name !== undefined) vt.name = String(body.name).trim().slice(0, 40) || vt.name;
      if (body.icon !== undefined) vt.icon = String(body.icon).slice(0, 8) || vt.icon;
      if (body.active !== undefined) vt.active = !!body.active;
      if (body.rate) {
        vt.rate.blockHours = clampNum(body.rate.blockHours ?? vt.rate.blockHours, 1, 720, vt.rate.blockHours);
        vt.rate.blockPrice = clampNum(body.rate.blockPrice ?? vt.rate.blockPrice, 0, 100000, vt.rate.blockPrice);
        vt.rate.monthlyPrice = clampNum(body.rate.monthlyPrice ?? vt.rate.monthlyPrice, 0, 100000, vt.rate.monthlyPrice);
        vt.rate.quarterlyPrice = clampNum(body.rate.quarterlyPrice ?? vt.rate.quarterlyPrice, 0, 1000000, vt.rate.quarterlyPrice);
      }
      saveStore();
      return sendJson(res, 200, { vehicleType: vt });
    }
    if (req.method === 'DELETE') {
      if (needAdmin()) return;
      if (store.passes.some((p) => p.vehicleTypeId === vt.id)) {
        vt.active = false;
        saveStore();
        return sendJson(res, 200, { ok: true, softDeleted: true });
      }
      store.vehicleTypes = store.vehicleTypes.filter((v) => v.id !== vt.id);
      saveStore();
      return sendJson(res, 200, { ok: true });
    }
  }

  /* ----- passes ----- */
  if (req.method === 'GET' && pathname === '/api/passes') {
    if (needAuth()) return;
    normalizePasses();
    let list = store.passes.slice();
    if (user.role !== 'admin') list = list.filter((p) => cleanMobile(p.mobile) === cleanMobile(user.mobile));
    const status = query.get('status') || '';
    if (status && status !== 'all') {
      if (status === 'live') list = list.filter((p) => ['active', 'expired'].includes(p.status));
      else list = list.filter((p) => p.status === status);
    }
    const q = (query.get('q') || '').trim().toLowerCase();
    if (q) list = list.filter((p) => [p.name, p.mobile, p.vehicleNo].some((x) => String(x || '').toLowerCase().includes(q)));
    const typeId = query.get('type') || '';
    if (typeId) list = list.filter((p) => p.vehicleTypeId === typeId);
    list.sort((a, b) => {
      const rank = { pending: 0, expired: 1, active: 2, closed: 3 };
      if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
      return a.endAt - b.endAt;
    });
    return sendJson(res, 200, { passes: list.slice(0, 500).map(customerView) });
  }

  if (req.method === 'POST' && pathname === '/api/passes') {
    if (needAuth()) return;
    const name = String(body.name || '').trim().slice(0, 60);
    const mobile = cleanMobile(body.mobile);
    const vt = store.vehicleTypes.find((v) => v.id === body.vehicleTypeId && v.active);
    const passType = ['hourly', 'monthly', 'quarterly'].includes(body.passType) ? body.passType : '';
    let vehicleNo = String(body.vehicleNo || '').trim().toUpperCase().slice(0, 20);
    if (vt?.id === 'cycle') vehicleNo = vehicleNo || '—';
    if (name.length < 2) return sendJson(res, 400, { error: 'Customer ka naam likhein' });
    if (mobile.length !== 10) return sendJson(res, 400, { error: 'Customer ka 10 digit mobile number likhein' });
    if (!vt) return sendJson(res, 400, { error: 'Vehicle type chunein' });
    if (!passType) return sendJson(res, 400, { error: 'Pass type chunein (Hourly / Monthly / Quarterly)' });

    const startAt = Math.max(now() - 365 * DAY, Number(body.startAt) || now());
    const hours = clampNum(body.hours, 1, 24 * 60, vt.rate.blockHours);
    const endAt = passDurationEnd(passType, startAt, hours);
    let price = priceFor(vt, passType, hours);
    if (user.role === 'admin' && body.price !== undefined && body.price !== '' && body.price !== null) {
      price = Math.max(0, Math.round(Number(body.price) || 0)); // admin manual rate laga sakta hai
    }
    const status = user.role === 'admin' ? 'active' : 'pending';
    const pass = {
      id: uid('pass'), name, mobile, vehicleTypeId: vt.id, vehicleNo,
      passType, startAt, endAt, hours: passType === 'hourly' ? hours : undefined,
      price, status, note: String(body.note || '').slice(0, 300),
      createdBy: user.mobile, createdAt: now(), updatedAt: now()
    };
    store.passes.push(pass);
    if (status === 'active' && Number(body.advanceAmount) > 0) {
      addPayment(pass, body.advanceAmount, body.advanceMethod, 'Advance booking payment', user);
    }
    saveStore();
    return sendJson(res, 200, { pass: customerView(pass) });
  }

  if (seg[0] === 'passes' && seg[1]) {
    if (needAuth()) return;
    normalizePasses();
    const pass = store.passes.find((p) => p.id === seg[1]);
    if (!pass) return sendJson(res, 404, { error: 'Pass nahi mila' });
    const own = cleanMobile(pass.mobile) === cleanMobile(user.mobile);
    if (user.role !== 'admin' && !own) return sendJson(res, 403, { error: 'Ye pass aapka nahi hai' });

    if (req.method === 'GET') {
      return sendJson(res, 200, {
        pass: customerView(pass),
        payments: store.payments.filter((x) => x.passId === pass.id).sort((a, b) => b.at - a.at)
      });
    }
    if (req.method === 'PUT') {
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'Sirf admin badlaav kar sakta hai' });
      if (body.name !== undefined) pass.name = String(body.name).trim().slice(0, 60) || pass.name;
      if (body.vehicleNo !== undefined) pass.vehicleNo = String(body.vehicleNo).trim().toUpperCase().slice(0, 20);
      if (body.note !== undefined) pass.note = String(body.note).slice(0, 300);
      if (body.vehicleTypeId !== undefined) {
        const nv = store.vehicleTypes.find((v) => v.id === body.vehicleTypeId);
        if (nv) pass.vehicleTypeId = nv.id;
      }
      if (body.status !== undefined && ['pending', 'active', 'closed'].includes(body.status)) {
        pass.status = body.status === 'active' && pass.endAt <= now() ? 'expired' : body.status;
      }
      if (body.startAt !== undefined) {
        const s = Number(body.startAt);
        if (Number.isFinite(s)) {
          pass.startAt = s;
          pass.endAt = passDurationEnd(pass.passType, s, pass.hours);
        }
      }
      if (body.extendEndAt !== undefined) {
        const e = Number(body.extendEndAt);
        if (Number.isFinite(e) && e > pass.startAt) pass.endAt = e;
      }
      if (body.price !== undefined) pass.price = Math.max(0, Math.round(Number(body.price) || 0));
      pass.updatedAt = now();
      saveStore();
      return sendJson(res, 200, { pass: customerView(pass) });
    }
    if (req.method === 'POST' && seg[2] === 'renew') {
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'Sirf admin renew kar sakta hai' });
      const passType = ['hourly', 'monthly', 'quarterly'].includes(body.passType) ? body.passType : pass.passType;
      const vt = store.vehicleTypes.find((v) => v.id === pass.vehicleTypeId);
      const hours = clampNum(body.hours, 1, 24 * 60, vt?.rate.blockHours || 12);
      const base = Math.max(now(), pass.endAt);
      pass.endAt = passDurationEnd(passType, base, hours);
      pass.startAt = base;
      pass.passType = passType;
      pass.hours = passType === 'hourly' ? hours : undefined;
      pass.price += priceFor(vt, passType, hours);
      if (pass.status !== 'pending') pass.status = 'active';
      pass.updatedAt = now();
      saveStore();
      return sendJson(res, 200, { pass: customerView(pass) });
    }
    if (req.method === 'POST' && seg[2] === 'payments') {
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'Sirf admin payment entry kar sakta hai' });
      const amount = Math.round(Number(body.amount));
      if (!Number.isFinite(amount) || amount <= 0) return sendJson(res, 400, { error: 'Sahi amount likhein' });
      const entry = addPayment(pass, amount, body.method, body.note, user);
      saveStore();
      return sendJson(res, 200, { payment: entry, pass: customerView(pass) });
    }
    if (req.method === 'DELETE') {
      if (user.role !== 'admin') return sendJson(res, 403, { error: 'Sirf admin delete kar sakta hai' });
      store.passes = store.passes.filter((p) => p.id !== pass.id);
      store.payments = store.payments.filter((x) => x.passId !== pass.id);
      saveStore();
      return sendJson(res, 200, { ok: true });
    }
  }

  /* ----- payments ledger ----- */
  if (req.method === 'GET' && pathname === '/api/payments') {
    if (needAdmin()) return;
    let list = store.payments.slice().sort((a, b) => b.at - a.at);
    const from = Number(query.get('from')) || 0;
    if (from) list = list.filter((x) => x.at >= from);
    const limit = Math.min(500, Number(query.get('limit')) || 100);
    return sendJson(res, 200, { payments: list.slice(0, limit), total: list.length });
  }
  if (seg[0] === 'payments' && seg[1] && req.method === 'DELETE') {
    if (needAdmin()) return;
    const before = store.payments.length;
    store.payments = store.payments.filter((x) => x.id !== seg[1]);
    if (store.payments.length === before) return sendJson(res, 404, { error: 'Payment entry nahi mili' });
    saveStore();
    return sendJson(res, 200, { ok: true });
  }

  /* ----- customers (admin) ----- */
  if (req.method === 'GET' && pathname === '/api/customers') {
    if (needAdmin()) return;
    normalizePasses();
    const q = (query.get('q') || '').trim().toLowerCase();
    const map = new Map();
    for (const p of store.passes) {
      const key = p.mobile;
      if (!map.has(key)) map.set(key, { mobile: p.mobile, name: p.name, passes: 0, active: 0, spent: 0, lastVehicle: p.vehicleNo, lastType: p.vehicleTypeId });
      const c = map.get(key);
      c.passes++;
      if (p.status === 'active') c.active++;
      if (['active', 'expired'].includes(p.status)) { c.name = p.name; c.lastVehicle = p.vehicleNo; c.lastType = p.vehicleTypeId; }
      c.spent += paidOn(p);
    }
    let list = [...map.values()];
    if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || c.mobile.includes(q));
    list.sort((a, b) => b.spent - a.spent);
    return sendJson(res, 200, { customers: list.slice(0, 300) });
  }

  /* ----- stats ----- */
  if (req.method === 'GET' && pathname === '/api/stats') {
    if (needAdmin()) return;
    return sendJson(res, 200, computeStats());
  }

  /* ----- notifications ----- */
  if (req.method === 'GET' && pathname === '/api/notifications') {
    if (needAuth()) return;
    return sendJson(res, 200, { notifications: notificationsFor(user), serverTime: now(), alertDays: store.config.alertDays });
  }

  /* ----- backup / restore (admin) ----- */
  if (req.method === 'GET' && pathname === '/api/backup') {
    if (needAdmin()) return;
    const snapshot = { exportedAt: now(), ...JSON.parse(JSON.stringify({ config: store.config, vehicleTypes: store.vehicleTypes, passes: store.passes, payments: store.payments, users: store.users.map((u) => ({ ...publicUser(u) })) })) };
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="yadav-parking-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      'Access-Control-Allow-Origin': '*'
    });
    return res.end(JSON.stringify(snapshot, null, 2));
  }
  if (req.method === 'POST' && pathname === '/api/backup/restore') {
    if (needAdmin()) return;
    const data = body.data || body;
    if (!data || !Array.isArray(data.passes) || !Array.isArray(data.vehicleTypes)) {
      return sendJson(res, 400, { error: 'Backup file galat hai (passes/vehicleTypes nahi mile)' });
    }
    store.config = Object.assign(store.config, data.config || {});
    store.vehicleTypes = data.vehicleTypes;
    store.passes = data.passes;
    store.payments = Array.isArray(data.payments) ? data.payments : [];
    saveStoreNow();
    return sendJson(res, 200, { ok: true, passes: store.passes.length, payments: store.payments.length });
  }

  return sendJson(res, 404, { error: 'API route nahi mila' });
}

function clampNum(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/* ---------------- server ---------------- */
loadStore();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const pathname = u.pathname;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization'
    });
    return res.end();
  }
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, u.searchParams);
    return serveStatic(req, res, pathname);
  } catch (err) {
    console.error('Request error:', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Yadav Parking server chal raha hai: http://${HOST}:${PORT}`);
  if (!ADMIN_MOBILE) console.log('Tip: ADMIN_MOBILE env set karein toh us mobile number wala account admin banega. (Abhi pehla signup admin hoga.)');
});
