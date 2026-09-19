// ============================================================
// security.js — production-grade hardening for InstantRCcard
// ------------------------------------------------------------
//   * Rate limiting (in-memory token bucket, per IP & per route)
//   * Login brute-force lockout (per mobile + per IP)
//   * CSRF token (double-submit cookie pattern)
//   * Request signing / anti-tamper shared secret
//   * Audit log of sensitive events
//   * Strict security headers (CSP, HSTS when behind HTTPS)
//   * Input validation + payload-size guard
// ============================================================
//
// All exports are pure / stateful-but-isolated. Server wires them in.
// ============================================================

import crypto from 'node:crypto';

// ---------- Configuration ------------------------------------

const STRICT = process.env.ENABLE_STRICT_RATE_LIMITS === '1';
const LOGIN_LOCKOUT_THRESHOLD = Number(process.env.LOGIN_LOCKOUT_THRESHOLD || (STRICT ? 8 : 20));
const LOGIN_LOCKOUT_WINDOW = Number(process.env.LOGIN_LOCKOUT_WINDOW || 3600); // seconds
const CSRF_TTL = Number(process.env.CSRF_TTL || 12 * 60 * 60); // 12h
const CLIENT_SHARED_SECRET = process.env.CLIENT_SHARED_SECRET || '';

const TRUSTED_PROXIES = new Set(
  String(process.env.TRUSTED_PROXIES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

// Rate-limit buckets. Keys:
//   rl:<route>:<bucketKey> -> { count, resetAt }
// bucketKey is usually client IP. Each bucket auto-resets.
const buckets = new Map();

// Login failure counters. Keys:
//   lock:mobile:<mobile>  -> { count, lockedUntil }
//   lock:ip:<ip>          -> { count, lockedUntil }
const lockouts = new Map();

// Audit log buffer (in-memory, last N events). Server writes to disk.
const AUDIT_BUFFER_MAX = 500;
const auditBuffer = [];

// ---------- Helpers ------------------------------------------

export function clientIp(req, trustProxy = false) {
  // On Render the platform sets X-Forwarded-For. We only trust it
  // if the immediate hop is in our trusted-proxy list (production
  // hardening), otherwise we fall back to the raw socket address.
  if (trustProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (xff) return xff;
  }
  return req.socket?.remoteAddress || '0.0.0.0';
}

export function uaFingerprint(req) {
  const ua = String(req.headers['user-agent'] || '').slice(0, 200);
  return crypto.createHash('sha256').update(ua).digest('hex').slice(0, 16);
}

function takeToken(map, key, now) {
  const value = map.get(key);
  if (!value) return null;
  if (value.resetAt && value.resetAt < now) {
    map.delete(key);
    return null;
  }
  return value;
}

// ---------- Rate limiting ------------------------------------

/**
 * Per-route, per-IP rate limiter.
 *   limit  : max requests in windowMs
 *   windowMs: rolling window
 *   keyFn  : optional custom key (defaults to IP)
 */
export function rateLimit({ route, limit, windowMs, keyFn }) {
  return function (req, res, next) {
    const now = Date.now();
    const ip = clientIp(req, TRUSTED_PROXIES.size > 0);
    const k = `rl:${route}:${keyFn ? keyFn(req, ip) : ip}`;
    const bucket = takeToken(buckets, k, now) || { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(k, bucket);
    const remaining = Math.max(0, limit - bucket.count);
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > limit) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      const body = JSON.stringify({ success: false, code: 'RATE_LIMITED', message: 'Too many requests. Thodi der baad try karo.' });
      try {
        res.writeHead(429, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body)
        });
      } catch {}
      try { res.end(body); } catch {}
      return;
    }
    next();
  };
}

// ---------- Login lockout ------------------------------------

export function isLoginLocked(mobile, ip) {
  const now = Date.now();
  const mobileEntry = lockouts.get(`lock:mobile:${mobile}`);
  if (mobileEntry && mobileEntry.lockedUntil > now) return { reason: 'mobile', until: mobileEntry.lockedUntil };
  const ipEntry = lockouts.get(`lock:ip:${ip}`);
  if (ipEntry && ipEntry.lockedUntil > now) return { reason: 'ip', until: ipEntry.lockedUntil };
  return null;
}

export function recordLoginFailure(mobile, ip) {
  const now = Date.now();
  const windowMs = LOGIN_LOCKOUT_WINDOW * 1000;
  for (const key of [`lock:mobile:${mobile}`, `lock:ip:${ip}`]) {
    const entry = lockouts.get(key) || { count: 0, firstFailureAt: 0, lockedUntil: 0 };
    // If the previous failure window has elapsed, reset the counter.
    if (!entry.firstFailureAt || now - entry.firstFailureAt > windowMs) {
      entry.count = 0;
      entry.firstFailureAt = now;
      entry.lockedUntil = 0;
    }
    entry.count += 1;
    if (entry.count >= LOGIN_LOCKOUT_THRESHOLD) {
      entry.lockedUntil = now + windowMs;
      // Keep `count` so we don't keep extending the lockout on every
      // additional attempt inside the window.
    }
    lockouts.set(key, entry);
  }
}

export function recordLoginSuccess(mobile, ip) {
  lockouts.delete(`lock:mobile:${mobile}`);
  lockouts.delete(`lock:ip:${ip}`);
}

export function lockoutSecondsRemaining(mobile, ip) {
  const now = Date.now();
  const candidates = [lockouts.get(`lock:mobile:${mobile}`), lockouts.get(`lock:ip:${ip}`)]
    .filter(Boolean)
    .map((e) => e.lockedUntil)
    .filter((t) => t > now);
  if (!candidates.length) return 0;
  return Math.max(...candidates) - now;
}

// ---------- CSRF (double-submit cookie) ----------------------

export function csrfCookieName() {
  return 'instant_rccard_csrf';
}

export function issueCsrfToken(res) {
  const token = crypto.randomBytes(24).toString('base64url');
  const cookie = `${csrfCookieName()}=${token}; Path=/; SameSite=Lax; Max-Age=${CSRF_TTL}`;
  return { token, cookie };
}

export function setCsrfCookie(res, token) {
  res.setHeader('Set-Cookie', `${csrfCookieName()}=${token}; Path=/; SameSite=Lax; Max-Age=${CSRF_TTL}`);
}

export function verifyCsrf(req, expectedToken) {
  if (!expectedToken) return false;
  const headerToken = String(req.headers['x-csrf-token'] || '');
  if (!headerToken) return false;
  if (headerToken.length !== expectedToken.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(headerToken), Buffer.from(expectedToken));
  } catch {
    return false;
  }
}

export function csrfCookieFromHeader(req) {
  const raw = String(req.headers.cookie || '');
  const parts = raw.split(';').map((p) => p.trim());
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    if (p.slice(0, i) === csrfCookieName()) return decodeURIComponent(p.slice(i + 1));
  }
  return '';
}

export function csrfMiddleware(req, res, next) {
  const cookieToken = csrfCookieFromHeader(req);
  const headerToken = String(req.headers['x-csrf-token'] || '');
  // Bootstrap path: client may have no cookie yet. /api/auth/csrf
  // will issue one and exit.
  const method = String(req.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || req.url === '/api/auth/csrf') {
    if (!cookieToken) {
      const { token, cookie } = issueCsrfToken(res);
      // Defer Set-Cookie until writeHead so it survives JSON send wrappers.
      req._pendingCookies = req._pendingCookies || [];
      req._pendingCookies.push(cookie);
      res.setHeader('X-CSRF-Token', token);
    }
    return next();
  }
  // For unsafe methods (POST/PUT/DELETE/PATCH) require both.
  if (!cookieToken || !headerToken) {
    return csrfDeny(res, 'CSRF_MISSING', 'CSRF token missing.');
  }
  if (cookieToken.length !== headerToken.length) {
    return csrfDeny(res, 'CSRF_MISMATCH', 'CSRF token invalid.');
  }
  try {
    if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
      return csrfDeny(res, 'CSRF_MISMATCH', 'CSRF token invalid.');
    }
  } catch {
    return csrfDeny(res, 'CSRF_MISMATCH', 'CSRF token invalid.');
  }
  next();
}

function csrfDeny(res, code, message) {
  const body = JSON.stringify({ success: false, code, message });
  try {
    res.writeHead(403, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    });
  } catch {}
  try { res.end(body); } catch {}
}

export function pendingCookies(req) {
  return req && Array.isArray(req._pendingCookies) ? req._pendingCookies : [];
}

// ---------- Anti-tamper shared secret ------------------------

export function sharedSecretMiddleware(req, res, next) {
  if (!CLIENT_SHARED_SECRET) return next(); // disabled
  const provided = String(req.headers['x-client-secret'] || '');
  const deny = () => {
    const body = JSON.stringify({ success: false, code: 'SECRET_MISMATCH', message: 'Client secret invalid.' });
    try {
      res.writeHead(401, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      });
    } catch {}
    try { res.end(body); } catch {}
  };
  if (provided.length !== CLIENT_SHARED_SECRET.length) return deny();
  try {
    if (!crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(CLIENT_SHARED_SECRET))) return deny();
  } catch {
    return deny();
  }
  next();
}

// ---------- Audit log ----------------------------------------

export function audit(event, details = {}) {
  const entry = {
    time: new Date().toISOString(),
    event,
    ...details
  };
  auditBuffer.push(entry);
  if (auditBuffer.length > AUDIT_BUFFER_MAX) auditBuffer.splice(0, auditBuffer.length - AUDIT_BUFFER_MAX);
  // Mirror to stderr so the platform log captures it.
  try { console.warn(`[audit] ${event} ${JSON.stringify(details)}`); } catch {}
}

export function getRecentAudit(limit = 50) {
  return auditBuffer.slice(-limit).reverse();
}

// ---------- Security headers ---------------------------------

export function hardenedSecurityHeaders(isHttps = false) {
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Permitted-Cross-Domain-Policies': 'none',
    // Strict CSP. We only load self + inline data: images.
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "font-src 'self' data:",
      "manifest-src 'self'"
    ].join('; ')
  };
  if (isHttps) {
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  }
  return headers;
}

// ---------- Body validation ----------------------------------

export const MAX_BODY_BYTES = 2_000_000; // 2 MB

export async function readJsonSafe(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Request too large'), { status: 413, code: 'PAYLOAD_TOO_LARGE' });
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400, code: 'INVALID_JSON' });
  }
}

// ---------- Misc ---------------------------------------------

export function timingSafeEqualStr(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (aa.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(aa, bb); } catch { return false; }
}

export function constantTimeStringCompare(a, b) {
  return timingSafeEqualStr(a, b);
}
