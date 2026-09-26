// First Forward Dashboard — zero-dependency Node server.
// Serves the static app and proxies + caches Google Sheets gviz queries (/api/gviz).
// Run locally:  npm start   (PORT defaults to 8080; Render sets PORT automatically)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const SHEET_ID = process.env.SHEET_ID || '1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc';
const CACHE_MS = Math.max(0, Number(process.env.CACHE_SECONDS || 120)) * 1000;
const MAX_CACHE_ENTRIES = 300;
const UPSTREAM_TIMEOUT_MS = 45_000;
const GVIZ_BASE = process.env.GVIZ_BASE || 'https://docs.google.com'; // override only for local testing with a mock
// Optional login: set DASH_PASSWORD (and optionally DASH_USER) → browser asks for username/password.
const AUTH_USER = process.env.DASH_USER || 'admin';
const AUTH_PASSWORD = process.env.DASH_PASSWORD || '';
const FRAME_PROTECTION = process.env.FRAME_PROTECTION === '1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8'
};
const BLOCKED_FILES = new Set(['server.js', 'package.json', 'package-lock.json', 'render.yaml', 'README.md', '.env']);

const cache = new Map();   // key → { at, body, status }
const inflight = new Map(); // key → Promise

function headers(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    ...(FRAME_PROTECTION ? { 'X-Frame-Options': 'SAMEORIGIN' } : {}),
    'Content-Security-Policy': "default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://docs.google.com",
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
  const i = decoded.indexOf(':');
  return i > 0 && decoded.slice(0, i) === AUTH_USER && decoded.slice(i + 1) === AUTH_PASSWORD;
}

function upstreamUrl(params) {
  const p = new URLSearchParams();
  p.set('tqx', 'out:json');
  const gid = params.get('gid');
  const sheet = params.get('sheet');
  if (gid) p.set('gid', gid); else if (sheet) p.set('sheet', sheet);
  const tq = params.get('tq');
  if (tq) p.set('tq', tq);
  return `${GVIZ_BASE}/spreadsheets/d/${SHEET_ID}/gviz/tq?${p.toString()}`;
}

async function fetchUpstream(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { 'User-Agent': 'FirstForwardDashboard/1.0' } });
    const body = await response.text();
    return { status: response.status, body };
  } finally { clearTimeout(timer); }
}

async function handleGviz(res, params) {
  const fresh = params.get('fresh') === '1';
  const url = upstreamUrl(params);
  const hit = cache.get(url);
  if (hit && !fresh && Date.now() - hit.at < CACHE_MS) {
    res.writeHead(hit.status, headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cache': 'HIT', 'X-FF-Source': 'proxy' }));
    return res.end(hit.body);
  }
  try {
    let p = inflight.get(url);
    if (!p) {
      p = fetchUpstream(url).finally(() => inflight.delete(url));
      inflight.set(url, p);
    }
    const { status, body } = await p;
    if (status >= 200 && status < 300 && body.includes('setResponse')) {
      cache.set(url, { at: Date.now(), body, status });
      if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
    } else if (hit) {
      res.writeHead(200, headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cache': 'STALE', 'X-FF-Source': 'proxy' }));
      return res.end(hit.body);
    } else if (!(status >= 200 && status < 300)) {
      return sendJson(res, 502, { error: `Google Sheets responded ${status}. Sheet public ("Anyone with the link") hai?` });
    }
    res.writeHead(200, headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cache': 'MISS', 'X-FF-Source': 'proxy' }));
    return res.end(body);
  } catch (error) {
    if (hit) {
      res.writeHead(200, headers({ 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Cache': 'STALE', 'X-FF-Source': 'proxy' }));
      return res.end(hit.body);
    }
    return sendJson(res, 502, { error: `Google Sheet se data nahi mila: ${error.name === 'AbortError' ? 'timeout' : error.message}` });
  }
}

async function serveStatic(res, pathname) {
  let requested = decodeURIComponent(pathname);
  if (requested === '/' || requested === '') requested = '/index.html';
  const candidate = path.normalize(path.join(__dirname, requested));
  if (!candidate.startsWith(__dirname)) return sendText(res, 404, 'Not found');
  const base = path.basename(candidate);
  if (BLOCKED_FILES.has(base) || base.startsWith('.')) return sendText(res, 404, 'Not found');
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile()) throw new Error('not a file');
    const content = await fs.readFile(candidate);
    const ext = path.extname(candidate).toLowerCase();
    res.writeHead(200, headers({ 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': content.length, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=600' }));
    return res.end(content);
  } catch {
    if (!path.extname(requested)) return serveStatic(res, '/index.html'); // pretty URLs → app shell
    return sendText(res, 404, 'Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'Method not allowed');
    if (url.pathname === '/api/health') return sendJson(res, 200, { ok: true, service: 'first-forward-dashboard', sheetId: SHEET_ID, cacheSeconds: CACHE_MS / 1000, cached: cache.size, protected: Boolean(AUTH_PASSWORD) });
    if (!authorized(req)) return sendText(res, 401, 'Login required', { 'WWW-Authenticate': 'Basic realm="First Forward Dashboard", charset="UTF-8"' });
    if (url.pathname === '/api/gviz') return await handleGviz(res, url.searchParams);
    return await serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    return sendText(res, 500, 'Unexpected server error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`First Forward Dashboard → http://0.0.0.0:${PORT}`);
  console.log(`Sheet ${SHEET_ID} · cache ${CACHE_MS / 1000}s · login ${AUTH_PASSWORD ? "ON" : "off"}${GVIZ_BASE !== "https://docs.google.com" ? ` · upstream ${GVIZ_BASE}` : ""}`);
});
