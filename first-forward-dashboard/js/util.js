/* Shared helpers: formatting, dates, DOM, CSV export, toast, tooltip. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';

  const fmtInt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const fmtDec1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1, minimumFractionDigits: 0 });
  const fmtDec2 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function clean(text) { return String(text ?? '').trim(); }

  function num(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value).replace(/[,\s%₹]/g, '').trim();
    if (!text || text === '-' || text === '—' || /^na$/i.test(text)) return null;
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  function fmt(value, decimals) {
    const n = typeof value === 'number' ? value : num(value);
    if (n === null || !Number.isFinite(n)) return '—';
    if (decimals === 2) return fmtDec2.format(n);
    if (decimals) return fmtDec1.format(n);
    return fmtInt.format(n);
  }
  function fmtShort(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e7) return (n / 1e7).toFixed(2).replace(/\.?0+$/, '') + ' Cr';
    if (a >= 1e5) return (n / 1e5).toFixed(2).replace(/\.?0+$/, '') + ' L';
    if (a >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return fmtInt.format(n);
  }
  function pctOf(part, total) {
    if (!total) return null;
    return (part / total) * 100;
  }
  function growth(current, previous) {
    if (previous === null || previous === undefined || !previous) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
  }
  function fmtPct(p, decimals) {
    if (p === null || p === undefined || !Number.isFinite(p)) return '—';
    return `${p.toFixed(decimals === undefined ? 1 : decimals)}%`;
  }
  function fmtSigned(p, decimals) {
    if (p === null || p === undefined || !Number.isFinite(p)) return '—';
    const d = decimals === undefined ? 1 : decimals;
    return `${p > 0 ? '+' : ''}${p.toFixed(d)}%`;
  }
  function deltaHtml(p, opts) {
    const o = opts || {};
    if (p === null || p === undefined || !Number.isFinite(p)) return `<span class="delta flat">— ${esc(o.suffix || '')}</span>`;
    const cls = p > 0.05 ? 'up' : p < -0.05 ? 'down' : 'flat';
    const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : '•';
    return `<span class="delta ${cls}">${arrow} ${fmtSigned(p, o.decimals)} ${esc(o.suffix || '')}</span>`;
  }

  // ---- dates -----------------------------------------------------------------
  const pad2 = (n) => String(n).padStart(2, '0');
  function monthIndex(name) {
    const n = clean(name).toLowerCase().slice(0, 3);
    return MONTHS.findIndex((m) => m.toLowerCase() === n);
  }
  function parseDate(value) {
    if (value === null || value === undefined || value === '') return null;
    if (value instanceof Date) return isNaN(value) ? null : value;
    const s = clean(value);
    let m;
    if ((m = s.match(/^Date\((\d{4}),(\d{1,2}),(\d{1,2})/))) return new Date(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = s.match(/^(\d{1,2})[-/ .]([A-Za-z]{3,9})[-/ .,]*(\d{2,4})?/))) {
      const mi = monthIndex(m[2]);
      if (mi >= 0) {
        let y = m[3] ? +m[3] : new Date().getFullYear();
        if (y < 100) y += 2000;
        return new Date(y, mi, +m[1]);
      }
    }
    if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/))) {
      const mi = monthIndex(m[1]);
      if (mi >= 0) return new Date(+m[3], mi, +m[2]);
    }
    if ((m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})(?:[ T].*)?$/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      return new Date(y, +m[2] - 1, +m[1]); // dd-mm-yyyy (Indian format)
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  // "September26" / "Sep-26" / "2026-09" → "2026-09"
  function parseMonthKey(value) {
    const s = clean(value);
    let m;
    if ((m = s.match(/^(\d{4})-(\d{1,2})$/))) return `${m[1]}-${pad2(+m[2])}`;
    if ((m = s.match(/^([A-Za-z]{3,9})[-\s']?(\d{2,4})$/))) {
      const mi = monthIndex(m[1]);
      if (mi < 0) return null;
      let y = +m[2]; if (y < 100) y += 2000;
      return `${y}-${pad2(mi + 1)}`;
    }
    const d = parseDate(s);
    return d ? ymKey(d) : null;
  }
  function ymKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
  function dateKey(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function fromDateKey(key) { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); }
  function ymParts(key) { const [y, m] = key.split('-').map(Number); return { y, m }; }
  function labelYM(key, long) {
    if (!key) return '—';
    const { y, m } = ymParts(key);
    return `${(long ? MONTHS_LONG : MONTHS)[m - 1]} ${y}`;
  }
  function labelDate(d, withYear) {
    if (!d) return '—';
    return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`;
  }
  function labelDateKey(key, withYear) { return labelDate(fromDateKey(key), withYear); }
  function weekday(d) { return DAYS[d.getDay()]; }
  function daysInMonth(key) { const { y, m } = ymParts(key); return new Date(y, m, 0).getDate(); }
  function prevMonthKey(key) { const { y, m } = ymParts(key); return m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`; }
  function nextMonthKey(key) { const { y, m } = ymParts(key); return m === 12 ? `${y + 1}-01` : `${y}-${pad2(m + 1)}`; }
  // ISO-week Monday for a date
  function weekStart(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = (x.getDay() + 6) % 7;
    x.setDate(x.getDate() - day);
    return x;
  }
  function timeLabel(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // ---- collections -----------------------------------------------------------
  function sum(list, getter) {
    let total = 0;
    for (const item of list) { const v = getter ? getter(item) : item; if (typeof v === 'number' && Number.isFinite(v)) total += v; }
    return total;
  }
  function groupSum(list, keyFn, valueFn) {
    const map = new Map();
    for (const item of list) {
      const k = keyFn(item);
      if (k === null || k === undefined || k === '') continue;
      map.set(k, (map.get(k) || 0) + (valueFn ? valueFn(item) : 1));
    }
    return map;
  }
  function topEntries(map, n) {
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n || map.size);
  }
  function sortBy(list, getter, desc) {
    return [...list].sort((a, b) => {
      const x = getter(a), y = getter(b);
      if (x === y) return 0;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      return (x < y ? -1 : 1) * (desc ? -1 : 1);
    });
  }
  function uniq(list) { return [...new Set(list)]; }

  // ---- DOM -------------------------------------------------------------------
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return [...(root || document).querySelectorAll(sel)]; }
  function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function debounce(fn, ms) {
    let timer = null;
    return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
  }
  function toast(message, kind) {
    let el = $('#toast');
    if (!el) { el = h('<div id="toast" class="toast" hidden></div>'); document.body.appendChild(el); }
    el.textContent = message;
    el.className = `toast ${kind || ''}`;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 3000);
  }
  function spinner(text) {
    return `<div class="loading"><div class="spin"></div><div>${esc(text || 'Loading data from Google Sheet…')}</div></div>`;
  }
  function errorBox(err, retryAttr) {
    const msg = err && err.message ? err.message : String(err);
    return `<div class="error-box"><div class="error-title">⚠️ Data load nahi hua</div><div class="error-msg">${esc(msg)}</div>${retryAttr ? `<button class="btn" ${retryAttr}>Retry</button>` : ''}</div>`;
  }
  function downloadCsv(filename, header, rows) {
    const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [header.map(quote).join(','), ...rows.map((r) => r.map(quote).join(','))].join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 800);
  }
  function colLetter(index) {
    let s = '';
    let i = index + 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function colIndex(letter) {
    let n = 0;
    for (const ch of String(letter).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // Shared tooltip for elements with data-tip
  function initTooltip() {
    const tip = h('<div class="tip" hidden></div>');
    document.body.appendChild(tip);
    let current = null;
    function move(e) {
      const pad = 14;
      let x = e.clientX + pad, y = e.clientY + pad;
      const r = tip.getBoundingClientRect();
      if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
      if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
      tip.style.left = `${x}px`; tip.style.top = `${y}px`;
    }
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (!t) { if (current) { current = null; tip.hidden = true; } return; }
      if (t !== current) { current = t; tip.innerHTML = t.getAttribute('data-tip'); tip.hidden = false; }
      move(e);
    });
    document.addEventListener('mousemove', (e) => { if (current) move(e); });
    document.addEventListener('mouseout', (e) => {
      if (current && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-tip]') === current)) { current = null; tip.hidden = true; }
    });
  }

  FF.util = {
    esc, clean, num, fmt, fmtShort, pctOf, growth, fmtPct, fmtSigned, deltaHtml,
    MONTHS, MONTHS_LONG, DAYS, pad2, parseDate, parseMonthKey, ymKey, dateKey, fromDateKey, ymParts, labelYM, labelDate, labelDateKey,
    weekday, daysInMonth, prevMonthKey, nextMonthKey, weekStart, timeLabel,
    sum, groupSum, topEntries, sortBy, uniq,
    $, $$, h, debounce, toast, spinner, errorBox, downloadCsv, colLetter, colIndex, initTooltip
  };
})(window.FF);
