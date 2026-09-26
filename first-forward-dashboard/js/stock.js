/* Stock page: inventory in the field (StockDataa) — by class, TL and agent, with days-of-cover vs current issuance. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, C = FF.charts;
  const esc = U.esc;
  const norm = (s) => U.clean(s).toUpperCase().replace(/\s+/g, ' ');
  const clsNum = (c) => parseInt(String(c).replace(/\D/g, ''), 10) || 999;

  function coverBadge(days) {
    if (days === null || !Number.isFinite(days)) return '<span class="badge gray">no issuance</span>';
    if (days < 7) return `<span class="badge red">🔴 ${U.fmt(days)} days</span>`;
    if (days < 15) return `<span class="badge orange">🟠 ${U.fmt(days)} days</span>`;
    if (days < 30) return `<span class="badge amber">🟡 ${U.fmt(days)} days</span>`;
    return `<span class="badge green">🟢 ${U.fmt(days)} days</span>`;
  }

  async function render(root, params, ctx) {
    const fresh = !!(ctx && ctx.fresh);
    root.innerHTML = `<div class="page-head"><div><h1>📦 Stock / Inventory</h1><p class="sub">StockDataa — field me pada hua tag stock, class / TL / agent wise</p></div>
      <div class="head-actions"><button class="btn primary" data-action="refresh">↻ Refresh</button><a class="btn" href="#/sheet/StockDataa">Full StockDataa sheet →</a></div></div><div id="st-body">${U.spinner('StockDataa aggregate ho raha hai…')}</div>`;
    const [stockR, agentsStockR, dailyR, issuedR] = await Promise.allSettled([M.loadStock({ fresh }), M.loadStockAgents({ fresh }), M.loadDaily(null, { fresh }), M.loadAgents({ fresh })]);
    if (!root.isConnected) return;
    const body = U.$('#st-body', root);
    if (stockR.status !== 'fulfilled') { body.innerHTML = U.errorBox(stockR.reason, 'data-action="refresh"'); return; }
    const stock = stockR.value;
    const agentsStock = agentsStockR.status === 'fulfilled' ? agentsStockR.value : [];
    const daily = dailyR.status === 'fulfilled' ? dailyR.value : [];
    const issued = issuedR.status === 'fulfilled' ? issuedR.value : [];

    const latest = M.latestDate(daily);
    const cur = latest ? U.ymKey(latest) : null;
    const elapsed = latest ? latest.getDate() : 0;
    const curVc4 = cur ? M.summary(daily, cur).vc4 : 0;
    const total = U.sum(stock, (r) => r.n);
    const vc4 = U.sum(stock.filter((r) => r.group === 'VC4'), (r) => r.n);
    const classes = U.uniq(stock.map((r) => r.cls)).sort((a, b) => clsNum(a) - clsNum(b));
    const byClass = U.groupSum(stock, (r) => r.cls, (r) => r.n);
    const tlNames = U.uniq(stock.map((r) => r.tlName));
    const agentsWithStock = new Set(agentsStock.map((a) => `${a.agentId}|${a.agentName}`)).size;
    const perDayVc4 = elapsed ? curVc4 / elapsed : 0;

    // issuance MTD per TL / agent (VC4 + total) for days-cover
    const tlIssued = new Map(), agIssued = new Map();
    for (const a of issued) {
      if (a.ym !== cur) continue;
      tlIssued.set(norm(a.tlName), (tlIssued.get(norm(a.tlName)) || 0) + a.n);
      agIssued.set(norm(a.name), (agIssued.get(norm(a.name)) || 0) + a.n);
    }

    const kpis = `<div class="kpi-grid">
      <div class="kpi g9"><div class="kpi-top"><span class="kpi-title">Total Stock in Field</span><span class="kpi-icon">📦</span></div><div class="kpi-value">${U.fmt(total)}</div><div class="kpi-foot">${tlNames.length} TLs · ${U.fmt(agentsWithStock)} agents holding stock</div></div>
      <div class="kpi g1"><div class="kpi-top"><span class="kpi-title">VC4 Stock</span><span class="kpi-icon">🚗</span></div><div class="kpi-value">${U.fmt(vc4)}</div><div class="kpi-foot">${U.fmtPct(U.pctOf(vc4, total), 0)} of stock · ${perDayVc4 ? `${U.fmt(vc4 / perDayVc4)} days cover @ ${U.fmt(perDayVc4)} VC4/day` : ''}</div></div>
      <div class="kpi g4"><div class="kpi-top"><span class="kpi-title">NVC4 (Commercial) Stock</span><span class="kpi-icon">🚚</span></div><div class="kpi-value">${U.fmt(total - vc4)}</div><div class="kpi-foot">${classes.filter((c) => c !== 'VC4').map((c) => `${c} <b>${U.fmt(byClass.get(c))}</b>`).join(' · ')}</div></div>
      <div class="kpi g6"><div class="kpi-top"><span class="kpi-title">${cur ? `${U.labelYM(cur)} VC4 issued (MTD)` : 'MTD VC4 issued'}</span><span class="kpi-icon">🏷️</span></div><div class="kpi-value">${U.fmt(curVc4)}</div><div class="kpi-foot">${elapsed} days · stock turns ${curVc4 && vc4 ? (curVc4 / vc4).toFixed(2) : '—'}× / month</div></div>
    </div>`;

    const classBars = C.bars({ labels: classes, height: 200, series: [{ name: 'Stock', values: classes.map((c) => byClass.get(c)), color: '#14b8a6' }], legendAlways: false });
    const tlTotals = U.groupSum(stock, (r) => r.tlName, (r) => r.n);
    const tlVc4 = U.groupSum(stock.filter((r) => r.group === 'VC4'), (r) => r.tlName, (r) => r.n);
    const topTls = U.topEntries(tlTotals, 12).map(([name, v], i) => ({ label: name, value: v, sub: `VC4 ${U.fmt(tlVc4.get(name) || 0)} · NVC4 ${U.fmt(v - (tlVc4.get(name) || 0))}`, color: C.PALETTE[(i + 3) % C.PALETTE.length] }));
    const donut = C.donut({ items: classes.map((c) => ({ label: c, value: byClass.get(c), color: c === 'VC4' ? '#6366f1' : undefined })), subtitle: 'tags in field' });

    // TL matrix
    const tlRows = U.topEntries(tlTotals).map(([name, t]) => {
      const v4 = tlVc4.get(name) || 0;
      const iss = tlIssued.get(norm(name)) || 0;
      const perDay = elapsed ? iss / elapsed : 0;
      const cover = perDay ? v4 / perDay : null;
      return { name, t, v4, iss, cover, cells: classes.map((c) => U.sum(stock.filter((r) => r.tlName === name && r.cls === c), (r) => r.n)) };
    });
    const tlTable = `<div class="table-wrap tall"><table class="tbl sticky-first"><thead><tr><th>TL</th>${classes.map((c) => `<th class="num">${esc(c)}</th>`).join('')}<th class="num">Total</th><th class="num">MTD issued</th><th>VC4 cover</th></tr></thead><tbody>${tlRows.map((r) => `<tr><td><a href="#/trend?tl=${encodeURIComponent(r.name)}">${esc(r.name)}</a></td>${r.cells.map((v) => `<td class="num">${v ? U.fmt(v) : '<span class="dim">·</span>'}</td>`).join('')}<td class="num"><b>${U.fmt(r.t)}</b></td><td class="num">${U.fmt(r.iss)}</td><td>${coverBadge(r.cover)}</td></tr>`).join('')}</tbody><tfoot><tr><td><b>Total</b></td>${classes.map((c) => `<td class="num"><b>${U.fmt(byClass.get(c))}</b></td>`).join('')}<td class="num"><b>${U.fmt(total)}</b></td><td class="num"><b>${U.fmt(U.sum([...tlIssued.values()]))}</b></td><td></td></tr></tfoot></table></div>`;

    // agent table (top 300 by stock, searchable)
    const agMap = new Map();
    for (const a of agentsStock) {
      const k = `${a.agentId}|${a.agentName}`;
      if (!agMap.has(k)) agMap.set(k, { id: a.agentId, name: a.agentName, tl: a.tlName, total: 0, vc4: 0 });
      const o = agMap.get(k); o.total += a.n; if (a.group === 'VC4') o.vc4 += a.n;
    }
    const agRows = [...agMap.values()].sort((a, b) => b.total - a.total);
    const agentRowHtml = (a) => {
      const iss = agIssued.get(norm(a.name)) || 0;
      const perDay = elapsed ? iss / elapsed : 0;
      return `<tr><td class="mono">${esc(a.id)}</td><td><a href="#/trend?agent=${encodeURIComponent(a.name)}">${esc(a.name)}</a></td><td>${esc(a.tl)}</td><td class="num">${U.fmt(a.vc4)}</td><td class="num">${U.fmt(a.total - a.vc4)}</td><td class="num"><b>${U.fmt(a.total)}</b></td><td class="num">${U.fmt(iss)}</td><td>${coverBadge(perDay ? a.vc4 / perDay : null)}</td></tr>`;
    };
    body.innerHTML = `${kpis}
      <div class="grid g-3">
        <section class="card"><div class="card-head"><h3>📊 Stock by Class</h3></div><div class="card-body">${classBars}</div></section>
        <section class="card"><div class="card-head"><h3>🍩 Class Share</h3></div><div class="card-body">${donut}</div></section>
        <section class="card"><div class="card-head"><h3>🏬 Top TLs by Stock</h3></div><div class="card-body">${C.hbars({ items: topTls, valueLabel: 'Stock' })}</div></section>
      </div>
      <section class="card"><div class="card-head"><h3>🧮 TL × Class Stock Matrix <span class="dim">(VC4 cover = VC4 stock ÷ avg daily issuance MTD)</span></h3><div class="card-right"><button class="btn small" data-action="export" data-name="stock-by-tl">⬇ CSV</button></div></div><div class="card-body">${tlTable}</div></section>
      <section class="card"><div class="card-head"><h3>🧑‍💼 Agent-wise Stock <span class="dim">(${U.fmt(agRows.length)} agents)</span></h3><div class="card-right"><input id="st-search" class="input" placeholder="Agent / TL / ID search…"><button class="btn small" data-action="export" data-name="stock-by-agent">⬇ CSV</button></div></div><div class="card-body"><div class="table-wrap tall"><table class="tbl" id="st-agent-table"><thead><tr><th>Agent ID</th><th>Agent</th><th>TL</th><th class="num">VC4</th><th class="num">NVC4</th><th class="num">Total</th><th class="num">MTD issued</th><th>VC4 cover</th></tr></thead><tbody id="st-agent-body">${agRows.slice(0, 200).map(agentRowHtml).join('')}</tbody></table></div><div class="dim small" id="st-agent-note">Top 200 dikh rahe hain — search karke baaki dekho.</div></div></section>
      <p class="foot-note">Source: StockDataa (${U.fmt(total)} tags) · Issuance MTD from EIR · Loaded ${U.timeLabel(FF.data.lastLoadAt)}</p>`;
    const search = U.$('#st-search', body);
    search.addEventListener('input', U.debounce(() => {
      const q = norm(search.value);
      const list = q ? agRows.filter((a) => norm(`${a.id} ${a.name} ${a.tl}`).includes(q)) : agRows;
      U.$('#st-agent-body', body).innerHTML = list.slice(0, 200).map(agentRowHtml).join('') || '<tr><td colspan="8" class="empty">No match</td></tr>';
      U.$('#st-agent-note', body).textContent = list.length > 200 ? `${U.fmt(list.length)} matches — top 200 dikh rahe hain.` : `${U.fmt(list.length)} agents`;
    }, 150));
  }

  FF.pages.stock = { title: 'Stock', render };
})(window.FF);
