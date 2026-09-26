/* Performance page: agent & TL performance from the REPORT tab (stock + last/current month issuance + status). */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, D = FF.data, C = FF.charts;
  const esc = U.esc, clean = U.clean, num = U.num;

  // Columns whose sub-header is blank in the sheet (verified against StockDataa TAG_CLASS totals).
  const LABEL_OVERRIDES = { stockC1: 'VC5', stockC2: 'VC6', stockC3: 'VC7', stockC4: 'VC12', stockC5: 'VC16', colAB: '', curC1: 'VC5', curC2: 'VC6', curC3: 'VC7', curC4: 'VC12', curC5: 'VC16', colBR: '' };
  const SCHEMA = [
    { key: 'profile', title: 'Agent Profile', match: /agent profile/i, fixed: 0, cols: [{ key: 'agentId', label: 'Agent ID' }, { key: 'id', label: 'ID' }, { key: 'name', label: 'Agent Name' }] },
    { key: 'tl', title: 'TL Master Data', match: /tl'?s master data/i, fixed: 3, cols: [{ key: 'gvIdFound', label: 'GV ID Found' }, { key: 'tlId', label: 'TL ID' }, { key: 'tlMobile', label: 'TL Mobile' }, { key: 'tlName', label: 'TL Name' }] },
    { key: 'stock', title: 'Agent Inventory (Stock)', match: /agent inventory summary/i, fixed: 7, cols: [{ key: 'stockVc4', label: 'VC4 Stock', type: 'num' }, { key: 'stockC1', label: null, type: 'num' }, { key: 'stockC2', label: null, type: 'num' }, { key: 'stockC3', label: null, type: 'num' }, { key: 'stockC4', label: null, type: 'num' }, { key: 'stockC5', label: null, type: 'num' }, { key: 'stockTotal', label: 'Total Stock', type: 'num' }, { key: 'stockNvc4', label: 'NVC4 Stock', type: 'num' }] },
    { key: 'dispatchVc4', title: 'Fastag Dispatch (VC4) · TL level', match: /dispatch details \(vc4\)/i, fixed: 15, cols: [{ key: 'tlVc4Days', label: 'TL VC4 Stock Days', type: 'num' }, { key: 'tlProjectedB', label: 'TL Projected Issuance', type: 'num' }, { key: 'tlPriority', label: 'Dispatch Priority', type: 'badge' }, { key: 'tlStockAlert', label: 'Stock Alert', type: 'badge' }] },
    { key: 'tlStock', title: 'TL Stock', match: /tl'?s stock details/i, fixed: 19, cols: [{ key: 'tlStockVc4', label: 'TL VC4 Stock', type: 'num' }, { key: 'tlStockNvc4', label: 'TL NVC4 Stock', type: 'num' }, { key: 'tlStockTotal', label: 'TL Total Stock', type: 'num' }] },
    { key: 'lastMonth', title: 'Last Month', match: /performance in\s*-/i, occurrence: 0, fixed: 22, month: true, cols: [{ key: 'lastActiveDays', label: 'Active Days', type: 'num' }, { key: 'lastVc4', label: 'VC4 Issued', type: 'num' }, { key: 'lastNvc4', label: 'NVC4 Issued', type: 'num' }, { key: 'lastTotal', label: 'Total Issued', type: 'num' }] },
    { key: 'curMonth', title: 'Current Month', match: /performance in\s*-/i, occurrence: 1, fixed: 26, month: true, cols: [{ key: 'wrongVrn', label: 'Wrong VRN', type: 'num' }, { key: 'colAB', label: null, type: 'num' }, { key: 'curVc4', label: 'VC4 Issued', type: 'num' }, { key: 'curC1', label: null, type: 'num' }, { key: 'curC2', label: null, type: 'num' }, { key: 'curC3', label: null, type: 'num' }, { key: 'curC4', label: null, type: 'num' }, { key: 'curC5', label: null, type: 'num' }, { key: 'curNvc4', label: 'NVC4 Issued', type: 'num' }, { key: 'curTotal', label: 'Total Issued', type: 'num' }, { key: 'curProjected', label: 'Projected (month end)', type: 'num' }, { key: 'avgVc4', label: 'VC4 / Active Day', type: 'num' }, { key: 'avgNvc4', label: 'NVC4 / Active Day', type: 'num' }, { key: 'avgTotal', label: 'Daily Avg (Total)', type: 'num' }] },
    { key: 'status', title: 'Agent Performance Status', match: /agents? performance status/i, fixed: 40, cols: [{ key: 'growth', label: 'Last vs Current', type: 'pct' }, { key: 'lastActive', label: 'Last Active', type: 'badge' }, { key: 'agentStatus', label: 'Agent Status', type: 'badge' }] },
    { key: 'week', title: 'Last 7 Days', match: /performance in 7 days/i, fixed: 43, cols: [{ key: 'activeDays', label: 'Active Days (month)', type: 'num' }, { key: 'd1', label: '@header', type: 'num' }, { key: 'd2', label: '@header', type: 'num' }, { key: 'd3', label: '@header', type: 'num' }, { key: 'd4', label: '@header', type: 'num' }, { key: 'd5', label: '@header', type: 'num' }, { key: 'd6', label: '@header', type: 'num' }, { key: 'd7', label: '@header', type: 'num' }] },
    { key: 'tlLast', title: 'TL · Last Month Issued', match: /tl'?s last month issued/i, fixed: 51, cols: [{ key: 'tlLastVc4', label: 'VC4', type: 'num' }, { key: 'tlLastNvc4', label: 'NVC4', type: 'num' }, { key: 'tlLastTotal', label: 'Total', type: 'num' }, { key: 'tlLastAvg', label: 'Daily Avg', type: 'num' }] },
    { key: 'tlCur', title: 'TL · Current Month Issuance', match: /tl'?s current month issuance/i, fixed: 55, cols: [{ key: 'tlCurVc4', label: 'VC4', type: 'num' }, { key: 'tlCurNvc4', label: 'NVC4', type: 'num' }, { key: 'tlCurTotal', label: 'Total', type: 'num' }, { key: 'tlAvgVc4', label: 'VC4 / Day', type: 'num' }, { key: 'tlAvgNvc4', label: 'NVC4 / Day', type: 'num' }, { key: 'tlAvgTotal', label: 'Daily Avg (Total)', type: 'num' }] },
    { key: 'tlStatus', title: 'TL Performance Status', match: /tl'?s performance status/i, fixed: 61, cols: [{ key: 'tlGrowth', label: 'Last vs Current', type: 'pct' }, { key: 'tlLastActive', label: 'Last Active', type: 'badge' }, { key: 'tlStatus', label: 'TL Status', type: 'badge' }, { key: 'tlProjected', label: 'Projected (month end)', type: 'num' }] },
    { key: 'agentWise', title: 'Agent Wise (Dispatch)', match: /^agent wise/i, fixed: 65, cols: [{ key: 'agentAvg', label: 'Daily Avg', type: 'num' }, { key: 'agentStockDays', label: 'Stock Days (VC4)', type: 'num' }, { key: 'agentPriority', label: 'Priority Level', type: 'badge' }] },
    { key: 'dispatchComm', title: 'Fastag Dispatch (Commercial) · TL level', match: /dispatch details \(commercial\)/i, fixed: 68, cols: [{ key: 'tlNvc4Days', label: 'TL NVC4 Stock Days', type: 'num' }, { key: 'colBR', label: null, type: 'num' }, { key: 'tlCommPriority', label: 'Priority Level', type: 'badge' }, { key: 'tlCommAlert', label: 'Stock Alert', type: 'badge' }] },
    { key: 'device', title: 'Device', match: /^device/i, fixed: 72, cols: [{ key: 'biometric', label: 'Biometric Device' }] },
    { key: 'gvStock', title: 'GV Stock', match: /^gv stock/i, fixed: 73, cols: [{ key: 'gvStockVc4', label: 'VC4', type: 'num' }, { key: 'gvStockNvc4', label: 'NVC4', type: 'num' }] },
    { key: 'gvLast', title: 'GV Issuance · Last Month', match: /gv issuance last month/i, fixed: 75, cols: [{ key: 'gvLast', label: 'Total', type: 'num' }] },
    { key: 'gvCur', title: 'GV Issuance · Current Month', match: /gv issuance current month/i, fixed: 76, cols: [{ key: 'gvCur', label: 'Total', type: 'num' }] }
  ];

  const state = {
    agents: [], filtered: [], tlGroups: [], columns: {}, sections: [], months: { last: 'Last Month', cur: 'Current Month' }, dayLabels: [], daysElapsed: null,
    view: 'overview', filters: { q: '', tl: '', status: '', active: '', alert: '', hideZero: false },
    sort: { agents: { key: 'curTotal', dir: 'desc' }, tls: { key: 'tlCurTotal', dir: 'desc' } }, page: 1, pageSize: 50, loadedAt: 0
  };

  // ---- helpers ------------------------------------------------------------------
  function pct(value) {
    if (value === null || value === undefined || value === '') return null;
    const m = String(value).match(/[-+]?\d+(?:\.\d+)?/);
    if (!m) return null;
    let n = Number(m[0]);
    if (/▼/.test(String(value)) && n > 0) n = -n;
    return n;
  }
  function stripEmoji(text) { return clean(text).replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}▲▼\s]+/u, '').trim(); }
  function tone(text) {
    const t = clean(text);
    if (!t) return 'gray';
    if (/🚀|🟢|▲/.test(t)) return 'green';
    if (/🟡/.test(t)) return 'amber';
    if (/🟠/.test(t)) return 'orange';
    if (/🔴|🔻|▼/.test(t)) return 'red';
    if (/not found/i.test(t)) return 'gray';
    if (/inactive|de-?growth|risk|critical|urgent/i.test(t)) return 'red';
    if (/growth|ok|active|yes/i.test(t)) return 'green';
    return 'gray';
  }
  function badge(text) {
    const t = clean(text);
    if (!t) return '<span class="dim">—</span>';
    return `<span class="badge ${tone(t)}" title="${esc(t)}">${esc(stripEmoji(t) || t)}</span>`;
  }
  function trend(text) {
    const n = pct(text);
    return n === null ? '<span class="dim">—</span>' : U.deltaHtml(n, { decimals: 0 });
  }
  const fmt = (v, dec) => U.fmt(v, dec ? 1 : 0);

  // ---- ingest -------------------------------------------------------------------
  function resolveSchema(sectionRow, subRow) {
    const found = {}, positions = {};
    SCHEMA.forEach((section) => {
      const matches = [];
      sectionRow.forEach((cell, index) => { if (section.match.test(clean(cell))) matches.push(index); });
      const start = matches[section.occurrence || 0] !== undefined ? matches[section.occurrence || 0] : section.fixed;
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
        let label = col.label, unknown = false;
        if (label === '@header') label = clean(subRow[index]) || `Day ${offset}`;
        if (label === null) { const o = clean(LABEL_OVERRIDES[col.key]); if (o) label = o; else { label = `Column ${U.colLetter(index)}`; unknown = true; } }
        const resolved = { key: col.key, index, label, type: col.type || 'text', unknown, section: section.key, letter: U.colLetter(index) };
        found[col.key] = resolved;
        return resolved;
      });
      return { key: section.key, title: section.month ? `${section.title} (${section.key === 'lastMonth' ? state.months.last : state.months.cur})` : section.title, cols };
    });
    state.columns = found;
    state.dayLabels = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((k) => found[k].label);
    const dayMatch = (state.dayLabels[6] || '').match(/(\d{1,2})/);
    state.daysElapsed = dayMatch ? Number(dayMatch[1]) : null;
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
  function buildAgents(rows, dataStart) {
    const c = state.columns, agents = [];
    for (let r = dataStart; r < rows.length; r++) {
      const raw = rows[r];
      const get = (key) => clean(raw[c[key].index]);
      if (!get('agentId') && !get('name') && !get('id')) continue;
      if (!get('agentId') && /^(grand\s*)?total$/i.test(get('name') || get('id'))) continue; // totals row
      const agent = { raw, __row: r };
      Object.values(c).forEach((col) => {
        const text = clean(raw[col.index]);
        if (col.type === 'num') agent[col.key] = num(text);
        else if (col.type === 'pct') { agent[col.key] = text; agent[col.key + 'Num'] = pct(text); }
        else agent[col.key] = text;
      });
      agent.week = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'].map((k) => agent[k] || 0);
      agent.weekTotal = agent.week.reduce((a, b) => a + b, 0);
      agent.curTotal = agent.curTotal ?? 0; agent.lastTotal = agent.lastTotal ?? 0;
      agent.hasIssuance = agent.curTotal > 0;
      agent.tlKey = agent.tlId && !/^na$/i.test(agent.tlId) ? agent.tlId : (agent.tlName || 'Unknown');
      agent.isMaster = Boolean(agent.agentId) && agent.agentId === agent.tlId && /apna\s*paye?ment/i.test(agent.name);
      agent.activeCat = activeCategory(agent.lastActive);
      agent.inactiveDays = inactiveDays(agent.lastActive);
      agent.searchText = [agent.name, agent.agentId, agent.id, agent.gvIdFound, agent.tlName, agent.tlId, agent.tlMobile].join(' ').toLowerCase();
      agents.push(agent);
    }
    return agents;
  }
  function buildTlGroups(agents) {
    const map = new Map();
    agents.forEach((agent) => {
      let g = map.get(agent.tlKey);
      if (!g) { g = { tlKey: agent.tlKey, tlId: agent.tlId, tlName: agent.tlName, tlMobile: agent.tlMobile, agents: [], week: [0, 0, 0, 0, 0, 0, 0], source: null }; map.set(agent.tlKey, g); }
      g.agents.push(agent);
      agent.week.forEach((v, i) => { g.week[i] += v; });
      if (!g.source || (g.source.tlCurTotal == null && agent.tlCurTotal != null)) g.source = agent;
      if (!g.tlName && agent.tlName) g.tlName = agent.tlName;
      if (!g.tlMobile && agent.tlMobile) g.tlMobile = agent.tlMobile;
    });
    const keys = ['tlStockVc4', 'tlStockNvc4', 'tlStockTotal', 'tlVc4Days', 'tlProjectedB', 'tlPriority', 'tlStockAlert', 'tlLastVc4', 'tlLastNvc4', 'tlLastTotal', 'tlLastAvg', 'tlCurVc4', 'tlCurNvc4', 'tlCurTotal', 'tlAvgVc4', 'tlAvgNvc4', 'tlAvgTotal', 'tlGrowth', 'tlGrowthNum', 'tlLastActive', 'tlStatus', 'tlProjected', 'tlNvc4Days', 'tlCommPriority', 'tlCommAlert'];
    return [...map.values()].map((g) => {
      keys.forEach((k) => { g[k] = g.source ? g.source[k] : null; });
      g.agentCount = g.agents.length; g.activeCount = g.agents.filter((a) => a.hasIssuance).length;
      g.weekTotal = g.week.reduce((a, b) => a + b, 0);
      g.searchText = [g.tlName, g.tlId, g.tlMobile].join(' ').toLowerCase();
      return g;
    });
  }
  async function load(fresh) {
    const table = await D.query(FF.config.report.sheet, '', { fresh, gid: FF.config.report.gid });
    const rows = D.textRows(table);
    if (table.headers > 0) rows.unshift(table.cols.map((c) => c.label || ''));
    let idx = -1;
    for (let i = 0; i < Math.min(rows.length, 8); i++) if (rows[i].some((cell) => /agent profile/i.test(cell))) { idx = i; break; }
    if (idx < 0) throw new Error('REPORT tab ka header (Agent Profile Details…) nahi mila — sheet structure badal gayi?');
    resolveSchema(rows[idx], rows[idx + 1] || []);
    state.agents = buildAgents(rows, idx + 2);
    if (!state.agents.length) throw new Error('REPORT me koi agent row nahi mili.');
    state.loadedAt = Date.now();
  }

  // ---- filters / kpis -------------------------------------------------------------
  function applyFilters() {
    const f = state.filters, q = f.q.trim().toLowerCase();
    state.filtered = state.agents.filter((a) => !(q && !a.searchText.includes(q)) && !(f.tl && a.tlKey !== f.tl) && !(f.status && (a.agentStatus || '(blank)') !== f.status) && !(f.active && a.activeCat !== f.active) && !(f.alert && (a.tlStockAlert || '(blank)') !== f.alert) && !(f.hideZero && !a.hasIssuance));
    state.tlGroups = buildTlGroups(state.filtered);
    state.page = 1;
  }
  const filtersActive = () => { const f = state.filters; return Boolean(f.q || f.tl || f.status || f.active || f.alert || f.hideZero); };
  function countBy(list, getter) { const m = new Map(); list.forEach((i) => { const k = getter(i); m.set(k, (m.get(k) || 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); }
  function kpiData() {
    const list = state.filtered;
    const k = { agents: list.length, active: list.filter((a) => a.hasIssuance).length, curTotal: U.sum(list, (a) => a.curTotal), curVc4: U.sum(list, (a) => a.curVc4), curNvc4: U.sum(list, (a) => a.curNvc4), lastTotal: U.sum(list, (a) => a.lastTotal), projected: U.sum(list, (a) => a.curProjected), stockTotal: U.sum(list, (a) => a.stockTotal), stockVc4: U.sum(list, (a) => a.stockVc4), stockNvc4: U.sum(list, (a) => a.stockNvc4), wrongVrn: U.sum(list, (a) => a.wrongVrn), week: [0, 0, 0, 0, 0, 0, 0] };
    list.forEach((a) => a.week.forEach((v, i) => { k.week[i] += v; }));
    k.weekTotal = k.week.reduce((a, b) => a + b, 0); k.lastDay = k.week[6];
    k.growth = k.lastTotal > 0 ? (k.projected / k.lastTotal - 1) * 100 : null;
    k.dailyAvg = state.daysElapsed ? k.curTotal / state.daysElapsed : null;
    return k;
  }
  function alertBuckets() {
    const groups = state.tlGroups;
    const isLow = (t) => /risk|critical|low stock|urgent|out of stock|reorder/i.test(clean(t)) && !/stock ok/i.test(clean(t));
    const isOver = (t) => /over ?stock|high stock/i.test(clean(t));
    const lowStock = groups.filter((g) => (g.tlCurTotal || 0) > 0 && (isLow(g.tlStockAlert) || (isLow(g.tlCommAlert) && (g.tlCurNvc4 || 0) > 0))).sort((a, b) => (a.tlVc4Days ?? 9999) - (b.tlVc4Days ?? 9999));
    const overStock = groups.filter((g) => isOver(g.tlStockAlert)).sort((a, b) => (b.tlVc4Days ?? 0) - (a.tlVc4Days ?? 0));
    const dropped = state.filtered.filter((a) => a.lastTotal > 0 && a.inactiveDays >= 3).sort((a, b) => b.lastTotal - a.lastTotal);
    const deGrowth = state.filtered.filter((a) => /de-?growth/i.test(a.agentStatus || '')).sort((a, b) => (b.lastTotal - (b.curProjected || 0)) - (a.lastTotal - (a.curProjected || 0)));
    const wrongVrn = state.filtered.filter((a) => (a.wrongVrn || 0) > 0).sort((a, b) => b.wrongVrn - a.wrongVrn);
    return { lowStock, overStock, dropped, deGrowth, wrongVrn, total: lowStock.length + overStock.length + deGrowth.length + wrongVrn.length };
  }

  // ---- table helpers ------------------------------------------------------------------
  const cellMain = (main, sub) => `<div class="cell-main" title="${esc(main)}">${esc(main || '—')}</div>${sub ? `<span class="cell-sub">${esc(sub)}</span>` : ''}`;
  const AGENT_COLUMNS = () => [
    { key: 'name', label: 'Agent', sticky: true, sortValue: (a) => a.name, render: (a) => `${cellMain(a.name, a.agentId || a.id)}${a.isMaster ? '<span class="tag">Master</span>' : ''}` },
    { key: 'tlName', label: 'TL', sortValue: (a) => a.tlName, render: (a) => cellMain(a.tlName, a.tlId) },
    { key: 'lastTotal', label: `${state.months.last.slice(0, 3)} total`, num: true, sortValue: (a) => a.lastTotal, render: (a) => fmt(a.lastTotal) },
    { key: 'curVc4', label: 'VC4', num: true, sortValue: (a) => a.curVc4, render: (a) => fmt(a.curVc4) },
    { key: 'curNvc4', label: 'NVC4', num: true, sortValue: (a) => a.curNvc4, render: (a) => fmt(a.curNvc4) },
    { key: 'curTotal', label: `${state.months.cur.slice(0, 3)} total`, num: true, strong: true, sortValue: (a) => a.curTotal, render: (a) => `<b>${fmt(a.curTotal)}</b>` },
    { key: 'curProjected', label: 'Projected', num: true, sortValue: (a) => a.curProjected, render: (a) => fmt(a.curProjected) },
    { key: 'avgTotal', label: 'Avg/day', num: true, sortValue: (a) => a.avgTotal, render: (a) => fmt(a.avgTotal, true) },
    { key: 'growth', label: 'Growth', num: true, sortValue: (a) => a.growthNum, render: (a) => trend(a.growth) },
    { key: 'weekTotal', label: '7 days', sortValue: (a) => a.weekTotal, render: (a) => `<span class="spark-wrap">${C.spark(a.week)}<b>${fmt(a.weekTotal)}</b></span>` },
    { key: 'activeDays', label: 'Active days', num: true, sortValue: (a) => a.activeDays, render: (a) => fmt(a.activeDays) },
    { key: 'lastActive', label: 'Last active', sortValue: (a) => a.inactiveDays, render: (a) => badge(a.lastActive) },
    { key: 'agentStatus', label: 'Status', sortValue: (a) => a.agentStatus, render: (a) => badge(a.agentStatus) },
    { key: 'stockTotal', label: 'Stock VC4 / total', num: true, sortValue: (a) => a.stockTotal, render: (a) => `<b>${fmt(a.stockVc4)}</b> <small class="dim">/ ${fmt(a.stockTotal)}</small>` },
    { key: 'agentStockDays', label: 'Stock days', num: true, sortValue: (a) => a.agentStockDays, render: (a) => fmt(a.agentStockDays) },
    { key: 'agentPriority', label: 'Priority', sortValue: (a) => a.agentPriority, render: (a) => badge(a.agentPriority) },
    { key: 'wrongVrn', label: 'Wrong VRN', num: true, sortValue: (a) => a.wrongVrn, render: (a) => (a.wrongVrn ? `<span class="delta down">${fmt(a.wrongVrn)}</span>` : '<span class="dim">0</span>') },
    { key: 'biometric', label: 'Device', sortValue: (a) => a.biometric, render: (a) => badge(a.biometric) }
  ];
  const TL_COLUMNS = () => [
    { key: 'tlName', label: 'Team Leader', sticky: true, sortValue: (g) => g.tlName || g.tlKey, render: (g) => cellMain(g.tlName || g.tlKey, `${g.tlId || ''}${g.tlMobile && !/^na$/i.test(g.tlMobile) ? ` · ${g.tlMobile}` : ''}`) },
    { key: 'agentCount', label: 'Agents (active)', num: true, sortValue: (g) => g.agentCount, render: (g) => `<b>${g.agentCount}</b> <small class="dim">(${g.activeCount})</small>` },
    { key: 'tlLastTotal', label: `${state.months.last.slice(0, 3)} total`, num: true, sortValue: (g) => g.tlLastTotal, render: (g) => fmt(g.tlLastTotal) },
    { key: 'tlCurVc4', label: 'VC4', num: true, sortValue: (g) => g.tlCurVc4, render: (g) => fmt(g.tlCurVc4) },
    { key: 'tlCurNvc4', label: 'NVC4', num: true, sortValue: (g) => g.tlCurNvc4, render: (g) => fmt(g.tlCurNvc4) },
    { key: 'tlCurTotal', label: `${state.months.cur.slice(0, 3)} total`, num: true, sortValue: (g) => g.tlCurTotal, render: (g) => `<b>${fmt(g.tlCurTotal)}</b>` },
    { key: 'tlAvgTotal', label: 'Avg/day', num: true, sortValue: (g) => g.tlAvgTotal, render: (g) => fmt(g.tlAvgTotal, true) },
    { key: 'tlProjected', label: 'Projected', num: true, sortValue: (g) => g.tlProjected, render: (g) => fmt(g.tlProjected) },
    { key: 'tlGrowth', label: 'Growth', num: true, sortValue: (g) => g.tlGrowthNum, render: (g) => trend(g.tlGrowth) },
    { key: 'tlStatus', label: 'TL status', sortValue: (g) => g.tlStatus, render: (g) => badge(g.tlStatus) },
    { key: 'weekTotal', label: '7 days (agents)', sortValue: (g) => g.weekTotal, render: (g) => `<span class="spark-wrap">${C.spark(g.week, '#ec4899')}<b>${fmt(g.weekTotal)}</b></span>` },
    { key: 'tlStockVc4', label: 'Stock VC4 / NVC4', num: true, sortValue: (g) => g.tlStockVc4, render: (g) => `<b>${fmt(g.tlStockVc4)}</b> <small class="dim">/ ${fmt(g.tlStockNvc4)}</small>` },
    { key: 'tlVc4Days', label: 'VC4 stock days', num: true, sortValue: (g) => g.tlVc4Days, render: (g) => fmt(g.tlVc4Days) },
    { key: 'tlStockAlert', label: 'Stock alert (VC4)', sortValue: (g) => g.tlStockAlert, render: (g) => badge(g.tlStockAlert) },
    { key: 'tlPriority', label: 'Priority (VC4)', sortValue: (g) => g.tlPriority, render: (g) => badge(g.tlPriority) },
    { key: 'tlNvc4Days', label: 'NVC4 stock days', num: true, sortValue: (g) => g.tlNvc4Days, render: (g) => fmt(g.tlNvc4Days) },
    { key: 'tlCommAlert', label: 'Alert (NVC4)', sortValue: (g) => g.tlCommAlert, render: (g) => badge(g.tlCommAlert) }
  ];
  function sortList(list, columns, s) {
    const col = columns.find((c) => c.key === s.key) || columns[0];
    const dir = s.dir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = col.sortValue(a), vb = col.sortValue(b);
      const na = va === null || va === undefined || va === '', nb = vb === null || vb === undefined || vb === '';
      if (na && nb) return 0; if (na) return 1; if (nb) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
  }
  function tableHtml(columns, list, s, rowAttr) {
    return `<table class="tbl sticky-first"><thead><tr>${columns.map((c) => `<th class="sortable ${c.num ? 'num' : ''} ${s.key === c.key ? 'sorted' : ''}" data-sort="${c.key}"><span>${esc(c.label)}</span>${s.key === c.key ? `<i>${s.dir === 'asc' ? '▲' : '▼'}</i>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${list.length ? list.map((item) => `<tr ${rowAttr(item)}>${columns.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render(item)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${columns.length}" class="empty">Koi match nahi. Filters clear karke dekho.</td></tr>`}</tbody></table>`;
  }

  // ---- drawer content -------------------------------------------------------------------
  function valueHtml(col, agent) {
    const raw = clean(agent.raw[col.index]);
    if (col.type === 'badge') return badge(raw);
    if (col.type === 'pct') return trend(raw);
    if (col.type === 'num') return `<b>${fmt(raw, /avg|\/ day/i.test(col.label) && !/days/i.test(col.label))}</b>`;
    return `<b>${esc(raw || '—')}</b>`;
  }
  function openAgent(rowIndex) {
    const agent = state.agents.find((a) => a.__row === rowIndex);
    if (!agent) return;
    const row = (label, html, title) => `<div class="drow"><span title="${esc(title || '')}">${esc(label)}</span>${html}</div>`;
    const summary = `<div class="dsec"><div class="dgrid">${row(`${state.months.cur} total`, `<b>${fmt(agent.curTotal)}</b>`)}${row(`${state.months.last} total`, `<b>${fmt(agent.lastTotal)}</b>`)}${row('Growth', trend(agent.growth))}${row('Status', badge(agent.agentStatus))}${row('Last active', badge(agent.lastActive))}${row('Projected', `<b>${fmt(agent.curProjected)}</b>`)}</div></div>`;
    const sections = state.sections.filter((s) => s.key !== 'profile').map((section) => {
      if (section.key === 'week') {
        return `<div class="dsec"><h4>${esc(section.title)} · total ${fmt(agent.weekTotal)}</h4><div class="dweek">${agent.week.map((v, i) => `<div class="dday ${v ? '' : 'zero'}"><small>${esc(state.dayLabels[i])}</small><b>${fmt(v)}</b></div>`).join('')}</div><div class="dgrid">${row(section.cols[0].label, `<b>${fmt(agent.activeDays)}</b>`)}</div></div>`;
      }
      return `<div class="dsec"><h4>${esc(section.title)}</h4><div class="dgrid">${section.cols.map((col) => row(col.label, valueHtml(col, agent), `Sheet column ${col.letter}`)).join('')}</div></div>`;
    }).join('');
    FF.app.openDrawer({ kicker: agent.isMaster ? 'Master account' : 'Agent', title: agent.name || agent.agentId || '—', sub: `ID ${esc(agent.agentId || '—')} · TL ${esc(agent.tlName || '—')}${agent.tlMobile && !/^na$/i.test(agent.tlMobile) ? ` · <a href="tel:${esc(agent.tlMobile)}">📞 ${esc(agent.tlMobile)}</a>` : ''} · <a href="#/trend?agent=${encodeURIComponent(agent.name)}">📈 Trend</a>`, body: summary + sections });
  }
  function openTl(tlKey) {
    const group = state.tlGroups.find((g) => g.tlKey === tlKey) || buildTlGroups(state.agents.filter((a) => a.tlKey === tlKey))[0];
    if (!group) return;
    const row = (label, html) => `<div class="drow"><span>${label}</span>${html}</div>`;
    const agents = [...group.agents].sort((a, b) => b.curTotal - a.curTotal);
    const body = `<div class="dsec"><h4>${esc(state.months.cur)} (TL level)</h4><div class="dgrid">${row('Total issued', `<b>${fmt(group.tlCurTotal)}</b>`)}${row('VC4 / NVC4', `<b>${fmt(group.tlCurVc4)} / ${fmt(group.tlCurNvc4)}</b>`)}${row('Daily avg', `<b>${fmt(group.tlAvgTotal, true)}</b>`)}${row('Projected', `<b>${fmt(group.tlProjected)}</b>`)}${row(`${esc(state.months.last)} total`, `<b>${fmt(group.tlLastTotal)}</b>`)}${row('Growth', trend(group.tlGrowth))}${row('TL status', badge(group.tlStatus))}${row('Last active', badge(group.tlLastActive))}</div></div>
      <div class="dsec"><h4>Last 7 days (agents) · ${fmt(group.weekTotal)}</h4><div class="dweek">${group.week.map((v, i) => `<div class="dday ${v ? '' : 'zero'}"><small>${esc(state.dayLabels[i])}</small><b>${fmt(v)}</b></div>`).join('')}</div></div>
      <div class="dsec"><h4>Stock & dispatch</h4><div class="dgrid">${row('Stock VC4', `<b>${fmt(group.tlStockVc4)}</b>`)}${row('Stock NVC4', `<b>${fmt(group.tlStockNvc4)}</b>`)}${row('Stock total', `<b>${fmt(group.tlStockTotal)}</b>`)}${row('VC4 stock days', `<b>${fmt(group.tlVc4Days)}</b>`)}${row('Alert (VC4)', badge(group.tlStockAlert))}${row('Priority (VC4)', badge(group.tlPriority))}${row('NVC4 stock days', `<b>${fmt(group.tlNvc4Days)}</b>`)}${row('Alert (NVC4)', badge(group.tlCommAlert))}${row('Priority (NVC4)', badge(group.tlCommPriority))}</div></div>
      <div class="dsec"><h4>Agents (${agents.length})</h4><div class="table-wrap"><table class="tbl compact"><thead><tr><th>Agent</th><th class="num">${esc(state.months.cur.slice(0, 3))}</th><th class="num">7d</th><th>Last active</th><th>Status</th></tr></thead><tbody>${agents.map((a) => `<tr data-agent="${a.__row}" class="clickable"><td>${cellMain(a.name, a.agentId)}</td><td class="num"><b>${fmt(a.curTotal)}</b></td><td class="num">${fmt(a.weekTotal)}</td><td>${badge(a.lastActive)}</td><td>${badge(a.agentStatus)}</td></tr>`).join('')}</tbody></table></div></div>`;
    FF.app.openDrawer({ kicker: 'Team Leader', title: group.tlName || group.tlKey, sub: `ID ${esc(group.tlId || group.tlKey)}${group.tlMobile && !/^na$/i.test(group.tlMobile) ? ` · <a href="tel:${esc(group.tlMobile)}">📞 ${esc(group.tlMobile)}</a>` : ''} · ${group.agentCount} agents · ${group.activeCount} active · <a href="#/trend?tl=${encodeURIComponent(group.tlName || '')}">📈 Trend</a>`, body });
  }

  // ---- views ----------------------------------------------------------------------------
  function renderKpis(el) {
    const k = kpiData(), al = alertBuckets();
    el.innerHTML = `<div class="kpi-grid six">
      <div class="kpi g1"><div class="kpi-top"><span class="kpi-title">Agents</span><span class="kpi-icon">🧑‍💼</span></div><div class="kpi-value">${fmt(k.agents)}</div><div class="kpi-foot">Active <b>${fmt(k.active)}</b> · Inactive <b>${fmt(k.agents - k.active)}</b></div></div>
      <div class="kpi g2"><div class="kpi-top"><span class="kpi-title">${esc(state.months.cur)} issued</span><span class="kpi-icon">🏷️</span></div><div class="kpi-value">${fmt(k.curTotal)}</div><div class="kpi-foot">VC4 <b>${fmt(k.curVc4)}</b> · NVC4 <b>${fmt(k.curNvc4)}</b>${k.dailyAvg !== null ? ` · <b>${fmt(k.dailyAvg, true)}</b>/day` : ''}</div></div>
      <div class="kpi g6"><div class="kpi-top"><span class="kpi-title">Projected vs ${esc(state.months.last)}</span><span class="kpi-icon">🎯</span></div><div class="kpi-value">${fmt(k.projected)}</div><div class="kpi-foot">${esc(state.months.last)} <b>${fmt(k.lastTotal)}</b> · ${U.deltaHtml(k.growth, { decimals: 0 })}</div></div>
      <div class="kpi g5"><div class="kpi-top"><span class="kpi-title">${esc(state.dayLabels[6] || 'Last day')}</span><span class="kpi-icon">⚡</span></div><div class="kpi-value">${fmt(k.lastDay)}</div><div class="kpi-foot">7-day <b>${fmt(k.weekTotal)}</b> · avg <b>${fmt(k.weekTotal / 7, true)}</b>/day</div></div>
      <div class="kpi g9"><div class="kpi-top"><span class="kpi-title">Stock in field</span><span class="kpi-icon">📦</span></div><div class="kpi-value">${fmt(k.stockTotal)}</div><div class="kpi-foot">VC4 <b>${fmt(k.stockVc4)}</b> · NVC4 <b>${fmt(k.stockNvc4)}</b></div></div>
      <div class="kpi g8"><div class="kpi-top"><span class="kpi-title">Needs attention</span><span class="kpi-icon">🚨</span></div><div class="kpi-value">${fmt(al.total)}</div><div class="kpi-foot">TL stock <b>${al.lowStock.length + al.overStock.length}</b> · De-growth <b>${al.deGrowth.length}</b> · Wrong VRN <b>${fmt(k.wrongVrn)}</b></div></div>
    </div>`;
  }
  function distList(entries, total, filterKey) {
    if (!entries.length) return '<div class="empty">No data</div>';
    return `<div class="dist">${entries.map(([label, count, valueOverride]) => {
      const value = valueOverride !== undefined ? valueOverride : label;
      const active = state.filters[filterKey] === value;
      return `<div class="dist-row ${active ? 'on' : ''}" data-filter="${filterKey}" data-value="${esc(value)}"><div class="dist-head">${badge(label)}<b>${fmt(count)}</b></div><div class="hbar-track"><div class="hbar-fill ${tone(label)}" style="width:${total ? (count / total) * 100 : 0}%"></div></div></div>`;
    }).join('')}</div>`;
  }
  function renderOverview(el) {
    const k = kpiData();
    const topAgents = [...state.filtered].sort((a, b) => b.curTotal - a.curTotal).slice(0, 10);
    const topTls = [...state.tlGroups].sort((a, b) => (b.tlCurTotal || 0) - (a.tlCurTotal || 0)).slice(0, 10);
    const activity = [['active', 'Active'], ['inactive-7', 'Inactive 1–7 days'], ['inactive-8', 'Inactive 8+ days'], ['inactive-month', 'Inactive in month'], ['notfound', 'Not found'], ['other', 'Other']].map(([key, label]) => [label, state.filtered.filter((a) => a.activeCat === key).length, key]).filter((r) => r[1] > 0);
    el.innerHTML = `<div class="grid g-2-1">
        <section class="card"><div class="card-head"><h3>📅 Last 7 days · ${esc(state.months.cur)}</h3><div class="card-right dim">Total ${fmt(k.weekTotal)} · avg ${fmt(k.weekTotal / 7, true)}/day</div></div><div class="card-body">${C.bars({ labels: state.dayLabels, series: [{ name: 'Issued', values: k.week, color: '#6366f1' }], height: 200 })}</div></section>
        <section class="card"><div class="card-head"><h3>🚦 Agent status</h3></div><div class="card-body">${distList(countBy(state.filtered, (a) => a.agentStatus || '(blank)'), state.filtered.length, 'status')}</div></section>
      </div>
      <div class="grid g-2">
        <section class="card"><div class="card-head"><h3>⭐ Top agents · ${esc(state.months.cur)}</h3></div><div class="card-body">${C.hbars({ items: topAgents.map((a, i) => ({ label: a.name + (a.isMaster ? ' (Master)' : ''), sub: a.tlName, value: a.curTotal, color: C.PALETTE[i % C.PALETTE.length], attr: `data-agent="${a.__row}"` })), valueLabel: state.months.cur })}</div></section>
        <section class="card"><div class="card-head"><h3>🏅 Top TLs · ${esc(state.months.cur)}</h3></div><div class="card-body">${C.hbars({ items: topTls.map((g, i) => ({ label: g.tlName || g.tlKey, sub: `${g.activeCount}/${g.agentCount} active`, value: g.tlCurTotal || 0, compare: g.tlLastTotal || 0, color: C.PALETTE[(i + 4) % C.PALETTE.length], attr: `data-tl="${esc(g.tlKey)}"` })), valueLabel: state.months.cur, compareLabel: state.months.last })}</div></section>
      </div>
      <div class="grid g-2">
        <section class="card"><div class="card-head"><h3>📦 TL stock alerts (VC4)</h3><div class="card-right dim">${state.tlGroups.length} TLs</div></div><div class="card-body">${distList(countBy(state.tlGroups, (g) => g.tlStockAlert || '(blank)'), state.tlGroups.length, 'alert')}</div></section>
        <section class="card"><div class="card-head"><h3>🕒 Agent activity</h3><div class="card-right dim">Biometric device: ${fmt(state.filtered.filter((a) => /^y/i.test(a.biometric || '')).length)} yes</div></div><div class="card-body">${distList(activity, state.filtered.length, 'active')}</div></section>
      </div>`;
  }
  function renderAgents(el) {
    const columns = AGENT_COLUMNS();
    const sorted = sortList(state.filtered, columns, state.sort.agents);
    const pages = Math.max(1, Math.ceil(sorted.length / state.pageSize));
    state.page = Math.min(Math.max(1, state.page), pages);
    const slice = sorted.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    el.innerHTML = `<section class="card"><div class="card-head"><h3>Agents <span class="dim">${fmt(sorted.length)} of ${fmt(state.agents.length)}${filtersActive() ? ' · filtered' : ''}</span></h3><div class="card-right"><button class="btn small" data-act="export-agents">⬇ CSV (all columns)</button></div></div>
      <div class="table-wrap tall">${tableHtml(columns, slice, state.sort.agents, (a) => `data-agent="${a.__row}" class="clickable"`)}</div>
      <div class="pager center"><button class="btn small" data-act="page" data-page="${state.page - 1}" ${state.page <= 1 ? 'disabled' : ''}>‹ Prev</button><span>Page ${state.page} / ${pages} · ${fmt(sorted.length)} agents</span><button class="btn small" data-act="page" data-page="${state.page + 1}" ${state.page >= pages ? 'disabled' : ''}>Next ›</button><select data-act="pagesize">${[25, 50, 100, 250].map((n) => `<option value="${n}" ${n === state.pageSize ? 'selected' : ''}>${n}/page</option>`).join('')}</select></div></section>`;
    el.__sorted = sorted;
  }
  function renderTls(el) {
    const columns = TL_COLUMNS();
    const sorted = sortList(state.tlGroups, columns, state.sort.tls);
    el.innerHTML = `<section class="card"><div class="card-head"><h3>Team Leaders <span class="dim">${fmt(sorted.length)} TLs · TL-level numbers sheet se, agent counts filter ke hisaab se</span></h3><div class="card-right"><button class="btn small" data-act="export-tls">⬇ CSV</button></div></div><div class="table-wrap tall">${tableHtml(columns, sorted, state.sort.tls, (g) => `data-tl="${esc(g.tlKey)}" class="clickable"`)}</div></section>`;
    el.__sorted = sorted;
  }
  function renderAlerts(el) {
    const b = alertBuckets(), cap = 100;
    const tlRows = (list, extra) => list.slice(0, cap).map((g) => `<tr data-tl="${esc(g.tlKey)}" class="clickable"><td>${cellMain(g.tlName || g.tlKey, g.tlId)}</td><td class="num">${fmt(g.tlStockVc4)} <small class="dim">/ ${fmt(g.tlStockNvc4)}</small></td><td class="num">${fmt(g.tlAvgTotal, true)}</td><td class="num"><b>${fmt(g.tlVc4Days)}</b></td><td class="num">${fmt(g.tlNvc4Days)}</td><td>${badge(g.tlStockAlert)}</td><td>${badge(g.tlCommAlert)}</td><td>${badge(extra(g))}</td></tr>`).join('');
    const agentRows = (list, valueFn) => list.slice(0, cap).map((a) => `<tr data-agent="${a.__row}" class="clickable"><td>${cellMain(a.name, a.agentId)}</td><td>${cellMain(a.tlName, a.tlMobile && !/^na$/i.test(a.tlMobile) ? a.tlMobile : '')}</td><td class="num">${fmt(a.lastTotal)}</td><td class="num">${fmt(a.curTotal)}</td><td class="num"><b>${valueFn(a)}</b></td><td>${badge(a.lastActive)}</td><td>${badge(a.agentStatus)}</td></tr>`).join('');
    const tlHead = (x) => `<thead><tr><th>TL</th><th class="num">Stock VC4 / NVC4</th><th class="num">Avg/day</th><th class="num">VC4 days</th><th class="num">NVC4 days</th><th>Alert (VC4)</th><th>Alert (NVC4)</th><th>${x}</th></tr></thead>`;
    const agentHead = (x) => `<thead><tr><th>Agent</th><th>TL</th><th class="num">${esc(state.months.last.slice(0, 3))}</th><th class="num">${esc(state.months.cur.slice(0, 3))}</th><th class="num">${x}</th><th>Last active</th><th>Status</th></tr></thead>`;
    const card = (title, count, tone, body, sub) => `<section class="card"><div class="card-head"><h3>${title} <span class="count ${tone}">${fmt(count)}</span></h3><div class="card-right dim">${sub || ''}</div></div>${count ? `<div class="table-wrap tall">${body}</div>` : '<div class="card-body empty">Sab theek hai — koi entry nahi.</div>'}</section>`;
    el.innerHTML = `${card('🚨 Dispatch needed · TL stock risk', b.lowStock.length, 'red', `<table class="tbl">${tlHead('Priority')}<tbody>${tlRows(b.lowStock, (g) => g.tlPriority)}</tbody></table>`, 'Active TLs jinka VC4 (ya NVC4) stock alert risk dikha raha hai')}
      ${card('🧊 Over-stocked TLs', b.overStock.length, 'amber', `<table class="tbl">${tlHead('TL status')}<tbody>${tlRows(b.overStock, (g) => g.tlStatus)}</tbody></table>`, 'Stock zaroorat se zyada — dispatch hold')}
      ${card('📉 De-growth agents', b.deGrowth.length, 'red', `<table class="tbl">${agentHead('Projected')}<tbody>${agentRows(b.deGrowth, (a) => fmt(a.curProjected))}</tbody></table>`, `Status "De-Growth" · sorted by biggest drop vs ${esc(state.months.last)}`)}
      ${card(`😶 Went quiet · ${esc(state.months.last)} me issue kiya, ab 3+ din inactive`, b.dropped.length, 'amber', `<table class="tbl">${agentHead('Inactive days')}<tbody>${agentRows(b.dropped, (a) => (a.inactiveDays >= 99 ? 'Month' : String(a.inactiveDays)))}</tbody></table>`, 'TL follow-up list')}
      ${card('🔖 Wrong VRN entries', b.wrongVrn.length, 'amber', `<table class="tbl">${agentHead('Wrong VRN')}<tbody>${agentRows(b.wrongVrn, (a) => fmt(a.wrongVrn))}</tbody></table>`, 'Is month wrong vehicle numbers wale agents')}`;
  }

  // ---- page ------------------------------------------------------------------------------
  async function render(root, params, ctx) {
    const fresh = !!(ctx && ctx.fresh);
    if (params.view && ['overview', 'agents', 'tls', 'alerts'].includes(params.view)) state.view = params.view;
    if (params.tl !== undefined) state.filters.tl = params.tl;
    root.innerHTML = `<div class="page-head"><div><h1>🏆 Performance</h1><p class="sub" id="pf-sub">REPORT tab se agent & TL performance…</p></div>
      <div class="head-actions"><button class="btn" data-act="share">📲 WhatsApp summary</button><button class="btn primary" data-action="refresh">↻ Refresh</button><a class="btn" href="#/sheet/REPORT">Full REPORT sheet →</a></div></div>
      <div id="pf-body">${U.spinner('REPORT tab load ho raha hai…')}</div>`;
    try { if (!state.agents.length || fresh) await load(fresh); } catch (err) { U.$('#pf-body', root).innerHTML = U.errorBox(err, 'data-action="refresh"'); return; }
    if (!root.isConnected) return;
    applyFilters();
    const body = U.$('#pf-body', root);
    U.$('#pf-sub', root).textContent = `${state.months.cur} report · ${state.agents.length} agents · loaded ${U.timeLabel(state.loadedAt)}`;
    const tlOpts = () => { const m = new Map(); state.agents.forEach((a) => { const e = m.get(a.tlKey) || { key: a.tlKey, name: a.tlName || a.tlKey, count: 0 }; e.count++; m.set(a.tlKey, e); }); return [...m.values()].sort((a, b) => a.name.localeCompare(b.name)); };
    body.innerHTML = `<div id="pf-kpis"></div>
      <div class="card controls"><div class="seg" id="pf-tabs">${[['overview', '🏠 Overview'], ['agents', '🧑‍💼 Agents'], ['tls', '👥 TLs'], ['alerts', '🚨 Alerts']].map(([k, l]) => `<button class="seg-btn ${state.view === k ? 'on' : ''}" data-view="${k}">${l}</button>`).join('')}</div>
        <div class="ctrl-row"><input class="input" id="pf-q" placeholder="Agent / ID / TL / mobile search…" value="${esc(state.filters.q)}">
          <label>TL <select id="pf-tl"><option value="">All TLs</option>${tlOpts().map((t) => `<option value="${esc(t.key)}" ${t.key === state.filters.tl ? 'selected' : ''}>${esc(t.name)} · ${t.count}</option>`).join('')}</select></label>
          <label>Status <select id="pf-status"><option value="">All</option>${countBy(state.agents, (a) => a.agentStatus || '(blank)').map(([v, c]) => `<option value="${esc(v)}" ${v === state.filters.status ? 'selected' : ''}>${esc(v)} · ${c}</option>`).join('')}</select></label>
          <label>Activity <select id="pf-active"><option value="">All</option>${[['active', 'Active'], ['inactive-7', 'Inactive 1–7 days'], ['inactive-8', 'Inactive 8+ days'], ['inactive-month', 'Inactive in month'], ['notfound', 'Not found']].map(([v, l]) => `<option value="${v}" ${v === state.filters.active ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Stock alert <select id="pf-alert"><option value="">All</option>${countBy(state.agents, (a) => a.tlStockAlert || '(blank)').map(([v, c]) => `<option value="${esc(v)}" ${v === state.filters.alert ? 'selected' : ''}>${esc(v)} · ${c}</option>`).join('')}</select></label>
          <label class="check"><input type="checkbox" id="pf-hidezero" ${state.filters.hideZero ? 'checked' : ''}> Hide 0-issuance</label>
          <button class="btn small" id="pf-clear">✕ Clear</button></div></div>
      <div id="pf-view"></div>`;
    const kpisEl = U.$('#pf-kpis', body), viewEl = U.$('#pf-view', body);
    const draw = () => {
      renderKpis(kpisEl);
      U.$$('#pf-tabs .seg-btn', body).forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
      if (state.view === 'overview') renderOverview(viewEl); else if (state.view === 'agents') renderAgents(viewEl); else if (state.view === 'tls') renderTls(viewEl); else renderAlerts(viewEl);
    };
    const refilter = () => { applyFilters(); draw(); };
    U.$('#pf-q', body).addEventListener('input', U.debounce((e) => { state.filters.q = e.target.value; refilter(); }, 160));
    [['pf-tl', 'tl'], ['pf-status', 'status'], ['pf-active', 'active'], ['pf-alert', 'alert']].forEach(([id, key]) => U.$(`#${id}`, body).addEventListener('change', (e) => { state.filters[key] = e.target.value; refilter(); }));
    U.$('#pf-hidezero', body).addEventListener('change', (e) => { state.filters.hideZero = e.target.checked; refilter(); });
    U.$('#pf-clear', body).addEventListener('click', () => { state.filters = { q: '', tl: '', status: '', active: '', alert: '', hideZero: false }; U.$('#pf-q', body).value = ''; ['pf-tl', 'pf-status', 'pf-active', 'pf-alert'].forEach((id) => { U.$(`#${id}`, body).value = ''; }); U.$('#pf-hidezero', body).checked = false; refilter(); });
    body.addEventListener('click', (e) => {
      const tab = e.target.closest('#pf-tabs .seg-btn');
      if (tab) { state.view = tab.dataset.view; history.replaceState(null, '', `#/performance?view=${state.view}`); draw(); return; }
      const agentEl = e.target.closest('[data-agent]');
      if (agentEl) { openAgent(Number(agentEl.dataset.agent)); return; }
      const tlEl = e.target.closest('[data-tl]');
      if (tlEl) { openTl(tlEl.dataset.tl); return; }
      const dist = e.target.closest('[data-filter]');
      if (dist) { const key = dist.dataset.filter, value = dist.dataset.value; state.filters[key] = state.filters[key] === value ? '' : value; const sel = U.$(`#pf-${key}`, body); if (sel) sel.value = state.filters[key]; state.view = key === 'alert' ? 'tls' : 'agents'; refilter(); return; }
      const th = e.target.closest('th.sortable');
      if (th) { const t = state.view === 'tls' ? 'tls' : 'agents'; const s = state.sort[t]; const cols = t === 'tls' ? TL_COLUMNS() : AGENT_COLUMNS(); if (s.key === th.dataset.sort) s.dir = s.dir === 'asc' ? 'desc' : 'asc'; else { s.key = th.dataset.sort; const col = cols.find((c) => c.key === s.key); s.dir = col && (col.num || /Total|Count/.test(s.key)) ? 'desc' : 'asc'; } draw(); return; }
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'page') { state.page = Number(act.dataset.page); draw(); viewEl.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      if (act.dataset.act === 'export-agents') { const cols = state.sections.flatMap((s) => s.cols); U.downloadCsv(`agents-report-${new Date().toISOString().slice(0, 10)}.csv`, cols.map((c) => `${c.label}${c.unknown ? ` (${c.letter})` : ''}`), (viewEl.__sorted || state.filtered).map((a) => cols.map((c) => clean(a.raw[c.index])))); U.toast('Agents CSV exported'); }
      if (act.dataset.act === 'export-tls') { const cols = TL_COLUMNS(); U.downloadCsv(`tl-summary-${new Date().toISOString().slice(0, 10)}.csv`, cols.map((c) => c.label), (viewEl.__sorted || state.tlGroups).map((g) => cols.map((c) => { const v = c.sortValue(g); return v === null || v === undefined ? '' : v; }))); U.toast('TL CSV exported'); }
      if (act.dataset.act === 'share') shareSummary();
    });
    body.addEventListener('change', (e) => { if (e.target.matches('[data-act="pagesize"]')) { state.pageSize = Number(e.target.value); state.page = 1; draw(); } });
    draw();
  }
  function shareSummary() {
    const k = kpiData(), al = alertBuckets();
    const topTls = [...state.tlGroups].sort((a, b) => (b.tlCurTotal || 0) - (a.tlCurTotal || 0)).slice(0, 5);
    const topAgents = [...state.filtered].filter((a) => !a.isMaster).sort((a, b) => b.curTotal - a.curTotal).slice(0, 5);
    const lines = [`*${FF.config.brand} – Agent Report – ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}*${filtersActive() ? ' (filtered)' : ''}`,
      `${state.dayLabels[6] || 'Last day'}: *${fmt(k.lastDay)}* tags`, `Last 7 days: ${fmt(k.weekTotal)} (avg ${fmt(k.weekTotal / 7, true)}/day)`,
      `${state.months.cur} MTD: *${fmt(k.curTotal)}* (VC4 ${fmt(k.curVc4)} | NVC4 ${fmt(k.curNvc4)})`, `Projected: ${fmt(k.projected)} vs ${state.months.last} ${fmt(k.lastTotal)} (${k.growth === null ? '—' : U.fmtSigned(k.growth, 0)})`,
      `Active agents: ${fmt(k.active)} / ${fmt(k.agents)}`, `Stock in field: ${fmt(k.stockTotal)} (VC4 ${fmt(k.stockVc4)})`, `Alerts: ${al.lowStock.length} TL stock risk, ${al.overStock.length} over-stocked, ${al.deGrowth.length} de-growth`, '',
      `*Top TLs (${state.months.cur})*`, ...topTls.map((g, i) => `${i + 1}. ${g.tlName || g.tlKey} – ${fmt(g.tlCurTotal || 0)}`), '', '*Top Agents*', ...topAgents.map((a, i) => `${i + 1}. ${a.name} – ${fmt(a.curTotal)}`)];
    const text = lines.join('\n');
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    U.toast('Summary copied — WhatsApp khul raha hai');
  }

  FF.pages.performance = { title: 'Performance', render, openAgent };
})(window.FF);
