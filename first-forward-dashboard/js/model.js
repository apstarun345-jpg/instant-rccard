/* Analytics model: aggregated views of EIR (issuance) & StockDataa (inventory) built from gviz group-by queries. */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const D = FF.data;

  const classGroup = (cls) => {
    const c = U.clean(cls).toUpperCase();
    if (c === 'VC4') return 'VC4';
    if (c === 'VC20') return 'VC20';
    return 'VC5+';
  };
  const channelOf = (masterId, tlName) => {
    const e = FF.config.eir;
    if (U.clean(masterId) === e.gvMasterId || U.clean(tlName) === e.gvChannelTl) return 'GV Partner';
    return 'First Forward';
  };

  function whereClause(filter) {
    const e = FF.config.eir;
    const parts = [`${e.date} is not null`];
    if (filter && filter.tl) parts.push(`${e.tlName} = ${D.lit(filter.tl)}`);
    if (filter && filter.agent) parts.push(`(${e.agentName} = ${D.lit(filter.agent)} or ${e.gvName} = ${D.lit(filter.agent)})`);
    if (filter && filter.channel === 'GV Partner') parts.push(`${e.masterId} is not null`);
    if (filter && filter.channel === 'First Forward') parts.push(`${e.masterId} is null`);
    return parts.join(' and ');
  }

  /** Daily rows: [{ key, d, ym, day, cls, group, type, vrnType, channel, n }] */
  async function loadDaily(filter, opts) {
    const e = FF.config.eir;
    const tq = `select ${e.date}, ${e.cls}, ${e.type}, ${e.vrnType}, ${e.masterId}, count(${e.tagId}) where ${whereClause(filter)} group by ${e.date}, ${e.cls}, ${e.type}, ${e.vrnType}, ${e.masterId} order by ${e.date}`;
    const t = await D.query(e.sheet, tq, opts);
    const rows = [];
    for (const r of t.rows) {
      const d = D.cellDate(r[0]);
      const n = D.cellNumber(r[5]);
      if (!d || !n) continue;
      const cls = D.cellText(r[1]).toUpperCase() || 'NA';
      rows.push({
        key: U.dateKey(d), d, ym: U.ymKey(d), day: d.getDate(), cls, group: classGroup(cls),
        type: D.cellText(r[2]).toUpperCase() || 'ISSUANCE', vrnType: D.cellText(r[3]),
        channel: channelOf(D.cellText(r[4]), ''), n
      });
    }
    return rows;
  }

  /** Agents by month: [{ id, name, channel, tlId, tlName, gvId, gvName, ym, n }] */
  async function loadAgents(opts) {
    const e = FF.config.eir;
    const tq = `select ${e.agentId}, ${e.agentName}, ${e.gvId}, ${e.gvName}, ${e.tlId}, ${e.tlName}, ${e.masterId}, year(${e.date}), month(${e.date}), count(${e.tagId}) where ${e.date} is not null group by ${e.agentId}, ${e.agentName}, ${e.gvId}, ${e.gvName}, ${e.tlId}, ${e.tlName}, ${e.masterId}, year(${e.date}), month(${e.date})`;
    const t = await D.query(e.sheet, tq, opts);
    const rows = [];
    for (const r of t.rows) {
      const y = D.cellNumber(r[7]), m = D.cellNumber(r[8]), n = D.cellNumber(r[9]);
      if (y === null || m === null || !n) continue;
      const agentId = D.cellText(r[0]), agentName = D.cellText(r[1]);
      const gvId = D.cellText(r[2]), gvName = D.cellText(r[3]);
      const tlName = D.cellText(r[5]);
      const channel = channelOf(D.cellText(r[6]), tlName);
      const id = agentId || gvId;
      const name = agentName || gvName || (id ? `Agent ${id}` : 'Unknown');
      rows.push({ id, name, key: `${channel}|${id}|${name}`, channel, tlId: D.cellText(r[4]), tlName: tlName || '—', gvId, gvName, ym: `${y}-${U.pad2(m + 1)}`, n });
    }
    return rows;
  }

  /** Tag status by month: [{ ym, status, n }] */
  async function loadStatus(opts) {
    const e = FF.config.eir;
    const tq = `select year(${e.date}), month(${e.date}), ${e.status}, count(${e.tagId}) where ${e.date} is not null group by year(${e.date}), month(${e.date}), ${e.status}`;
    const t = await D.query(e.sheet, tq, opts);
    return t.rows.map((r) => {
      const y = D.cellNumber(r[0]), m = D.cellNumber(r[1]);
      return y === null || m === null ? null : { ym: `${y}-${U.pad2(m + 1)}`, status: D.cellText(r[2]).toUpperCase() || 'UNKNOWN', n: D.cellNumber(r[3]) || 0 };
    }).filter(Boolean);
  }

  /** Stock by class × TL: [{ cls, group, tlName, n }] */
  async function loadStock(opts) {
    const s = FF.config.stock;
    const tq = `select ${s.cls}, ${s.tlName}, count(${s.tagId}) where ${s.tagId} is not null group by ${s.cls}, ${s.tlName}`;
    const t = await D.query(s.sheet, tq, opts);
    return t.rows.map((r) => {
      const raw = D.cellText(r[0]);
      const cls = raw ? (/^\d+$/.test(raw) ? `VC${raw}` : raw.toUpperCase()) : 'NA';
      return { cls, group: classGroup(cls), tlName: D.cellText(r[1]) || '—', n: D.cellNumber(r[2]) || 0 };
    });
  }

  /** Stock by agent × class: [{ agentId, agentName, tlName, cls, n }] */
  async function loadStockAgents(opts) {
    const s = FF.config.stock;
    const tq = `select ${s.agentId}, ${s.agentName}, ${s.tlName}, ${s.cls}, count(${s.tagId}) where ${s.tagId} is not null group by ${s.agentId}, ${s.agentName}, ${s.tlName}, ${s.cls}`;
    const t = await D.query(s.sheet, tq, opts);
    return t.rows.map((r) => {
      const raw = D.cellText(r[3]);
      const cls = raw ? (/^\d+$/.test(raw) ? `VC${raw}` : raw.toUpperCase()) : 'NA';
      return { agentId: D.cellText(r[0]), agentName: D.cellText(r[1]) || '—', tlName: D.cellText(r[2]) || '—', cls, group: classGroup(cls), n: D.cellNumber(r[4]) || 0 };
    });
  }

  // ---- derived helpers ---------------------------------------------------------
  function months(daily) { return U.uniq(daily.map((r) => r.ym)).sort(); }
  function latestDate(daily) { return daily.reduce((acc, r) => (!acc || r.d > acc ? r.d : acc), null); }

  /** Per-day totals for a month: { days:[1..N], labels, totals[], byGroup:{...} } */
  function dailySeries(daily, ym, dimFn) {
    const n = U.daysInMonth(ym);
    const totals = new Array(n).fill(0);
    const dims = new Map();
    for (const r of daily) {
      if (r.ym !== ym) continue;
      totals[r.day - 1] += r.n;
      if (dimFn) {
        const k = dimFn(r);
        if (!dims.has(k)) dims.set(k, new Array(n).fill(0));
        dims.get(k)[r.day - 1] += r.n;
      }
    }
    const { y, m } = U.ymParts(ym);
    const days = Array.from({ length: n }, (_, i) => i + 1);
    return { ym, days, labels: days.map(String), dates: days.map((d) => new Date(y, m - 1, d)), totals, dims };
  }

  function summary(daily, ym, upToDay) {
    const s = { ym, total: 0, vc4: 0, vc20: 0, vc5p: 0, comm: 0, issuance: 0, replacement: 0, chassis: 0, wrongVrn: 0, ff: 0, gv: 0, days: new Set(), lastDay: 0 };
    for (const r of daily) {
      if (r.ym !== ym) continue;
      if (upToDay && r.day > upToDay) continue;
      s.total += r.n;
      if (r.group === 'VC4') s.vc4 += r.n; else if (r.group === 'VC20') s.vc20 += r.n; else s.vc5p += r.n;
      if (r.type === 'REPLACEMENT') s.replacement += r.n; else s.issuance += r.n;
      if (/chassis/i.test(r.vrnType)) s.chassis += r.n;
      if (/wrong/i.test(r.vrnType)) s.wrongVrn += r.n;
      if (r.channel === 'GV Partner') s.gv += r.n; else s.ff += r.n;
      s.days.add(r.day);
      if (r.day > s.lastDay) s.lastDay = r.day;
    }
    s.comm = s.vc20 + s.vc5p;
    s.activeDays = s.days.size;
    s.avgPerDay = s.activeDays ? s.total / s.activeDays : 0;
    s.daysInMonth = U.daysInMonth(ym);
    s.projected = s.lastDay ? Math.round((s.total / s.lastDay) * s.daysInMonth) : 0;
    return s;
  }

  function byDim(daily, ym, dimFn) {
    const map = new Map();
    for (const r of daily) { if (ym && r.ym !== ym) continue; const k = dimFn(r); map.set(k, (map.get(k) || 0) + r.n); }
    return map;
  }

  FF.model = { classGroup, channelOf, loadDaily, loadAgents, loadStatus, loadStock, loadStockAgents, months, latestDate, dailySeries, summary, byDim };
})(window.FF);
