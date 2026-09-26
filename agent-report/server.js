// Standalone Node server for the Agent Performance Report.
// Zero dependencies: serves the static dashboard and proxies/caches the public Google Sheet CSV.
// Run: PORT=8080 node server.js   (Render: Root Directory = agent-report, Start Command = npm start)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const SHEET_ID = process.env.REPORT_SHEET_ID || '1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc';
const SHEET_GID = process.env.REPORT_SHEET_GID || '242489821';
const CACHE_MS = Math.max(0, Number(process.env.REPORT_CACHE_SECONDS || 180)) * 1000;
const FIXTURE_FILE = process.env.REPORT_FIXTURE_FILE || ''; // local CSV for testing without internet
const UPSTREAM_TIMEOUT_MS = 30_000;
// Optional protection: set REPORT_PASSWORD (and optionally REPORT_USER) to require a browser login prompt.
const AUTH_USER = process.env.REPORT_USER || 'admin';
const AUTH_PASSWORD = process.env.REPORT_PASSWORD || '';
// Set FRAME_PROTECTION=1 to block embedding in iframes (off by default so hosted previews work).
const FRAME_PROTECTION = process.env.FRAME_PROTECTION === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

let cache = { csv: '', fetchedAt: 0 };

function headers(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(FRAME_PROTECTION ? { 'X-Frame-Options': 'SAMEORIGIN' } : {}),
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://docs.google.com https://*.googleusercontent.com",
    ...extra
  };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, headers({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' }));
  res.end(body);
}

function sendText(res, status, text, extra = {}) {
  res.writeHead(status, headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(text), ...extra }));
  res.end(text);
}

function authorized(req) {
  if (!AUTH_PASSWORD) return true;
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  const separator = decoded.indexOf(':');
  if (separator < 0) return false;
  return decoded.slice(0, separator) === AUTH_USER && decoded.slice(separator + 1) === AUTH_PASSWORD;
}

function sheetUrls() {
  return [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`
  ];
}

async function fetchSheetCsv() {
  if (FIXTURE_FILE) return fs.readFile(FIXTURE_FILE, 'utf8');
  let lastError;
  for (const url of sheetUrls()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'AgentReport/1.0' } });
      if (!response.ok) throw new Error(`Google Sheet responded ${response.status}`);
      const text = await response.text();
      if (!text.trim() || text.trim().startsWith('<')) throw new Error('Sheet returned HTML instead of CSV (is sharing set to "Anyone with the link"?)');
      return text;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Google Sheet fetch failed');
}

async function handleReport(res, searchParams) {
  const force = searchParams.get('refresh') === '1';
  const fresh = cache.csv && Date.now() - cache.fetchedAt < CACHE_MS;
  const meta = { sheetId: SHEET_ID, gid: SHEET_GID, cacheSeconds: CACHE_MS / 1000 };
  if (fresh && !force) return sendJson(res, 200, { success: true, cached: true, fetchedAt: cache.fetchedAt, ...meta, csv: cache.csv });
  try {
    const csv = await fetchSheetCsv();
    cache = { csv, fetchedAt: Date.now() };
    return sendJson(res, 200, { success: true, cached: false, fetchedAt: cache.fetchedAt, ...meta, csv });
  } catch (error) {
    if (cache.csv) return sendJson(res, 200, { success: true, cached: true, stale: true, fetchedAt: cache.fetchedAt, ...meta, warning: error.message, csv: cache.csv });
    return sendJson(res, 502, { success: false, message: `Google Sheet se data nahi mila: ${error.message}` });
  }
}

async function serveStatic(res, pathname) {
  const requested = pathname === '/' || pathname === '/index.html' ? '/index.html' : pathname;
  const candidate = path.normalize(path.join(__dirname, decodeURIComponent(requested)));
  if (!candidate.startsWith(__dirname) || path.basename(candidate) === 'server.js' || path.basename(candidate).startsWith('.')) return sendText(res, 404, 'Not found');
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) throw new Error('not a file');
    const content = await fs.readFile(candidate);
    const extension = path.extname(candidate).toLowerCase();
    res.writeHead(200, headers({
      'Content-Type': MIME[extension] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=3600'
    }));
    return res.end(content);
  } catch {
    return sendText(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    if (url.pathname === '/api/health') return sendJson(res, 200, { success: true, service: 'agent-report', sheetId: SHEET_ID, gid: SHEET_GID, protected: Boolean(AUTH_PASSWORD) });
    if (!authorized(req)) return sendText(res, 401, 'Login required', { 'WWW-Authenticate': 'Basic realm="Agent Performance Report", charset="UTF-8"' });
    if (url.pathname === '/api/report') return await handleReport(res, url.searchParams);
    if (url.pathname === '/report' || url.pathname === '/report/') return await serveStatic(res, '/index.html');
    return await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return sendText(res, 500, 'Unexpected server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Agent Performance Report running on http://0.0.0.0:${PORT}`);
  console.log(`Sheet: ${SHEET_ID} (gid ${SHEET_GID}) · cache ${CACHE_MS / 1000}s · login ${AUTH_PASSWORD ? 'ON' : 'off'}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
