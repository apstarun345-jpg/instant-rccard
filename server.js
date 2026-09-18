import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const dbFile = process.env.DB_FILE || path.join(dataDir, 'instant-rccard.json');
const PORT = Number(process.env.PORT || 4173);
const RC_API_URL = process.env.RC_API_URL || 'https://api.apnirc.xyz/api/b2b/get-rc';
const RC_API_TOKEN = process.env.RC_API_TOKEN || '';
const ADMIN_MOBILE = normalizeMobile(process.env.ADMIN_MOBILE || '');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SHEET_WEBHOOK_URL = process.env.SHEET_WEBHOOK_URL || '';
const SHEET_SYNC_SECRET = process.env.SHEET_SYNC_SECRET || '';
const RC_PRICES = Object.freeze({
  mparivahan: 10,
  'rc-card': 15
});
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const MAX_BODY_BYTES = 1_500_000;
const UPSTREAM_TIMEOUT_MS = 30_000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

let db = { users: [], transactions: [] };
let mutationQueue = Promise.resolve();
let sheetSyncQueue = Promise.resolve();

function normalizeMobile(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  return digits;
}

function validMobile(mobile) {
  return /^[6-9]\d{9}$/.test(mobile);
}

function normalizeVrn(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validVrn(vrn) {
  return /^[A-Z0-9]{4,15}$/.test(vrn);
}

function priceForDownload(downloadType) {
  return RC_PRICES[downloadType] || RC_PRICES.mparivahan;
}

function publicUser(user) {
  return {
    name: user.name,
    mobile: user.mobile,
    wallet: Number(user.wallet || 0),
    role: user.role,
    pricePerRc: RC_PRICES.mparivahan,
    prices: {
      mparivahan: RC_PRICES.mparivahan,
      rcCard: RC_PRICES['rc-card']
    }
  };
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'"
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...securityHeaders(),
    ...extraHeaders
  });
  res.end(body);
}

function sendError(res, status, message, code) {
  return sendJson(res, status, { success: false, message, ...(code ? { code } : {}) });
}

async function readJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
}

async function loadDatabase() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    const raw = await fs.readFile(dbFile, 'utf8');
    const parsed = JSON.parse(raw);
    db = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    db = { users: [], transactions: [] };
    await persistDatabase();
  }
}

async function persistDatabase() {
  await fs.mkdir(path.dirname(dbFile), { recursive: true });
  const temp = `${dbFile}.tmp`;
  await fs.writeFile(temp, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(temp, dbFile);
}

function withMutationLock(work) {
  const previous = mutationQueue;
  let release;
  mutationQueue = new Promise((resolve) => { release = resolve; });
  return previous
    .then(work)
    .finally(() => release());
}

function findUser(mobile) {
  return db.users.find((user) => user.mobile === mobile) || null;
}

function syncAdminRole(user) {
  if (user && ADMIN_MOBILE && user.mobile === ADMIN_MOBILE && user.role !== 'admin') {
    user.role = 'admin';
    void persistDatabase();
  }
  return user;
}

function passwordHash(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString('hex');
}

function passwordMatches(password, user) {
  const actual = Buffer.from(passwordHash(password, user.salt), 'hex');
  const expected = Buffer.from(user.passwordHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function makeSessionCookie(userId) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const payload = `${userId}.${expires}`;
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

function verifySessionCookie(value) {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [userId, expiry, signature] = parts;
  const payload = `${userId}.${expiry}`;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('hex');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  if (Number(expiry) < Math.floor(Date.now() / 1000)) return null;
  return syncAdminRole(db.users.find((user) => user.id === userId) || null);
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(([key]) => key));
}

function currentUser(req) {
  return verifySessionCookie(parseCookies(req).instant_rccard_session);
}

function authCookie(userId) {
  return `instant_rccard_session=${encodeURIComponent(makeSessionCookie(userId))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_SECONDS}`;
}

function clearAuthCookie() {
  return 'instant_rccard_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

function appendTransaction(mobile, type, amount, balanceAfter, vrn, note, adminMobile = '') {
  db.transactions.push({
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    mobile,
    type,
    amount,
    balanceAfter,
    vrn: vrn || '',
    status: 'SUCCESS',
    note: note || '',
    adminMobile
  });
}

function userTransactions(mobile, limit = 30) {
  return db.transactions.filter((item) => item.mobile === mobile).slice(-limit).reverse();
}

function sheetUserPayload(user) {
  return {
    userId: user.id,
    name: user.name,
    mobile: user.mobile,
    role: user.role,
    wallet: Number(user.wallet || 0),
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
    active: Boolean(user.active)
  };
}

function queueSheetSync(action, payload) {
  if (!SHEET_WEBHOOK_URL || !SHEET_SYNC_SECRET) return;
  sheetSyncQueue = sheetSyncQueue
    .then(() => syncToSheet(action, payload))
    .catch((error) => console.warn('Google Sheet sync failed:', error.message));
}

async function syncToSheet(action, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(SHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ secret: SHEET_SYNC_SECRET, action, payload }),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

function providerImages(payload) {
  const data = payload?.data ?? payload?.result ?? payload;
  const base64 = data?.base64;
  if (!base64 || typeof base64 !== 'object' || typeof base64.front !== 'string' || typeof base64.back !== 'string' || !base64.front || !base64.back) return null;
  return { front: base64.front, back: base64.back };
}

async function fetchProvider(vrn) {
  if (!RC_API_TOKEN) return { success: false, message: 'RC_API_TOKEN server environment me configured nahi hai.' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(RC_API_URL, {
      method: 'POST',
      headers: { Authorization: RC_API_TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ vrn }),
      signal: controller.signal
    });
    const raw = await response.text();
    let payload;
    try { payload = JSON.parse(raw); } catch { return { success: false, message: 'RC provider ne invalid response diya.' }; }
    if (!response.ok || payload?.success === false) return { success: false, message: payload?.message || payload?.error || 'RC image nahi mili. Vehicle number check karo.' };
    const images = providerImages(payload);
    if (!images) return { success: false, message: 'Front aur back RC image available nahi hai.' };
    return { success: true, images };
  } catch (error) {
    return { success: false, message: error.name === 'AbortError' ? 'RC provider timeout ho gaya.' : 'RC provider se connection nahi ho paaya.' };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleSignup(req, res) {
  const body = await readJson(req);
  const name = String(body.name || '').trim();
  const mobile = normalizeMobile(body.mobile);
  const password = String(body.password || '');
  if (name.length < 2) return sendError(res, 422, 'Apna naam enter karo.');
  if (!validMobile(mobile)) return sendError(res, 422, 'Valid 10-digit mobile number daalo.');
  if (password.length < 6) return sendError(res, 422, 'Password minimum 6 characters ka hona chahiye.');

  return withMutationLock(async () => {
    if (findUser(mobile)) return sendError(res, 409, 'Is mobile number ka account pehle se bana hua hai.');
    const salt = crypto.randomBytes(16).toString('hex');
    const user = { id: crypto.randomUUID(), name, mobile, salt, passwordHash: passwordHash(password, salt), wallet: 0, role: ADMIN_MOBILE && mobile === ADMIN_MOBILE ? 'admin' : 'user', createdAt: new Date().toISOString(), lastLogin: new Date().toISOString(), active: true };
    db.users.push(user);
    await persistDatabase();
    queueSheetSync('user', sheetUserPayload(user));
    return sendJson(res, 200, { success: true, user: publicUser(user) }, { 'Set-Cookie': authCookie(user.id) });
  });
}

async function handleLogin(req, res) {
  const body = await readJson(req);
  const mobile = normalizeMobile(body.mobile);
  const password = String(body.password || '');
  const user = syncAdminRole(findUser(mobile));
  if (!user || !user.active || !passwordMatches(password, user)) return sendError(res, 401, 'Mobile number ya password galat hai.');
  user.lastLogin = new Date().toISOString();
  await persistDatabase();
  queueSheetSync('user', sheetUserPayload(user));
  return sendJson(res, 200, { success: true, user: publicUser(user) }, { 'Set-Cookie': authCookie(user.id) });
}

async function handlePurchase(req, res) {
  const user = currentUser(req);
  if (!user || !user.active) return sendError(res, 401, 'Session expire ho gaya. Dobara login karo.');
  const body = await readJson(req);
  const vrn = normalizeVrn(body.vrn);
  const downloadType = body.downloadType === 'rc-card' ? 'rc-card' : 'mparivahan';
  const price = priceForDownload(downloadType);
  if (!validVrn(vrn)) return sendError(res, 422, 'Valid vehicle number daalo, jaise RJ14AB1234.');

  return withMutationLock(async () => {
    const fresh = syncAdminRole(findUser(user.mobile));
    if (!fresh) return sendError(res, 401, 'User account nahi mila.');
    if (Number(fresh.wallet) < price) {
      return sendJson(res, 200, {
        success: false,
        code: 'LOW_BALANCE',
        message: `Recharge your wallet. Minimum ₹${price} balance required for this format.`,
        wallet: Number(fresh.wallet),
        requiredPrice: price,
        downloadType
      });
    }

    const provider = await fetchProvider(vrn);
    if (!provider.success) return sendJson(res, 200, { success: false, message: provider.message, wallet: Number(fresh.wallet), requiredPrice: price, downloadType });

    fresh.wallet = Number(fresh.wallet) - price;
    const downloadLabel = downloadType === 'rc-card' ? 'RC Card PNG download' : 'MParivahan A4 PNG download';
    appendTransaction(fresh.mobile, 'RC_PURCHASE', -price, fresh.wallet, vrn, downloadLabel);
    await persistDatabase();
    queueSheetSync('user', sheetUserPayload(fresh));
    queueSheetSync('transaction', db.transactions[db.transactions.length - 1]);
    return sendJson(res, 200, { success: true, data: { vrn, front: provider.images.front, back: provider.images.back, downloadType }, wallet: fresh.wallet, charged: price, requiredPrice: price });
  });
}

function requireAdmin(req, res) {
  const user = currentUser(req);
  if (!user || !user.active) { sendError(res, 401, 'Session expire ho gaya.'); return null; }
  if (user.role !== 'admin') { sendError(res, 403, 'Admin access required.'); return null; }
  return user;
}

async function handleAdminSearch(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJson(req);
  const mobile = normalizeMobile(body.mobile);
  const user = findUser(mobile);
  if (!user) return sendError(res, 404, 'Is mobile number ka account nahi mila.');
  return sendJson(res, 200, { success: true, user: publicUser(user), transactions: userTransactions(mobile, 10) });
}

async function handleAdminRecharge(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJson(req);
  const mobile = normalizeMobile(body.mobile);
  const amount = Number(body.amount);
  if (!validMobile(mobile)) return sendError(res, 422, 'Valid user mobile number daalo.');
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) return sendError(res, 422, 'Recharge amount ₹1 se ₹100000 ke beech hona chahiye.');

  return withMutationLock(async () => {
    const user = findUser(mobile);
    if (!user) return sendError(res, 404, 'User account nahi mila.');
    user.wallet = Number(user.wallet) + amount;
    appendTransaction(mobile, 'RECHARGE', amount, user.wallet, '', String(body.note || 'Manual admin recharge').slice(0, 120), admin.mobile);
    await persistDatabase();
    queueSheetSync('user', sheetUserPayload(user));
    queueSheetSync('transaction', db.transactions[db.transactions.length - 1]);
    return sendJson(res, 200, { success: true, message: 'Wallet recharge successful.', user: publicUser(user) });
  });
}

async function serveStatic(req, res, pathname) {
  const requested = pathname === '/' ? '/index.html' : pathname;
  // Supports both the packaged public/ layout and the flat GitHub upload layout.
  let staticRoot = publicDir;
  try {
    await fs.access(path.join(publicDir, 'index.html'));
  } catch {
    staticRoot = __dirname;
  }
  const candidate = path.normalize(path.join(staticRoot, decodeURIComponent(requested)));
  if (!candidate.startsWith(staticRoot)) return sendError(res, 403, 'Forbidden');
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) throw new Error('not file');
    const content = await fs.readFile(candidate);
    const extension = path.extname(candidate).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[extension] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600', ...securityHeaders() });
    return res.end(content);
  } catch {
    return sendError(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    if (req.method === 'GET' && pathname === '/api/health') {
      const sheetSyncConfigured = Boolean(SHEET_WEBHOOK_URL && SHEET_SYNC_SECRET);
      return sendJson(res, 200, { success: true, service: 'InstantRCcard', providerConfigured: Boolean(RC_API_TOKEN), adminConfigured: Boolean(ADMIN_MOBILE), sheetSyncConfigured, storage: sheetSyncConfigured ? 'json+google-sheet' : 'json' });
    }
    if (req.method === 'GET' && pathname === '/api/auth/session') {
      const user = currentUser(req);
      return sendJson(res, 200, user ? { success: true, user: publicUser(user) } : { success: false, message: 'Not logged in' });
    }
    if (req.method === 'POST' && pathname === '/api/auth/signup') return await handleSignup(req, res);
    if (req.method === 'POST' && pathname === '/api/auth/login') return await handleLogin(req, res);
    if (req.method === 'POST' && pathname === '/api/auth/logout') return sendJson(res, 200, { success: true }, { 'Set-Cookie': clearAuthCookie() });
    if (req.method === 'GET' && pathname === '/api/account/transactions') {
      const user = currentUser(req);
      if (!user) return sendError(res, 401, 'Session expire ho gaya.');
      return sendJson(res, 200, { success: true, transactions: userTransactions(user.mobile, 30) });
    }
    if (req.method === 'POST' && pathname === '/api/rc/purchase') return await handlePurchase(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/users/search') return await handleAdminSearch(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/recharge') return await handleAdminRecharge(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/transactions') {
      const admin = requireAdmin(req, res);
      if (!admin) return;
      return sendJson(res, 200, { success: true, transactions: db.transactions.slice(-50).reverse() });
    }
    if (req.method === 'GET') return await serveStatic(req, res, pathname);
    return sendError(res, 405, 'Method not allowed');
  } catch (error) {
    console.error(error.message);
    return sendError(res, error.status || 500, error.message || 'Unexpected server error');
  }
});

await loadDatabase();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`InstantRCcard running on http://0.0.0.0:${PORT}`);
  console.log(`RC provider: ${RC_API_URL}`);
  console.log(`Provider token: ${RC_API_TOKEN ? 'configured' : 'missing'}`);
  console.log(`Admin mobile: ${ADMIN_MOBILE ? 'configured' : 'missing'}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
