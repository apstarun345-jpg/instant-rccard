/* Data layer: Google Visualization (gviz) queries against the public sheet.
   Flow: /api/gviz (server.js proxy, cached) → direct Google fetch (static hosting fallback).
   Queries use the gviz query language (select / where / group by / order by / limit / offset), so even
   1-lakh-row tabs (EIR, StockDataa) are aggregated / paged by Google — the browser never downloads them fully. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const TTL_MS = 5 * 60 * 1000;
  const cache = new Map(); // key → { t, promise }
  let lastLoadAt = null;
  let lastSource = '';

  function directBase() { return `https://docs.google.com/spreadsheets/d/${FF.config.sheetId}/gviz/tq`; }

  function buildUrl(base, sheet, tq, gid, extra) {
    const p = new URLSearchParams();
    p.set('tqx', 'out:json');
    if (gid) p.set('gid', gid); else p.set('sheet', sheet);
    if (tq) p.set('tq', tq);
    if (extra) Object.entries(extra).forEach(([k, v]) => p.set(k, v));
    return `${base}?${p.toString()}`;
  }

  class QueryError extends Error {
    constructor(message, detail) { super(message); this.name = 'QueryError'; this.detail = detail; }
  }

  function parseGviz(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end < 0) throw new Error('Google Sheet se galat response aaya (JSON nahi mila). Sheet public hai?');
    let json;
    try { json = JSON.parse(text.slice(start, end + 1)); } catch (e) { throw new Error('Response parse nahi hua: ' + e.message); }
    if (json.status === 'error') {
      const msg = (json.errors || []).map((e) => e.detailed_message || e.message).join('; ') || 'Query error';
      throw new QueryError(msg.replace(/<[^>]+>/g, ''), json.errors);
    }
    const table = json.table || { cols: [], rows: [] };
    const cols = (table.cols || []).map((c) => ({ id: c.id, label: c.label || '', type: c.type || 'string', pattern: c.pattern || '' }));
    const rows = (table.rows || []).map((r) => (r.c || []).map((c) => (c ? { v: c.v, f: c.f } : null)));
    return { cols, rows, headers: table.parsedNumHeaders || 0, warnings: json.warnings || [] };
  }

  function cellText(cell, col) {
    if (!cell || cell.v === null || cell.v === undefined) return '';
    if (cell.f !== null && cell.f !== undefined) return String(cell.f);
    const v = cell.v;
    if (typeof v === 'string' && /^Date\(/.test(v)) {
      const d = U.parseDate(v);
      return d ? U.labelDate(d, true) : v;
    }
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }
  function cellNumber(cell) {
    if (!cell || cell.v === null || cell.v === undefined) return null;
    if (typeof cell.v === 'number') return Number.isFinite(cell.v) ? cell.v : null;
    return U.num(cell.f !== undefined && cell.f !== null ? cell.f : cell.v);
  }
  function cellDate(cell) {
    if (!cell || cell.v === null || cell.v === undefined) return null;
    return U.parseDate(cell.v) || U.parseDate(cell.f);
  }
  // String matrix (formatted values) of a table
  function textRows(table) { return table.rows.map((r) => table.cols.map((c, i) => cellText(r[i], c))); }
  function looksLikeEIR(table) {
    const labels = table.cols.slice(0, 3).map((c) => U.clean(c.label).toUpperCase());
    return labels[0] === 'TAG_ID' && labels[1] === 'VRN';
  }

  async function fetchText(url, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || 60000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store', credentials: 'same-origin' });
      const text = await res.text();
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.parse(text).error || ''; } catch (e) { /* ignore */ }
        throw new Error(`HTTP ${res.status}${detail ? ' – ' + detail : ''}`);
      }
      return { text, source: res.headers.get('x-ff-source') || (url.startsWith('http') ? 'direct' : 'proxy'), cached: res.headers.get('x-cache') === 'HIT' };
    } finally { clearTimeout(timer); }
  }

  /** Run a gviz query. Returns { cols, rows, headers, source }. */
  async function query(sheetName, tq, opts) {
    const o = opts || {};
    const cfg = FF.config.sheetByName(sheetName);
    const gid = o.gid !== undefined ? o.gid : (cfg && cfg.gid) || '';
    const key = `${sheetName}|${gid}|${tq || ''}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && !o.fresh && now - hit.t < TTL_MS) return hit.promise;

    const attempts = [];
    if (FF.config.proxyPath && FF.config.proxy !== false) attempts.push(buildUrl(FF.config.proxyPath, sheetName, tq, gid, o.fresh ? { fresh: '1' } : null));
    attempts.push(buildUrl(directBase(), sheetName, tq, gid));

    const promise = (async () => {
      let lastErr = null;
      for (const url of attempts) {
        try {
          const { text, source } = await fetchText(url, o.timeoutMs);
          const table = parseGviz(text);
          table.source = source;
          table.sheet = sheetName;
          lastLoadAt = Date.now();
          lastSource = source;
          return table;
        } catch (err) {
          lastErr = err;
          if (err instanceof QueryError) break; // same query would fail directly too
        }
      }
      throw lastErr || new Error('Fetch failed');
    })();
    cache.set(key, { t: now, promise });
    promise.catch(() => { if (cache.get(key) && cache.get(key).promise === promise) cache.delete(key); });
    return promise;
  }

  function clearCache() { cache.clear(); }

  // Escape a literal for the gviz query language (double-quoted string).
  function lit(value) { return `"${String(value).replace(/["\\]/g, '')}"`; }

  FF.data = { query, clearCache, parseGviz, cellText, cellNumber, cellDate, textRows, looksLikeEIR, lit, QueryError,
    get lastLoadAt() { return lastLoadAt; }, get lastSource() { return lastSource; } };
})(window.FF);
