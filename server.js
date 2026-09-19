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
const MAX_BODY_BYTES = 5_000_000;
const MAX_AD_BYTES = 40_000;
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

let db = { users: [], transactions: [], ads: [], settings: {}, rateLog: [] };
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

function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function normalizeVrn(value) {
  return String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validVrn(vrn) {
  return /^[A-Z0-9]{4,15}$/.test(vrn);
}

function defaultRcCardPrice() {
  return settingsNumber('rcCardPrice');
}

function customRcCardPrice(user) {
  if (!user || user.rcCardPrice == null || user.rcCardPrice === '') return null;
  const value = Number(user.rcCardPrice);
  return Number.isFinite(value) && value >= 1 ? Math.round(value) : null;
}

function hasCustomRcCardRate(user) {
  return customRcCardPrice(user) != null;
}

function userRcCardPrice(user) {
  const custom = customRcCardPrice(user);
  return custom == null ? defaultRcCardPrice() : custom;
}

function priceForDownload(downloadType, user) {
  if (downloadType === 'rc-card') return userRcCardPrice(user);
  return RC_PRICES.mparivahan;
}

function publicUser(user) {
  const rcCard = userRcCardPrice(user);
  const custom = customRcCardPrice(user);
  return {
    name: user.name,
    email: user.email || '',
    mobile: user.mobile,
    wallet: Number(user.wallet || 0),
    role: user.role,
    pricePerRc: RC_PRICES.mparivahan,
    customRcCardPrice: custom,
    prices: {
      mparivahan: RC_PRICES.mparivahan,
      rcCard
    }
  };
}

// Admin ke "Users & rates" section ke liye extra detail (wallet, status, created date).
function publicAdminUser(user) {
  const custom = customRcCardPrice(user);
  return {
    ...publicUser(user),
    active: user.active !== false,
    createdAt: user.createdAt || '',
    lastLogin: user.lastLogin || '',
    rateUpdatedAt: user.rcRateUpdatedAt || '',
    rateUpdatedBy: user.rcRateUpdatedBy || '',
    rate: userRcCardPrice(user),
    customRate: custom,
    hasCustomRate: custom != null
  };
}

function appendRateLog(admin, user, from, to) {
  if (!Array.isArray(db.rateLog)) db.rateLog = [];
  const entry = {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    adminMobile: admin ? admin.mobile : '',
    mobile: user.mobile,
    name: user.name || '',
    from: from == null ? null : from,
    to: to == null ? null : to
  };
  db.rateLog.push(entry);
  if (db.rateLog.length > 300) db.rateLog = db.rateLog.slice(-300);
  return entry;
}

// Ek user ka RC Card rate set/clear karta hai + audit log + Sheet sync queue karta hai.
function applyUserRate(admin, user, { price, clear }) {
  const from = customRcCardPrice(user);
  let to = null;
  if (!clear) {
    const value = Number(price);
    if (!Number.isFinite(value) || value < 1 || value > 1000) {
      return { ok: false, status: 422, message: 'RC rate ₹1 se ₹1000 ke beech hona chahiye.' };
    }
    to = Math.round(value);
  }
  user.rcCardPrice = to;
  user.rcRateUpdatedAt = new Date().toISOString();
  user.rcRateUpdatedBy = admin ? admin.mobile : '';
  const rateLogEntry = appendRateLog(admin, user, from, to);
  queueSheetSync('user', sheetUserPayload(user));
  queueSheetSync('rateLog', rateLogEntry);
  return { ok: true, from, to };
}

// Naam, mobile ya email ke partial match se users dhoondta hai (admin list ke liye).
function searchAdminUsers(query) {
  const raw = String(query ?? '').trim().toLowerCase();
  if (!raw) return db.users.slice();
  const digits = normalizeMobile(raw);
  return db.users.filter((user) => {
    if (String(user.name || '').toLowerCase().includes(raw)) return true;
    if (String(user.email || '').toLowerCase().includes(raw)) return true;
    if (String(user.mobile || '').includes(raw)) return true;
    return Boolean(digits && digits.length >= 3 && String(user.mobile || '').includes(digits));
  });
}

function sortAdminUsers(users) {
  return users.slice().sort((a, b) => {
    if ((a.role === 'admin') !== (b.role === 'admin')) return a.role === 'admin' ? -1 : 1;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

// Mobile/email/naam teeno se user resolve karta hai; ambiguous naam par saaf message deta hai.
function resolveAdminUserQuery(query) {
  const raw = String(query ?? '').trim();
  if (!raw) return { status: 422, message: 'User ka mobile number, email ya naam daalo.' };
  const direct = findUserByQuery(raw);
  if (direct) return { user: direct };
  const matches = searchAdminUsers(raw);
  if (matches.length === 1) return { user: matches[0] };
  if (matches.length > 1) {
    return { status: 422, message: `"${raw}" se ${matches.length} users mile. Exact mobile/email daalo ya "Users & rates" tab me sahi user choose karo.` };
  }
  return { status: 404, message: 'Is mobile/email/naam ka account nahi mila.' };
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
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      ads: Array.isArray(parsed.ads) ? parsed.ads : [],
      settings: parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {},
      rateLog: Array.isArray(parsed.rateLog) ? parsed.rateLog : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    db = { users: [], transactions: [], ads: [], settings: {}, rateLog: [] };
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

function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return db.users.find((user) => normalizeEmail(user.email) === normalized) || null;
}

function findUserByQuery(query) {
  const raw = String(query ?? '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return findUserByEmail(raw);
  const mobile = normalizeMobile(raw);
  if (validMobile(mobile)) return findUser(mobile);
  // Also try email-style lookup when input looks like email without needing @ check again
  if (validEmail(normalizeEmail(raw))) return findUserByEmail(raw);
  return null;
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
    email: user.email || '',
    mobile: user.mobile,
    passwordHash: user.passwordHash || '',
    salt: user.salt || '',
    role: user.role,
    wallet: Number(user.wallet || 0),
    rcCardPrice: user.rcCardPrice != null && user.rcCardPrice !== '' ? Number(user.rcCardPrice) : '',
    rcRateUpdatedAt: user.rcRateUpdatedAt || '',
    rcRateUpdatedBy: user.rcRateUpdatedBy || '',
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
    active: Boolean(user.active)
  };
}

function sheetAdPayload(ad) {
  return {
    id: ad.id,
    title: ad.title || '',
    imageData: ad.imageData || '',
    active: ad.active !== false,
    createdAt: ad.createdAt,
    updatedAt: ad.updatedAt
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

function imageValue(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (!value || typeof value !== 'object') return '';
  for (const key of ['base64', 'data', 'url', 'src', 'image']) {
    if (typeof value[key] === 'string' && value[key].trim()) return value[key].trim();
  }
  return '';
}

function providerImages(payload) {
  const data = payload?.data ?? payload?.result ?? payload;
  const groups = [data?.base64, data?.images, data?.image, data];
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const front = imageValue(group.front ?? group.frontImage ?? group.front_image ?? group.frontSide ?? group.front_side);
    const back = imageValue(group.back ?? group.backImage ?? group.back_image ?? group.backSide ?? group.back_side);
    if (front && back) return { front, back };
  }
  return null;
}

async function normalizeProviderImage(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  if (/^data:image\//i.test(source)) return source;
  if (/^https?:\/\//i.test(source)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(source, { headers: { Accept: 'image/*', Authorization: RC_API_TOKEN }, signal: controller.signal });
      if (!response.ok) return '';
      const contentType = String(response.headers.get('content-type') || 'image/png').split(';')[0];
      if (!contentType.startsWith('image/')) return '';
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > 4_000_000) return '';
      return `data:${contentType};base64,${bytes.toString('base64')}`;
    } catch {
      return '';
    } finally {
      clearTimeout(timeout);
    }
  }
  const raw = source.replace(/\s/g, '');
  return /^[A-Za-z0-9+/=_-]+$/.test(raw) ? `data:image/png;base64,${raw}` : '';
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
    const front = await normalizeProviderImage(images.front);
    const back = await normalizeProviderImage(images.back);
    if (!front || !back) return { success: false, message: 'Front aur back RC image download nahi ho paayi.' };
    return { success: true, images: { front, back } };
  } catch (error) {
    return { success: false, message: error.name === 'AbortError' ? 'RC provider timeout ho gaya.' : 'RC provider se connection nahi ho paaya.' };
  } finally {
    clearTimeout(timeout);
  }
}

async function restoreFromSheet() {
  if (!SHEET_WEBHOOK_URL || !SHEET_SYNC_SECRET) return;
  try {
    const snapshotUrl = new URL(SHEET_WEBHOOK_URL);
    snapshotUrl.searchParams.set('action', 'snapshot');
    snapshotUrl.searchParams.set('secret', SHEET_SYNC_SECRET);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const response = await fetch(snapshotUrl, { headers: { Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    if (!snapshot.success) throw new Error(snapshot.message || 'Snapshot unavailable');

    const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
    const transactions = Array.isArray(snapshot.transactions) ? snapshot.transactions : [];
    const ads = Array.isArray(snapshot.ads) ? snapshot.ads : [];

    // Google Sheet is the durable source when it contains account records.
    // Keep a local database if the sheet is empty/unavailable during first setup.
    if (accounts.length || !db.users.length) db.users = accounts.map((account) => {
      const customPrice = Number(account.rcCardPrice);
      return {
        id: String(account.userId || account.id || `sheet-${account.mobile}`),
        name: String(account.name || ''),
        email: normalizeEmail(account.email),
        mobile: normalizeMobile(account.mobile),
        salt: String(account.salt || ''),
        passwordHash: String(account.passwordHash || ''),
        wallet: Number(account.wallet || 0),
        rcCardPrice: Number.isFinite(customPrice) && customPrice >= 1 ? Math.round(customPrice) : null,
        rcRateUpdatedAt: account.rcRateUpdatedAt || '',
        rcRateUpdatedBy: account.rcRateUpdatedBy || '',
        role: account.role === 'admin' ? 'admin' : 'user',
        createdAt: account.createdAt || new Date().toISOString(),
        lastLogin: account.lastLogin || account.createdAt || new Date().toISOString(),
        active: account.active !== false && String(account.active).toLowerCase() !== 'false'
      };
    });
    if (transactions.length || !db.transactions.length) db.transactions = transactions;
    if (snapshot.settings && typeof snapshot.settings === 'object') db.settings = { ...db.settings, ...snapshot.settings };
    if (Array.isArray(snapshot.rateLog)) db.rateLog = snapshot.rateLog.slice(-300);
    if (ads.length || !db.ads.length) db.ads = ads.map((ad) => ({
      id: String(ad.id || crypto.randomUUID()),
      title: String(ad.title || ''),
      imageData: String(ad.imageData || ''),
      active: ad.active !== false && String(ad.active).toLowerCase() !== 'false',
      createdAt: ad.createdAt || new Date().toISOString(),
      updatedAt: ad.updatedAt || ad.createdAt || new Date().toISOString()
    }));
    await persistDatabase();
    console.log(`Restored ${db.users.length} account(s), ${db.transactions.length} transaction(s), ${db.ads.length} ad(s) from Google Sheet.`);
  } catch (error) {
    console.warn('Google Sheet restore skipped:', error.message);
  }
}

async function handleSignup(req, res) {
  const body = await readJson(req);
  const name = String(body.name || '').trim();
  const email = normalizeEmail(body.email);
  const mobile = normalizeMobile(body.mobile);
  const password = String(body.password || '');
  if (name.length < 2) return sendError(res, 422, 'Apna naam enter karo.');
  if (!validEmail(email)) return sendError(res, 422, 'Valid email address daalo.');
  if (!validMobile(mobile)) return sendError(res, 422, 'Valid 10-digit mobile number daalo.');
  if (password.length < 6) return sendError(res, 422, 'Password minimum 6 characters ka hona chahiye.');

  return withMutationLock(async () => {
    if (findUser(mobile)) return sendError(res, 409, 'Is mobile number ka account pehle se bana hua hai.');
    const salt = crypto.randomBytes(16).toString('hex');
    if (findUserByEmail(email)) return sendError(res, 409, 'Is email ka account pehle se bana hua hai.');
    const user = { id: crypto.randomUUID(), name, email, mobile, salt, passwordHash: passwordHash(password, salt), wallet: 0, rcCardPrice: null, role: ADMIN_MOBILE && mobile === ADMIN_MOBILE ? 'admin' : 'user', createdAt: new Date().toISOString(), lastLogin: new Date().toISOString(), active: true };
    db.users.push(user);
    await persistDatabase();
    queueSheetSync('user', sheetUserPayload(user));
    return sendJson(res, 200, { success: true, user: publicUser(user) }, { 'Set-Cookie': authCookie(user.id) });
  });
}

async function handleLogin(req, res) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const mobile = normalizeMobile(body.mobile);
  const password = String(body.password || '');
  if (!validEmail(email) || !validMobile(mobile) || !password) {
    return sendError(res, 422, 'Registered email, valid mobile number aur password enter karo.');
  }
  const user = syncAdminRole(findUser(mobile));
  if (!user || !user.active || !passwordMatches(password, user)) {
    return sendError(res, 401, 'Email, mobile number ya password galat hai.');
  }
  // Purane valid accounts me email blank ho sakta hai; dono credentials ke saath pehli login par email save ho jayega.
  if (!normalizeEmail(user.email)) user.email = email;
  if (normalizeEmail(user.email) !== email) {
    return sendError(res, 401, 'Email, mobile number ya password galat hai.');
  }
  user.lastLogin = new Date().toISOString();
  await persistDatabase();
  queueSheetSync('user', sheetUserPayload(user));
  return sendJson(res, 200, { success: true, user: publicUser(user) }, { 'Set-Cookie': authCookie(user.id) });
}

async function handleForgotPassword(req, res) {
  const body = await readJson(req);
  const email = normalizeEmail(body.email);
  const mobile = normalizeMobile(body.mobile);
  const newPassword = String(body.newPassword || '');
  const confirmPassword = String(body.confirmPassword || '');
  if (!validEmail(email) || !validMobile(mobile)) return sendError(res, 422, 'Valid email aur 10-digit mobile number daalo.');
  if (newPassword.length < 6) return sendError(res, 422, 'New password minimum 6 characters ka hona chahiye.');
  if (newPassword !== confirmPassword) return sendError(res, 422, 'New password aur confirm password match nahi karte.');

  return withMutationLock(async () => {
    const user = findUser(mobile);
    if (!user || !user.active || (user.email && user.email !== email)) {
      return sendError(res, 404, 'Email aur mobile se account verify nahi ho paaya.');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    user.email = email;
    user.salt = salt;
    user.passwordHash = passwordHash(newPassword, salt);
    user.lastLogin = new Date().toISOString();
    await persistDatabase();
    queueSheetSync('user', sheetUserPayload(user));
    return sendJson(res, 200, { success: true, message: 'Password reset successful. Ab naye password se login karo.' });
  });
}

async function handlePurchase(req, res) {
  const user = currentUser(req);
  if (!user || !user.active) return sendError(res, 401, 'Session expire ho gaya. Dobara login karo.');
  const body = await readJson(req);
  const vrn = normalizeVrn(body.vrn);
  const downloadType = body.downloadType === 'rc-card' ? 'rc-card' : 'mparivahan';
  if (!validVrn(vrn)) return sendError(res, 422, 'Valid vehicle number daalo, jaise RJ14AB1234.');

  return withMutationLock(async () => {
    const fresh = syncAdminRole(findUser(user.mobile));
    if (!fresh) return sendError(res, 401, 'User account nahi mila.');
    const price = priceForDownload(downloadType, fresh);
    if (downloadType === 'mparivahan') {
      return sendJson(res, 200, { success: false, code: 'COMING_SOON', message: 'MParivahan RC format Coming Soon!', downloadType, requiredPrice: price });
    }
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
  const query = String(body.query || body.mobile || body.email || '').trim();
  if (!query) return sendError(res, 422, 'User mobile number ya email daalo.');
  const resolved = resolveAdminUserQuery(query);
  if (!resolved.user) return sendError(res, resolved.status, resolved.message);
  const user = resolved.user;
  return sendJson(res, 200, {
    success: true,
    user: publicUser(user),
    adminUser: publicAdminUser(user),
    defaultRcCardPrice: defaultRcCardPrice(),
    transactions: userTransactions(user.mobile, 10)
  });
}

async function handleAdminSetUserRate(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJson(req);
  const query = String(body.query || body.mobile || body.email || '').trim();
  const clearCustom = body.clear === true || body.price === null || body.price === '';
  if (!query) return sendError(res, 422, 'User mobile number ya email daalo.');

  return withMutationLock(async () => {
    const resolved = resolveAdminUserQuery(query);
    if (!resolved.user) return sendError(res, resolved.status, resolved.message);
    const user = resolved.user;
    const result = applyUserRate(admin, user, { price: body.price, clear: clearCustom });
    if (!result.ok) return sendError(res, result.status, result.message);

    await persistDatabase();
    return sendJson(res, 200, {
      success: true,
      message: result.to == null
        ? `${user.name} ab default global RC rate ₹${defaultRcCardPrice()} use karega.`
        : `${user.name} ka RC Card rate ₹${result.to} set ho gaya.`,
      user: publicUser(user),
      adminUser: publicAdminUser(user),
      defaultRcCardPrice: defaultRcCardPrice()
    });
  });
}

// Admin panel ka "Users & rates" tab: naam/mobile/email search + rate summary + rate audit log.
async function handleAdminListUsers(req, res, searchParams) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const query = String(searchParams.get('q') || '').trim();
  const limitRaw = Number(searchParams.get('limit'));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 300) : 100;
  const matches = sortAdminUsers(searchAdminUsers(query));
  const users = matches.slice(0, limit).map(publicAdminUser);
  const customRateCount = db.users.filter(hasCustomRcCardRate).length;
  return sendJson(res, 200, {
    success: true,
    users,
    query,
    matched: matches.length,
    shown: users.length,
    total: db.users.length,
    activeUsers: db.users.filter((user) => user.active !== false).length,
    customRateCount,
    defaultRcCardPrice: defaultRcCardPrice(),
    rateLog: (Array.isArray(db.rateLog) ? db.rateLog : []).slice(-15).reverse()
  });
}

// Bulk rate: "all" (har normal user) ya "selected" (diye gaye mobile numbers).
async function handleAdminBulkSetRate(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJson(req);
  const clearCustom = body.clear === true || body.price === null || body.price === '';
  const scope = body.scope === 'selected' ? 'selected' : 'all';
  if (!clearCustom) {
    const value = Number(body.price);
    if (!Number.isFinite(value) || value < 1 || value > 1000) {
      return sendError(res, 422, 'RC rate ₹1 se ₹1000 ke beech hona chahiye.');
    }
  }
  if (scope === 'all' && body.confirm !== true) {
    return sendError(res, 422, 'Sabhi users par rate lagane ke liye confirm zaroori hai.');
  }

  return withMutationLock(async () => {
    let targets;
    if (scope === 'selected') {
      const mobiles = Array.isArray(body.mobiles) ? body.mobiles.map(normalizeMobile).filter(validMobile) : [];
      if (!mobiles.length) return sendError(res, 422, 'Kam se kam ek user ka mobile number daalo.');
      targets = db.users.filter((user) => mobiles.includes(user.mobile));
    } else {
      targets = db.users.filter((user) => user.role !== 'admin');
    }
    if (!targets.length) return sendError(res, 404, 'Koi matching user nahi mila.');

    let updated = 0;
    for (const user of targets) {
      const result = applyUserRate(admin, user, { price: body.price, clear: clearCustom });
      if (result.ok) updated += 1;
    }
    await persistDatabase();
    return sendJson(res, 200, {
      success: true,
      updated,
      message: clearCustom
        ? `${updated} user(s) ka custom rate hata diya — ab default ₹${defaultRcCardPrice()} apply hoga.`
        : `${updated} user(s) ka RC Card rate ₹${Math.round(Number(body.price))} set ho gaya.`
    });
  });
}

async function handleAdminSetUserStatus(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJson(req);
  const mobile = normalizeMobile(body.mobile);
  const active = body.active !== false;
  if (!validMobile(mobile)) return sendError(res, 422, 'Valid user mobile number daalo.');

  return withMutationLock(async () => {
    const user = findUser(mobile);
    if (!user) return sendError(res, 404, 'User account nahi mila.');
    if (user.mobile === admin.mobile && !active) return sendError(res, 422, 'Apna admin account block nahi kar sakte.');
    user.active = active;
    await persistDatabase();
    queueSheetSync('user', sheetUserPayload(user));
    return sendJson(res, 200, {
      success: true,
      user: publicAdminUser(user),
      message: active ? `${user.name} ka account unblock ho gaya.` : `${user.name} ka account block kar diya.`
    });
  });
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

function publicAd(ad) {
  return {
    id: String(ad.id),
    title: String(ad.title || ''),
    imageData: String(ad.imageData || ''),
    active: ad.active !== false,
    createdAt: ad.createdAt,
    updatedAt: ad.updatedAt || ad.createdAt
  };
}

function validAdImage(imageData) {
  if (typeof imageData !== 'string') return false;
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(imageData)) return false;
  const base64 = imageData.slice(imageData.indexOf(',') + 1).replace(/\s/g, '');
  try {
    return Buffer.from(base64, 'base64').byteLength <= MAX_AD_BYTES;
  } catch {
    return false;
  }
}

async function handleGetAds(req, res) {
  const ads = db.ads.filter((ad) => ad.active !== false).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map(publicAd);
  return sendJson(res, 200, { success: true, ads });
}

const DEFAULT_SETTINGS = { usersBaseline: 200000, downloadsBaseline: 171000, rating: '4.9', rcCardPrice: 15 };

function settingsNumber(key) {
  const raw = db.settings ? db.settings[key] : undefined;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_SETTINGS[key] || 0;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : (DEFAULT_SETTINGS[key] || 0);
}

async function handlePublicStats(req, res) {
  const activeUsers = db.users.filter((user) => user.active !== false && user.role !== 'admin').length;
  const completedDownloads = db.transactions.filter((tx) => tx.type === 'RC_PURCHASE' && tx.status === 'SUCCESS').length;
  const configuredRating = String((db.settings && db.settings.rating) || '').trim();
  const rating = configuredRating || String(process.env.PUBLIC_RATING || '').trim() || DEFAULT_SETTINGS.rating;
  return sendJson(res, 200, {
    success: true,
    users: activeUsers + settingsNumber('usersBaseline'),
    downloads: completedDownloads + settingsNumber('downloadsBaseline'),
    rating: /^\d(?:\.\d)?$/.test(rating) ? rating : '',
    rcCardPrice: settingsNumber('rcCardPrice')
  });
}

function dayKey(iso) {
  return String(iso || '').slice(0, 10);
}

function monthKey(iso) {
  return String(iso || '').slice(0, 7);
}

function sumAmount(list) {
  return list.reduce((total, tx) => total + Number(tx.amount || 0), 0);
}

function computeAdminStats(fromDay, toDay) {
  const now = new Date();
  const todayKey = now.toISOString().slice(0, 10);
  const monthNowKey = now.toISOString().slice(0, 7);
  const lastMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const lastMonthKey = lastMonthDate.toISOString().slice(0, 7);

  const totalUsers = db.users.filter((user) => user.role !== 'admin').length;
  const activeUsers = db.users.filter((user) => user.role !== 'admin' && user.active !== false).length;

  // "Topup" = wallet credits the admin has given users (manual admin recharge).
  const topups = db.transactions.filter((tx) => tx.type === 'RECHARGE');
  const rcDownloads = db.transactions.filter((tx) => tx.type === 'RC_PURCHASE' && tx.status === 'SUCCESS');

  const todayTopup = sumAmount(topups.filter((tx) => dayKey(tx.time) === todayKey));
  const monthTopup = sumAmount(topups.filter((tx) => monthKey(tx.time) === monthNowKey));
  const lastMonthTopup = sumAmount(topups.filter((tx) => monthKey(tx.time) === lastMonthKey));

  const todayRcDownloads = rcDownloads.filter((tx) => dayKey(tx.time) === todayKey).length;
  const monthRcDownloads = rcDownloads.filter((tx) => monthKey(tx.time) === monthNowKey).length;
  const lastMonthRcDownloads = rcDownloads.filter((tx) => monthKey(tx.time) === lastMonthKey).length;

  let range = null;
  if (fromDay && toDay) {
    const inRange = (tx) => {
      const key = dayKey(tx.time);
      return key >= fromDay && key <= toDay;
    };
    range = {
      from: fromDay,
      to: toDay,
      topup: sumAmount(topups.filter(inRange)),
      rcDownloads: rcDownloads.filter(inRange).length,
      newUsers: db.users.filter((user) => {
        if (user.role === 'admin') return false;
        const key = dayKey(user.createdAt);
        return key >= fromDay && key <= toDay;
      }).length
    };
  }

  return {
    totalUsers,
    activeUsers,
    todayTopup,
    monthTopup,
    lastMonthTopup,
    todayRcDownloads,
    monthRcDownloads,
    lastMonthRcDownloads,
    range
  };
}

async function handleAdminStats(req, res, searchParams) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const fromRaw = String(searchParams.get('from') || '');
  const toRaw = String(searchParams.get('to') || '');
  const validDay = /^\d{4}-\d{2}-\d{2}$/;
  const from = validDay.test(fromRaw) ? fromRaw : '';
  const to = validDay.test(toRaw) ? toRaw : '';
  const stats = computeAdminStats(from, to);
  return sendJson(res, 200, {
    success: true,
    stats,
    settings: {
      rating: String((db.settings && db.settings.rating) || DEFAULT_SETTINGS.rating),
      usersBaseline: settingsNumber('usersBaseline'),
      downloadsBaseline: settingsNumber('downloadsBaseline'),
      rcCardPrice: settingsNumber('rcCardPrice')
    }
  });
}

async function handleAdminUpdateRating(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJson(req);
  const rating = String(body.rating ?? '').trim();
  if (rating && !/^[0-5](?:\.\d)?$/.test(rating)) {
    return sendError(res, 422, 'Rating 0 se 5 ke beech ek decimal ke saath daalo, jaise 4.8.');
  }
  db.settings = db.settings || {};
  db.settings.rating = rating;
  await persistDatabase();
  queueSheetSync('settings', { rating });
  return sendJson(res, 200, { success: true, rating });
}

async function handleAdminUpdateBaseline(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJson(req);
  const usersBaseline = Number(body.usersBaseline);
  const downloadsBaseline = Number(body.downloadsBaseline);
  if (!Number.isFinite(usersBaseline) || usersBaseline < 0 || usersBaseline > 100_000_000) {
    return sendError(res, 422, 'Users baseline 0 se 10 crore ke beech ek valid number hona chahiye.');
  }
  if (!Number.isFinite(downloadsBaseline) || downloadsBaseline < 0 || downloadsBaseline > 100_000_000) {
    return sendError(res, 422, 'RC downloads baseline 0 se 10 crore ke beech ek valid number hona chahiye.');
  }
  db.settings = db.settings || {};
  db.settings.usersBaseline = usersBaseline;
  db.settings.downloadsBaseline = downloadsBaseline;
  await persistDatabase();
  queueSheetSync('settings', { usersBaseline, downloadsBaseline });
  return sendJson(res, 200, { success: true, usersBaseline, downloadsBaseline });
}

async function handleAdminUpdateRcPrice(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJson(req);
  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 1 || price > 1000) {
    return sendError(res, 422, 'RC Card rate ₹1 se ₹1000 ke beech hona chahiye.');
  }
  db.settings = db.settings || {};
  db.settings.rcCardPrice = Math.round(price);
  await persistDatabase();
  queueSheetSync('settings', { rcCardPrice: db.settings.rcCardPrice });
  return sendJson(res, 200, {
    success: true,
    rcCardPrice: db.settings.rcCardPrice,
    message: 'Default RC Card rate update ho gaya. Jis user ka custom rate set nahi hai, woh ab ye rate use karega.'
  });
}

async function handleAdminGetAds(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  return sendJson(res, 200, { success: true, ads: db.ads.slice().reverse().map(publicAd) });
}

async function handleAdminAddAd(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const body = await readJson(req);
  const title = String(body.title || 'InstantRCcard offer').trim().slice(0, 120);
  const imageData = String(body.imageData || '');
  if (!validAdImage(imageData)) return sendError(res, 422, 'PNG, JPG, WEBP ya GIF image upload karo. Image size 40 KB se kam rakho.');
  const now = new Date().toISOString();
  const ad = { id: crypto.randomUUID(), title, imageData, active: true, createdAt: now, updatedAt: now };
  db.ads.push(ad);
  await persistDatabase();
  queueSheetSync('ad', sheetAdPayload(ad));
  return sendJson(res, 200, { success: true, ad: publicAd(ad) });
}

async function handleAdminDeleteAd(req, res, adId) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const before = db.ads.length;
  db.ads = db.ads.filter((ad) => String(ad.id) !== String(adId));
  if (db.ads.length === before) return sendError(res, 404, 'Advertisement nahi mila.');
  await persistDatabase();
  queueSheetSync('adDelete', { id: String(adId) });
  return sendJson(res, 200, { success: true, message: 'Advertisement remove ho gaya.' });
}

async function handleAdminToggleAd(req, res, adId) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  const ad = db.ads.find((item) => String(item.id) === String(adId));
  if (!ad) return sendError(res, 404, 'Advertisement nahi mila.');
  ad.active = ad.active === false;
  ad.updatedAt = new Date().toISOString();
  await persistDatabase();
  queueSheetSync('ad', sheetAdPayload(ad));
  return sendJson(res, 200, { success: true, ad: publicAd(ad) });
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
    if (req.method === 'POST' && pathname === '/api/auth/forgot-password') return await handleForgotPassword(req, res);
    if (req.method === 'POST' && pathname === '/api/auth/logout') return sendJson(res, 200, { success: true }, { 'Set-Cookie': clearAuthCookie() });
    if (req.method === 'GET' && pathname === '/api/ads') return await handleGetAds(req, res);
    if (req.method === 'GET' && pathname === '/api/public/stats') return await handlePublicStats(req, res);
    if (req.method === 'GET' && pathname === '/api/account/transactions') {
      const user = currentUser(req);
      if (!user) return sendError(res, 401, 'Session expire ho gaya.');
      return sendJson(res, 200, { success: true, transactions: userTransactions(user.mobile, 30) });
    }
    if (req.method === 'POST' && pathname === '/api/rc/purchase') return await handlePurchase(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/users/search') return await handleAdminSearch(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/users') return await handleAdminListUsers(req, res, url.searchParams);
    if (req.method === 'POST' && pathname === '/api/admin/users/set-rate') return await handleAdminSetUserRate(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/users/bulk-rate') return await handleAdminBulkSetRate(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/users/status') return await handleAdminSetUserStatus(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/recharge') return await handleAdminRecharge(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/ads') return await handleAdminGetAds(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/ads') return await handleAdminAddAd(req, res);
    const adRoute = pathname.match(/^\/api\/admin\/ads\/([^/]+)$/);
    if (adRoute && req.method === 'DELETE') return await handleAdminDeleteAd(req, res, decodeURIComponent(adRoute[1]));
    if (adRoute && req.method === 'POST') return await handleAdminToggleAd(req, res, decodeURIComponent(adRoute[1]));
    if (req.method === 'GET' && pathname === '/api/admin/stats') return await handleAdminStats(req, res, url.searchParams);
    if (req.method === 'POST' && pathname === '/api/admin/settings/rating') return await handleAdminUpdateRating(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/settings/baseline') return await handleAdminUpdateBaseline(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/settings/rc-price') return await handleAdminUpdateRcPrice(req, res);
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
await restoreFromSheet();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`InstantRCcard running on http://0.0.0.0:${PORT}`);
  console.log(`RC provider: ${RC_API_URL}`);
  console.log(`Provider token: ${RC_API_TOKEN ? 'configured' : 'missing'}`);
  console.log(`Admin mobile: ${ADMIN_MOBILE ? 'configured' : 'missing'}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
