import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import webpush from 'web-push';

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
const ADMIN_PERMISSION_KEYS = Object.freeze(['kpi', 'recharge', 'rates', 'ads', 'transactions', 'userHistory', 'access']);
const FULL_ADMIN_PERMISSIONS = Object.freeze({ kpi: true, recharge: true, rates: true, ads: true, transactions: true, userHistory: true, access: true });
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const STATS_TIME_ZONE = process.env.APP_TIME_ZONE || 'Asia/Kolkata';
const MAX_BODY_BYTES = 5_000_000;
const MAX_AD_BYTES = 40_000;
const MAX_PAYMENT_QR_BYTES = 1_500_000;
const UPSTREAM_TIMEOUT_MS = 12_000;
const PROVIDER_RETRY_COUNT = 2;
const SHEET_SYNC_TIMEOUT_MS = 60_000;
const BUILD_VERSION = 'wallet-direct-v8-railway-primary';
const WEB_PUSH_VAPID_PUBLIC_KEY = process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '';
const WEB_PUSH_VAPID_PRIVATE_KEY = process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '';
const WEB_PUSH_SUBJECT = process.env.WEB_PUSH_SUBJECT || 'mailto:admin@example.com';
// Optional one-way replication for a secondary Render deployment. Set this
// URL only on Render when Railway is the primary admin/request service.
const CROSS_DEPLOY_PRIMARY_URL = ''; // Railway-only release: no secondary writer or replication target.
const CROSS_DEPLOY_SYNC_SECRET = ''; // Railway-only release: legacy cross-deploy sync disabled.
// Recommended no-SQL cross-deployment mode: Render serves the static app and
// forwards every API request to Railway, so Railway remains the single writer.
const PRIMARY_API_URL = ''; // Railway-only release: no upstream API target.
const PROXY_TO_PRIMARY = false; // Railway-only release: Railway handles its own API directly.
const PRIMARY_PROXY_TIMEOUT_MS = 35_000;
let webPushReady = false;
try {
  if (WEB_PUSH_VAPID_PUBLIC_KEY && WEB_PUSH_VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(WEB_PUSH_SUBJECT, WEB_PUSH_VAPID_PUBLIC_KEY, WEB_PUSH_VAPID_PRIVATE_KEY);
    webPushReady = true;
  }
} catch (error) {
  console.warn('Web Push disabled:', error.message);
}
const RC_CACHE_TTL_MS = 30 * 60 * 1000;
const RC_CACHE_MAX_ENTRIES = 64;
const providerCache = new Map();
const providerInflight = new Map();

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

let db = { users: [], transactions: [], ads: [], settings: {}, rateLog: [], topupRequests: [], notifications: [], pushSubscriptions: [] };
let mutationQueue = Promise.resolve();
let sheetSyncQueue = Promise.resolve();
let sheetSyncFailures = [];
let restoreState = { status: 'not-started', users: 0, transactions: 0, rcDownloads: 0, sheetAccounts: 0, sheetTransactions: 0, completedAt: '', error: '' };
const MAX_STORED_NOTIFICATIONS = 3000;

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

function validPaymentQr(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  if (!/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=\s]+$/i.test(value)) return false;
  try {
    const bytes = Buffer.from(value.slice(value.indexOf(',') + 1).replace(/\s/g, ''), 'base64');
    return bytes.byteLength > 0 && bytes.byteLength <= MAX_PAYMENT_QR_BYTES;
  } catch {
    return false;
  }
}

function supportWhatsappNumber() {
  const configured = normalizeMobile(db.settings?.supportWhatsapp || process.env.SUPPORT_WHATSAPP || '');
  return validMobile(configured) ? configured : '';
}

function supportSettingsPayload(req) {
  const whatsapp = supportWhatsappNumber();
  const paymentQr = validPaymentQr(db.settings?.paymentQr) ? db.settings.paymentQr : '';
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || (req?.socket?.encrypted ? 'https' : 'http');
  const host = String(req?.headers?.host || '').trim();
  const paymentQrUrl = paymentQr && host ? `${protocol}://${host}/api/payment-qr` : '';
  return {
    whatsapp,
    whatsappUrl: whatsapp ? `https://wa.me/91${whatsapp}` : '',
    paymentQr,
    paymentQrUrl
  };
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

function isMainAdmin(user) {
  return Boolean(user && ADMIN_MOBILE && normalizeMobile(user.mobile) === ADMIN_MOBILE);
}

function adminRoleLabel(user) {
  return isMainAdmin(user) ? 'Main Admin' : 'Admin Assistant';
}

function normalizedAdminPermissions(value, fallbackFull = false) {
  if (fallbackFull || value == null || value === '') return { ...FULL_ADMIN_PERMISSIONS };
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = {}; }
  }
  if (!source || typeof source !== 'object') source = {};
  return Object.fromEntries(ADMIN_PERMISSION_KEYS.map((key) => [key, source[key] === true]));
}

function adminPermissionsFor(user) {
  if (!user || user.role !== 'admin') return {};
  const owner = isMainAdmin(user);
  return normalizedAdminPermissions(user.adminPermissions, owner || user.adminPermissions == null);
}

function hasAdminPermission(user, permission) {
  if (!user || user.role !== 'admin') return false;
  if (!permission) return true;
  return adminPermissionsFor(user)[permission] === true;
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
    ...(user.role === 'admin' ? {
      adminPermissions: adminPermissionsFor(user),
      adminLabel: adminRoleLabel(user),
      isMainAdmin: isMainAdmin(user)
    } : {}),
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
    hasCustomRate: custom != null,
    adminPermissions: user.role === 'admin' ? adminPermissionsFor(user) : {},
    ...(user.role === 'admin' ? { adminLabel: adminRoleLabel(user), isMainAdmin: isMainAdmin(user) } : {})
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
    'Cache-Control': 'no-store, max-age=0',
    'Content-Length': Buffer.byteLength(body),
    ...securityHeaders(),
    ...extraHeaders
  });
  res.end(body);
}

function sendError(res, status, message, code) {
  return sendJson(res, status, { success: false, message, ...(code ? { code } : {}) });
}

async function readRequestBuffer(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function proxyRequestHeaders(req) {
  const headers = {};
  const blocked = new Set(['host', 'content-length', 'content-encoding', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'accept-encoding']);
  Object.entries(req.headers || {}).forEach(([key, value]) => {
    if (blocked.has(key.toLowerCase()) || value == null) return;
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
  });
  const forwardedFor = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').trim();
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  headers['x-forwarded-host'] = String(req.headers.host || '');
  headers['x-forwarded-proto'] = String(req.headers['x-forwarded-proto'] || (req.socket?.encrypted ? 'https' : 'http')).split(',')[0].trim();
  return headers;
}

async function proxyApiRequest(req, res, url) {
  if (!PRIMARY_API_URL) return sendError(res, 503, 'Primary Railway API configured nahi hai.', 'PRIMARY_API_NOT_CONFIGURED');
  let target;
  try {
    target = new URL(`${url.pathname}${url.search}`, `${PRIMARY_API_URL}/`);
  } catch {
    return sendError(res, 500, 'Primary API URL invalid hai.', 'PRIMARY_API_URL_INVALID');
  }
  const method = String(req.method || 'GET').toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method);
  const body = hasBody ? await readRequestBuffer(req) : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRIMARY_PROXY_TIMEOUT_MS);
  try {
    const upstream = await fetch(target, {
      method,
      headers: proxyRequestHeaders(req),
      body: hasBody && body?.length ? body : undefined,
      redirect: 'manual',
      signal: controller.signal
    });
    let responseBody = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await upstream.arrayBuffer());
    const headers = {};
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (['set-cookie', 'content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(lower)) return;
      headers[key] = value;
    });
    const setCookies = typeof upstream.headers.getSetCookie === 'function'
      ? upstream.headers.getSetCookie()
      : (upstream.headers.get('set-cookie') ? [upstream.headers.get('set-cookie')] : []);
    if (setCookies.length) headers['set-cookie'] = setCookies;
    // Make Render health visibly report that it is proxying Railway.
    if (url.pathname === '/api/health' && String(upstream.headers.get('content-type') || '').includes('application/json')) {
      try {
        const health = JSON.parse(responseBody.toString('utf8'));
        health.proxyToPrimary = true;
        health.primaryApiConfigured = true;
        health.proxyOrigin = 'render';
        responseBody = Buffer.from(JSON.stringify(health));
      } catch {
        // Preserve the upstream payload if a future health format changes.
      }
    }
    headers['Content-Length'] = String(responseBody.length);
    res.writeHead(upstream.status, headers);
    return res.end(responseBody);
  } catch (error) {
    const message = error?.name === 'AbortError'
      ? 'Primary Railway API timeout ho gaya. Dobara try karein.'
      : 'Primary Railway API abhi available nahi hai.';
    return sendError(res, 502, message, 'PRIMARY_API_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
  }
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

async function readFormOrJson(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw).entries());
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid request body'), { status: 400 });
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
      rateLog: Array.isArray(parsed.rateLog) ? parsed.rateLog : [],
      topupRequests: Array.isArray(parsed.topupRequests) ? parsed.topupRequests : [],
      notifications: Array.isArray(parsed.notifications) ? parsed.notifications : [],
      pushSubscriptions: Array.isArray(parsed.pushSubscriptions) ? parsed.pushSubscriptions : []
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    db = { users: [], transactions: [], ads: [], settings: {}, rateLog: [], topupRequests: [], notifications: [], pushSubscriptions: [] };
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

function normalizeLoginName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function findUserByLoginName(value) {
  const normalized = normalizeLoginName(value);
  if (!normalized || normalized.length < 2) return null;
  const aliases = (user) => [user.username, user.userName, user.login, user.name]
    .map(normalizeLoginName)
    .filter(Boolean);
  const exact = db.users.filter((user) => aliases(user).includes(normalized));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  // A unique first-name match keeps older name-based accounts usable without
  // accidentally choosing between two users with the same name.
  const firstNameMatches = db.users.filter((user) => {
    const firstName = normalizeLoginName(user.name).split(' ')[0];
    return firstName && firstName === normalized;
  });
  return firstNameMatches.length === 1 ? firstNameMatches[0] : null;
}

function findUserForLogin(identifier) {
  const raw = String(identifier ?? '').trim();
  if (!raw) return null;
  if (raw.includes('@')) return findUserByEmail(raw);
  const mobile = normalizeMobile(raw);
  if (validMobile(mobile)) return findUser(mobile);
  return findUserByLoginName(raw);
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
  if (user && ADMIN_MOBILE && user.mobile === ADMIN_MOBILE) {
    const changed = user.role !== 'admin' || JSON.stringify(user.adminPermissions || {}) !== JSON.stringify(FULL_ADMIN_PERMISSIONS);
    user.role = 'admin';
    user.adminPermissions = { ...FULL_ADMIN_PERMISSIONS };
    // The role/permission update is kept in memory for this request. The next
    // login or durable mutation persists it; avoiding a detached write here
    // prevents concurrent JSON temp-file renames during session restore.
  }
  return user;
}

function passwordHash(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 64).toString('hex');
}

function safeEqualText(left, right) {
  const actual = Buffer.from(String(left || ''));
  const expected = Buffer.from(String(right || ''));
  return actual.length === expected.length && actual.length > 0 && crypto.timingSafeEqual(actual, expected);
}

function scryptPasswordMatches(password, user) {
  const stored = String(user?.passwordHash || '');
  const salt = String(user?.salt || '');
  if (!/^[0-9a-f]{128}$/i.test(stored) || !salt) return false;
  return safeEqualText(passwordHash(password, salt), stored.toLowerCase());
}

// The original Apps Script used SHA-256(salt + '|' + password) in base64.
// Keep this verifier so legacy Users rows remain login-compatible, then upgrade
// the account to the current scrypt format after a successful login.
function legacyPasswordMatches(password, user) {
  const stored = String(user?.passwordHash || '');
  const salt = String(user?.salt || '');
  if (!stored || !salt) return false;
  const legacy = crypto.createHash('sha256').update(`${salt}|${String(password)}`, 'utf8').digest('base64');
  return safeEqualText(legacy, stored);
}

function passwordMatches(password, user) {
  return scryptPasswordMatches(password, user) || legacyPasswordMatches(password, user);
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

function nextShortId(prefix, list, field) {
  const values = (Array.isArray(list) ? list : []).map((item) => String(item?.[field] || '').toLowerCase());
  const matcher = new RegExp(`^${prefix}\\d+$`, 'i');
  const used = new Set(values.filter((value) => matcher.test(value)));
  let number = 1;
  while (used.has(`${prefix}${number}`.toLowerCase())) number += 1;
  return `${prefix}${number}`;
}

function ensureLocalShortIds() {
  let changed = false;
  const usedUsers = new Set();
  let nextUser = 1;
  (Array.isArray(db.users) ? db.users : []).forEach((user) => {
    let shortId = String(user.shortId || '').toLowerCase();
    if (!/^u\d+$/.test(shortId) || usedUsers.has(shortId)) {
      while (usedUsers.has(`u${nextUser}`)) nextUser += 1;
      shortId = `u${nextUser}`;
      nextUser += 1;
      changed = true;
    }
    usedUsers.add(shortId);
    if (user.shortId !== shortId) { user.shortId = shortId; changed = true; }
  });
  const usedTransactions = new Set();
  let nextTransaction = 1;
  (Array.isArray(db.transactions) ? db.transactions : []).forEach((transaction) => {
    let shortId = String(transaction.shortId || '').toUpperCase();
    if (!/^T\d+$/.test(shortId) || usedTransactions.has(shortId)) {
      while (usedTransactions.has(`T${nextTransaction}`)) nextTransaction += 1;
      shortId = `T${nextTransaction}`;
      nextTransaction += 1;
      changed = true;
    }
    usedTransactions.add(shortId);
    if (transaction.shortId !== shortId) { transaction.shortId = shortId; changed = true; }
  });
  return changed;
}

function sheetTransactionPayload(transaction) {
  return {
    ...transaction,
    id: transaction.shortId || transaction.id,
    transactionId: transaction.shortId || transaction.id,
    internalTransactionId: transaction.id
  };
}

function appendTransaction(mobile, type, amount, balanceAfter, vrn, note, adminMobile = '', extra = {}) {
  const transaction = {
    id: crypto.randomUUID(),
    shortId: nextShortId('T', db.transactions, 'shortId'),
    time: new Date().toISOString(),
    mobile,
    type,
    amount,
    balanceAfter,
    vrn: vrn || '',
    status: 'SUCCESS',
    note: note || '',
    adminMobile,
    ...extra
  };
  db.transactions.push(transaction);
  return transaction;
}

function userTransactions(mobile, limit = 30) {
  return db.transactions.filter((item) => item.mobile === mobile).slice(-limit).reverse();
}

function transactionMatchesCategory(transaction, category) {
  const normalized = String(category || 'all').toLowerCase();
  if (normalized === 'wallet') return isWalletBalanceTransaction(transaction);
  if (normalized === 'rc') return isRcDownloadTransaction(transaction);
  return true;
}

function paginatedTransactions(transactions, searchParams) {
  const category = ['wallet', 'rc', 'all'].includes(String(searchParams.get('category') || 'all').toLowerCase())
    ? String(searchParams.get('category') || 'all').toLowerCase()
    : 'all';
  // Transaction views intentionally use a fixed ten-row page to keep wallet and
  // admin histories fast even when the account has a large history.
  const limit = 10;
  const requestedPage = Number(searchParams.get('page') || 1);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.round(requestedPage)) : 1;
  const filtered = transactions.filter((transaction) => transactionMatchesCategory(transaction, category));
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages);
  const end = total - ((safePage - 1) * limit);
  const start = Math.max(0, end - limit);
  return {
    category,
    page: safePage,
    pages,
    total,
    limit,
    transactions: filtered.slice(start, end).reverse()
  };
}

function paginatedCollection(items, searchParams, pageKey = 'page', newestFirst = false) {
  const limit = 10;
  const requestedPage = Number(searchParams.get(pageKey) || 1);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.round(requestedPage)) : 1;
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages);
  const ordered = newestFirst ? items.slice().reverse() : items.slice();
  const start = (safePage - 1) * limit;
  return {
    page: safePage,
    pages,
    total,
    limit,
    items: ordered.slice(start, start + limit)
  };
}

function sheetUserPayload(user) {
  return {
    userId: user.shortId || user.id,
    shortUserId: user.shortId || '',
    internalUserId: user.id,
    username: user.username || user.name || '',
    name: user.name,
    email: user.email || '',
    mobile: user.mobile,
    passwordHash: user.passwordHash || '',
    salt: user.salt || '',
    role: user.role,
    adminPermissions: user.role === 'admin' ? adminPermissionsFor(user) : {},
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

function publicTopupRequest(request) {
  return {
    id: String(request.id || ''),
    clientReference: String(request.clientReference || ''),
    mobile: String(request.mobile || ''),
    name: String(request.name || ''),
    email: String(request.email || ''),
    amountRequested: Number(request.amountRequested || 0),
    amountApproved: request.amountApproved == null ? null : Number(request.amountApproved),
    status: String(request.status || 'PENDING'),
    createdAt: request.createdAt || '',
    updatedAt: request.updatedAt || request.createdAt || '',
    whatsappSentAt: request.whatsappSentAt || '',
    decidedAt: request.decidedAt || '',
    decidedBy: request.decidedBy || '',
    rejectReason: request.rejectReason || ''
  };
}

function publicNotification(notification) {
  return {
    id: String(notification.id || ''),
    type: String(notification.type || 'activity'),
    title: String(notification.title || 'InstantRCcard'),
    body: String(notification.body || ''),
    data: notification.data && typeof notification.data === 'object' ? notification.data : {},
    createdAt: notification.createdAt || '',
    read: notification.read === true
  };
}

async function persistNotificationsForUsers(users, event) {
  const candidates = Array.from(new Map((users || []).filter(Boolean).map((user) => [String(user.id), user])).values());
  if (!candidates.length) return;
  const work = (async () => {
    if (!Array.isArray(db.notifications)) db.notifications = [];
    const eventId = String(event?.data?.eventId || event?.eventId || '');
    const recipients = candidates.filter((user) => {
      if (!eventId) return true;
      return !db.notifications.some((notification) => String(notification.recipientUserId) === String(user.id)
        && String(notification.data?.eventId || '') === eventId);
    });
    if (!recipients.length) return;
    const now = new Date().toISOString();
    const created = recipients.map((user) => ({
      id: crypto.randomUUID(),
      recipientUserId: user.id,
      type: String(event.type || 'activity'),
      title: String(event.title || 'InstantRCcard activity').slice(0, 120),
      body: String(event.body || '').slice(0, 500),
      data: event.data && typeof event.data === 'object' ? event.data : {},
      createdAt: now,
      read: false
    }));
    // Persist the in-app notification before doing any Sheet/network work so
    // the next poll can show it immediately after the triggering mutation.
    db.notifications.push(...created);
    if (db.notifications.length > MAX_STORED_NOTIFICATIONS) db.notifications = db.notifications.slice(-MAX_STORED_NOTIFICATIONS);
    await persistDatabase();

    // Sheet mirroring is deliberately fire-and-forget. A slow Apps Script
    // request must not delay an in-app notification or push delivery.
    if (SHEET_WEBHOOK_URL && SHEET_SYNC_SECRET) {
      created.forEach((notification) => {
        void queueSheetSync('notification', notification).catch((error) => {
          const index = sheetSyncFailures.indexOf(error);
          if (index >= 0) sheetSyncFailures.splice(index, 1);
          console.warn('Notification Sheet sync pending:', error.message);
        });
      });
    }
    if (!webPushReady || !Array.isArray(db.pushSubscriptions)) return;
    const recipientIds = new Set(recipients.map((user) => String(user.id)));
    const subscriptions = db.pushSubscriptions.filter((item) => recipientIds.has(String(item.userId || '')));
    const pushPayload = {
      title: String(event.title || 'InstantRCcard activity'),
      body: String(event.body || ''),
      icon: '/instant-rccard-icon-192-v21.png',
      badge: '/instant-rccard-icon-192-v21.png',
      tag: String(event.type || 'instant-rccard'),
      data: { ...(event.data || {}), url: '/' }
    };
    subscriptions.forEach((item) => {
      void webpush.sendNotification(item.subscription, JSON.stringify(pushPayload)).catch((error) => {
        if (error && (error.statusCode === 404 || error.statusCode === 410)) {
          db.pushSubscriptions = db.pushSubscriptions.filter((saved) => saved.endpoint !== item.endpoint);
          void persistDatabase();
          void queueSheetSync('pushSubscriptionDelete', { endpoint: item.endpoint, userId: item.userId }).catch((syncError) => {
            clearTrackedSheetFailure(syncError);
          });
        } else {
          console.warn('Web Push delivery failed:', error.message);
        }
      });
    });
  })();
  return work.catch((error) => {
    console.warn('Notification persistence failed:', error.message);
  });
}

function queueNotificationsForUsers(users, event) {
  return withMutationLock(() => persistNotificationsForUsers(users, event));
}

function notifyUserActivity(user, event) {
  return user ? persistNotificationsForUsers([user], event) : Promise.resolve();
}

function notifyAdminsForActivity(permission, event) {
  const admins = db.users.filter((user) => user.role === 'admin' && hasAdminPermission(user, permission));
  return persistNotificationsForUsers(admins, event);
}

function sheetTopupRequestPayload(request) {
  const publicRequest = publicTopupRequest(request);
  const shortUserId = String(request.userShortId || request.shortUserId || '').trim() || (/^u\d+$/i.test(String(request.userId || '').trim()) ? String(request.userId).trim() : '');
  const internalUserId = String(request.internalUserId || '').trim() || (shortUserId ? '' : String(request.userId || '').trim());
  return {
    ...publicRequest,
    userId: shortUserId || internalUserId,
    shortUserId,
    internalUserId,
    amountRequested: publicRequest.amountRequested,
    amountApproved: publicRequest.amountApproved == null ? '' : publicRequest.amountApproved
  };
}

function queueSheetSync(action, payload) {
  if (!SHEET_WEBHOOK_URL || !SHEET_SYNC_SECRET) return Promise.resolve();
  const operation = sheetSyncQueue.then(async () => {
    try {
      return await syncToSheet(action, payload);
    } catch (error) {
      sheetSyncFailures.push(error);
      throw error;
    }
  });
  // Keep the global queue usable for later writes while returning the original
  // rejecting operation to callers that need to fail safely.
  sheetSyncQueue = operation.catch((error) => {
    console.warn('Google Sheet sync failed:', error.message);
    return null;
  });
  return operation;
}

// Legacy/administrative mutations may await this before responding. Wallet
// mutations deliberately use queueSheetSyncInBackground so a slow Sheet cannot
// delay the user-visible balance, history, or notification response.
async function flushSheetSync() {
  await sheetSyncQueue;
  if (sheetSyncFailures.length) {
    const errors = sheetSyncFailures.splice(0);
    throw new Error(errors.map((error) => error.message).join('; '));
  }
}

// Wallet mutations respond as soon as local JSON and in-app notifications are
// durable. Google Sheet mirroring continues in the background so a slow Apps
// Script request cannot make the user wait for a balance or history update.
function queueSheetSyncInBackground(action, payload, label = 'Background', attempt = 1) {
  const operation = queueSheetSync(action, payload);
  void operation.catch((error) => {
    clearTrackedSheetFailure(error);
    if (attempt < 4) {
      const delay = Math.min(10_000, attempt * 2_000);
      console.warn(`${label} Sheet sync retry ${attempt} pending:`, error.message);
      setTimeout(() => queueSheetSyncInBackground(action, payload, label, attempt + 1), delay).unref?.();
    } else {
      console.warn(`${label} Sheet sync pending after retries:`, error.message);
    }
  });
  return operation;
}

function trackTopupSheetSync(request, operation) {
  return operation
    .then(() => {
      // Do not wait on the mutation lock here: the caller may itself be
      // holding that lock while awaiting the Sheet response.
      void withMutationLock(async () => {
        const current = Array.isArray(db.topupRequests) ? db.topupRequests.find((item) => String(item.id) === String(request.id)) : null;
        if (current) {
          current.sheetSyncPending = false;
          await persistDatabase();
        }
      });
      return { ok: true };
    })
    .catch((error) => {
      const index = sheetSyncFailures.indexOf(error);
      if (index >= 0) sheetSyncFailures.splice(index, 1);
      console.warn('Topup Sheet sync pending retry:', error.message);
      return { ok: false, error };
    });
}

async function waitForTopupSheetSync(trackedOperation, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timedOut: true }), timeoutMs);
  });
  const result = await Promise.race([trackedOperation, timeout]);
  clearTimeout(timer);
  return result;
}

function clearTrackedSheetFailure(error) {
  const index = sheetSyncFailures.indexOf(error);
  if (index >= 0) sheetSyncFailures.splice(index, 1);
}

async function runSheetSyncOperations(operations, timeoutMs = 3_500) {
  const work = Promise.all((operations || []).map((operation) => operation
    .then(() => true)
    .catch((error) => {
      clearTrackedSheetFailure(error);
      console.warn('Sheet sync pending retry:', error.message);
      return false;
    }))).then((results) => results.every(Boolean));
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const result = await Promise.race([work, timeout]);
  clearTimeout(timer);
  return result;
}

async function retryPurchaseSheetSync(userMobile, transactionId, attempts = 5) {
  if (!SHEET_WEBHOOK_URL || !SHEET_SYNC_SECRET) return;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const user = findUser(userMobile);
    const transaction = Array.isArray(db.transactions) ? db.transactions.find((item) => String(item.id) === String(transactionId)) : null;
    if (!user || !transaction) return;
    transaction.sheetSyncPending = true;
    try {
      await persistDatabase();
      const synced = await runSheetSyncOperations([
        queueSheetSync('user', sheetUserPayload(user)),
        queueSheetSync('transaction', sheetTransactionPayload(transaction))
      ], SHEET_SYNC_TIMEOUT_MS);
      if (synced) {
        await withMutationLock(async () => {
          const current = db.transactions.find((item) => String(item.id) === String(transactionId));
          if (current) {
            current.sheetSyncPending = false;
            await persistDatabase();
          }
        });
        return;
      }
    } catch (error) {
      console.warn(`RC transaction Sheet retry ${attempt} failed:`, error.message);
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, attempt * 2_000)));
  }
}

function retryPendingPurchaseSheetSyncs() {
  if (!SHEET_WEBHOOK_URL || !SHEET_SYNC_SECRET || !Array.isArray(db.transactions)) return;
  db.transactions
    .filter((transaction) => transaction.type === 'RC_PURCHASE' && transaction.sheetSyncPending === true)
    .forEach((transaction) => { void retryPurchaseSheetSync(transaction.mobile, transaction.id, 5); });
}

async function syncToSheet(action, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHEET_SYNC_TIMEOUT_MS);
  try {
    const response = await fetch(SHEET_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ secret: SHEET_SYNC_SECRET, action, payload }),
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`Google Sheet sync HTTP ${response.status}`);
    let result;
    try { result = JSON.parse(raw); } catch { throw new Error('Google Sheet sync returned an invalid response'); }
    if (result?.success === false) throw new Error(result.message || 'Google Sheet sync rejected the update');
    return result;
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

async function fetchProviderFromApi(vrn) {
  if (!RC_API_TOKEN) return { success: false, message: 'RC_API_TOKEN server environment me configured nahi hai.' };
  let lastFailure = { success: false, message: 'RC provider se response nahi mila.' };
  for (let attempt = 1; attempt <= PROVIDER_RETRY_COUNT; attempt += 1) {
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
      try { payload = JSON.parse(raw); } catch {
        lastFailure = { success: false, message: 'RC provider ne invalid response diya.' };
        if (attempt === PROVIDER_RETRY_COUNT) return lastFailure;
        continue;
      }
      const providerMessage = payload?.message || payload?.error || 'RC image nahi mili. Vehicle number check karo.';
      const retryableStatus = response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500;
      const retryableMessage = /timeout|temporar|try again|busy|unavailable|server|connection/i.test(String(providerMessage));
      if (!response.ok) {
        lastFailure = { success: false, message: providerMessage };
        if (!retryableStatus || attempt === PROVIDER_RETRY_COUNT) return lastFailure;
        continue;
      }
      if (payload?.success === false) {
        lastFailure = { success: false, message: providerMessage };
        if (!retryableMessage || attempt === PROVIDER_RETRY_COUNT) return lastFailure;
        continue;
      }
      const images = providerImages(payload);
      if (!images) {
        lastFailure = { success: false, message: 'Front aur back RC image available nahi hai.' };
        if (attempt === PROVIDER_RETRY_COUNT) return lastFailure;
        continue;
      }
      // Front aur back ko parallel normalize karne se provider URL responses faster complete hote hain.
      const [front, back] = await Promise.all([
        normalizeProviderImage(images.front),
        normalizeProviderImage(images.back)
      ]);
      if (front && back) return { success: true, images: { front, back } };
      lastFailure = { success: false, message: 'Front aur back RC image download nahi ho paayi.' };
    } catch (error) {
      lastFailure = { success: false, message: error.name === 'AbortError' ? 'RC provider timeout ho gaya. Thodi der baad dobara try karein.' : 'RC provider se connection nahi ho paaya.' };
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < PROVIDER_RETRY_COUNT) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
  }
  return lastFailure;
}

function cachedProviderImages(vrn) {
  const entry = providerCache.get(vrn);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    providerCache.delete(vrn);
    return null;
  }
  // Refresh recency so frequently used vehicle numbers stay hot in the small cache.
  providerCache.delete(vrn);
  providerCache.set(vrn, entry);
  return entry.images;
}

function rememberProviderImages(vrn, images) {
  providerCache.delete(vrn);
  providerCache.set(vrn, { images, expiresAt: Date.now() + RC_CACHE_TTL_MS });
  while (providerCache.size > RC_CACHE_MAX_ENTRIES) providerCache.delete(providerCache.keys().next().value);
}

async function fetchProvider(vrn) {
  const cached = cachedProviderImages(vrn);
  if (cached) return { success: true, images: cached, cached: true };
  const existing = providerInflight.get(vrn);
  if (existing) return existing;

  const pending = fetchProviderFromApi(vrn)
    .then((result) => {
      if (result.success && result.images) rememberProviderImages(vrn, result.images);
      return result;
    })
    .finally(() => providerInflight.delete(vrn));
  providerInflight.set(vrn, pending);
  return pending;
}

async function restoreFromSheet() {
  if (!SHEET_WEBHOOK_URL || !SHEET_SYNC_SECRET) {
    restoreState = { ...restoreState, status: 'not-configured', error: 'SHEET_WEBHOOK_URL or SHEET_SYNC_SECRET missing', users: db.users.length, transactions: db.transactions.length, rcDownloads: db.transactions.filter(isRcDownloadTransaction).length };
    return;
  }
  restoreState = { ...restoreState, status: 'loading', error: '' };
  try {
    const snapshotUrl = new URL(SHEET_WEBHOOK_URL);
    snapshotUrl.searchParams.set('action', 'snapshot');
    snapshotUrl.searchParams.set('secret', SHEET_SYNC_SECRET);
    const controller = new AbortController();
    // Apps Script can cold-start and run the one-time legacy migration before
    // returning the snapshot. Give it enough time so a valid restore is not
    // mistaken for an empty database during a Railway/Render restart.
    const timeout = setTimeout(() => controller.abort(), 60_000);
    const response = await fetch(snapshotUrl, { headers: { Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const snapshot = await response.json();
    if (!snapshot.success) throw new Error(snapshot.message || 'Snapshot unavailable');

    const accounts = Array.isArray(snapshot.accounts) ? snapshot.accounts : [];
    const transactions = Array.isArray(snapshot.transactions) ? snapshot.transactions : [];
    const ads = Array.isArray(snapshot.ads) ? snapshot.ads : [];
    const topupRequests = Array.isArray(snapshot.topupRequests) ? snapshot.topupRequests : [];
    const sheetNotifications = Array.isArray(snapshot.notifications) ? snapshot.notifications.slice(-MAX_STORED_NOTIFICATIONS) : [];
    const sheetPushSubscriptions = Array.isArray(snapshot.pushSubscriptions) ? snapshot.pushSubscriptions : [];
    const sheetRateLog = Array.isArray(snapshot.rateLog) ? snapshot.rateLog.slice(-300) : [];
    const localRateLog = Array.isArray(db.rateLog) ? db.rateLog : [];
    const rateLogById = new Map();
    [...localRateLog, ...sheetRateLog].forEach((entry) => {
      const fallbackId = `${entry.mobile || ''}|${entry.time || ''}|${entry.from ?? ''}|${entry.to ?? ''}`;
      const id = String(entry.id || fallbackId);
      const previous = rateLogById.get(id);
      if (!previous || String(entry.time || '') >= String(previous.time || '')) rateLogById.set(id, entry);
    });
    const durableRateLog = Array.from(rateLogById.values())
      .sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')))
      .slice(-300);
    const latestDurableRateByMobile = new Map();
    durableRateLog.forEach((entry) => {
      const mobile = normalizeMobile(entry.mobile);
      if (!validMobile(mobile)) return;
      const rawTo = entry.to;
      const numericTo = rawTo === null || rawTo === '' || rawTo === undefined ? null : Number(rawTo);
      if (numericTo !== null && (!Number.isFinite(numericTo) || numericTo < 1)) return;
      const previous = latestDurableRateByMobile.get(mobile);
      const time = String(entry.time || '');
      if (!previous || time >= previous.time) {
        latestDurableRateByMobile.set(mobile, {
          time,
          to: numericTo == null ? null : Math.round(numericTo),
          adminMobile: String(entry.adminMobile || '')
        });
      }
    });

    // Google Sheet is the durable source when it contains account records.
    // Keep a local database if the sheet is empty/unavailable during first setup.
    if (accounts.length || !db.users.length) {
      const localUsers = db.users.slice();
      const localUsersByKey = new Map(localUsers.map((user) => [String(user.id || user.mobile), user]));
      const sheetMobiles = new Set(accounts.map((account) => normalizeMobile(account.mobile)).filter(Boolean));
      const sheetIds = new Set(accounts.map((account) => String(account.userId || account.id || '')).filter(Boolean));
      const localOnlyUsers = localUsers.filter((user) => {
        const id = String(user.id || user.mobile || '');
        return !sheetIds.has(id) && !sheetMobiles.has(normalizeMobile(user.mobile));
      });
      db.users = accounts.map((account) => {
        const shortAccountId = String(account.userId || account.shortUserId || '').trim().toLowerCase();
        const internalAccountId = String(account.internalUserId || account.legacyUserId || '').trim();
        const accountKey = internalAccountId || shortAccountId || String(account.id || account.mobile || '');
        const mobile = normalizeMobile(account.mobile);
        const localUser = localUsersByKey.get(accountKey) || db.users.find((user) => user.mobile === mobile);
        const customPrice = Number(account.rcCardPrice);
        const hasSheetRate = Number.isFinite(customPrice) && customPrice >= 1;
        const rateUpdatedAt = String(account.rcRateUpdatedAt || '');
        const durableRateLog = latestDurableRateByMobile.get(mobile);
        const logIsNewer = Boolean(durableRateLog && (!rateUpdatedAt || durableRateLog.time >= rateUpdatedAt));
        // The rate log is the recovery ledger for accounts created before the
        // custom-rate columns existed or rows whose rate field was accidentally blank.
        // A latest log entry with null `to` is an intentional clear action.
        const loggedRate = logIsNewer && durableRateLog && durableRateLog.to != null ? durableRateLog.to : null;
        const loggedClear = logIsNewer && durableRateLog && durableRateLog.to == null;
        const localRate = localUser ? customRcCardPrice(localUser) : null;
        const localRateUpdatedAt = String(localUser?.rcRateUpdatedAt || '');
        const localRateIsNewer = localRate != null && (!rateUpdatedAt || localRateUpdatedAt >= rateUpdatedAt);
        const preservedLocalRate = !hasSheetRate && !loggedRate && !loggedClear && localRateIsNewer
          ? localRate
          : null;
        const effectiveRate = loggedRate != null
          ? loggedRate
          : loggedClear
            ? null
            : hasSheetRate
              ? Math.round(customPrice)
              : preservedLocalRate;
        const effectiveRateUpdatedAt = logIsNewer && durableRateLog
          ? durableRateLog.time
          : rateUpdatedAt || (preservedLocalRate != null && localUser ? localUser.rcRateUpdatedAt || '' : '');
        const effectiveRateUpdatedBy = logIsNewer && durableRateLog
          ? durableRateLog.adminMobile
          : account.rcRateUpdatedBy || (preservedLocalRate != null && localUser ? localUser.rcRateUpdatedBy || '' : '');
        return {
          id: accountKey || `sheet-${account.mobile}`,
          shortId: /^u\d+$/.test(shortAccountId) ? shortAccountId : '',
          username: String(account.username || account.name || localUser?.username || localUser?.name || ''),
          name: String(account.name || localUser?.name || ''),
          email: normalizeEmail(account.email || localUser?.email || ''),
          mobile,
          salt: String(account.salt || localUser?.salt || ''),
          passwordHash: String(account.passwordHash || localUser?.passwordHash || ''),
          wallet: Number(account.wallet || 0),
          rcCardPrice: effectiveRate,
          rcRateUpdatedAt: effectiveRateUpdatedAt,
          rcRateUpdatedBy: effectiveRateUpdatedBy,
          role: account.role === 'admin' ? 'admin' : 'user',
          adminPermissions: account.role === 'admin' ? normalizedAdminPermissions(account.adminPermissions, account.adminPermissions == null) : {},
          createdAt: account.createdAt || new Date().toISOString(),
          lastLogin: account.lastLogin || account.createdAt || new Date().toISOString(),
          active: account.active !== false && String(account.active).toLowerCase() !== 'false'
        };
      });
      // Never discard a local account that the Sheet has not seen yet. User
      // deletion is not supported, so merging this safe local-only set avoids
      // losing a just-created account during a partial first restore.
      db.users.push(...localOnlyUsers);
      localOnlyUsers.forEach((user) => queueSheetSync('user', sheetUserPayload(user)));
      // Repair an old/missing Sheet rate column asynchronously once the local
      // custom value or rate-ledger value has been recovered.
      db.users.forEach((user) => {
        if (customRcCardPrice(user) != null) queueSheetSync('user', sheetUserPayload(user));
      });
    }
    if (transactions.length || !db.transactions.length) {
      const durableTransactions = transactions.map((transaction) => ({
        ...transaction,
        id: String(transaction.internalTransactionId || transaction.internalId || transaction.id || crypto.randomUUID()),
        shortId: String(transaction.shortId || transaction.transactionId || transaction.id || '').match(/^T\d+$/i)?.[0]?.toUpperCase() || ''
      }));
      const localTransactions = db.transactions.slice();
      const durableIds = new Set(durableTransactions.map((transaction) => String(transaction.id || '')).filter(Boolean));
      db.transactions = durableTransactions.concat(localTransactions.filter((transaction) => !durableIds.has(String(transaction.id || ''))));
    }
    if (topupRequests.length || !db.topupRequests.length) {
      const localRequests = db.topupRequests.slice();
      const durableIds = new Set(topupRequests.map((request) => String(request.id || '')).filter(Boolean));
      db.topupRequests = topupRequests.concat(localRequests.filter((request) => !durableIds.has(String(request.id || ''))));
    }
    if (sheetNotifications.length || !db.notifications.length) {
      const localNotifications = Array.isArray(db.notifications) ? db.notifications.slice() : [];
      const durableIds = new Set(sheetNotifications.map((item) => String(item.id || '')).filter(Boolean));
      db.notifications = sheetNotifications.concat(localNotifications.filter((item) => !durableIds.has(String(item.id || '')))).slice(-MAX_STORED_NOTIFICATIONS);
    }
    if (sheetPushSubscriptions.length || !db.pushSubscriptions.length) {
      const localSubscriptions = Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions.slice() : [];
      const durableEndpoints = new Set(sheetPushSubscriptions.map((item) => String(item.endpoint || '')).filter(Boolean));
      db.pushSubscriptions = sheetPushSubscriptions.concat(localSubscriptions.filter((item) => !durableEndpoints.has(String(item.endpoint || ''))));
    }
    if (snapshot.settings && typeof snapshot.settings === 'object') db.settings = { ...db.settings, ...snapshot.settings };
    if (durableRateLog.length || !db.rateLog.length) db.rateLog = durableRateLog;
    if (ads.length || !db.ads.length) db.ads = ads.map((ad) => ({
      id: String(ad.id || crypto.randomUUID()),
      title: String(ad.title || ''),
      imageData: String(ad.imageData || ''),
      active: ad.active !== false && String(ad.active).toLowerCase() !== 'false',
      createdAt: ad.createdAt || new Date().toISOString(),
      updatedAt: ad.updatedAt || ad.createdAt || new Date().toISOString()
    }));
    await persistDatabase();
    restoreState = {
      status: 'success',
      users: db.users.length,
      transactions: db.transactions.length,
      rcDownloads: db.transactions.filter(isRcDownloadTransaction).length,
      sheetAccounts: accounts.length,
      sheetTransactions: transactions.length,
      completedAt: new Date().toISOString(),
      error: ''
    };
    console.log(`Restored ${db.users.length} account(s), ${db.transactions.length} transaction(s), ${db.ads.length} ad(s) from Google Sheet.`);
  } catch (error) {
    const restoreError = String(error && error.message || 'Unknown restore error').replace(/([?&]secret=)[^&]*/gi, '$1REDACTED').slice(0, 180);
    restoreState = { ...restoreState, status: 'failed', error: restoreError, users: db.users.length, transactions: db.transactions.length, rcDownloads: db.transactions.filter(isRcDownloadTransaction).length };
    console.warn('Google Sheet restore skipped:', restoreError);
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
    const isOwner = Boolean(ADMIN_MOBILE && mobile === ADMIN_MOBILE);
    const user = { id: crypto.randomUUID(), shortId: nextShortId('u', db.users, 'shortId'), username: name, name, email, mobile, salt, passwordHash: passwordHash(password, salt), wallet: 0, rcCardPrice: null, role: isOwner ? 'admin' : 'user', adminPermissions: isOwner ? { ...FULL_ADMIN_PERMISSIONS } : {}, createdAt: new Date().toISOString(), lastLogin: new Date().toISOString(), active: true };
    db.users.push(user);
    await persistDatabase();
      await notifyAdminsForActivity('kpi', {
      type: 'new-user',
      title: 'New user signup',
      body: `${user.name} (+91 ${user.mobile}) ne account create kiya.`,
      data: { mobile: user.mobile, userId: user.id, eventId: `new-user:${user.id}` }
    });
    if (CROSS_DEPLOY_PRIMARY_URL && CROSS_DEPLOY_SYNC_SECRET) void retryUserToPrimary(user);
    queueSheetSync('user', sheetUserPayload(user));
    await flushSheetSync();
    return sendJson(res, 200, { success: true, user: publicUser(user) }, { 'Set-Cookie': authCookie(user.id) });
  });
}

async function handleLogin(req, res) {
  const body = await readJson(req);
  const identifier = String(body.identifier || body.username || body.login || '').trim();
  const legacyEmail = normalizeEmail(body.email);
  const legacyMobile = normalizeMobile(body.mobile);
  const password = String(body.password || '');
  if (!password || (!identifier && !validEmail(legacyEmail) && !validMobile(legacyMobile))) {
    return sendError(res, 422, 'Username, email ya 10-digit mobile number, aur password enter karo.');
  }

  let user = null;
  if (identifier) {
    user = findUserForLogin(identifier);
  } else if (validMobile(legacyMobile)) {
    user = findUser(legacyMobile);
    if (user && validEmail(legacyEmail) && normalizeEmail(user.email) !== legacyEmail) user = null;
  } else if (validEmail(legacyEmail)) {
    user = findUserByEmail(legacyEmail);
  }

  user = syncAdminRole(user);
  const legacyPassword = Boolean(user && !scryptPasswordMatches(password, user) && legacyPasswordMatches(password, user));
  if (!user || !user.active || !passwordMatches(password, user)) {
    return sendError(res, 401, 'Username/email/mobile number ya password galat hai.');
  }
  if (legacyPassword) {
    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.passwordHash = passwordHash(password, salt);
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
    await flushSheetSync();
    return sendJson(res, 200, { success: true, message: 'Password reset successful. Ab naye password se login karo.' });
  });
}

function validPushSubscription(value) {
  return Boolean(value && typeof value.endpoint === 'string' && value.endpoint.length >= 20 && value.endpoint.length <= 2000 && value.keys && typeof value.keys.p256dh === 'string' && typeof value.keys.auth === 'string');
}

async function forwardUserToPrimary(user) {
  if (!CROSS_DEPLOY_PRIMARY_URL || !CROSS_DEPLOY_SYNC_SECRET || !user) return;
  const target = new URL('/api/internal/replicate', CROSS_DEPLOY_PRIMARY_URL).toString();
  const eventId = `new-user:${user.id}`;
  const notification = {
    type: 'new-user',
    title: 'New user signup',
    body: `${user.name || 'User'} (+91 ${user.mobile}) ne account create kiya.`,
    data: { mobile: user.mobile, userId: user.id, eventId }
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Cross-Deploy-Secret': CROSS_DEPLOY_SYNC_SECRET },
      body: JSON.stringify({ eventId, eventType: 'user', user: sheetUserPayload(user), notification }),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) throw new Error(result.message || `Primary user sync HTTP ${response.status}`);
  } finally {
    clearTimeout(timer);
  }
}

async function retryUserToPrimary(user, attempts = 3) {
  if (!CROSS_DEPLOY_PRIMARY_URL || !CROSS_DEPLOY_SYNC_SECRET || !user) return;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await forwardUserToPrimary(user);
      return;
    } catch (error) {
      console.warn(`Primary user sync attempt ${attempt} failed:`, error.message);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
}

async function forwardTopupRequestToPrimary(request) {
  if (!CROSS_DEPLOY_PRIMARY_URL || !CROSS_DEPLOY_SYNC_SECRET || !request) return;
  const target = new URL('/api/internal/replicate', CROSS_DEPLOY_PRIMARY_URL).toString();
  const eventId = `topup-request:${request.id}`;
  const notification = {
    type: 'topup-request',
    title: 'New wallet top-up request',
    body: `${request.name || 'User'} (+91 ${request.mobile}) ne ₹${request.amountRequested} top-up request bheji hai.`,
    data: { mobile: request.mobile, amount: request.amountRequested, requestId: request.id, eventId }
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Cross-Deploy-Secret': CROSS_DEPLOY_SYNC_SECRET },
      body: JSON.stringify({
        eventId,
        eventType: 'topup-request',
        request: { ...sheetTopupRequestPayload(request), amountApproved: request.amountApproved == null ? null : Number(request.amountApproved) },
        notification
      }),
      signal: controller.signal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) throw new Error(result.message || `Primary sync HTTP ${response.status}`);
    await withMutationLock(async () => {
      const current = Array.isArray(db.topupRequests) ? db.topupRequests.find((item) => String(item.id) === String(request.id)) : null;
      if (current) {
        current.crossDeploySyncPending = false;
        current.crossDeploySyncedAt = new Date().toISOString();
        await persistDatabase();
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function retryTopupRequestToPrimary(request, attempts = 3) {
  if (!CROSS_DEPLOY_PRIMARY_URL || !CROSS_DEPLOY_SYNC_SECRET || !request) return;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await forwardTopupRequestToPrimary(request);
      return;
    } catch (error) {
      console.warn(`Primary topup sync attempt ${attempt} failed:`, error.message);
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1_500));
    }
  }
}

function retryPendingCrossDeployTopups() {
  if (!CROSS_DEPLOY_PRIMARY_URL || !CROSS_DEPLOY_SYNC_SECRET || !Array.isArray(db.topupRequests)) return;
  db.topupRequests
    .filter((request) => String(request.status || 'PENDING').toUpperCase() === 'PENDING' && request.crossDeploySyncPending !== false)
    .forEach((request) => { void retryTopupRequestToPrimary(request, 5); });
}

async function handleCrossDeployReplication(req, res) {
  if (!CROSS_DEPLOY_SYNC_SECRET || String(req.headers['x-cross-deploy-secret'] || '') !== CROSS_DEPLOY_SYNC_SECRET) {
    return sendError(res, 401, 'Cross-deployment sync unauthorized.');
  }
  const body = await readJson(req);
  if (body.eventType === 'user') {
    const incoming = body.user;
    if (!incoming || !incoming.mobile) return sendError(res, 422, 'User replication event invalid hai.');
    return withMutationLock(async () => {
      const mobile = normalizeMobile(incoming.mobile);
      let user = findUser(mobile);
      const existing = Boolean(user);
      let permissions = incoming.adminPermissions || {};
      if (typeof permissions === 'string') {
        try { permissions = JSON.parse(permissions); } catch (error) { permissions = {}; }
      }
      if (!user) {
        user = {
          id: String(incoming.internalUserId || incoming.userId || crypto.randomUUID()),
          shortId: /^u\d+$/i.test(String(incoming.shortUserId || incoming.userId || '')) ? String(incoming.shortUserId || incoming.userId).toLowerCase() : '',
          username: String(incoming.username || incoming.name || ''),
          name: String(incoming.name || ''),
          email: normalizeEmail(incoming.email || ''),
          mobile,
          salt: String(incoming.salt || ''),
          passwordHash: String(incoming.passwordHash || ''),
          wallet: Number(incoming.wallet || 0),
          rcCardPrice: incoming.rcCardPrice === '' || incoming.rcCardPrice == null ? null : Number(incoming.rcCardPrice),
          rcRateUpdatedAt: String(incoming.rcRateUpdatedAt || ''),
          rcRateUpdatedBy: String(incoming.rcRateUpdatedBy || ''),
          role: incoming.role === 'admin' ? 'admin' : 'user',
          adminPermissions: incoming.role === 'admin' ? normalizedAdminPermissions(permissions, permissions == null) : {},
          createdAt: incoming.createdAt || new Date().toISOString(),
          lastLogin: incoming.lastLogin || incoming.createdAt || new Date().toISOString(),
          active: incoming.active !== false
        };
        db.users.push(user);
      }
      await persistDatabase();
      const event = body.notification && typeof body.notification === 'object'
        ? body.notification
        : { type: 'new-user', title: 'New user signup', body: `${user.name} (+91 ${user.mobile}) ne account create kiya.`, data: { mobile: user.mobile, userId: user.id, eventId: String(body.eventId || `new-user:${user.id}`) } };
      await notifyAdminsForActivity('kpi', event);
      return sendJson(res, 200, { success: true, replicated: true, existing, user: publicUser(user) });
    });
  }
  if (body.eventType !== 'topup-request' || !body.request || !body.request.id) return sendError(res, 422, 'Replication event invalid hai.');
  const incoming = body.request;
  const requestId = String(incoming.id);
  return withMutationLock(async () => {
    if (!Array.isArray(db.topupRequests)) db.topupRequests = [];
    const existing = db.topupRequests.find((request) => String(request.id) === requestId);
    let record = existing;
    if (!record) {
      record = {
        ...incoming,
        userId: String(incoming.internalUserId || incoming.userId || ''),
        userShortId: String(incoming.shortUserId || ''),
        sheetSyncPending: false,
        crossDeploySyncPending: false
      };
      db.topupRequests.push(record);
    } else if (String(incoming.updatedAt || '') >= String(existing.updatedAt || '')) {
      Object.assign(existing, incoming);
      record = existing;
    }
    await persistDatabase();
    const event = body.notification && typeof body.notification === 'object'
      ? body.notification
      : {
          type: 'topup-request',
          title: 'New wallet top-up request',
          body: `${incoming.name || 'User'} (+91 ${incoming.mobile}) ne ₹${incoming.amountRequested} top-up request bheji hai.`,
          data: { mobile: incoming.mobile, amount: incoming.amountRequested, requestId, eventId: String(body.eventId || `topup-request:${requestId}`) }
        };
    if (String(record.status || 'PENDING').toUpperCase() === 'PENDING') await notifyAdminsForActivity('recharge', event);
    return sendJson(res, 200, { success: true, replicated: true, existing: Boolean(existing), request: publicTopupRequest(record) });
  });
}

async function handleNotificationPublicKey(req, res) {
  return sendJson(res, 200, { success: true, enabled: webPushReady, publicKey: webPushReady ? WEB_PUSH_VAPID_PUBLIC_KEY : '' });
}

async function handleNotificationList(req, res) {
  const user = currentUser(req);
  if (!user || !user.active) return sendError(res, 401, 'Session expire ho gaya.');
  const notifications = (Array.isArray(db.notifications) ? db.notifications : [])
    .filter((item) => String(item.recipientUserId) === String(user.id))
    .slice(-100)
    .reverse()
    .map(publicNotification);
  return sendJson(res, 200, { success: true, enabled: webPushReady, notifications, unread: notifications.filter((item) => !item.read).length });
}

async function handleNotificationSubscribe(req, res) {
  const user = currentUser(req);
  if (!user || !user.active) return sendError(res, 401, 'Session expire ho gaya.');
  const body = await readJson(req);
  const subscription = body.subscription || body;
  if (!validPushSubscription(subscription)) return sendError(res, 422, 'Notification subscription valid nahi hai.');
  return withMutationLock(async () => {
    if (!Array.isArray(db.pushSubscriptions)) db.pushSubscriptions = [];
    const endpoint = String(subscription.endpoint);
    const record = {
      userId: user.id,
      mobile: user.mobile,
      endpoint,
      subscription: {
        endpoint,
        expirationTime: subscription.expirationTime || null,
        keys: { p256dh: String(subscription.keys.p256dh), auth: String(subscription.keys.auth) }
      },
      updatedAt: new Date().toISOString()
    };
    const index = db.pushSubscriptions.findIndex((item) => item.endpoint === endpoint);
    if (index >= 0) db.pushSubscriptions[index] = record;
    else db.pushSubscriptions.push(record);
    await persistDatabase();
    try {
      await queueSheetSync('pushSubscription', record);
      await flushSheetSync();
    } catch (error) {
      const index = sheetSyncFailures.indexOf(error);
      if (index >= 0) sheetSyncFailures.splice(index, 1);
      console.warn('Push subscription Sheet sync pending:', error.message);
    }
    return sendJson(res, 200, { success: true, enabled: webPushReady, message: webPushReady ? 'Notifications on ho gaye.' : 'In-app notifications on hain; Web Push keys abhi configure nahi hain.' });
  });
}

async function handleNotificationUnsubscribe(req, res) {
  const user = currentUser(req);
  if (!user || !user.active) return sendError(res, 401, 'Session expire ho gaya.');
  const body = await readJson(req);
  const endpoint = String(body.endpoint || body.subscription?.endpoint || '');
  return withMutationLock(async () => {
    if (Array.isArray(db.pushSubscriptions) && endpoint) {
      db.pushSubscriptions = db.pushSubscriptions.filter((item) => !(item.endpoint === endpoint && String(item.userId) === String(user.id)));
      await persistDatabase();
      try {
        await queueSheetSync('pushSubscriptionDelete', { endpoint, userId: user.id });
        await flushSheetSync();
      } catch (error) {
        const index = sheetSyncFailures.indexOf(error);
        if (index >= 0) sheetSyncFailures.splice(index, 1);
        console.warn('Push unsubscribe Sheet sync pending:', error.message);
      }
    }
    return sendJson(res, 200, { success: true });
  });
}

async function handleNotificationRead(req, res) {
  const user = currentUser(req);
  if (!user || !user.active) return sendError(res, 401, 'Session expire ho gaya.');
  const body = await readJson(req);
  const ids = Array.isArray(body.ids) ? new Set(body.ids.map(String)) : null;
  return withMutationLock(async () => {
    const changed = [];
    (Array.isArray(db.notifications) ? db.notifications : []).forEach((item) => {
      if (String(item.recipientUserId) !== String(user.id)) return;
      if ((!ids || ids.has(String(item.id))) && item.read !== true) { item.read = true; changed.push(item); }
    });
    await persistDatabase();
    const syncs = changed.map((item) => queueSheetSync('notification', item).catch((error) => {
      const index = sheetSyncFailures.indexOf(error);
      if (index >= 0) sheetSyncFailures.splice(index, 1);
      console.warn('Notification read Sheet sync pending:', error.message);
    }));
    try { await Promise.all(syncs); await flushSheetSync(); } catch (error) { console.warn('Notification read Sheet sync pending:', error.message); }
    return sendJson(res, 200, { success: true });
  });
}

async function handlePurchase(req, res) {
  const user = currentUser(req);
  if (!user || !user.active) return sendError(res, 401, 'Session expire ho gaya. Dobara login karo.');
  const body = await readJson(req);
  const vrn = normalizeVrn(body.vrn);
  const downloadType = body.downloadType === 'rc-card' ? 'rc-card' : 'mparivahan';
  const idempotencyKey = String(body.idempotencyKey || '').trim().slice(0, 120);
  if (!validVrn(vrn)) return sendError(res, 422, 'Valid vehicle number daalo, jaise RJ14AB1234.');

  return withMutationLock(async () => {
    const fresh = syncAdminRole(findUser(user.mobile));
    if (!fresh) return sendError(res, 401, 'User account nahi mila.');
    const price = priceForDownload(downloadType, fresh);
    if (downloadType === 'mparivahan') {
      return sendJson(res, 200, { success: false, code: 'COMING_SOON', message: 'MParivahan RC format Coming Soon!', downloadType, requiredPrice: price });
    }

    // If the browser lost the previous response, replay the same successful
    // purchase instead of charging the wallet a second time.
    const previous = idempotencyKey
      ? db.transactions.find((transaction) => transaction.mobile === fresh.mobile
        && transaction.type === 'RC_PURCHASE'
        && transaction.idempotencyKey === idempotencyKey
        && transaction.vrn === vrn)
      : null;
    if (previous) {
      const replay = await fetchProvider(vrn);
      if (!replay.success) return sendJson(res, 200, { success: false, message: 'RC request pehle process ho chuki hai. File dobara banane ke liye retry karein.', wallet: Number(previous.balanceAfter), requiredPrice: price, downloadType, alreadyProcessed: true });
      return sendJson(res, 200, {
        success: true,
        alreadyProcessed: true,
        data: { vrn, front: replay.images.front, back: replay.images.back, downloadType },
        wallet: Number(previous.balanceAfter),
        charged: 0,
        requiredPrice: price
      });
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
    const transaction = appendTransaction(fresh.mobile, 'RC_PURCHASE', -price, fresh.wallet, vrn, downloadLabel, '', {
      downloadType,
      idempotencyKey,
      sheetSyncPending: Boolean(SHEET_WEBHOOK_URL && SHEET_SYNC_SECRET)
    });
    await persistDatabase();
    await notifyUserActivity(fresh, {
      type: 'rc-download',
      title: 'RC download complete',
      body: `${vrn} ka RC Card download ho gaya. ₹${price} wallet se deduct hua. Balance ₹${fresh.wallet}.`,
      data: { vrn, amount: price, wallet: fresh.wallet, eventId: `rc-download:${transaction.id}` }
    });
    await notifyAdminsForActivity('transactions', {
      type: 'rc-download',
      title: 'User ne RC download kiya',
      body: `${fresh.name} (+91 ${fresh.mobile}) ne ${vrn} ka RC Card download kiya.`,
      data: { mobile: fresh.mobile, vrn, amount: price, eventId: `rc-download:${transaction.id}` }
    });
    const sheetOperations = [
      queueSheetSync('user', sheetUserPayload(fresh)),
      queueSheetSync('transaction', sheetTransactionPayload(transaction))
    ];
    const sheetSyncedQuickly = await runSheetSyncOperations(sheetOperations);
    if (SHEET_WEBHOOK_URL && SHEET_SYNC_SECRET) {
      transaction.sheetSyncPending = !sheetSyncedQuickly;
      await persistDatabase();
      if (!sheetSyncedQuickly) void retryPurchaseSheetSync(fresh.mobile, transaction.id);
    }
    return sendJson(res, 200, { success: true, data: { vrn, front: provider.images.front, back: provider.images.back, downloadType }, wallet: fresh.wallet, charged: price, requiredPrice: price });
  });
}

function requireAdmin(req, res, permission = '') {
  const user = currentUser(req);
  if (!user || !user.active) { sendError(res, 401, 'Session expire ho gaya.'); return null; }
  if (user.role !== 'admin') { sendError(res, 403, 'Admin access required.'); return null; }
  if (permission && !hasAdminPermission(user, permission)) {
    sendError(res, 403, 'Is admin account ko is section ka access nahi diya gaya.');
    return null;
  }
  return user;
}

function requireAnyAdmin(req, res, permissions) {
  const user = requireAdmin(req, res);
  if (!user) return null;
  const allowed = Array.isArray(permissions) && permissions.some((permission) => hasAdminPermission(user, permission));
  if (!allowed) {
    sendError(res, 403, 'Is admin account ko user wallet history ya wallet control ka access nahi diya gaya.');
    return null;
  }
  return user;
}

function requireMainAdmin(req, res) {
  const user = requireAdmin(req, res);
  if (!user) return null;
  if (!isMainAdmin(user)) {
    sendError(res, 403, 'Ye setting sirf Main Admin ke liye available hai.');
    return null;
  }
  return user;
}

async function createTopupRequestRecord(user, amount, options = {}) {
  const fresh = syncAdminRole(findUser(user.mobile));
  if (!fresh || !fresh.active) return { error: { status: 401, message: 'User account nahi mila.' } };
  if (!Array.isArray(db.topupRequests)) db.topupRequests = [];
  const clientReference = String(options.clientReference || '').trim().slice(0, 80);
  const referenced = clientReference
    ? db.topupRequests.find((request) => request.mobile === fresh.mobile && request.clientReference === clientReference)
    : null;
  const pending = referenced || db.topupRequests.find((request) => request.mobile === fresh.mobile && request.status === 'PENDING');
  if (pending) {
    if (clientReference && !pending.clientReference) {
      pending.clientReference = clientReference;
      pending.updatedAt = new Date().toISOString();
      await persistDatabase();
    }
    // A previous redirect attempt may have persisted locally before a slow
    // Sheet sync failed. Re-sync that same durable request; never create a
    // second pending request for the same user.
    const operation = queueSheetSync('topupRequest', sheetTopupRequestPayload(pending));
    const tracked = trackTopupSheetSync(pending, operation);
    if (options.waitForSheet === false) {
      await waitForTopupSheetSync(tracked, 8_000);
      if (CROSS_DEPLOY_PRIMARY_URL && CROSS_DEPLOY_SYNC_SECRET) void retryTopupRequestToPrimary(pending);
      return { existing: true, request: pending };
    }
    const result = await tracked;
    if (!result.ok) throw result.error;
    if (CROSS_DEPLOY_PRIMARY_URL && CROSS_DEPLOY_SYNC_SECRET) void retryTopupRequestToPrimary(pending);
    return { existing: true, request: pending };
  }
  const now = new Date().toISOString();
  const request = {
    id: crypto.randomUUID(),
    crossDeploySyncPending: Boolean(CROSS_DEPLOY_PRIMARY_URL && CROSS_DEPLOY_SYNC_SECRET),
    clientReference,
    userId: fresh.id,
    userShortId: fresh.shortId || '',
    mobile: fresh.mobile,
    name: fresh.name || '',
    email: fresh.email || '',
    amountRequested: Math.round(amount),
    amountApproved: null,
    status: 'PENDING',
    sheetSyncPending: true,
    createdAt: now,
    updatedAt: now,
    whatsappSentAt: now,
    decidedAt: '',
    decidedBy: '',
    rejectReason: ''
  };
  db.topupRequests.push(request);
  await persistDatabase();
  await notifyAdminsForActivity('recharge', {
    type: 'topup-request',
    title: 'New wallet top-up request',
    body: `${fresh.name} (+91 ${fresh.mobile}) ne ₹${request.amountRequested} top-up request bheji hai.`,
    data: { mobile: fresh.mobile, amount: request.amountRequested, requestId: request.id, eventId: `topup-request:${request.id}` }
  });
  if (CROSS_DEPLOY_PRIMARY_URL && CROSS_DEPLOY_SYNC_SECRET) void retryTopupRequestToPrimary(request);
  const operation = queueSheetSync('topupRequest', sheetTopupRequestPayload(request));
  const tracked = trackTopupSheetSync(request, operation);
  if (options.waitForSheet === false) {
    // Give the fast path a short opportunity to complete normally. If the
    // provider is slow, local durable storage plus the pending outbox keeps
    // the request recoverable while WhatsApp still opens on the first click.
    await waitForTopupSheetSync(tracked, 8_000);
    return { existing: false, request };
  }
  const result = await tracked;
  if (!result.ok) throw result.error;
  return { existing: false, request };
}

function retryPendingTopupSheetSyncs() {
  if (!SHEET_WEBHOOK_URL || !SHEET_SYNC_SECRET || !Array.isArray(db.topupRequests)) return;
  db.topupRequests
    .filter((request) => String(request.status || 'PENDING').toUpperCase() === 'PENDING')
    .forEach((request) => {
      request.sheetSyncPending = true;
      const operation = queueSheetSync('topupRequest', sheetTopupRequestPayload(request));
      void trackTopupSheetSync(request, operation);
    });
}

async function handleCreateTopupRequest(req, res) {
  const user = currentUser(req);
  if (!user || !user.active) return sendError(res, 401, 'Session expire ho gaya. Dobara login karo.');
  const body = await readJson(req);
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    return sendError(res, 422, 'Topup amount ₹1 se ₹100000 ke beech hona chahiye.');
  }
  return withMutationLock(async () => {
    const result = await createTopupRequestRecord(user, amount);
    if (result.error) return sendError(res, result.error.status, result.error.message);
    return sendJson(res, 200, {
      success: true,
      existing: result.existing,
      ...(result.existing ? { message: 'Aapki ek wallet payment request already pending hai.' } : {}),
      request: publicTopupRequest(result.request)
    });
  });
}

// Direct form navigation is more reliable than navigating after an awaited
// fetch: the browser receives a server redirect only after the request is
// durably created, so one click always opens WhatsApp.
async function handleWalletTopupWhatsapp(req, res) {
  const user = currentUser(req);
  if (!user || !user.active) return sendError(res, 401, 'Session expire ho gaya. Dobara login karo.');
  const whatsapp = supportWhatsappNumber();
  if (!whatsapp) return sendError(res, 422, 'Main Admin ne WhatsApp support number configure nahi kiya.');
  const body = await readFormOrJson(req);
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
    return sendError(res, 422, 'Topup amount ₹1 se ₹100000 ke beech hona chahiye.');
  }
  const clientReference = String(body.clientReference || '').trim().slice(0, 80);
  const result = await withMutationLock(() => createTopupRequestRecord(user, amount, { waitForSheet: false, clientReference }));
  if (result.error) return sendError(res, result.error.status, result.error.message);
  const request = result.request;
  const support = supportSettingsPayload(req);
  const qrLink = support.paymentQrUrl || (support.paymentQr ? `${String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()}://${req.headers.host}/api/payment-qr` : '');
  const qrLine = qrLink ? ` Payment QR link: ${qrLink}.` : ' App me dikhaye gaye payment QR par payment karein.';
  const paymentReference = request.clientReference || request.id;
  const message = `Hello InstantRCcard support. Payment done. RC wallet payment request ID: ${request.id}. Payment reference: ${paymentReference}. Amount: ₹${request.amountRequested}. User mobile: +91 ${request.mobile}. Payment instructions: app me diye gaye QR par payment karke screenshot aur receipt isi chat me bhej raha/rahi hoon.${qrLine}`;
  const whatsappUrl = `https://wa.me/91${whatsapp}?text=${encodeURIComponent(message)}`;
  res.writeHead(303, { Location: whatsappUrl, 'Cache-Control': 'no-store', ...securityHeaders() });
  return res.end();
}

async function handleAdminGetTopupRequests(req, res, searchParams) {
  const admin = requireAdmin(req, res, 'recharge');
  if (!admin) return;
  const status = String(searchParams.get('status') || 'ALL').toUpperCase();
  const allRequests = (Array.isArray(db.topupRequests) ? db.topupRequests : [])
    .filter((request) => !status || status === 'ALL' || request.status === status);
  const pageData = paginatedCollection(allRequests, searchParams, 'page', true);
  const requests = pageData.items.map(publicTopupRequest);
  const pending = (Array.isArray(db.topupRequests) ? db.topupRequests : [])
    .filter((request) => String(request.status || 'PENDING').toUpperCase() === 'PENDING').length;
  return sendJson(res, 200, {
    success: true,
    requests,
    pending,
    status,
    page: pageData.page,
    pages: pageData.pages,
    total: pageData.total,
    limit: pageData.limit
  });
}

async function handleAdminResolveTopupRequest(req, res, requestId) {
  const admin = requireAdmin(req, res, 'recharge');
  if (!admin) return;
  const body = await readJson(req);
  const decision = String(body.status || body.action || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(decision)) return sendError(res, 422, 'Request ko approve ya reject choose karo.');

  return withMutationLock(async () => {
    const request = (Array.isArray(db.topupRequests) ? db.topupRequests : []).find((item) => String(item.id) === String(requestId));
    if (!request) return sendError(res, 404, 'Wallet payment request nahi mili.');
    if (request.status !== 'PENDING') return sendError(res, 409, 'Ye request already process ho chuki hai.');
    const now = new Date().toISOString();
    if (decision === 'REJECTED') {
      request.status = 'REJECTED';
      request.amountApproved = null;
      request.rejectReason = String(body.reason || 'Payment verify nahi ho paayi.').trim().slice(0, 180);
      request.decidedAt = now;
      request.decidedBy = admin.mobile;
      request.updatedAt = now;
      await persistDatabase();
      await notifyUserActivity(findUser(request.mobile), {
        type: 'topup-rejected',
        title: 'Wallet top-up rejected',
        body: `Aapka ₹${request.amountRequested} wallet top-up reject ho gaya. ${request.rejectReason}`,
        data: { amount: request.amountRequested, requestId: request.id }
      });
      queueSheetSyncInBackground('topupRequest', sheetTopupRequestPayload(request), 'Wallet request rejection');
      return sendJson(res, 200, { success: true, request: publicTopupRequest(request), message: 'Wallet payment request reject ho gayi.' });
    }

    const amount = Number(body.amount == null || body.amount === '' ? request.amountRequested : body.amount);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) {
      return sendError(res, 422, 'Approved amount ₹1 se ₹100000 ke beech hona chahiye.');
    }
    const user = findUser(request.mobile);
    if (!user || !user.active) return sendError(res, 404, 'Request ka user account nahi mila ya blocked hai.');
    user.wallet = Number(user.wallet || 0) + Math.round(amount);
    appendTransaction(
      user.mobile,
      'RECHARGE',
      Math.round(amount),
      user.wallet,
      '',
      `RC wallet payment request ${request.id}`,
      admin.mobile,
      {
        sourceMobile: admin.mobile,
        sourceName: admin.name || '',
        targetMobile: user.mobile,
        targetName: user.name || '',
        adminName: admin.name || '',
        direction: 'ADMIN_TO_USER_CREDIT'
      }
    );
    request.status = 'APPROVED';
    request.amountApproved = Math.round(amount);
    request.decidedAt = now;
    request.decidedBy = admin.mobile;
    request.updatedAt = now;
    request.rejectReason = '';
    await persistDatabase();
    await notifyUserActivity(user, {
      type: 'wallet-credit',
      title: 'Wallet balance added',
      body: `${admin.name || 'Admin'} (+91 ${admin.mobile}) ne ₹${Math.round(amount)} aapke wallet me add kiye. New balance ₹${user.wallet}.`,
      data: { amount: Math.round(amount), wallet: user.wallet, requestId: request.id }
    });
    queueSheetSyncInBackground('topupRequest', sheetTopupRequestPayload(request), 'Wallet request approval');
    queueSheetSyncInBackground('user', sheetUserPayload(user), 'Wallet request user');
    queueSheetSyncInBackground('transaction', sheetTransactionPayload(db.transactions[db.transactions.length - 1]), 'Wallet request transaction');
    return sendJson(res, 200, { success: true, request: publicTopupRequest(request), user: publicUser(user), message: `₹${Math.round(amount)} wallet me add ho gaye.` });
  });
}

async function handleAdminSearch(req, res) {
  const admin = requireAnyAdmin(req, res, ['recharge', 'userHistory']);
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
    transactions: userTransactions(user.mobile, 10).map(transactionViewPayload)
  });
}

async function handleAdminUserSuggestions(req, res, searchParams) {
  const admin = requireAnyAdmin(req, res, ['recharge', 'userHistory', 'rates', 'access']);
  if (!admin) return;
  const query = String(searchParams.get('q') || '').trim();
  if (query.length < 2) return sendJson(res, 200, { success: true, query, users: [] });
  const users = sortAdminUsers(searchAdminUsers(query)).slice(0, 8).map((user) => ({
    name: user.name || 'User',
    email: user.email || '',
    mobile: user.mobile,
    role: user.role,
    adminLabel: user.role === 'admin' ? adminRoleLabel(user) : ''
  }));
  return sendJson(res, 200, { success: true, query, users });
}

async function handleAdminUserWalletHistory(req, res, searchParams) {
  const admin = requireAdmin(req, res, 'userHistory');
  if (!admin) return;
  const query = String(searchParams.get('query') || searchParams.get('mobile') || searchParams.get('email') || searchParams.get('name') || '').trim();
  if (!query) return sendError(res, 422, 'User mobile, email ya naam daalo.');
  const resolved = resolveAdminUserQuery(query);
  if (!resolved.user) return sendError(res, resolved.status, resolved.message);
  const user = resolved.user;
  const rows = db.transactions.filter((transaction) => transaction.mobile === user.mobile && (isWalletBalanceTransaction(transaction) || isRcDownloadTransaction(transaction)));
  const pageData = paginatedCollection(rows, searchParams, 'page', true);
  return sendJson(res, 200, {
    success: true,
    user: publicAdminUser(user),
    query,
    summary: buildUserWalletHistorySummary(rows, user),
    category: 'wallet-ledger',
    page: pageData.page,
    pages: pageData.pages,
    total: pageData.total,
    limit: pageData.limit,
    transactions: pageData.items.map(transactionViewPayload),
    viewer: { name: admin.name || 'Admin', mobile: admin.mobile, label: adminRoleLabel(admin) }
  });
}

async function handleAdminSetUserRate(req, res) {
  const admin = requireAdmin(req, res, 'rates');
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
    await flushSheetSync();
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
  const admin = requireAdmin(req, res, 'rates');
  if (!admin) return;
  const query = String(searchParams.get('q') || '').trim();
  const matches = sortAdminUsers(searchAdminUsers(query));
  const userPage = paginatedCollection(matches, searchParams, 'page', false);
  const rateLogRows = (Array.isArray(db.rateLog) ? db.rateLog : []).slice(-300);
  const rateLogPage = paginatedCollection(rateLogRows, searchParams, 'ratePage', true);
  const users = userPage.items.map(publicAdminUser);
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
    page: userPage.page,
    pages: userPage.pages,
    limit: userPage.limit,
    rateLog: rateLogPage.items,
    ratePage: rateLogPage.page,
    ratePages: rateLogPage.pages,
    rateTotal: rateLogPage.total,
    rateLimit: rateLogPage.limit
  });
}

// Bulk rate: "all" (har normal user) ya "selected" (diye gaye mobile numbers).
async function handleAdminBulkSetRate(req, res) {
  const admin = requireAdmin(req, res, 'rates');
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
    await flushSheetSync();
    return sendJson(res, 200, {
      success: true,
      updated,
      message: clearCustom
        ? `${updated} user(s) ka custom rate hata diya — ab default ₹${defaultRcCardPrice()} apply hoga.`
        : `${updated} user(s) ka RC Card rate ₹${Math.round(Number(body.price))} set ho gaya.`
    });
  });
}

async function handleAdminAccessUsers(req, res, searchParams) {
  const admin = requireAdmin(req, res, 'access');
  if (!admin) return;
  const query = String(searchParams.get('q') || '').trim();
  const matches = sortAdminUsers(searchAdminUsers(query));
  const pageData = paginatedCollection(matches, searchParams, 'page', false);
  return sendJson(res, 200, {
    success: true,
    users: pageData.items.map(publicAdminUser),
    query,
    matched: matches.length,
    page: pageData.page,
    pages: pageData.pages,
    total: pageData.total,
    limit: pageData.limit,
    permissionKeys: ADMIN_PERMISSION_KEYS
  });
}

async function handleAdminUpdateAccess(req, res) {
  const admin = requireAdmin(req, res, 'access');
  if (!admin) return;
  const body = await readJson(req);
  const query = String(body.query || body.mobile || body.email || '').trim();
  if (!query) return sendError(res, 422, 'User mobile, email ya naam daalo.');
  return withMutationLock(async () => {
    const resolved = resolveAdminUserQuery(query);
    if (!resolved.user) return sendError(res, resolved.status, resolved.message);
    const user = resolved.user;
    if (ADMIN_MOBILE && user.mobile === ADMIN_MOBILE) {
      return sendError(res, 422, 'Owner admin ke access ko yahan se change nahi kar sakte.');
    }
    if (user.mobile === admin.mobile) {
      return sendError(res, 422, 'Apne current admin access ko change nahi kar sakte.');
    }
    const makeAdmin = body.makeAdmin !== false;
    user.role = makeAdmin ? 'admin' : 'user';
    user.adminPermissions = makeAdmin ? normalizedAdminPermissions(body.permissions, false) : {};
    user.adminAccessUpdatedAt = new Date().toISOString();
    user.adminAccessUpdatedBy = admin.mobile;
    await persistDatabase();
    queueSheetSync('user', sheetUserPayload(user));
    await flushSheetSync();
    return sendJson(res, 200, {
      success: true,
      message: makeAdmin ? `${user.name} ko selected admin access de diya gaya.` : `${user.name} ka admin access hata diya gaya.`,
      user: publicAdminUser(user),
      permissions: makeAdmin ? adminPermissionsFor(user) : {}
    });
  });
}

async function handleAdminSetUserStatus(req, res) {
  const admin = requireAdmin(req, res, 'access');
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
    await flushSheetSync();
    return sendJson(res, 200, {
      success: true,
      user: publicAdminUser(user),
      message: active ? `${user.name} ka account unblock ho gaya.` : `${user.name} ka account block kar diya.`
    });
  });
}

async function handleAdminRecharge(req, res) {
  const admin = requireAdmin(req, res, 'recharge');
  if (!admin) return;
  const body = await readJson(req);
  const mobile = normalizeMobile(body.mobile);
  const amount = Number(body.amount);
  if (!validMobile(mobile)) return sendError(res, 422, 'Valid user mobile number daalo.');
  if (!Number.isFinite(amount) || amount < 1 || amount > 100000) return sendError(res, 422, 'Recharge amount ₹1 se ₹100000 ke beech hona chahiye.');

  return withMutationLock(async () => {
    const user = findUser(mobile);
    if (!user) return sendError(res, 404, 'User account nahi mila.');
    user.wallet = Number(user.wallet) + amount;
    appendTransaction(
      mobile,
      'RECHARGE',
      amount,
      user.wallet,
      '',
      String(body.note || 'Manual admin recharge').slice(0, 120),
      admin.mobile,
      {
        sourceMobile: admin.mobile,
        sourceName: admin.name || '',
        targetMobile: user.mobile,
        targetName: user.name || '',
        adminName: admin.name || '',
        direction: 'ADMIN_TO_USER_CREDIT'
      }
    );
    await persistDatabase();
    await notifyUserActivity(user, {
      type: 'wallet-credit',
      title: 'Wallet balance added',
      body: `${admin.name || 'Admin'} (+91 ${admin.mobile}) ne ₹${Math.round(amount)} aapke wallet me add kiye. New balance ₹${user.wallet}.`,
      data: { amount: Math.round(amount), wallet: user.wallet }
    });
    await notifyAdminsForActivity('recharge', {
      type: 'wallet-recharge',
      title: 'Wallet recharge complete',
      body: `${user.name} (+91 ${user.mobile}) ke wallet me ₹${Math.round(amount)} add kiye gaye.`,
      data: { mobile: user.mobile, amount: Math.round(amount), wallet: user.wallet }
    });
    queueSheetSyncInBackground('user', sheetUserPayload(user), 'Wallet recharge user');
    queueSheetSyncInBackground('transaction', sheetTransactionPayload(db.transactions[db.transactions.length - 1]), 'Wallet recharge transaction');
    return sendJson(res, 200, { success: true, message: 'Wallet recharge successful.', user: publicUser(user) });
  });
}

async function handleAdminDebit(req, res) {
  const admin = requireAdmin(req, res, 'recharge');
  if (!admin) return;
  const body = await readJson(req);
  const mobile = normalizeMobile(body.mobile);
  const rawAmount = Number(body.amount);
  if (!validMobile(mobile)) return sendError(res, 422, 'Valid user mobile number daalo.');
  if (!Number.isFinite(rawAmount) || rawAmount < 1 || rawAmount > 100000) return sendError(res, 422, 'Debit amount ₹1 se ₹100000 ke beech hona chahiye.');
  const amount = Math.round(rawAmount);

  return withMutationLock(async () => {
    const user = findUser(mobile);
    if (!user) return sendError(res, 404, 'User account nahi mila.');
    if (mobile === admin.mobile) return sendError(res, 409, 'Admin apne hi wallet se debit nahi kar sakta.');
    const currentWallet = Number(user.wallet || 0);
    if (currentWallet < amount) {
      return sendError(res, 409, `User wallet me sirf ₹${Math.round(currentWallet)} available hai. Debit amount kam karo.`);
    }
    user.wallet = currentWallet - amount;
    admin.wallet = Number(admin.wallet || 0) + amount;
    const transaction = appendTransaction(
      user.mobile,
      'WALLET_DEBIT',
      -amount,
      user.wallet,
      '',
      String(body.note || 'Manual admin wallet debit').slice(0, 120),
      admin.mobile,
      {
        sourceMobile: user.mobile,
        sourceName: user.name || '',
        targetMobile: admin.mobile,
        targetName: admin.name || '',
        adminName: admin.name || '',
        direction: 'USER_TO_ADMIN_DEBIT'
      }
    );
    const adminTransaction = appendTransaction(
      admin.mobile,
      'ADMIN_WALLET_CREDIT',
      amount,
      admin.wallet,
      '',
      `Wallet debit credit from ${user.mobile}`,
      admin.mobile,
      {
        sourceUserMobile: user.mobile,
        sourceMobile: user.mobile,
        sourceName: user.name || '',
        targetMobile: admin.mobile,
        targetName: admin.name || '',
        adminName: admin.name || '',
        sourceTransactionId: transaction.id,
        direction: 'USER_TO_ADMIN_CREDIT'
      }
    );
    await persistDatabase();
    await notifyUserActivity(user, {
      type: 'wallet-debit',
      title: 'Wallet amount debited',
      body: `${admin.name || 'Admin'} (+91 ${admin.mobile}) ne ₹${amount} aapke wallet se debit kiye. New balance ₹${user.wallet}.`,
      data: { mobile: user.mobile, userName: user.name, sourceMobile: user.mobile, sourceName: user.name, targetMobile: admin.mobile, targetName: admin.name, amount, wallet: user.wallet, transactionId: transaction.id, eventId: `wallet-debit:${transaction.id}` }
    });
    await notifyAdminsForActivity('recharge', {
      type: 'admin-wallet-credit',
      title: 'Admin wallet credit received',
      body: `${user.name} (+91 ${user.mobile}) se ₹${amount} aapke admin wallet me credit hua. New admin balance ₹${admin.wallet}.`,
      data: { mobile: user.mobile, userName: user.name, sourceMobile: user.mobile, sourceName: user.name, targetMobile: admin.mobile, targetName: admin.name, amount, wallet: user.wallet, adminWallet: admin.wallet, transactionId: transaction.id, adminTransactionId: adminTransaction.id, eventId: `wallet-debit:${transaction.id}` }
    });
    queueSheetSyncInBackground('user', sheetUserPayload(user), 'Wallet debit user');
    queueSheetSyncInBackground('transaction', sheetTransactionPayload(transaction), 'Wallet debit transaction');
    queueSheetSyncInBackground('user', sheetUserPayload(admin), 'Admin wallet credit user');
    queueSheetSyncInBackground('transaction', sheetTransactionPayload(adminTransaction), 'Admin wallet credit transaction');
    return sendJson(res, 200, {
      success: true,
      message: `₹${amount} user wallet se debit ho gaye.`, 
      user: publicUser(user),
      admin: publicUser(admin),
      transaction: sheetTransactionPayload(transaction),
      adminTransaction: sheetTransactionPayload(adminTransaction)
    });
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

async function handlePublicSupportSettings(req, res) {
  return sendJson(res, 200, { success: true, support: supportSettingsPayload(req) }, { 'Cache-Control': 'no-store' });
}

async function handlePaymentQr(req, res) {
  const paymentQr = validPaymentQr(db.settings?.paymentQr) ? db.settings.paymentQr : '';
  if (!paymentQr) return sendError(res, 404, 'Payment QR abhi configured nahi hai.');
  const comma = paymentQr.indexOf(',');
  const mime = paymentQr.slice(5, comma).split(';')[0] || 'image/png';
  const bytes = Buffer.from(paymentQr.slice(comma + 1).replace(/\s/g, ''), 'base64');
  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': bytes.length,
    'Cache-Control': 'no-store',
    ...securityHeaders()
  });
  return res.end(bytes);
}

const DEFAULT_SETTINGS = { usersBaseline: 200000, downloadsBaseline: 171000, rating: '4.9', rcCardPrice: 15 };

function settingsNumber(key) {
  const raw = db.settings ? db.settings[key] : undefined;
  if (raw === undefined || raw === null || raw === '') return DEFAULT_SETTINGS[key] || 0;
  const value = Number(raw);
  const minimum = key === 'rcCardPrice' ? 1 : 0;
  return Number.isFinite(value) && value >= minimum ? value : (DEFAULT_SETTINGS[key] || 0);
}

async function handlePublicStats(req, res) {
  const activeUsers = db.users.filter((user) => user.active !== false && user.role !== 'admin').length;
  const completedDownloads = db.transactions.filter(isRcDownloadTransaction).length;
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
  const raw = String(iso || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: STATS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== 'literal') result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function monthKey(iso) {
  return dayKey(iso).slice(0, 7);
}

function transactionTime(transaction) {
  return transaction?.time || transaction?.createdAt || transaction?.timestamp || transaction?.date || '';
}

function normalizedTransactionType(transaction) {
  return String(transaction?.type || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function transactionDownloadType(transaction) {
  const explicit = String(transaction?.downloadType || '').toLowerCase();
  if (explicit === 'mparivahan' || /mparivahan/i.test(String(transaction?.note || ''))) return 'mparivahan';
  if (explicit) return explicit;
  return transaction?.vrn ? 'rc-card' : '';
}

function transactionViewPayload(transaction) {
  const type = normalizedTransactionType(transaction);
  const account = findUser(String(transaction?.mobile || ''));
  const admin = findUser(String(transaction?.adminMobile || ''));
  const sourceMobile = String(transaction?.sourceMobile
    || transaction?.sourceUserMobile
    || ((type === 'WALLETDEBIT' || type === 'DEBIT' || type === 'ADMINDEBIT' || type === 'ADMINWALLETDEBIT') ? transaction?.mobile : (type === 'ADMINWALLETCREDIT' ? transaction?.sourceUserMobile : transaction?.adminMobile))
    || '');
  const targetMobile = String(transaction?.targetMobile
    || ((type === 'WALLETDEBIT' || type === 'DEBIT' || type === 'ADMINDEBIT' || type === 'ADMINWALLETDEBIT') ? transaction?.adminMobile : (type === 'ADMINWALLETCREDIT' ? transaction?.mobile : transaction?.mobile))
    || '');
  const sourceUser = findUser(sourceMobile);
  const targetUser = findUser(targetMobile);
  const sourceName = String(transaction?.sourceName || sourceUser?.name || (sourceMobile && admin?.mobile === sourceMobile ? admin.name : '') || '');
  const targetName = String(transaction?.targetName || targetUser?.name || (targetMobile && admin?.mobile === targetMobile ? admin.name : '') || '');
  const accountName = String(transaction?.userName || account?.name || '');
  const adminName = String(transaction?.adminName || admin?.name || '');
  let direction = String(transaction?.direction || '');
  if (!direction) {
    if (type === 'WALLETDEBIT' || type === 'DEBIT' || type === 'ADMINDEBIT' || type === 'ADMINWALLETDEBIT') direction = 'USER_TO_ADMIN_DEBIT';
    else if (type === 'ADMINWALLETCREDIT') direction = 'USER_TO_ADMIN_CREDIT';
    else if (type === 'RECHARGE' || type === 'WALLETRECHARGE' || type === 'WALLETTOPUP' || type === 'TOPUP') direction = 'ADMIN_TO_USER_CREDIT';
    else if (transaction?.vrn) direction = 'USER_RC_PURCHASE';
  }
  const inferredDownloadType = transactionDownloadType(transaction);
  return {
    ...transaction,
    transactionId: String(transaction?.transactionId || transaction?.shortId || transaction?.id || ''),
    displayTransactionId: String(transaction?.shortId || transaction?.transactionId || transaction?.id || ''),
    userName: accountName,
    userMobile: String(transaction?.mobile || ''),
    adminName,
    sourceName,
    sourceMobile,
    targetName,
    targetMobile,
    direction,
    downloadType: inferredDownloadType
  };
}

function buildUserActivitySummary(transactions) {
  const rows = Array.isArray(transactions) ? transactions : [];
  const rcRows = rows.filter(isRcDownloadTransaction).slice().sort((a, b) => new Date(transactionTime(a)).getTime() - new Date(transactionTime(b)).getTime());
  const walletRows = rows.filter(isWalletBalanceTransaction);
  const rcCardRows = rcRows.filter((transaction) => transactionDownloadType(transaction) !== 'mparivahan');
  const mparivahanRows = rcRows.filter((transaction) => transactionDownloadType(transaction) === 'mparivahan');
  const vehicles = new Set(rcRows.map((transaction) => normalizeVrn(transaction?.vrn)).filter(Boolean));
  const latest = rcRows.length ? transactionViewPayload(rcRows[rcRows.length - 1]) : null;
  const first = rcRows.length ? transactionViewPayload(rcRows[0]) : null;
  return {
    totalWalletTransactions: walletRows.length,
    walletCredits: walletRows.filter((transaction) => Number(transaction.amount || 0) > 0).reduce((total, transaction) => total + Number(transaction.amount || 0), 0),
    walletDebits: Math.abs(walletRows.filter((transaction) => Number(transaction.amount || 0) < 0).reduce((total, transaction) => total + Number(transaction.amount || 0), 0)),
    totalRcDownloads: rcRows.length,
    uniqueVehicles: vehicles.size,
    totalRcSpent: Math.abs(rcRows.reduce((total, transaction) => total + Number(transaction.amount || 0), 0)),
    rcCardDownloads: rcCardRows.length,
    mparivahanDownloads: mparivahanRows.length,
    firstRc: first,
    latestRc: latest
  };
}

function buildUserWalletHistorySummary(transactions, user) {
  const rows = (Array.isArray(transactions) ? transactions : []).filter((transaction) => isWalletBalanceTransaction(transaction) || isRcDownloadTransaction(transaction));
  const walletRows = rows.filter(isWalletBalanceTransaction);
  const rcRows = rows.filter(isRcDownloadTransaction);
  const credits = walletRows.filter((transaction) => Number(transaction.amount || 0) > 0);
  const walletDebits = walletRows.filter((transaction) => Number(transaction.amount || 0) < 0);
  const rcSpend = Math.abs(rcRows.reduce((total, transaction) => total + Number(transaction.amount || 0), 0));
  const ordered = rows.slice().sort((a, b) => new Date(transactionTime(a)).getTime() - new Date(transactionTime(b)).getTime());
  const latest = ordered.length ? transactionViewPayload(ordered[ordered.length - 1]) : null;
  return {
    totalTransactions: rows.length,
    walletTransactions: walletRows.length,
    rcDownloads: rcRows.length,
    totalCredits: credits.reduce((total, transaction) => total + Number(transaction.amount || 0), 0),
    walletDebits: Math.abs(walletDebits.reduce((total, transaction) => total + Number(transaction.amount || 0), 0)),
    rcSpend,
    totalDebits: Math.abs(walletDebits.reduce((total, transaction) => total + Number(transaction.amount || 0), 0)) + rcSpend,
    netChange: rows.reduce((total, transaction) => total + Number(transaction.amount || 0), 0),
    currentBalance: Number(user?.wallet || 0),
    latest
  };
}

function successfulTransaction(transaction) {
  const status = String(transaction?.status || 'SUCCESS').toUpperCase();
  return !['FAILED', 'FAILURE', 'REJECTED', 'CANCELLED', 'ERROR'].includes(status);
}

function isRechargeTransaction(transaction) {
  return ['RECHARGE', 'WALLETRECHARGE', 'WALLETTOPUP', 'TOPUP'].includes(normalizedTransactionType(transaction));
}

function isWalletBalanceTransaction(transaction) {
  return isRechargeTransaction(transaction)
    || ['WALLETDEBIT', 'DEBIT', 'ADMINDEBIT', 'ADMINWALLETDEBIT', 'ADMINWALLETCREDIT', 'WALLETCREDIT'].includes(normalizedTransactionType(transaction));
}

function isRcDownloadTransaction(transaction) {
  const type = normalizedTransactionType(transaction);
  if (!successfulTransaction(transaction)) return false;
  if (['RCPURCHASE', 'RCDOWNLOAD', 'RCCARDDOWNLOAD', 'DOWNLOADRC', 'RCCARD'].includes(type)) return true;
  // Accept older mirror rows that recorded a vehicle number and a debit but
  // used a different display type. Never classify wallet/recharge rows here.
  return Boolean(transaction?.vrn) && Number(transaction?.amount || 0) < 0 && !isWalletBalanceTransaction(transaction);
}

function sumAmount(list) {
  return list.reduce((total, tx) => total + Number(tx.amount || 0), 0);
}

function summarizeAdminTopups(list) {
  return {
    amount: sumAmount(list),
    entries: list.length,
    users: new Set(list.map((tx) => String(tx.mobile || '')).filter(Boolean)).size
  };
}

function buildAdminActivity(topups, todayKey, monthNowKey, lastMonthKey, range, viewer) {
  const admins = viewer && !isMainAdmin(viewer)
    ? db.users.filter((user) => user.role === 'admin' && user.mobile === viewer.mobile)
    : db.users.filter((user) => user.role === 'admin');
  return admins.map((admin) => {
    const own = topups.filter((tx) => tx.adminMobile === admin.mobile);
    const today = summarizeAdminTopups(own.filter((tx) => dayKey(transactionTime(tx)) === todayKey));
    const month = summarizeAdminTopups(own.filter((tx) => monthKey(transactionTime(tx)) === monthNowKey));
    const lastMonth = summarizeAdminTopups(own.filter((tx) => monthKey(transactionTime(tx)) === lastMonthKey));
    const allTime = summarizeAdminTopups(own);
    const rangeStats = range
      ? summarizeAdminTopups(own.filter((tx) => {
        const key = dayKey(transactionTime(tx));
        return key >= range.from && key <= range.to;
      }))
      : null;
    return {
      mobile: admin.mobile,
      name: admin.name || 'Admin',
      label: adminRoleLabel(admin),
      permissions: adminPermissionsFor(admin),
      today,
      month,
      lastMonth,
      allTime,
      range: rangeStats
    };
  });
}

function computeAdminStats(fromDay, toDay, viewer) {
  const now = new Date();
  const todayKey = dayKey(now);
  const monthNowKey = todayKey.slice(0, 7);
  const [year, month] = monthNowKey.split('-').map(Number);
  const lastMonthDate = new Date(Date.UTC(year, month - 2, 1));
  const lastMonthKey = lastMonthDate.toISOString().slice(0, 7);
  const ownerView = isMainAdmin(viewer);

  // Main Admin sees the complete platform. An Admin Assistant only sees
  // transactions and users attributed to that assistant's own mobile.
  const allTopups = db.transactions.filter(isRechargeTransaction);
  const topups = ownerView ? allTopups : allTopups.filter((tx) => tx.adminMobile === viewer.mobile);
  const allRcDownloads = db.transactions.filter(isRcDownloadTransaction);
  const rcDownloads = ownerView ? allRcDownloads : allRcDownloads.filter((tx) => tx.adminMobile === viewer.mobile);
  const scopedUserMobiles = new Set(topups.map((tx) => String(tx.mobile || '')).filter(Boolean));
  const scopedUsers = ownerView
    ? db.users.filter((user) => user.role !== 'admin')
    : db.users.filter((user) => user.role !== 'admin' && scopedUserMobiles.has(user.mobile));

  const totalUsers = scopedUsers.length;
  const activeUsers = scopedUsers.filter((user) => user.active !== false).length;

  const todayTopup = sumAmount(topups.filter((tx) => dayKey(transactionTime(tx)) === todayKey));
  const monthTopup = sumAmount(topups.filter((tx) => monthKey(transactionTime(tx)) === monthNowKey));
  const lastMonthTopup = sumAmount(topups.filter((tx) => monthKey(transactionTime(tx)) === lastMonthKey));

  const todayRcDownloads = rcDownloads.filter((tx) => dayKey(transactionTime(tx)) === todayKey).length;
  const monthRcDownloads = rcDownloads.filter((tx) => monthKey(transactionTime(tx)) === monthNowKey).length;
  const lastMonthRcDownloads = rcDownloads.filter((tx) => monthKey(transactionTime(tx)) === lastMonthKey).length;

  const walletRequestSource = hasAdminPermission(viewer, 'recharge')
    ? (Array.isArray(db.topupRequests) ? db.topupRequests : [])
    : [];
  const walletRequestsInRange = fromDay && toDay
    ? walletRequestSource.filter((request) => {
      const key = dayKey(request.createdAt);
      return key >= fromDay && key <= toDay;
    })
    : walletRequestSource;
  const walletRequests = {
    total: walletRequestsInRange.length,
    pending: walletRequestsInRange.filter((request) => request.status === 'PENDING').length,
    approved: walletRequestsInRange.filter((request) => request.status === 'APPROVED').length,
    rejected: walletRequestsInRange.filter((request) => request.status === 'REJECTED').length,
    approvedAmount: sumAmount(walletRequestsInRange.filter((request) => request.status === 'APPROVED').map((request) => ({ amount: request.amountApproved || 0 })))
  };

  let range = null;
  if (fromDay && toDay) {
    const inRange = (tx) => {
      const key = dayKey(transactionTime(tx));
      return key >= fromDay && key <= toDay;
    };
    const rangeTopups = topups.filter(inRange);
    const rangeRcDownloads = rcDownloads.filter(inRange);
    range = {
      from: fromDay,
      to: toDay,
      topup: sumAmount(rangeTopups),
      entries: rangeTopups.length,
      users: new Set(rangeTopups.map((tx) => String(tx.mobile || '')).filter(Boolean)).size,
      rcDownloads: rangeRcDownloads.length,
      newUsers: ownerView
        ? db.users.filter((user) => {
          if (user.role === 'admin') return false;
          const key = dayKey(user.createdAt);
          return key >= fromDay && key <= toDay;
        }).length
        : 0
    };
  }

  return {
    scope: ownerView ? 'all' : 'self',
    scopeLabel: ownerView ? 'Main Admin · All platform activity' : 'Admin Assistant · Your activity only',
    viewer: {
      name: viewer.name || 'Admin',
      mobile: viewer.mobile,
      label: adminRoleLabel(viewer)
    },
    totalUsers,
    activeUsers,
    todayTopup,
    monthTopup,
    lastMonthTopup,
    allTimeTopup: sumAmount(topups),
    todayRcDownloads,
    monthRcDownloads,
    lastMonthRcDownloads,
    walletRequests,
    range,
    adminActivity: buildAdminActivity(topups, todayKey, monthNowKey, lastMonthKey, range, viewer)
  };
}

async function handleAdminStats(req, res, searchParams) {
  const admin = requireAdmin(req, res, 'kpi');
  if (!admin) return;
  const fromRaw = String(searchParams.get('from') || '');
  const toRaw = String(searchParams.get('to') || '');
  const validDay = /^\d{4}-\d{2}-\d{2}$/;
  const from = validDay.test(fromRaw) ? fromRaw : '';
  const to = validDay.test(toRaw) ? toRaw : '';
  const stats = computeAdminStats(from, to, admin);
  return sendJson(res, 200, {
    success: true,
    stats,
    settings: isMainAdmin(admin) ? {
      rating: String((db.settings && db.settings.rating) || DEFAULT_SETTINGS.rating),
      usersBaseline: settingsNumber('usersBaseline'),
      downloadsBaseline: settingsNumber('downloadsBaseline'),
      rcCardPrice: settingsNumber('rcCardPrice'),
      supportWhatsapp: supportWhatsappNumber(),
      paymentQr: validPaymentQr(db.settings?.paymentQr) ? db.settings.paymentQr : ''
    } : null
  });
}

async function handleAdminKpiDetails(req, res, searchParams) {
  const admin = requireAdmin(req, res, 'kpi');
  if (!admin) return;
  const type = String(searchParams.get('type') || 'wallet-requests');
  const fromRaw = String(searchParams.get('from') || '');
  const toRaw = String(searchParams.get('to') || '');
  const validDay = /^\d{4}-\d{2}-\d{2}$/;
  const from = validDay.test(fromRaw) ? fromRaw : '';
  const to = validDay.test(toRaw) ? toRaw : '';
  const ownerView = isMainAdmin(admin);
  const now = new Date();
  const todayKey = dayKey(now);
  const monthNowKey = todayKey.slice(0, 7);
  const [year, month] = monthNowKey.split('-').map(Number);
  const lastMonthKey = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  const inRange = (value) => {
    const key = dayKey(value);
    if (from && to) return key >= from && key <= to;
    if (type === 'today-topup' || type === 'today-rc') return key === todayKey;
    if (type === 'month-topup' || type === 'month-rc') return key.slice(0, 7) === monthNowKey;
    if (type === 'last-month-topup' || type === 'last-rc') return key.slice(0, 7) === lastMonthKey;
    return true;
  };
  const allTopups = db.transactions.filter(isRechargeTransaction);
  const topups = (ownerView ? allTopups : allTopups.filter((tx) => tx.adminMobile === admin.mobile)).filter((tx) => inRange(transactionTime(tx)));
  const allRcDownloads = db.transactions.filter(isRcDownloadTransaction);
  const rcDownloads = (ownerView ? allRcDownloads : allRcDownloads.filter((tx) => tx.adminMobile === admin.mobile)).filter((tx) => inRange(transactionTime(tx)));
  const scopedUserMobiles = new Set(allTopups.filter((tx) => ownerView || tx.adminMobile === admin.mobile).map((tx) => String(tx.mobile || '')).filter(Boolean));
  const scopedUsers = (ownerView
    ? db.users.filter((user) => user.role !== 'admin')
    : db.users.filter((user) => user.role !== 'admin' && scopedUserMobiles.has(user.mobile)))
    .filter((user) => inRange(user.createdAt));
  const requestSource = hasAdminPermission(admin, 'recharge') ? (Array.isArray(db.topupRequests) ? db.topupRequests : []) : [];
  const requests = requestSource.filter((request) => inRange(request.createdAt)).reverse().map(publicTopupRequest);
  let items = [];
  let title = 'KPI details';
  if (type === 'users' || type === 'active-users') {
    title = type === 'active-users' ? 'Active users details' : 'Total users details';
    items = scopedUsers.filter((user) => type !== 'active-users' || user.active !== false).map((user) => ({
      name: user.name || 'User', mobile: user.mobile, email: user.email || '', wallet: Number(user.wallet || 0),
      status: user.active === false ? 'BLOCKED' : 'ACTIVE', role: user.role, createdAt: user.createdAt
    }));
  } else if (type === 'wallet-requests') {
    title = 'RC wallet payment requests';
    items = requests;
  } else if (type.indexOf('rc-') === 0 || type.endsWith('-rc')) {
    title = 'RC download details';
    items = rcDownloads.slice().reverse().map((tx) => transactionViewPayload(tx));
  } else {
    title = 'Wallet topup details';
    items = topups.slice().reverse().map((tx) => transactionViewPayload(tx));
  }
  const pageData = paginatedCollection(items, searchParams, 'page', false);
  return sendJson(res, 200, {
    success: true,
    type,
    title,
    from,
    to,
    items: pageData.items,
    page: pageData.page,
    pages: pageData.pages,
    total: pageData.total,
    limit: pageData.limit
  });
}

async function handleAdminUpdateRating(req, res) {
  const admin = requireMainAdmin(req, res);
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
  await flushSheetSync();
  return sendJson(res, 200, { success: true, rating });
}

async function handleAdminUpdateBaseline(req, res) {
  const admin = requireMainAdmin(req, res);
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
  await flushSheetSync();
  return sendJson(res, 200, { success: true, usersBaseline, downloadsBaseline });
}

async function handleAdminUpdateRcPrice(req, res) {
  const admin = requireMainAdmin(req, res);
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
  await flushSheetSync();
  return sendJson(res, 200, {
    success: true,
    rcCardPrice: db.settings.rcCardPrice,
    message: 'Default RC Card rate update ho gaya. Jis user ka custom rate set nahi hai, woh ab ye rate use karega.'
  });
}

async function handleAdminUpdateSupport(req, res) {
  const admin = requireMainAdmin(req, res);
  if (!admin) return;
  const body = await readJson(req);
  const whatsapp = normalizeMobile(body.whatsapp || body.supportWhatsapp);
  if (!validMobile(whatsapp)) return sendError(res, 422, 'Valid 10-digit WhatsApp support number daalo.');

  const hasQr = Object.prototype.hasOwnProperty.call(body, 'paymentQr');
  const nextQr = body.clearQr === true ? '' : (hasQr ? String(body.paymentQr || '') : (db.settings?.paymentQr || ''));
  if (nextQr && !validPaymentQr(nextQr)) {
    return sendError(res, 422, 'Valid PNG, JPG, WEBP ya GIF payment QR image upload karo.');
  }

  db.settings = db.settings || {};
  db.settings.supportWhatsapp = whatsapp;
  db.settings.paymentQr = nextQr;
  await persistDatabase();
  queueSheetSync('settings', { supportWhatsapp: whatsapp, paymentQr: nextQr });
  await flushSheetSync();
  return sendJson(res, 200, { success: true, support: supportSettingsPayload(req) });
}

async function handleAdminGetAds(req, res) {
  const admin = requireAdmin(req, res, 'ads');
  if (!admin) return;
  return sendJson(res, 200, { success: true, ads: db.ads.slice().reverse().map(publicAd) });
}

async function handleAdminAddAd(req, res) {
  const admin = requireAdmin(req, res, 'ads');
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
  await flushSheetSync();
  return sendJson(res, 200, { success: true, ad: publicAd(ad) });
}

async function handleAdminDeleteAd(req, res, adId) {
  const admin = requireAdmin(req, res, 'ads');
  if (!admin) return;
  const before = db.ads.length;
  db.ads = db.ads.filter((ad) => String(ad.id) !== String(adId));
  if (db.ads.length === before) return sendError(res, 404, 'Advertisement nahi mila.');
  await persistDatabase();
  queueSheetSync('adDelete', { id: String(adId) });
  await flushSheetSync();
  return sendJson(res, 200, { success: true, message: 'Advertisement remove ho gaya.' });
}

async function handleAdminToggleAd(req, res, adId) {
  const admin = requireAdmin(req, res, 'ads');
  if (!admin) return;
  const ad = db.ads.find((item) => String(item.id) === String(adId));
  if (!ad) return sendError(res, 404, 'Advertisement nahi mila.');
  ad.active = ad.active === false;
  ad.updatedAt = new Date().toISOString();
  await persistDatabase();
  queueSheetSync('ad', sheetAdPayload(ad));
  await flushSheetSync();
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
    // In all-data proxy mode Render never reads/writes its own local JSON.
    // Every API category (wallet, transactions, notifications, settings,
    // ads, KPI and RC purchases) is handled by the Railway primary service.
    if (PROXY_TO_PRIMARY && pathname.startsWith('/api/')) return await proxyApiRequest(req, res, url);
    if (req.method === 'GET' && pathname === '/api/health') {
      const sheetSyncConfigured = Boolean(SHEET_WEBHOOK_URL && SHEET_SYNC_SECRET);
      return sendJson(res, 200, {
        success: true,
        service: 'InstantRCcard',
        build: BUILD_VERSION,
        providerConfigured: Boolean(RC_API_TOKEN),
        adminConfigured: Boolean(ADMIN_MOBILE),
        webPushConfigured: webPushReady,
        proxyToPrimary: PROXY_TO_PRIMARY,
        primaryApiConfigured: Boolean(PRIMARY_API_URL),
        crossDeployPrimaryConfigured: Boolean(CROSS_DEPLOY_PRIMARY_URL),
        crossDeploySyncConfigured: Boolean(CROSS_DEPLOY_SYNC_SECRET),
        sheetSyncConfigured,
        storage: sheetSyncConfigured ? 'json+google-sheet' : 'json',
        durableStore: sheetSyncConfigured ? 'google-sheet-mirror' : 'local-json-only',
        restore: {
          status: restoreState.status,
          users: db.users.length,
          transactions: db.transactions.length,
          rcDownloads: db.transactions.filter(isRcDownloadTransaction).length,
          sheetAccounts: restoreState.sheetAccounts || 0,
          sheetTransactions: restoreState.sheetTransactions || 0,
          completedAt: restoreState.completedAt || '',
          error: restoreState.error || ''
        }
      });
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
    if (req.method === 'GET' && pathname === '/api/support-settings') return await handlePublicSupportSettings(req, res);
    if (req.method === 'POST' && pathname === '/api/internal/replicate') return await handleCrossDeployReplication(req, res);
    if (req.method === 'GET' && pathname === '/api/notifications/public-key') return await handleNotificationPublicKey(req, res);
    if (req.method === 'GET' && pathname === '/api/notifications') return await handleNotificationList(req, res);
    if (req.method === 'POST' && pathname === '/api/notifications/subscribe') return await handleNotificationSubscribe(req, res);
    if (req.method === 'POST' && pathname === '/api/notifications/unsubscribe') return await handleNotificationUnsubscribe(req, res);
    if (req.method === 'POST' && pathname === '/api/notifications/read') return await handleNotificationRead(req, res);
    if (req.method === 'GET' && pathname === '/api/payment-qr') return await handlePaymentQr(req, res);
    if (req.method === 'GET' && pathname === '/api/public/stats') return await handlePublicStats(req, res);
    if (req.method === 'GET' && pathname === '/api/account/transactions') {
      const user = currentUser(req);
      if (!user) return sendError(res, 401, 'Session expire ho gaya.');
      const userTransactionRows = db.transactions.filter((transaction) => transaction.mobile === user.mobile);
      const pageData = paginatedTransactions(userTransactionRows, url.searchParams);
      return sendJson(res, 200, {
        success: true,
        ...pageData,
        summary: buildUserActivitySummary(userTransactionRows),
        transactions: pageData.transactions.map(transactionViewPayload)
      });
    }
    if (req.method === 'POST' && pathname === '/api/wallet/topup-request') return await handleCreateTopupRequest(req, res);
    if (req.method === 'POST' && pathname === '/api/wallet/topup-whatsapp') return await handleWalletTopupWhatsapp(req, res);
    if (req.method === 'POST' && pathname === '/api/rc/purchase') return await handlePurchase(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/users/search') return await handleAdminSearch(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/users/suggestions') return await handleAdminUserSuggestions(req, res, url.searchParams);
    if (req.method === 'GET' && pathname === '/api/admin/users/wallet-history') return await handleAdminUserWalletHistory(req, res, url.searchParams);
    if (req.method === 'GET' && pathname === '/api/admin/users') return await handleAdminListUsers(req, res, url.searchParams);
    if (req.method === 'GET' && pathname === '/api/admin/users/access') return await handleAdminAccessUsers(req, res, url.searchParams);
    if (req.method === 'POST' && pathname === '/api/admin/users/access') return await handleAdminUpdateAccess(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/users/set-rate') return await handleAdminSetUserRate(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/users/bulk-rate') return await handleAdminBulkSetRate(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/users/status') return await handleAdminSetUserStatus(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/recharge') return await handleAdminRecharge(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/debit') return await handleAdminDebit(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/wallet/topup-requests') return await handleAdminGetTopupRequests(req, res, url.searchParams);
    const topupRequestRoute = pathname.match(/^\/api\/admin\/wallet\/topup-requests\/([^/]+)$/);
    if (topupRequestRoute && req.method === 'POST') return await handleAdminResolveTopupRequest(req, res, decodeURIComponent(topupRequestRoute[1]));
    if (req.method === 'GET' && pathname === '/api/admin/ads') return await handleAdminGetAds(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/ads') return await handleAdminAddAd(req, res);
    const adRoute = pathname.match(/^\/api\/admin\/ads\/([^/]+)$/);
    if (adRoute && req.method === 'DELETE') return await handleAdminDeleteAd(req, res, decodeURIComponent(adRoute[1]));
    if (adRoute && req.method === 'POST') return await handleAdminToggleAd(req, res, decodeURIComponent(adRoute[1]));
    if (req.method === 'GET' && pathname === '/api/admin/stats') return await handleAdminStats(req, res, url.searchParams);
    if (req.method === 'GET' && pathname === '/api/admin/stats/details') return await handleAdminKpiDetails(req, res, url.searchParams);
    if (req.method === 'POST' && pathname === '/api/admin/settings/rating') return await handleAdminUpdateRating(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/settings/baseline') return await handleAdminUpdateBaseline(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/settings/rc-price') return await handleAdminUpdateRcPrice(req, res);
    if (req.method === 'POST' && pathname === '/api/admin/settings/support') return await handleAdminUpdateSupport(req, res);
    if (req.method === 'GET' && pathname === '/api/admin/transactions') {
      const admin = requireAdmin(req, res, 'transactions');
      if (!admin) return;
      const transactionRows = isMainAdmin(admin)
        ? db.transactions.slice()
        : db.transactions.filter((tx) => tx.adminMobile === admin.mobile);
      const pageData = paginatedTransactions(transactionRows, url.searchParams);
      return sendJson(res, 200, { success: true, ...pageData, transactions: pageData.transactions.map(transactionViewPayload) });
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
if (ensureLocalShortIds()) {
  await persistDatabase();
  if (SHEET_WEBHOOK_URL && SHEET_SYNC_SECRET) {
    db.users.forEach((user) => queueSheetSync('user', sheetUserPayload(user)));
  }
}
retryPendingTopupSheetSyncs();
retryPendingPurchaseSheetSyncs();
retryPendingCrossDeployTopups();
server.listen(PORT, '0.0.0.0', () => {
  console.log(`InstantRCcard running on http://0.0.0.0:${PORT}`);
  console.log(`RC provider: ${RC_API_URL}`);
  console.log(`Provider token: ${RC_API_TOKEN ? 'configured' : 'missing'}`);
  console.log(`Admin mobile: ${ADMIN_MOBILE ? 'configured' : 'missing'}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
