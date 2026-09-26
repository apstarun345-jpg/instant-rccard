/* FASTag Agent Performance Report — reads the public Google Sheet "REPORT" tab and renders a dashboard.
   No build step, no dependencies. Data flow: /api/report (server cache) → direct Google fetch fallback. */
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------
  const SHEET_ID = '1ZHzmu7xtXl7trZDOXUbFmclJGffy98U4kz2QBSKsfwc';
  const SHEET_GID = '242489821';
  const SHEET_VIEW_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit?gid=${SHEET_GID}#gid=${SHEET_GID}`;
  const DIRECT_URLS = [
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`,
    `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`
  ];
  const AUTO_REFRESH_MS = 10 * 60 * 1000;

  // Sheet ke jin columns ka sub-header khali hai, unke naam yahan likh do (e.g. stockC1: 'VC5').
  // Khali chhodne par UI mein sheet ka column letter dikhega (e.g. "Column I").
  const LABEL_OVERRIDES = {
    stockC1: '', stockC2: '', stockC3: '', stockC4: '', stockC5: '',
    colAB: '',
    curC1: '', curC2: '', curC3: '', curC4: '', curC5: '',
    colBR: ''
  };

  // Column schema. Sections are located by their merged header text; `fixed` is the fallback index.
  // label: null → unknown (column letter shown), '@header' → read from the sheet's sub-header row.
  const SCHEMA = [
    { key: 'profile', title: 'Agent Profile', match: /agent profile/i, fixed: 0, cols: [
      { key: 'agentId', label: 'Agent ID' },
      { key: 'id', label: 'ID' },
      { key: 'name', label: 'Agent Name' }
    ] },
    { key: 'tl', title: 'TL Master Data', match: /tl'?s master data/i, fixed: 3, cols: [
      { key: 'gvIdFound', label: 'GV ID Found' },
      { key: 'tlId', label: 'TL ID' },
      { key: 'tlMobile', label: 'TL Mobile' },
      { key: 'tlName', label: 'TL Name' }
    ] },
    { key: 'stock', title: 'Agent Inventory (Stock)', match: /agent inventory summary/i, fixed: 7, cols: [
      { key: 'stockVc4', label: 'VC4 Stock', type: 'num' },
      { key: 'stockC1', label: null, type: 'num' },
      { key: 'stockC2', label: null, type: 'num' },
      { key: 'stockC3', label: null, type: 'num' },
      { key: 'stockC4', label: null, type: 'num' },
      { key: 'stockC5', label: null, type: 'num' },
      { key: 'stockTotal', label: 'Total Stock', type: 'num' },
      { key: 'stockNvc4', label: 'NVC4 Stock', type: 'num' }
    ] },
    { key: 'dispatchVc4', title: 'Fastag Dispatch (VC4) · TL level', match: /dispatch details \(vc4\)/i, fixed: 15, cols: [
      { key: 'tlVc4Days', label: 'TL VC4 Stock Days', type: 'num' },
      { key: 'tlProjectedB', label: 'TL Projected Issuance', type: 'num' },
      { key: 'tlPriority', label: 'Dispatch Priority', type: 'badge' },
      { key: 'tlStockAlert', label: 'Stock Alert', type: 'badge' }
    ] },
    { key: 'tlStock', title: 'TL Stock', match: /tl'?s stock details/i, fixed: 19, cols: [
      { key: 'tlStockVc4', label: 'TL VC4 Stock', type: 'num' },
      { key: 'tlStockNvc4', label: 'TL NVC4 Stock', type: 'num' },
      { key: 'tlStockTotal', label: 'TL Total Stock', type: 'num' }
    ] },
    { key: 'lastMonth', title: 'Last Month', match: /performance in\s*-/i, occurrence: 0, fixed: 22, month: true, cols: [
      { key: 'lastActiveDays', label: 'Active Days', type: 'num' },
      { key: 'lastVc4', label: 'VC4 Issued', type: 'num' },
      { key: 'lastNvc4', label: 'NVC4 Issued', type: 'num' },
      { key: 'lastTotal', label: 'Total Issued', type: 'num' }
    ] },
    { key: 'curMonth', title: 'Current Month', match: /performance in\s*-/i, occurrence: 1, fixed: 26, month: true, cols: [
      { key: 'wrongVrn', label: 'Wrong VRN', type: 'num' },
      { key: 'colAB', label: null, type: 'num' },
      { key: 'curVc4', label: 'VC4 Issued', type: 'num' },
      { key: 'curC1', label: null, type: 'num' },
      { key: 'curC2', label: null, type: 'num' },
      { key: 'curC3', label: null, type: 'num' },
      { key: 'curC4', label: null, type: 'num' },
      { key: 'curC5', label: null, type: 'num' },
      { key: 'curNvc4', label: 'NVC4 Issued', type: 'num' },
      { key: 'curTotal', label: 'Total Issued', type: 'num' },
      { key: 'curProjected', label: 'Projected (month end)', type: 'num' },
      { key: 'avgVc4', label: 'VC4 / Active Day', type: 'num' },
      { key: 'avgNvc4', label: 'NVC4 / Active Day', type: 'num' },
      { key: 'avgTotal', label: 'Daily Avg (Total)', type: 'num' }
    ] },
    { key: 'status', title: 'Agent Performance Status', match: /agents? performance status/i, fixed: 40, cols: [
      { key: 'growth', label: 'Last vs Current', type: 'pct' },
      { key: 'lastActive', label: 'Last Active', type: 'badge' },
      { key: 'agentStatus', label: 'Agent Status', type: 'badge' }
    ] },
    { key: 'week', title: 'Last 7 Days', match: /performance in 7 days/i, fixed: 43, cols: [
      { key: 'activeDays', label: 'Active Days (month)', type: 'num' },
      { key: 'd1', label: '@header', type: 'num' },
      { key: 'd2', label: '@header', type: 'num' },
      { key: 'd3', label: '@header', type: 'num' },
      { key: 'd4', label: '@header', type: 'num' },
      { key: 'd5', label: '@header', type: 'num' },
      { key: 'd6', label: '@header', type: 'num' },
      { key: 'd7', label: '@header', type: 'num' }
    ] },
    { key: 'tlLast', title: 'TL · Last Month Issued', match: /tl'?s last month issued/i, fixed: 51, cols: [
      { key: 'tlLastVc4', label: 'VC4', type: 'num' },
      { key: 'tlLastNvc4', label: 'NVC4', type: 'num' },
      { key: 'tlLastTotal', label: 'Total', type: 'num' },
      { key: 'tlLastAvg', label: 'Daily Avg', type: 'num' }
    ] },
    { key: 'tlCur', title: 'TL · Current Month Issuance', match: /tl'?s current month issuance/i, fixed: 55, cols: [
      { key: 'tlCurVc4', label: 'VC4', type: 'num' },
      { key: 'tlCurNvc4', label: 'NVC4', type: 'num' },
      { key: 'tlCurTotal', label: 'Total', type: 'num' },
      { key: 'tlAvgVc4', label: 'VC4 / Day', type: 'num' },
      { key: 'tlAvgNvc4', label: 'NVC4 / Day', type: 'num' },
      { key: 'tlAvgTotal', label: 'Daily Avg (Total)', type: 'num' }
    ] },
    { key: 'tlStatus', title: 'TL Performance Status', match: /tl'?s performance status/i, fixed: 61, cols: [
      { key: 'tlGrowth', label: 'Last vs Current', type: 'pct' },
      { key: 'tlLastActive', label: 'Last Active', type: 'badge' },
      { key: 'tlStatus', label: 'TL Status', type: 'badge' },
      { key: 'tlProjected', label: 'Projected (month end)', type: 'num' }
    ] },
    { key: 'agentWise', title: 'Agent Wise (Dispatch)', match: /^agent wise/i, fixed: 65, cols: [
      { key: 'agentAvg', label: 'Daily Avg', type: 'num' },
      { key: 'agentStockDays', label: 'Stock Days (VC4)', type: 'num' },
      { key: 'agentPriority', label: 'Priority Level', type: 'badge' }
    ] },
    { key: 'dispatchComm', title: 'Fastag Dispatch (Commercial) · TL level', match: /dispatch details \(commercial\)/i, fixed: 68, cols: [
      { key: 'tlNvc4Days', label: 'TL NVC4 Stock Days', type: 'num' },
      { key: 'colBR', label: null, type: 'num' },
      { key: 'tlCommPriority', label: 'Priority Level', type: 'badge' },
      { key: 'tlCommAlert', label: 'Stock Alert', type: 'badge' }
    ] },
    { key: 'device', title: 'Device', match: /^device/i, fixed: 72, cols: [
      { key: 'biometric', label: 'Biometric Device' }
    ] },
    { key: 'gvStock', title: 'GV Stock', match: /^gv stock/i, fixed: 73, cols: [
      { key: 'gvStockVc4', label: 'VC4', type: 'num' },
      { key: 'gvStockNvc4', label: 'NVC4', type: 'num' }
    ] },
    { key: 'gvLast', title: 'GV Issuance · Last Month', match: /gv issuance last month/i, fixed: 75, cols: [
      { key: 'gvLast', label: 'Total', type: 'num' }
    ] },
    { key: 'gvCur', title: 'GV Issuance · Current Month', match: /gv issuance current month/i, fixed: 76, cols: [
      { key: 'gvCur', label: 'Total', type: 'num' }
    ] }
  ];

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const state = {
    agents: [],
    filtered: [],
    tlGroups: [],
    columns: {},          // key → resolved column {index, label, type, unknown, section}
    sections: [],         // resolved sections with columns
    months: { last: 'Last Month', cur: 'Current Month' },
    dayLabels: [],
    daysElapsed: null,
    view: 'overview',
    filters: { q: '', tl: '', status: '', active: '', alert: '', device: '', hideZero: false },
    sort: { agents: { key: 'curTotal', dir: 'desc' }, tls: { key: 'tlCurTotal', dir: 'desc' } },
    page: 1,
    pageSize: 50,
    meta: { source: '', fetchedAt: 0, warning: '' },
    loaded: false,
    refreshTimer: null
  };

  const $ = (id) => document.getElementById(id);
  const fmtInt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  const fmtDec = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 });

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function num(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const text = String(value).replace(/[,\s%₹]/g, '').trim();
    if (!text || text === '-' || /^na$/i.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  function pct(value) {
    if (value === null || value === undefined || value === '') return null;
    const match = String(value).match(/[-+]?\d+(?:\.\d+)?/);
    if (!match) return null;
    let n = Number(match[0]);
    if (/▼/.test(String(value)) && n > 0) n = -n;
    return n;
  }
  function fmt(value, decimals) {
    const n = num(value);
    if (n === null) return '—';
    return decimals ? fmtDec.format(n) : fmtInt.format(n);
  }
  function fmtSigned(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    const rounded = Math.round(n);
    return `${rounded > 0 ? '+' : ''}${rounded}%`;
  }
  function colLetter(index) {
    let s = '';
    let i = index + 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function clean(text) {
    return String(text ?? '').trim();
  }
  function stripEmoji(text) {
    return clean(text).replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}▲▼\s]+/u, '').trim();
  }
  function tone(text) {
    const t = clean(text);
    if (!t) return 'gray';
    if (/🚀/.test(t)) return 'green';
    if (/🟢|▲/.test(t)) return 'green';
    if (/🟡/.test(t)) return 'amber';
    if (/🟠/.test(t)) return 'orange';
    if (/🔴|🔻|▼/.test(t)) return 'red';
    if (/not found/i.test(t)) return 'gray';
    if (/inactive/i.test(t)) return 'red';
    if (/de-?growth/i.test(t)) return 'red';
    if (/growth|ok|active|yes/i.test(t)) return 'green';
    if (/^no$/i.test(t)) return 'gray';
    return 'gray';
  }
  function badge(text, extraClass) {
    const t = clean(text);
    if (!t) return '<span class="dim">—</span>';
    return `<span class="rp-badge ${tone(t)} ${extraClass || ''}" title="${esc(t)}">${esc(stripEmoji(t) || t)}</span>`;
  }
  function trend(text) {
    const n = pct(text);
    if (n === null) return '<span class="dim">—</span>';
    const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    const arrow = n > 0 ? '▲' : n < 0 ? '▼' : '•';
    return `<span class="rp-trend ${cls}">${arrow} ${fmtSigned(n)}</span>`;
  }
  function trendNumber(n) {
    if (n === null || n === undefined || !Number.isFinite(n)) return '<span class="dim">—</span>';
    const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    const arrow = n > 0 ? '▲' : n < 0 ? '▼' : '•';
    return `<span class="rp-trend ${cls}">${arrow} ${fmtSigned(n)}</span>`;
  }
  function spark(values, total) {
    const max = Math.max(1, ...values);
    const w = 7, gap = 1.6, h = 20;
    const bars = values.map((v, i) => {
      const bh = v > 0 ? Math.max(2, (v / max) * (h - 1)) : 1.5;
      return `<rect x="${(i * (w + gap)).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${w}" height="${bh.toFixed(1)}" rx="1.2" class="${v > 0 ? (i === values.length - 1 ? 'last' : '') : 'zero'}"><title>${esc(state.dayLabels[i] || '')}: ${v}</title></rect>`;
    }).join('');
    return `<span class="rp-spark"><svg viewBox="0 0 ${(values.length * (w + gap)).toFixed(1)} ${h}" preserveAspectRatio="none">${bars}</svg><b>${fmtInt.format(total)}</b></span>`;
  }
  function toast(message) {
    const el = $('rp-toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
  }
  function timeLabel(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }
  function sum(list, getter) {
    let total = 0;
    for (const item of list) { const v = getter(item); if (typeof v === 'number' && Number.isFinite(v)) total += v; }
    return total;
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

  // ---------------------------------------------------------------------------
  // CSV parsing (RFC 4180)
  // ---------------------------------------------------------------------------
  function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
  }

  // ---------------------------------------------------------------------------
  // Schema resolution + row building
  // ---------------------------------------------------------------------------
  function resolveSchema(sectionRow, subRow) {
    const found = {};
    const positions = {};
    SCHEMA.forEach((section) => {
      const matches = [];
      sectionRow.forEach((cell, index) => { if (section.match.test(clean(cell))) matches.push(index); });
      const occurrence = section.occurrence || 0;
      const start = matches[occurrence] !== undefined ? matches[occurrence] : section.fixed;
      positions[section.key] = start;
      if (section.month) {
        const m = clean(sectionRow[start]).match(/performance in\s*-\s*(.+)$/i);
        if (m) state.months[section.key === 'lastMonth' ? 'last' : 'cur'] = m[1].trim();
      }
    });
    state.sections = SCHEMA.map((section) => {
      const start = positions[section.key];
      const cols = section.cols.map((col, offset) => {
        const index = start + offset;
        let label = col.label;
        let unknown = false;
        if (label === '@header') label = clean(subRow[index]) || `Day ${offset}`;
        if (label === null) {
          const override = clean(LABEL_OVERRIDES[col.key]);
          if (override) label = override;
          else { label = `Column ${colLetter(index)}`; unknown = true; }
        }
        const resolved = { key: col.key, index, label, type: col.type || 'text', unknown, section: section.key, letter: colLetter(index) };
        found[col.key] = resolved;
        return resolved;
      });
      const title = section.month ? `${section.title} (${section.key === 'lastMonth' ? state.months.last : state.months.cur})` : section.title;
      return { key: section.key, title, cols };
    });
    state.columns = found;
    state.dayLabels = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((k) => found[k].label);
    const lastDay = state.dayLabels[state.dayLabels.length - 1] || '';
    const dayMatch = lastDay.match(/(\d{1,2})/);
    state.daysElapsed = dayMatch ? Number(dayMatch[1]) : null;
    // Soft sanity check against the sheet's own sub-headers.
    const expect = [['growth', /last vs current/i], ['tlGrowth', /percent/i], ['wrongVrn', /wrong vrn/i], ['biometric', /biomatric|biometric/i]];
    expect.forEach(([key, re]) => {
      const label = clean(subRow[found[key].index]);
      if (label && !re.test(label)) console.warn(`[report] Column check: expected "${key}" near "${re}", sheet says "${label}" at ${found[key].letter}`);
    });
  }

  function buildAgents(rows, dataStart) {
    const c = state.columns;
    const agents = [];
    for (let r = dataStart; r < rows.length; r++) {
      const raw = rows[r];
      const get = (key) => clean(raw[c[key].index]);
      const agentId = get('agentId');
      const name = get('name');
      const id = get('id');
      if (!agentId && !name && !id) continue; // "Agent Not Found" placeholders + totals row
      const agent = { raw, __row: r };
      Object.values(c).forEach((col) => {
        const text = clean(raw[col.index]);
        if (col.type === 'num') agent[col.key] = num(text);
        else if (col.type === 'pct') { agent[col.key] = text; agent[col.key + 'Num'] = pct(text); }
        else agent[col.key] = text;
      });
      agent.week = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((k) => agent[k] || 0);
      agent.weekTotal = agent.week.reduce((a, b) => a + b, 0);
      agent.curTotal = agent.curTotal ?? 0;
      agent.lastTotal = agent.lastTotal ?? 0;
      agent.hasIssuance = agent.curTotal > 0;
      agent.tlKey = (agent.tlId && !/^na$/i.test(agent.tlId)) ? agent.tlId : (agent.tlName || 'Unknown');
      agent.isMaster = Boolean(agent.agentId) && agent.agentId === agent.tlId && /apna\s*paye?ment/i.test(agent.name);
      agent.activeCat = activeCategory(agent.lastActive);
      agent.inactiveDays = inactiveDays(agent.lastActive);
      agent.biometricNorm = /^y/i.test(agent.biometric || '') ? 'YES' : /^n/i.test(agent.biometric || '') ? 'NO' : '';
      agent.searchText = [agent.name, agent.agentId, agent.id, agent.gvIdFound, agent.tlName, agent.tlId, agent.tlMobile].join(' ').toLowerCase();
      agents.push(agent);
    }
    return agents;
  }

  function activeCategory(text) {
    const t = clean(text);
    if (!t) return 'other';
    if (/not found/i.test(t)) return 'notfound';
    if (/inactive in month/i.test(t)) return 'inactive-month';
    const m = t.match(/(\d+)\s*days?\s*inactive/i);
    if (m) return Number(m[1]) <= 7 ? 'inactive-7' : 'inactive-8';
    if (/active/i.test(t)) return 'active';
    return 'other';
  }
  function inactiveDays(text) {
    const m = clean(text).match(/(\d+)\s*days?\s*inactive/i);
    if (m) return Number(m[1]);
    if (/inactive in month/i.test(clean(text))) return 99;
    return 0;
  }

  function buildTlGroups(agents) {
    const map = new Map();
    agents.forEach((agent) => {
      let group = map.get(agent.tlKey);
      if (!group) {
        group = { tlKey: agent.tlKey, tlId: agent.tlId, tlName: agent.tlName, tlMobile: agent.tlMobile, agents: [], week: [0, 0, 0, 0, 0, 0, 0], source: null };
        map.set(agent.tlKey, group);
      }
      group.agents.push(agent);
      agent.week.forEach((v, i) => { group.week[i] += v; });
      if (!group.source || (group.source.tlCurTotal == null && agent.tlCurTotal != null)) group.source = agent;
      if (!group.tlName && agent.tlName) group.tlName = agent.tlName;
      if (!group.tlMobile && agent.tlMobile) group.tlMobile = agent.tlMobile;
    });
    const tlKeys = ['tlStockVc4', 'tlStockNvc4', 'tlStockTotal', 'tlVc4Days', 'tlProjectedB', 'tlPriority', 'tlStockAlert', 'tlLastVc4', 'tlLastNvc4', 'tlLastTotal', 'tlLastAvg', 'tlCurVc4', 'tlCurNvc4', 'tlCurTotal', 'tlAvgVc4', 'tlAvgNvc4', 'tlAvgTotal', 'tlGrowth', 'tlGrowthNum', 'tlLastActive', 'tlStatus', 'tlProjected', 'tlNvc4Days', 'colBR', 'tlCommPriority', 'tlCommAlert'];
    const groups = [];
    map.forEach((group) => {
      tlKeys.forEach((k) => { group[k] = group.source ? group.source[k] : null; });
      group.agentCount = group.agents.length;
      group.activeCount = group.agents.filter((a) => a.hasIssuance).length;
      group.weekTotal = group.week.reduce((a, b) => a + b, 0);
      group.agentCurSum = sum(group.agents, (a) => a.curTotal);
      group.agentLastSum = sum(group.agents, (a) => a.lastTotal);
      group.searchText = [group.tlName, group.tlId, group.tlMobile].join(' ').toLowerCase();
      groups.push(group);
    });
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------
  async function fetchWithTimeout(url, ms, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try { return await fetch(url, { ...(options || {}), signal: controller.signal }); }
    finally { clearTimeout(timer); }
  }

  async function fetchCsv(force) {
    const errors = [];
    try {
      const res = await fetchWithTimeout(`/api/report${force ? '?refresh=1' : ''}`, 35000, { cache: 'no-store' });
      const json = await res.json();
      if (json && json.success && json.csv) {
        return { csv: json.csv, source: json.stale ? 'server (stale cache)' : json.cached ? 'server cache' : 'server', fetchedAt: json.fetchedAt || Date.now(), warning: json.warning || '' };
      }
      throw new Error((json && json.message) || `HTTP ${res.status}`);
    } catch (error) {
      errors.push(`server: ${error.message}`);
    }
    for (const url of DIRECT_URLS) {
      try {
        const res = await fetchWithTimeout(url, 35000, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!text.trim() || text.trim().startsWith('<')) throw new Error('sheet returned HTML (sharing = Anyone with the link?)');
        return { csv: text, source: 'direct from Google', fetchedAt: Date.now(), warning: '' };
      } catch (error) {
        errors.push(`direct: ${error.message}`);
      }
    }
    throw new Error(errors.join(' · '));
  }

  function ingest(csvText) {
    const rows = parseCsv(csvText);
    let sectionRowIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      if (rows[i].some((cell) => /agent profile/i.test(cell))) { sectionRowIndex = i; break; }
    }
    if (sectionRowIndex < 0) throw new Error('REPORT tab ka header (Agent Profile Details…) nahi mila — sheet structure badal gayi?');
    const sectionRow = rows[sectionRowIndex];
    const subRow = rows[sectionRowIndex + 1] || [];
    resolveSchema(sectionRow, subRow);
    state.agents = buildAgents(rows, sectionRowIndex + 2);
    if (!state.agents.length) throw new Error('Sheet mein koi agent row nahi mili.');
    populateFilterOptions();
  }

  async function load({ force = false, silent = false } = {}) {
    const refreshBtn = $('rp-refresh');
    refreshBtn.classList.add('spinning');
    refreshBtn.disabled = true;
    if (!silent && !state.loaded) { $('rp-loading').hidden = false; $('rp-error').hidden = true; }
    try {
      const result = await fetchCsv(force);
      ingest(result.csv);
      state.meta = { source: result.source, fetchedAt: result.fetchedAt, warning: result.warning };
      state.loaded = true;
      $('rp-loading').hidden = true;
      $('rp-error').hidden = true;
      renderMeta();
      applyFilters();
      if (silent || force) toast(`Updated · ${state.agents.length} agents · ${result.source}`);
    } catch (error) {
      console.error(error);
      if (!state.loaded) {
        $('rp-loading').hidden = true;
        $('rp-error').hidden = false;
        $('rp-error-message').textContent = error.message;
      } else {
        toast(`Refresh fail: ${error.message}`);
      }
    } finally {
      refreshBtn.classList.remove('spinning');
      refreshBtn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Filters
  // ---------------------------------------------------------------------------
  function populateFilterOptions() {
    const tlSelect = $('f-tl');
    const statusSelect = $('f-status');
    const alertSelect = $('f-alert');
    const keepTl = state.filters.tl, keepStatus = state.filters.status, keepAlert = state.filters.alert;

    const tlMap = new Map();
    state.agents.forEach((a) => {
      const entry = tlMap.get(a.tlKey) || { key: a.tlKey, name: a.tlName || a.tlKey, count: 0 };
      entry.count += 1;
      tlMap.set(a.tlKey, entry);
    });
    const tls = [...tlMap.values()].sort((a, b) => a.name.localeCompare(b.name));
    tlSelect.innerHTML = '<option value="">All TLs</option>' + tls.map((t) => `<option value="${esc(t.key)}">${esc(t.name)}${t.key !== t.name ? ` (${esc(t.key)})` : ''} · ${t.count}</option>`).join('');

    const statusCounts = countBy(state.agents, (a) => a.agentStatus || '(blank)');
    statusSelect.innerHTML = '<option value="">All</option>' + statusCounts.map(([value, count]) => `<option value="${esc(value)}">${esc(value)} · ${count}</option>`).join('');

    const alertCounts = countBy(state.agents, (a) => a.tlStockAlert || '(blank)');
    alertSelect.innerHTML = '<option value="">All</option>' + alertCounts.map(([value, count]) => `<option value="${esc(value)}">${esc(value)} · ${count}</option>`).join('');

    tlSelect.value = keepTl; statusSelect.value = keepStatus; alertSelect.value = keepAlert;
    if (tlSelect.value !== keepTl) state.filters.tl = '';
    if (statusSelect.value !== keepStatus) state.filters.status = '';
    if (alertSelect.value !== keepAlert) state.filters.alert = '';
    $('f-active').value = state.filters.active;
    $('f-device').value = state.filters.device;
    $('f-hidezero').checked = state.filters.hideZero;
    $('rp-search').value = state.filters.q;
  }

  function countBy(list, getter) {
    const map = new Map();
    list.forEach((item) => { const k = getter(item); map.set(k, (map.get(k) || 0) + 1); });
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }

  function applyFilters() {
    const f = state.filters;
    const q = f.q.trim().toLowerCase();
    state.filtered = state.agents.filter((a) => {
      if (q && !a.searchText.includes(q)) return false;
      if (f.tl && a.tlKey !== f.tl) return false;
      if (f.status && (a.agentStatus || '(blank)') !== f.status) return false;
      if (f.active && a.activeCat !== f.active) return false;
      if (f.alert && (a.tlStockAlert || '(blank)') !== f.alert) return false;
      if (f.device && a.biometricNorm !== f.device) return false;
      if (f.hideZero && !a.hasIssuance) return false;
      return true;
    });
    state.tlGroups = buildTlGroups(state.filtered);
    state.page = 1;
    writeHash();
    renderAll();
  }

  function setFilter(key, value) {
    state.filters[key] = value;
    const el = { q: 'rp-search', tl: 'f-tl', status: 'f-status', active: 'f-active', alert: 'f-alert', device: 'f-device' }[key];
    if (el) $(el).value = value;
    if (key === 'hideZero') $('f-hidezero').checked = Boolean(value);
    applyFilters();
  }

  function clearFilters() {
    state.filters = { q: '', tl: '', status: '', active: '', alert: '', device: '', hideZero: false };
    ['rp-search', 'f-tl', 'f-status', 'f-active', 'f-alert', 'f-device'].forEach((id) => { $(id).value = ''; });
    $('f-hidezero').checked = false;
    applyFilters();
  }

  function filtersActive() {
    const f = state.filters;
    return Boolean(f.q || f.tl || f.status || f.active || f.alert || f.device || f.hideZero);
  }

  // ---------------------------------------------------------------------------
  // URL hash state (shareable views)
  // ---------------------------------------------------------------------------
  function readHash() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (params.get('view')) state.view = params.get('view');
    ['q', 'tl', 'status', 'active', 'alert', 'device'].forEach((k) => { if (params.get(k)) state.filters[k] = params.get(k); });
    if (params.get('hideZero') === '1') state.filters.hideZero = true;
  }
  function writeHash() {
    const params = new URLSearchParams();
    if (state.view !== 'overview') params.set('view', state.view);
    Object.entries(state.filters).forEach(([k, v]) => { if (v && k !== 'hideZero') params.set(k, v); });
    if (state.filters.hideZero) params.set('hideZero', '1');
    const next = params.toString();
    history.replaceState(null, '', next ? `#${next}` : location.pathname);
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------
  function renderMeta() {
    const el = $('rp-updated');
    el.textContent = `Updated ${timeLabel(state.meta.fetchedAt)} · ${state.meta.source}`;
    el.classList.toggle('stale', /stale/.test(state.meta.source));
    $('rp-subtitle').textContent = `${state.months.cur} report · ${state.agents.length} agents · Google Sheet`;
    $('rp-open-sheet').href = SHEET_VIEW_URL;
    const banner = $('rp-banner');
    if (state.meta.warning) {
      banner.hidden = false;
      banner.className = 'rp-banner';
      banner.textContent = `Sheet se fresh data nahi mila (${state.meta.warning}). Cached data dikh raha hai: ${timeLabel(state.meta.fetchedAt)}.`;
    } else banner.hidden = true;
  }

  function renderAll() {
    renderKpis();
    renderTabs();
    renderView();
  }

  function renderTabs() {
    $('count-agents').textContent = fmtInt.format(state.filtered.length);
    $('count-tls').textContent = fmtInt.format(state.tlGroups.length);
    $('count-alerts').textContent = fmtInt.format(alertBuckets().total);
    document.querySelectorAll('.rp-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === state.view));
  }

  function renderView() {
    document.querySelectorAll('.rp-view').forEach((section) => { section.hidden = section.dataset.view !== state.view; });
    if (state.view === 'overview') renderOverview();
    else if (state.view === 'agents') renderAgents();
    else if (state.view === 'tls') renderTls();
    else if (state.view === 'alerts') renderAlerts();
  }

  function setView(view) {
    state.view = view;
    writeHash();
    renderTabs();
    renderView();
    window.scrollTo({ top: Math.min(window.scrollY, 260), behavior: 'smooth' });
  }

  // ----- KPIs -----
  function kpiData() {
    const list = state.filtered;
    const agents = list.length;
    const active = list.filter((a) => a.hasIssuance).length;
    const curTotal = sum(list, (a) => a.curTotal);
    const curVc4 = sum(list, (a) => a.curVc4);
    const curNvc4 = sum(list, (a) => a.curNvc4);
    const lastTotal = sum(list, (a) => a.lastTotal);
    const projected = sum(list, (a) => a.curProjected);
    const growth = lastTotal > 0 ? (projected / lastTotal - 1) * 100 : null;
    const week = [0, 0, 0, 0, 0, 0, 0];
    list.forEach((a) => a.week.forEach((v, i) => { week[i] += v; }));
    const weekTotal = week.reduce((a, b) => a + b, 0);
    const lastDay = week[week.length - 1];
    const stockTotal = sum(list, (a) => a.stockTotal);
    const stockVc4 = sum(list, (a) => a.stockVc4);
    const stockNvc4 = sum(list, (a) => a.stockNvc4);
    const wrongVrn = sum(list, (a) => a.wrongVrn);
    const dailyAvg = state.daysElapsed ? curTotal / state.daysElapsed : null;
    return { agents, active, curTotal, curVc4, curNvc4, lastTotal, projected, growth, week, weekTotal, lastDay, stockTotal, stockVc4, stockNvc4, wrongVrn, dailyAvg };
  }

  function renderKpis() {
    const k = kpiData();
    const alerts = alertBuckets();
    const lastDayLabel = state.dayLabels[6] || 'Last day';
    const cards = [
      { label: 'Agents', value: fmtInt.format(k.agents), accent: '#1d4ed8', sub: `<span>Active <b>${fmtInt.format(k.active)}</b></span><span>Inactive <b>${fmtInt.format(k.agents - k.active)}</b></span>` },
      { label: `${esc(state.months.cur)} issued`, value: fmtInt.format(k.curTotal), accent: '#15803d', sub: `<span>VC4 <b>${fmtInt.format(k.curVc4)}</b></span><span>NVC4 <b>${fmtInt.format(k.curNvc4)}</b></span>${k.dailyAvg !== null ? `<span>Avg/day <b>${fmtDec.format(k.dailyAvg)}</b></span>` : ''}` },
      { label: `Projected vs ${esc(state.months.last)}`, value: fmtInt.format(k.projected), accent: '#7c3aed', sub: `<span>${esc(state.months.last)} <b>${fmtInt.format(k.lastTotal)}</b></span>${trendNumber(k.growth)}` },
      { label: `${esc(lastDayLabel)} (last day)`, value: fmtInt.format(k.lastDay), accent: '#0ea5e9', sub: `<span>7-day <b>${fmtInt.format(k.weekTotal)}</b></span><span>Avg <b>${fmtDec.format(k.weekTotal / 7)}</b>/day</span>` },
      { label: 'Stock in field', value: fmtInt.format(k.stockTotal), accent: '#d97706', sub: `<span>VC4 <b>${fmtInt.format(k.stockVc4)}</b></span><span>NVC4 <b>${fmtInt.format(k.stockNvc4)}</b></span>` },
      { label: 'Needs attention', value: fmtInt.format(alerts.total), accent: '#b42318', sub: `<span>TL stock <b>${fmtInt.format(alerts.lowStock.length + alerts.overStock.length)}</b></span><span>De-growth <b>${fmtInt.format(alerts.deGrowth.length)}</b></span><span>Wrong VRN <b>${fmtInt.format(k.wrongVrn)}</b></span>` }
    ];
    $('rp-kpis').innerHTML = cards.map((c) => `
      <article class="rp-kpi" style="--kpi-accent:${c.accent}">
        <div class="rp-kpi-label">${c.label}</div>
        <div class="rp-kpi-value">${c.value}</div>
        <div class="rp-kpi-sub">${c.sub}</div>
      </article>`).join('');
  }

  // ----- Overview -----
  function renderOverview() {
    const k = kpiData();
    const topAgents = [...state.filtered].sort((a, b) => b.curTotal - a.curTotal).slice(0, 10);
    const topTls = [...state.tlGroups].sort((a, b) => (b.tlCurTotal || 0) - (a.tlCurTotal || 0)).slice(0, 10);
    const statusDist = countBy(state.filtered, (a) => a.agentStatus || '(blank)');
    const activityDist = [
      ['active', 'Active'], ['inactive-7', 'Inactive 1–7 days'], ['inactive-8', 'Inactive 8+ days'], ['inactive-month', 'Inactive in month'], ['notfound', 'Not found'], ['other', 'Other']
    ].map(([key, label]) => [key, label, state.filtered.filter((a) => a.activeCat === key).length]).filter((r) => r[2] > 0);
    const alertDist = countBy(state.tlGroups, (g) => g.tlStockAlert || '(blank)');
    const deviceYes = state.filtered.filter((a) => a.biometricNorm === 'YES').length;

    const filterNote = filtersActive() ? '<small>filtered view</small>' : '<small>all agents</small>';
    $('view-overview').innerHTML = `
      <div class="rp-grid">
        <section class="rp-card span-8">
          <div class="rp-card-head"><h3>Daily issuance · last 7 days</h3><small>Total ${fmtInt.format(k.weekTotal)} · avg ${fmtDec.format(k.weekTotal / 7)}/day</small></div>
          ${barChart(k.week, state.dayLabels)}
        </section>
        <section class="rp-card span-4">
          <div class="rp-card-head"><h3>Agent status</h3>${filterNote}</div>
          <div class="rp-dist">${distRows(statusDist, state.filtered.length, 'status')}</div>
        </section>
        <section class="rp-card span-6">
          <div class="rp-card-head"><h3>Top agents · ${esc(state.months.cur)}</h3><small>by total issued</small></div>
          <div class="rp-hbars">${topAgents.length ? topAgents.map((a, i) => hbar(i + 1, `${esc(a.name)}${a.isMaster ? '<span class="rp-master-tag">Master</span>' : ''}`, esc(a.tlName), a.curTotal, topAgents[0].curTotal, `data-agent="${a.__row}"`)).join('') : '<div class="rp-empty">No data</div>'}</div>
        </section>
        <section class="rp-card span-6">
          <div class="rp-card-head"><h3>Top TLs · ${esc(state.months.cur)}</h3><small>TL-level issuance from sheet</small></div>
          <div class="rp-hbars">${topTls.length ? topTls.map((g, i) => hbar(i + 1, esc(g.tlName || g.tlKey), `${g.activeCount}/${g.agentCount} active`, g.tlCurTotal || 0, topTls[0].tlCurTotal || 1, `data-tl="${esc(g.tlKey)}"`, toneClass(g.tlStatus))).join('') : '<div class="rp-empty">No data</div>'}</div>
        </section>
        <section class="rp-card span-6">
          <div class="rp-card-head"><h3>TL stock alerts (VC4)</h3><small>${state.tlGroups.length} TLs</small></div>
          <div class="rp-dist">${distRows(alertDist, state.tlGroups.length, 'alert')}</div>
        </section>
        <section class="rp-card span-6">
          <div class="rp-card-head"><h3>Agent activity</h3><small>Biometric device: ${fmtInt.format(deviceYes)} yes</small></div>
          <div class="rp-dist">${distRows(activityDist.map(([key, label, count]) => [label, count, key]), state.filtered.length, 'active')}</div>
        </section>
      </div>`;

    $('view-overview').querySelectorAll('[data-agent]').forEach((el) => el.addEventListener('click', () => openAgent(Number(el.dataset.agent))));
    $('view-overview').querySelectorAll('[data-tl]').forEach((el) => el.addEventListener('click', () => openTl(el.dataset.tl)));
    $('view-overview').querySelectorAll('[data-filter]').forEach((el) => el.addEventListener('click', () => {
      const [key, value] = [el.dataset.filter, el.dataset.value];
      setFilter(key, state.filters[key] === value ? '' : value);
      if (key !== 'alert') setView('agents'); else setView('tls');
    }));
  }

  function toneClass(text) {
    const t = tone(text);
    return t === 'green' ? 'green' : t === 'red' ? 'red' : t === 'amber' || t === 'orange' ? 'amber' : 'gray';
  }

  function hbar(rank, name, sub, value, max, attrs, fillClass) {
    const width = max > 0 ? Math.max(1.5, (value / max) * 100) : 0;
    return `<div class="rp-hbar" ${attrs || ''}>
      <div class="rp-hbar-rank">${rank}</div>
      <div class="rp-hbar-main"><div class="rp-hbar-name"><span>${name}</span><small>${sub || ''}</small></div><div class="rp-hbar-track"><div class="rp-hbar-fill ${fillClass || ''}" style="width:${width.toFixed(1)}%"></div></div></div>
      <div class="rp-hbar-value">${fmtInt.format(value || 0)}</div>
    </div>`;
  }

  function distRows(entries, total, filterKey) {
    if (!entries.length) return '<div class="rp-empty">No data</div>';
    return entries.map(([label, count, valueOverride]) => {
      const value = valueOverride !== undefined ? valueOverride : label;
      const width = total ? (count / total) * 100 : 0;
      const active = state.filters[filterKey] === value;
      return `<div class="rp-dist-row" data-filter="${filterKey}" data-value="${esc(value)}" title="Click to ${active ? 'clear' : 'apply'} filter">
        <div><div class="rp-hbar-name">${badge(label)}${active ? '<small>filtered</small>' : ''}</div><div class="rp-hbar-track"><div class="rp-hbar-fill ${toneClass(label)}" style="width:${width.toFixed(1)}%"></div></div></div>
        <div class="rp-dist-count">${fmtInt.format(count)}</div>
      </div>`;
    }).join('');
  }

  function barChart(values, labels) {
    const max = Math.max(1, ...values);
    const n = values.length;
    const cols = values.map((v, i) => {
      const height = Math.max(v > 0 ? 2 : 0.5, (v / max) * 100);
      return `<div class="rp-bar-col" title="${esc(labels[i] || '')}: ${fmtInt.format(v)}">
        <div class="rp-bar-val">${fmtInt.format(v)}</div>
        <div class="rp-bar-track"><div class="rp-bar-fill ${i === n - 1 ? 'last' : ''}" style="height:${height.toFixed(1)}%"></div></div>
        <div class="rp-bar-lbl">${esc(labels[i] || '')}</div>
      </div>`;
    }).join('');
    return `<div class="rp-bars" role="img" aria-label="Daily issuance chart">${cols}</div>`;
  }

  // ----- Agents table -----
  const AGENT_COLUMNS = () => [
    { key: 'name', label: 'Agent', sticky: true, sortValue: (a) => a.name, render: (a) => `<div class="rp-cell-main" title="${esc(a.name)}">${esc(a.name || '—')}${a.isMaster ? '<span class="rp-master-tag">Master</span>' : ''}</div><span class="rp-cell-sub">${esc(a.agentId || a.id || '')}</span>` },
    { key: 'tlName', label: 'TL', sortValue: (a) => a.tlName, render: (a) => `<div class="rp-cell-main" title="${esc(a.tlName)}">${esc(a.tlName || '—')}</div><span class="rp-cell-sub">${esc(a.tlId || '')}</span>` },
    { key: 'lastTotal', label: `${state.months.last.slice(0, 3)} total`, num: true, sortValue: (a) => a.lastTotal, render: (a) => fmt(a.lastTotal) },
    { key: 'curVc4', label: 'VC4', num: true, sortValue: (a) => a.curVc4, render: (a) => fmt(a.curVc4) },
    { key: 'curNvc4', label: 'NVC4', num: true, sortValue: (a) => a.curNvc4, render: (a) => fmt(a.curNvc4) },
    { key: 'curTotal', label: `${state.months.cur.slice(0, 3)} total`, num: true, strong: true, sortValue: (a) => a.curTotal, render: (a) => fmt(a.curTotal) },
    { key: 'curProjected', label: 'Projected', num: true, sortValue: (a) => a.curProjected, render: (a) => fmt(a.curProjected) },
    { key: 'avgTotal', label: 'Avg/day', num: true, sortValue: (a) => a.avgTotal, render: (a) => fmt(a.avgTotal, true) },
    { key: 'growth', label: 'Growth', num: true, sortValue: (a) => a.growthNum, render: (a) => trend(a.growth) },
    { key: 'weekTotal', label: '7 days', sortValue: (a) => a.weekTotal, render: (a) => spark(a.week, a.weekTotal) },
    { key: 'activeDays', label: 'Active days', num: true, sortValue: (a) => a.activeDays, render: (a) => fmt(a.activeDays) },
    { key: 'lastActive', label: 'Last active', sortValue: (a) => a.inactiveDays, render: (a) => badge(a.lastActive) },
    { key: 'agentStatus', label: 'Status', sortValue: (a) => a.agentStatus, render: (a) => badge(a.agentStatus) },
    { key: 'stockTotal', label: 'Stock (VC4 / total)', num: true, sortValue: (a) => a.stockTotal, render: (a) => `<span class="rp-stack"><b>${fmt(a.stockVc4)}</b><small>/ ${fmt(a.stockTotal)}</small></span>` },
    { key: 'agentStockDays', label: 'Stock days', num: true, sortValue: (a) => a.agentStockDays, render: (a) => fmt(a.agentStockDays) },
    { key: 'agentPriority', label: 'Priority', sortValue: (a) => a.agentPriority, render: (a) => badge(a.agentPriority) },
    { key: 'wrongVrn', label: 'Wrong VRN', num: true, sortValue: (a) => a.wrongVrn, render: (a) => (a.wrongVrn ? `<span class="rp-trend down">${fmt(a.wrongVrn)}</span>` : '<span class="dim">0</span>') },
    { key: 'biometric', label: 'Device', sortValue: (a) => a.biometricNorm, render: (a) => badge(a.biometricNorm || a.biometric) }
  ];

  function sortList(list, columns, sortState) {
    const col = columns.find((c) => c.key === sortState.key) || columns[0];
    const dir = sortState.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = col.sortValue(a), vb = col.sortValue(b);
      const na = va === null || va === undefined || va === '';
      const nb = vb === null || vb === undefined || vb === '';
      if (na && nb) return 0;
      if (na) return 1;
      if (nb) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }

  function tableHead(columns, sortState) {
    return `<thead><tr>${columns.map((c) => `<th class="${c.num ? 'num' : ''} ${c.sticky ? 'sticky-col' : ''} ${sortState.key === c.key ? 'sorted' : ''}" data-sort="${c.key}">${esc(c.label)}${sortState.key === c.key ? `<span class="arrow">${sortState.dir === 'asc' ? '▲' : '▼'}</span>` : ''}</th>`).join('')}</tr></thead>`;
  }

  function renderAgents() {
    const columns = AGENT_COLUMNS();
    const sorted = sortList(state.filtered, columns, state.sort.agents);
    const pageSize = state.pageSize === 'all' ? sorted.length || 1 : state.pageSize;
    const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    const start = (state.page - 1) * pageSize;
    const slice = sorted.slice(start, start + pageSize);

    $('agents-sub').textContent = `${fmtInt.format(sorted.length)} of ${fmtInt.format(state.agents.length)} agents${filtersActive() ? ' · filtered' : ''}`;
    const body = slice.length
      ? `<tbody>${slice.map((a) => `<tr data-row="${a.__row}">${columns.map((c) => `<td class="${c.num ? 'num' : ''} ${c.sticky ? 'sticky-col' : ''} ${c.strong ? 'strong' : ''}">${c.render(a)}</td>`).join('')}</tr>`).join('')}</tbody>`
      : `<tbody><tr><td colspan="${columns.length}"><div class="rp-empty">Koi agent match nahi hua. Filters clear karke dekho.</div></td></tr></tbody>`;
    const table = $('agents-table');
    table.innerHTML = tableHead(columns, state.sort.agents) + body;
    table.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => toggleSort('agents', th.dataset.sort, columns)));
    table.querySelectorAll('tbody tr[data-row]').forEach((tr) => tr.addEventListener('click', () => openAgent(Number(tr.dataset.row))));
    renderPagination(sorted.length, pageSize, pages);
    $('agents-export').onclick = () => exportAgents(sorted);
  }

  function toggleSort(table, key, columns) {
    const current = state.sort[table];
    if (current.key === key) current.dir = current.dir === 'asc' ? 'desc' : 'asc';
    else { current.key = key; const col = columns.find((c) => c.key === key); current.dir = col && (col.num || key === 'weekTotal' || key === 'agentCount' || key === 'activeCount') ? 'desc' : 'asc'; }
    if (table === 'agents') renderAgents(); else renderTls();
  }

  function renderPagination(total, pageSize, pages) {
    const el = $('agents-pagination');
    if (total === 0) { el.innerHTML = ''; return; }
    const from = (state.page - 1) * pageSize + 1;
    const to = Math.min(total, state.page * pageSize);
    const buttons = [];
    const push = (p, label, active, disabled) => buttons.push(`<button class="rp-page ${active ? 'active' : ''}" data-page="${p}" ${disabled ? 'disabled' : ''} type="button">${label}</button>`);
    push(state.page - 1, '‹', false, state.page === 1);
    const windowStart = Math.max(1, state.page - 2), windowEnd = Math.min(pages, windowStart + 4);
    if (windowStart > 1) push(1, '1', false, false);
    if (windowStart > 2) buttons.push('<span class="rp-page" style="border:0">…</span>');
    for (let p = windowStart; p <= windowEnd; p++) push(p, String(p), p === state.page, false);
    if (windowEnd < pages - 1) buttons.push('<span class="rp-page" style="border:0">…</span>');
    if (windowEnd < pages) push(pages, String(pages), false, false);
    push(state.page + 1, '›', false, state.page === pages);
    el.innerHTML = `<span>Showing ${fmtInt.format(from)}–${fmtInt.format(to)} of ${fmtInt.format(total)}</span><div class="rp-pages">${buttons.join('')}</div>`;
    el.querySelectorAll('button[data-page]').forEach((b) => b.addEventListener('click', () => { state.page = Number(b.dataset.page); renderAgents(); $('view-agents').scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
  }

  function exportAgents(list) {
    const cols = state.sections.flatMap((s) => s.cols);
    const header = cols.map((c) => `${c.label}${c.unknown ? ` (${c.letter})` : ''}`);
    const rows = list.map((a) => cols.map((c) => clean(a.raw[c.index])));
    downloadCsv(`agents-report-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
    toast(`Exported ${list.length} agents`);
  }

  // ----- TL table -----
  const TL_COLUMNS = () => [
    { key: 'tlName', label: 'Team Leader', sticky: true, sortValue: (g) => g.tlName || g.tlKey, render: (g) => `<div class="rp-cell-main" title="${esc(g.tlName)}">${esc(g.tlName || g.tlKey)}</div><span class="rp-cell-sub">${esc(g.tlId || '')}${g.tlMobile && !/^na$/i.test(g.tlMobile) ? ` · ${esc(g.tlMobile)}` : ''}</span>` },
    { key: 'agentCount', label: 'Agents (active)', num: true, sortValue: (g) => g.agentCount, render: (g) => `<span class="rp-stack"><b>${g.agentCount}</b><small>(${g.activeCount} active)</small></span>` },
    { key: 'tlLastTotal', label: `${state.months.last.slice(0, 3)} total`, num: true, sortValue: (g) => g.tlLastTotal, render: (g) => fmt(g.tlLastTotal) },
    { key: 'tlCurVc4', label: 'VC4', num: true, sortValue: (g) => g.tlCurVc4, render: (g) => fmt(g.tlCurVc4) },
    { key: 'tlCurNvc4', label: 'NVC4', num: true, sortValue: (g) => g.tlCurNvc4, render: (g) => fmt(g.tlCurNvc4) },
    { key: 'tlCurTotal', label: `${state.months.cur.slice(0, 3)} total`, num: true, strong: true, sortValue: (g) => g.tlCurTotal, render: (g) => fmt(g.tlCurTotal) },
    { key: 'tlAvgTotal', label: 'Avg/day', num: true, sortValue: (g) => g.tlAvgTotal, render: (g) => fmt(g.tlAvgTotal, true) },
    { key: 'tlProjected', label: 'Projected', num: true, sortValue: (g) => g.tlProjected, render: (g) => fmt(g.tlProjected) },
    { key: 'tlGrowth', label: 'Growth', num: true, sortValue: (g) => g.tlGrowthNum, render: (g) => trend(g.tlGrowth) },
    { key: 'tlStatus', label: 'TL status', sortValue: (g) => g.tlStatus, render: (g) => badge(g.tlStatus) },
    { key: 'weekTotal', label: '7 days (agents)', num: true, sortValue: (g) => g.weekTotal, render: (g) => spark(g.week, g.weekTotal) },
    { key: 'tlStockVc4', label: 'Stock VC4 / NVC4', num: true, sortValue: (g) => g.tlStockVc4, render: (g) => `<span class="rp-stack"><b>${fmt(g.tlStockVc4)}</b><small>/ ${fmt(g.tlStockNvc4)}</small></span>` },
    { key: 'tlVc4Days', label: 'VC4 stock days', num: true, sortValue: (g) => g.tlVc4Days, render: (g) => fmt(g.tlVc4Days) },
    { key: 'tlStockAlert', label: 'Stock alert (VC4)', sortValue: (g) => g.tlStockAlert, render: (g) => badge(g.tlStockAlert) },
    { key: 'tlPriority', label: 'Priority (VC4)', sortValue: (g) => g.tlPriority, render: (g) => badge(g.tlPriority) },
    { key: 'tlNvc4Days', label: 'NVC4 stock days', num: true, sortValue: (g) => g.tlNvc4Days, render: (g) => fmt(g.tlNvc4Days) },
    { key: 'tlCommAlert', label: 'Alert (NVC4)', sortValue: (g) => g.tlCommAlert, render: (g) => badge(g.tlCommAlert) }
  ];

  function renderTls() {
    const columns = TL_COLUMNS();
    const sorted = sortList(state.tlGroups, columns, state.sort.tls);
    $('tls-sub').textContent = `${fmtInt.format(sorted.length)} TLs · TL-level numbers from sheet, agent counts follow filters`;
    const body = sorted.length
      ? `<tbody>${sorted.map((g) => `<tr data-tl="${esc(g.tlKey)}">${columns.map((c) => `<td class="${c.num ? 'num' : ''} ${c.sticky ? 'sticky-col' : ''} ${c.strong ? 'strong' : ''}">${c.render(g)}</td>`).join('')}</tr>`).join('')}</tbody>`
      : `<tbody><tr><td colspan="${columns.length}"><div class="rp-empty">Koi TL match nahi hua.</div></td></tr></tbody>`;
    const table = $('tls-table');
    table.innerHTML = tableHead(columns, state.sort.tls) + body;
    table.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => toggleSort('tls', th.dataset.sort, columns)));
    table.querySelectorAll('tbody tr[data-tl]').forEach((tr) => tr.addEventListener('click', () => openTl(tr.dataset.tl)));
    $('tls-export').onclick = () => {
      const header = ['TL ID', 'TL Name', 'TL Mobile', 'Agents', 'Active Agents', `${state.months.last} Total`, `${state.months.cur} VC4`, `${state.months.cur} NVC4`, `${state.months.cur} Total`, 'Daily Avg', 'Projected', 'Growth', 'TL Status', '7-Day Total', 'Stock VC4', 'Stock NVC4', 'Stock Total', 'VC4 Stock Days', 'Stock Alert (VC4)', 'Priority (VC4)', 'NVC4 Stock Days', 'Alert (NVC4)', 'Priority (NVC4)'];
      const rows = sorted.map((g) => [g.tlId, g.tlName, g.tlMobile, g.agentCount, g.activeCount, g.tlLastTotal, g.tlCurVc4, g.tlCurNvc4, g.tlCurTotal, g.tlAvgTotal, g.tlProjected, g.tlGrowth, g.tlStatus, g.weekTotal, g.tlStockVc4, g.tlStockNvc4, g.tlStockTotal, g.tlVc4Days, g.tlStockAlert, g.tlPriority, g.tlNvc4Days, g.tlCommAlert, g.tlCommPriority]);
      downloadCsv(`tl-summary-${new Date().toISOString().slice(0, 10)}.csv`, header, rows);
      toast(`Exported ${sorted.length} TLs`);
    };
  }

  // ----- Alerts -----
  function alertBuckets() {
    const groups = state.tlGroups;
    const isLow = (t) => /risk|critical|low stock|urgent|out of stock|reorder/i.test(clean(t)) && !/stock ok/i.test(clean(t));
    const isOver = (t) => /over ?stock|high stock/i.test(clean(t));
    // Only TLs that are actually issuing this month; NVC4 risk counts only when the TL issues commercial tags.
    const lowStock = groups.filter((g) => (g.tlCurTotal || 0) > 0 && (isLow(g.tlStockAlert) || (isLow(g.tlCommAlert) && (g.tlCurNvc4 || 0) > 0))).sort((a, b) => (a.tlVc4Days ?? 9999) - (b.tlVc4Days ?? 9999));
    const overStock = groups.filter((g) => isOver(g.tlStockAlert)).sort((a, b) => (b.tlVc4Days ?? 0) - (a.tlVc4Days ?? 0));
    const dropped = state.filtered.filter((a) => a.lastTotal > 0 && (a.inactiveDays >= 3)).sort((a, b) => b.lastTotal - a.lastTotal);
    const deGrowth = state.filtered.filter((a) => /de-?growth/i.test(a.agentStatus || '')).sort((a, b) => (b.lastTotal - (b.curProjected || 0)) - (a.lastTotal - (a.curProjected || 0)));
    const wrongVrn = state.filtered.filter((a) => (a.wrongVrn || 0) > 0).sort((a, b) => b.wrongVrn - a.wrongVrn);
    return { lowStock, overStock, dropped, deGrowth, wrongVrn, total: lowStock.length + overStock.length + deGrowth.length + wrongVrn.length };
  }

  function renderAlerts() {
    const b = alertBuckets();
    const cap = 100;
    const tlRows = (list, extra) => list.slice(0, cap).map((g) => `<tr data-tl="${esc(g.tlKey)}">
        <td class="sticky-col"><div class="rp-cell-main">${esc(g.tlName || g.tlKey)}</div><span class="rp-cell-sub">${esc(g.tlId || '')}${g.tlMobile && !/^na$/i.test(g.tlMobile) ? ` · ${esc(g.tlMobile)}` : ''}</span></td>
        <td class="num">${fmt(g.tlStockVc4)} <small class="dim">/ ${fmt(g.tlStockNvc4)}</small></td>
        <td class="num">${fmt(g.tlAvgTotal, true)}</td>
        <td class="num strong">${fmt(g.tlVc4Days)}</td>
        <td class="num">${fmt(g.tlNvc4Days)}</td>
        <td>${badge(g.tlStockAlert)}</td>
        <td>${badge(g.tlCommAlert)}</td>
        <td>${badge(extra(g))}</td>
      </tr>`).join('');
    const agentRows = (list, valueLabel, valueFn) => list.slice(0, cap).map((a) => `<tr data-row="${a.__row}">
        <td class="sticky-col"><div class="rp-cell-main">${esc(a.name)}</div><span class="rp-cell-sub">${esc(a.agentId || '')}</span></td>
        <td><div class="rp-cell-main">${esc(a.tlName)}</div><span class="rp-cell-sub">${a.tlMobile && !/^na$/i.test(a.tlMobile) ? esc(a.tlMobile) : ''}</span></td>
        <td class="num">${fmt(a.lastTotal)}</td>
        <td class="num">${fmt(a.curTotal)}</td>
        <td class="num strong">${valueFn(a)}</td>
        <td>${badge(a.lastActive)}</td>
        <td>${badge(a.agentStatus)}</td>
      </tr>`).join('');
    const note = (list) => (list.length > cap ? `<div class="rp-alert-note">Showing first ${cap} of ${list.length}. Use the Agents tab filters for the full list.</div>` : '');
    const tlHead = (extraLabel) => `<thead><tr><th class="sticky-col">TL</th><th class="num">Stock VC4 / NVC4</th><th class="num">Avg/day</th><th class="num">VC4 days</th><th class="num">NVC4 days</th><th>Alert (VC4)</th><th>Alert (NVC4)</th><th>${extraLabel}</th></tr></thead>`;
    const agentHead = (valueLabel) => `<thead><tr><th class="sticky-col">Agent</th><th>TL</th><th class="num">${esc(state.months.last.slice(0, 3))}</th><th class="num">${esc(state.months.cur.slice(0, 3))}</th><th class="num">${valueLabel}</th><th>Last active</th><th>Status</th></tr></thead>`;
    const card = (title, count, tone, body, sub) => `<section class="rp-card rp-alert-card span-12">
        <div class="rp-card-head"><div class="rp-alert-title"><h3>${title}</h3><span class="rp-count ${tone}">${fmtInt.format(count)}</span></div><small>${sub || ''}</small></div>
        ${count ? body : '<div class="rp-empty">Sab theek hai — koi entry nahi.</div>'}
      </section>`;

    $('view-alerts').innerHTML = `<div class="rp-grid">
      ${card('Dispatch needed · TL stock risk', b.lowStock.length, 'rp-count-warn', `<div class="rp-table-wrap"><table class="rp-table">${tlHead('Priority')}<tbody>${tlRows(b.lowStock, (g) => g.tlPriority)}</tbody></table></div>${note(b.lowStock)}`, 'Active TLs whose VC4 (or NVC4, if they issue commercial) stock alert shows risk')}
      ${card('Over-stocked TLs', b.overStock.length, '', `<div class="rp-table-wrap"><table class="rp-table">${tlHead('TL status')}<tbody>${tlRows(b.overStock, (g) => g.tlStatus)}</tbody></table></div>${note(b.overStock)}`, 'Stock covers more days than needed — hold dispatch')}
      ${card('De-growth agents', b.deGrowth.length, 'rp-count-warn', `<div class="rp-table-wrap"><table class="rp-table">${agentHead('Projected')}<tbody>${agentRows(b.deGrowth, 'Projected', (a) => fmt(a.curProjected))}</tbody></table></div>${note(b.deGrowth)}`, `Status contains "De-Growth" · sorted by biggest drop vs ${esc(state.months.last)}`)}
      ${card(`Went quiet · issued in ${esc(state.months.last)}, inactive 3+ days`, b.dropped.length, '', `<div class="rp-table-wrap"><table class="rp-table">${agentHead('Inactive days')}<tbody>${agentRows(b.dropped, 'Inactive days', (a) => (a.inactiveDays >= 99 ? 'Month' : String(a.inactiveDays)))}</tbody></table></div>${note(b.dropped)}`, 'Follow-up list for TLs')}
      ${card('Wrong VRN entries', b.wrongVrn.length, '', `<div class="rp-table-wrap"><table class="rp-table">${agentHead('Wrong VRN')}<tbody>${agentRows(b.wrongVrn, 'Wrong VRN', (a) => fmt(a.wrongVrn))}</tbody></table></div>${note(b.wrongVrn)}`, 'Agents with wrong vehicle numbers this month')}
    </div>`;
    $('view-alerts').querySelectorAll('tr[data-row]').forEach((tr) => tr.addEventListener('click', () => openAgent(Number(tr.dataset.row))));
    $('view-alerts').querySelectorAll('tr[data-tl]').forEach((tr) => tr.addEventListener('click', () => openTl(tr.dataset.tl)));
  }

  // ----- Drawer -----
  function openDrawer() {
    $('rp-drawer').classList.add('open');
    $('rp-drawer').setAttribute('aria-hidden', 'false');
    $('rp-drawer-backdrop').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    $('rp-drawer').classList.remove('open');
    $('rp-drawer').setAttribute('aria-hidden', 'true');
    $('rp-drawer-backdrop').hidden = true;
    document.body.style.overflow = '';
  }

  function valueHtml(col, agent) {
    const raw = clean(agent.raw[col.index]);
    if (col.type === 'badge') return badge(raw);
    if (col.type === 'pct') return trend(raw);
    if (col.type === 'num') return `<b>${fmt(raw, /avg|day/i.test(col.label) && !/days/i.test(col.label))}</b>`;
    return `<b>${esc(raw || '—')}</b>`;
  }

  function openAgent(rowIndex) {
    const agent = state.agents.find((a) => a.__row === rowIndex);
    if (!agent) return;
    $('drawer-kicker').textContent = agent.isMaster ? 'Master account' : 'Agent';
    $('drawer-title').textContent = agent.name || agent.agentId || '—';
    $('drawer-sub').innerHTML = `<span>ID ${esc(agent.agentId || '—')}</span><span>TL ${esc(agent.tlName || '—')}${agent.tlId ? ` (${esc(agent.tlId)})` : ''}</span>${agent.tlMobile && !/^na$/i.test(agent.tlMobile) ? `<a href="tel:${esc(agent.tlMobile)}">📞 ${esc(agent.tlMobile)}</a>` : ''}`;
    const summary = `<div class="rp-dsec"><div class="rp-dgrid">
        <div class="rp-drow"><span>${esc(state.months.cur)} total</span><b>${fmt(agent.curTotal)}</b></div>
        <div class="rp-drow"><span>${esc(state.months.last)} total</span><b>${fmt(agent.lastTotal)}</b></div>
        <div class="rp-drow"><span>Growth</span>${trend(agent.growth)}</div>
        <div class="rp-drow"><span>Status</span>${badge(agent.agentStatus)}</div>
        <div class="rp-drow"><span>Last active</span>${badge(agent.lastActive)}</div>
        <div class="rp-drow"><span>Projected</span><b>${fmt(agent.curProjected)}</b></div>
      </div></div>`;
    const sections = state.sections.filter((s) => !['profile'].includes(s.key)).map((section) => {
      if (section.key === 'week') {
        const days = agent.week.map((v, i) => `<div class="rp-dday ${v ? '' : 'zero'}"><small>${esc(state.dayLabels[i])}</small><b>${fmtInt.format(v)}</b></div>`).join('');
        return `<div class="rp-dsec"><h4>${esc(section.title)} · total ${fmtInt.format(agent.weekTotal)}</h4><div class="rp-dweek">${days}</div>
          <div class="rp-dgrid" style="margin-top:8px"><div class="rp-drow"><span>${esc(section.cols[0].label)}</span><b>${fmt(agent.activeDays)}</b></div></div></div>`;
      }
      const rows = section.cols.map((col) => `<div class="rp-drow"><span class="${col.unknown ? 'unknown' : ''}" title="${col.unknown ? 'Sheet mein is column ka sub-header khali hai (column ' + col.letter + ')' : 'Sheet column ' + col.letter}">${esc(col.label)}</span>${valueHtml(col, agent)}</div>`).join('');
      return `<div class="rp-dsec"><h4>${esc(section.title)}</h4><div class="rp-dgrid">${rows}</div></div>`;
    }).join('');
    $('drawer-body').innerHTML = summary + sections;
    openDrawer();
  }

  function openTl(tlKey) {
    const group = state.tlGroups.find((g) => g.tlKey === tlKey) || buildTlGroups(state.agents.filter((a) => a.tlKey === tlKey))[0];
    if (!group) return;
    $('drawer-kicker').textContent = 'Team Leader';
    $('drawer-title').textContent = group.tlName || group.tlKey;
    $('drawer-sub').innerHTML = `<span>ID ${esc(group.tlId || group.tlKey)}</span>${group.tlMobile && !/^na$/i.test(group.tlMobile) ? `<a href="tel:${esc(group.tlMobile)}">📞 ${esc(group.tlMobile)}</a>` : ''}<span>${group.agentCount} agents · ${group.activeCount} active</span>`;
    const row = (label, html) => `<div class="rp-drow"><span>${label}</span>${html}</div>`;
    const days = group.week.map((v, i) => `<div class="rp-dday ${v ? '' : 'zero'}"><small>${esc(state.dayLabels[i])}</small><b>${fmtInt.format(v)}</b></div>`).join('');
    const agents = [...group.agents].sort((a, b) => b.curTotal - a.curTotal);
    $('drawer-body').innerHTML = `
      <div class="rp-dsec"><h4>${esc(state.months.cur)} (TL level)</h4><div class="rp-dgrid">
        ${row('Total issued', `<b>${fmt(group.tlCurTotal)}</b>`)}${row('VC4 / NVC4', `<b>${fmt(group.tlCurVc4)} / ${fmt(group.tlCurNvc4)}</b>`)}
        ${row('Daily avg', `<b>${fmt(group.tlAvgTotal, true)}</b>`)}${row('Projected', `<b>${fmt(group.tlProjected)}</b>`)}
        ${row(`${esc(state.months.last)} total`, `<b>${fmt(group.tlLastTotal)}</b>`)}${row('Growth', trend(group.tlGrowth))}
        ${row('TL status', badge(group.tlStatus))}${row('Last active', badge(group.tlLastActive))}
      </div></div>
      <div class="rp-dsec"><h4>Last 7 days (sum of agents) · ${fmtInt.format(group.weekTotal)}</h4><div class="rp-dweek">${days}</div></div>
      <div class="rp-dsec"><h4>Stock & dispatch</h4><div class="rp-dgrid">
        ${row('Stock VC4', `<b>${fmt(group.tlStockVc4)}</b>`)}${row('Stock NVC4', `<b>${fmt(group.tlStockNvc4)}</b>`)}${row('Stock total', `<b>${fmt(group.tlStockTotal)}</b>`)}
        ${row('VC4 stock days', `<b>${fmt(group.tlVc4Days)}</b>`)}${row('Stock alert (VC4)', badge(group.tlStockAlert))}${row('Priority (VC4)', badge(group.tlPriority))}
        ${row('NVC4 stock days', `<b>${fmt(group.tlNvc4Days)}</b>`)}${row('Stock alert (NVC4)', badge(group.tlCommAlert))}${row('Priority (NVC4)', badge(group.tlCommPriority))}
        ${row(`<span class="unknown" title="Sheet column ${state.columns.colBR.letter} — header khali hai">${esc(state.columns.colBR.label)}</span>`, `<b>${fmt(group.colBR)}</b>`)}
      </div></div>
      <div class="rp-dsec"><h4>Agents (${agents.length})</h4>
        <div class="rp-table-wrap rp-drawer-agents"><table class="rp-table"><thead><tr><th>Agent</th><th class="num">${esc(state.months.cur.slice(0, 3))}</th><th class="num">7d</th><th>Last active</th><th>Status</th></tr></thead>
        <tbody>${agents.map((a) => `<tr data-row="${a.__row}"><td><div class="rp-cell-main">${esc(a.name)}</div><span class="rp-cell-sub">${esc(a.agentId)}</span></td><td class="num strong">${fmt(a.curTotal)}</td><td class="num">${fmt(a.weekTotal)}</td><td>${badge(a.lastActive)}</td><td>${badge(a.agentStatus)}</td></tr>`).join('')}</tbody></table></div>
      </div>`;
    $('drawer-body').querySelectorAll('tr[data-row]').forEach((tr) => tr.addEventListener('click', () => openAgent(Number(tr.dataset.row))));
    openDrawer();
  }

  // ----- Share summary -----
  function buildSummary() {
    const k = kpiData();
    const topTls = [...state.tlGroups].sort((a, b) => (b.tlCurTotal || 0) - (a.tlCurTotal || 0)).slice(0, 5);
    const topAgents = [...state.filtered].filter((a) => !a.isMaster).sort((a, b) => b.curTotal - a.curTotal).slice(0, 5);
    const alerts = alertBuckets();
    const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const lines = [
      `*FASTag Agent Report – ${today}*${filtersActive() ? ' (filtered)' : ''}`,
      `${state.dayLabels[6] || 'Last day'}: *${fmtInt.format(k.lastDay)}* tags`,
      `Last 7 days: ${fmtInt.format(k.weekTotal)} (avg ${fmtDec.format(k.weekTotal / 7)}/day)`,
      `${state.months.cur} MTD: *${fmtInt.format(k.curTotal)}* (VC4 ${fmtInt.format(k.curVc4)} | NVC4 ${fmtInt.format(k.curNvc4)})`,
      `Projected: ${fmtInt.format(k.projected)} vs ${state.months.last} ${fmtInt.format(k.lastTotal)} (${k.growth === null ? '—' : fmtSigned(k.growth)})`,
      `Active agents: ${fmtInt.format(k.active)} / ${fmtInt.format(k.agents)}`,
      `Stock in field: ${fmtInt.format(k.stockTotal)} (VC4 ${fmtInt.format(k.stockVc4)})`,
      `Alerts: ${alerts.lowStock.length} TL stock risk, ${alerts.overStock.length} over-stocked, ${alerts.deGrowth.length} de-growth`,
      '',
      `*Top TLs (${state.months.cur})*`,
      ...topTls.map((g, i) => `${i + 1}. ${g.tlName || g.tlKey} – ${fmtInt.format(g.tlCurTotal || 0)}`),
      '',
      '*Top Agents*',
      ...topAgents.map((a, i) => `${i + 1}. ${a.name} – ${fmtInt.format(a.curTotal)}`)
    ];
    return lines.join('\n');
  }

  async function shareSummary() {
    const text = buildSummary();
    try { await navigator.clipboard.writeText(text); toast('Summary copied — WhatsApp khul raha hai'); }
    catch { toast('WhatsApp khul raha hai'); }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  function bindEvents() {
    let searchTimer;
    $('rp-search').addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.filters.q = e.target.value; applyFilters(); }, 160);
    });
    $('f-tl').addEventListener('change', (e) => { state.filters.tl = e.target.value; applyFilters(); });
    $('f-status').addEventListener('change', (e) => { state.filters.status = e.target.value; applyFilters(); });
    $('f-active').addEventListener('change', (e) => { state.filters.active = e.target.value; applyFilters(); });
    $('f-alert').addEventListener('change', (e) => { state.filters.alert = e.target.value; applyFilters(); });
    $('f-device').addEventListener('change', (e) => { state.filters.device = e.target.value; applyFilters(); });
    $('f-hidezero').addEventListener('change', (e) => { state.filters.hideZero = e.target.checked; applyFilters(); });
    $('f-clear').addEventListener('click', clearFilters);
    $('agents-pagesize').addEventListener('change', (e) => { state.pageSize = e.target.value === 'all' ? 'all' : Number(e.target.value); state.page = 1; renderAgents(); });
    document.querySelectorAll('.rp-tab').forEach((tab) => tab.addEventListener('click', () => setView(tab.dataset.view)));
    $('rp-refresh').addEventListener('click', () => load({ force: true, silent: true }));
    $('rp-retry').addEventListener('click', () => load({ force: true }));
    $('rp-share').addEventListener('click', shareSummary);
    $('drawer-close').addEventListener('click', closeDrawer);
    $('rp-drawer-backdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.loaded && Date.now() - state.meta.fetchedAt > AUTO_REFRESH_MS) load({ silent: true });
    });
  }

  function init() {
    readHash();
    $('rp-open-sheet').href = SHEET_VIEW_URL;
    bindEvents();
    document.querySelectorAll('.rp-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === state.view));
    load();
    state.refreshTimer = setInterval(() => { if (document.visibilityState === 'visible') load({ silent: true }); }, AUTO_REFRESH_MS);
  }

  init();
})();
