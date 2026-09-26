/* Dashboard page: KPI cards + charts from EIR (issuance), StockDataa (inventory) and tag status. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, M = FF.model, C = FF.charts;
  const esc = U.esc;

  function kpi(cls, title, icon, value, foot, tip) {
    return `<div class="kpi ${cls}" ${tip ? `data-tip="${esc(tip)}"` : ''}><div class="kpi-top"><span class="kpi-title">${esc(title)}</span><span class="kpi-icon">${icon}</span></div><div class="kpi-value">${value}</div><div class="kpi-foot">${foot || ''}</div></div>`;
  }
  function card(title, body, opts) {
    const o = opts || {};
    return `<section class="card ${o.cls || ''}"><div class="card-head"><h3>${title}</h3>${o.right ? `<div class="card-right">${o.right}</div>` : ''}</div><div class="card-body">${body}</div></section>`;
  }
  function sectionError(title, err) { return card(title, U.errorBox(err)); }

  async function render(root, params, ctx) {
    const fresh = !!(ctx && ctx.fresh);
    root.innerHTML = `<div class="page-head"><div><h1>📊 Dashboard</h1><p class="sub">Live summary · EIR issuance + StockDataa inventory</p></div>
      <div class="head-actions"><button class="btn primary" data-action="refresh">↻ Refresh</button><a class="btn" target="_blank" rel="noopener" href="${esc(FF.config.sheetUrl())}">Open Google Sheet ↗</a></div></div>
      <div id="db-body">${U.spinner('EIR & StockDataa se data aggregate ho raha hai… (pehli baar 5-10 sec lag sakte hain)')}</div>`;

    const [dailyR, agentsR, statusR, stockR] = await Promise.allSettled([
      M.loadDaily(null, { fresh }), M.loadAgents({ fresh }), M.loadStatus({ fresh }), M.loadStock({ fresh })
    ]);
    if (!root.isConnected) return;
    const body = U.$('#db-body', root);
    if (dailyR.status !== 'fulfilled') {
      body.innerHTML = U.errorBox(dailyR.reason, 'data-action="refresh"');
      return;
    }
    const daily = dailyR.value;
    const agents = agentsR.status === 'fulfilled' ? agentsR.value : null;
    const status = statusR.status === 'fulfilled' ? statusR.value : null;
    const stock = stockR.status === 'fulfilled' ? stockR.value : null;

    const monthsList = M.months(daily);
    const latest = M.latestDate(daily);
    if (!latest) { body.innerHTML = U.errorBox(new Error('EIR sheet me koi ISSUE_DATE nahi mili.')); return; }
    const cur = U.ymKey(latest);
    const last = U.prevMonthKey(cur);
    const curS = M.summary(daily, cur);
    const lastFull = M.summary(daily, last);
    const lastMtd = M.summary(daily, last, curS.lastDay);
    const curSeries = M.dailySeries(daily, cur);
    const lastSeries = M.dailySeries(daily, last);
    const todayN = curSeries.totals[latest.getDate() - 1] || 0;
    const prevDayN = latest.getDate() > 1 ? curSeries.totals[latest.getDate() - 2] : (lastSeries.totals[lastSeries.totals.length - 1] || 0);

    // agents
    let activeCur = 0, activeLast = 0, ffAgents = 0, gvAgents = 0;
    const tlCur = new Map(), tlLast = new Map(), agCur = new Map(), agMeta = new Map();
    if (agents) {
      const setCur = new Set(), setLast = new Set();
      for (const a of agents) {
        if (a.ym === cur) { setCur.add(a.key); agCur.set(a.key, (agCur.get(a.key) || 0) + a.n); agMeta.set(a.key, a); tlCur.set(a.tlName, (tlCur.get(a.tlName) || 0) + a.n); }
        if (a.ym === last) { setLast.add(a.key); tlLast.set(a.tlName, (tlLast.get(a.tlName) || 0) + a.n); }
      }
      activeCur = setCur.size; activeLast = setLast.size;
      for (const k of setCur) ffAgents += agMeta.get(k).channel === 'First Forward' ? 1 : 0;
      gvAgents = activeCur - ffAgents;
    }
    // stock
    const stockTotal = stock ? U.sum(stock, (r) => r.n) : null;
    const stockVc4 = stock ? U.sum(stock.filter((r) => r.group === 'VC4'), (r) => r.n) : null;
    // status
    const statusCur = status ? status.filter((s) => s.ym === cur) : [];
    const statusTotal = U.sum(statusCur, (s) => s.n);
    const hotlisted = U.sum(statusCur.filter((s) => /HOTLIST/i.test(s.status)), (s) => s.n);
    const activated = U.sum(statusCur.filter((s) => s.status === 'ACTIVATED'), (s) => s.n);

    const lm = U.labelYM(last), cm = U.labelYM(cur);
    const kpis = [
      kpi('g1', `Latest Day · ${U.labelDate(latest)} (${U.weekday(latest)})`, '⚡', U.fmt(todayN), `${U.deltaHtml(U.growth(todayN, prevDayN), { decimals: 0 })} vs previous day (${U.fmt(prevDayN)})`),
      kpi('g2', `MTD Issuance · ${cm}`, '🏷️', U.fmt(curS.total), `${U.deltaHtml(U.growth(curS.total, lastMtd.total))} vs ${lm} same period (${U.fmt(lastMtd.total)})`),
      kpi('g3', 'VC4 (Payable) · MTD', '🚗', U.fmt(curS.vc4), `${U.fmtPct(U.pctOf(curS.vc4, curS.total), 0)} share · ${U.deltaHtml(U.growth(curS.vc4, lastMtd.vc4))} vs ${lm}`),
      kpi('g4', 'Commercial (NVC4) · MTD', '🚚', U.fmt(curS.comm), `VC20 <b>${U.fmt(curS.vc20)}</b> · VC5+ <b>${U.fmt(curS.vc5p)}</b> · ${U.deltaHtml(U.growth(curS.comm, lastMtd.comm))}`),
      kpi('g5', 'Avg / Day · MTD', '📅', U.fmt(curS.avgPerDay), `${lm}: ${U.fmt(lastFull.avgPerDay)} / day · ${curS.activeDays} active days`),
      kpi('g6', `Projected Month-End · ${cm}`, '🎯', U.fmt(curS.projected), `${U.deltaHtml(U.growth(curS.projected, lastFull.total))} vs ${lm} full (${U.fmt(lastFull.total)})`),
      kpi('g7', 'Replacements · MTD', '🔁', U.fmt(curS.replacement), `${U.fmtPct(U.pctOf(curS.replacement, curS.total))} of total · ${U.deltaHtml(U.growth(curS.replacement, lastMtd.replacement))} vs ${lm}`),
      kpi('g8', 'Chassis / Wrong VRN · MTD', '🧩', `${U.fmt(curS.chassis)} <small>/ ${U.fmt(curS.wrongVrn)}</small>`, `Chassis ${U.fmtPct(U.pctOf(curS.chassis, curS.total))} · Wrong VRN ${U.fmtPct(U.pctOf(curS.wrongVrn, curS.total), 2)}`),
      kpi('g9', 'Stock in Field', '📦', stock ? U.fmt(stockTotal) : '—', stock ? `VC4 <b>${U.fmt(stockVc4)}</b> · NVC4 <b>${U.fmt(stockTotal - stockVc4)}</b> · ${curS.avgPerDay ? `${U.fmt(stockTotal / curS.avgPerDay)} days cover` : ''}` : 'StockDataa load nahi hua'),
      kpi('g10', 'Active Agents · MTD', '🧑‍💼', agents ? U.fmt(activeCur) : '—', agents ? `FF <b>${U.fmt(ffAgents)}</b> · GV <b>${U.fmt(gvAgents)}</b> · ${U.deltaHtml(U.growth(activeCur, activeLast), { decimals: 0 })} vs ${lm} (${U.fmt(activeLast)})` : 'Agent data load nahi hua'),
      kpi('g11', 'GV Partner Share · MTD', '🤝', U.fmtPct(U.pctOf(curS.gv, curS.total), 0), `GV <b>${U.fmt(curS.gv)}</b> · First Forward <b>${U.fmt(curS.ff)}</b>`),
      kpi('g12', 'Activated / Hotlisted · MTD', '✅', status ? `${U.fmtPct(U.pctOf(activated, statusTotal), 0)} <small>/ ${U.fmtPct(U.pctOf(hotlisted, statusTotal))}</small>` : '—', status ? `Activated <b>${U.fmt(activated)}</b> · Hotlisted <b>${U.fmt(hotlisted)}</b>` : 'Status data load nahi hua')
    ];

    // charts data
    const dayLabels = curSeries.days.map(String);
    const lastVals = lastSeries.totals.slice(0, curSeries.days.length).map((v, i) => (i < lastSeries.totals.length ? v : null));
    const curVals = curSeries.totals.map((v, i) => (i < latest.getDate() ? v : null));
    const lineChart = C.lines({ labels: dayLabels, tipLabels: curSeries.days.map((d) => `Day ${d}`), height: 250, series: [
      { name: cm, values: curVals, color: C.COLORS.current },
      { name: lm, values: lastVals, color: C.COLORS.last, dash: true, area: false }
    ] });
    const classDonut = C.donut({ items: [
      { label: 'VC4', value: curS.vc4 }, { label: 'VC20', value: curS.vc20 }, { label: 'VC5+', value: curS.vc5p }
    ], subtitle: 'MTD total' });

    const monthLabels = monthsList.map((m) => U.labelYM(m));
    const sums = monthsList.map((m) => M.summary(daily, m));
    const monthlyClass = C.bars({ labels: monthLabels, height: 200, series: [
      { name: 'VC4', values: sums.map((s) => s.vc4) }, { name: 'VC20', values: sums.map((s) => s.vc20) }, { name: 'VC5+', values: sums.map((s) => s.vc5p) }
    ] });
    const monthlyType = C.bars({ labels: monthLabels, height: 200, series: [
      { name: 'ISSUANCE', values: sums.map((s) => s.issuance) }, { name: 'REPLACEMENT', values: sums.map((s) => s.replacement) }
    ] });
    const monthlyChannel = C.bars({ labels: monthLabels, height: 200, series: [
      { name: 'First Forward', values: sums.map((s) => s.ff) }, { name: 'GV Partner', values: sums.map((s) => s.gv) }
    ] });

    const topTls = U.topEntries(tlCur, 10).map(([name, v], i) => ({ label: name, value: v, compare: tlLast.get(name) || 0, color: C.PALETTE[i % C.PALETTE.length], attr: `data-link="#/trend?tl=${encodeURIComponent(name)}"` }));
    const topAgents = U.topEntries(agCur, 10).map(([key, v], i) => { const a = agMeta.get(key); return { label: a.name, sub: `${a.channel === 'GV Partner' ? 'GV · ' : ''}${a.tlName}`, value: v, color: a.channel === 'GV Partner' ? C.COLORS['GV Partner'] : C.PALETTE[i % C.PALETTE.length], attr: `data-link="#/trend?agent=${encodeURIComponent(a.name)}"` }; });

    let stockByClass = '', stockTls = '';
    if (stock) {
      const byCls = M.byDim(stock.map((r) => ({ ...r, ym: cur })), null, (r) => r.cls);
      const order = [...byCls.keys()].sort((a, b) => (parseInt(a.replace(/\D/g, ''), 10) || 999) - (parseInt(b.replace(/\D/g, ''), 10) || 999));
      stockByClass = C.bars({ labels: order, height: 190, series: [{ name: 'Stock', values: order.map((k) => byCls.get(k)), color: '#14b8a6' }] });
      const tlStock = U.groupSum(stock, (r) => r.tlName, (r) => r.n);
      stockTls = C.hbars({ items: U.topEntries(tlStock, 10).map(([name, v], i) => ({ label: name, value: v, color: C.PALETTE[(i + 3) % C.PALETTE.length], sub: `VC4 ${U.fmt(U.sum(stock.filter((r) => r.tlName === name && r.group === 'VC4'), (r) => r.n))}` })), valueLabel: 'Stock' });
    }
    const statusDonut = status ? C.donut({ items: U.topEntries(U.groupSum(statusCur, (s) => s.status, (s) => s.n), 7).map(([label, value]) => ({ label, value })), subtitle: 'tags MTD' }) : '';
    const vrnDonut = C.donut({ items: U.topEntries(M.byDim(daily, cur, (r) => r.vrnType || 'Other'), 6).map(([label, value]) => ({ label, value })), subtitle: 'VRN type MTD' });

    // weekday pattern (last 8 weeks)
    const cutoff = new Date(latest); cutoff.setDate(cutoff.getDate() - 55);
    const wdSum = new Array(7).fill(0), wdDays = Array.from({ length: 7 }, () => new Set());
    for (const r of daily) { if (r.d < cutoff) continue; wdSum[r.d.getDay()] += r.n; wdDays[r.d.getDay()].add(r.key); }
    const wdOrder = [1, 2, 3, 4, 5, 6, 0];
    const weekdayChart = C.bars({ labels: wdOrder.map((i) => U.DAYS[i]), height: 190, series: [{ name: 'Avg / day', values: wdOrder.map((i) => (wdDays[i].size ? Math.round(wdSum[i] / wdDays[i].size) : 0)), color: '#8b5cf6' }] });

    // last 14 days table
    const recent = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(latest); d.setDate(d.getDate() - i);
      const ym = U.ymKey(d), day = d.getDate();
      const rows = daily.filter((r) => r.ym === ym && r.day === day);
      const t = U.sum(rows, (r) => r.n);
      recent.push({ d, total: t, vc4: U.sum(rows.filter((r) => r.group === 'VC4'), (r) => r.n), comm: U.sum(rows.filter((r) => r.group !== 'VC4'), (r) => r.n), repl: U.sum(rows.filter((r) => r.type === 'REPLACEMENT'), (r) => r.n), gv: U.sum(rows.filter((r) => r.channel === 'GV Partner'), (r) => r.n) });
    }
    const recentRows = recent.map((r, i) => {
      const prev = recent[i + 1];
      return `<tr><td>${U.labelDate(r.d)} <span class="dim">${U.weekday(r.d)}</span></td><td class="num"><b>${U.fmt(r.total)}</b></td><td class="num">${U.fmt(r.vc4)}</td><td class="num">${U.fmt(r.comm)}</td><td class="num">${U.fmt(r.repl)}</td><td class="num">${U.fmt(r.gv)}</td><td>${prev ? U.deltaHtml(U.growth(r.total, prev.total), { decimals: 0 }) : '—'}</td></tr>`;
    }).join('');

    body.innerHTML = `
      <div class="kpi-grid">${kpis.join('')}</div>
      <div class="grid g-2-1">
        ${card(`📈 Daily Issuance · ${cm} <span class="dim">vs</span> ${lm}`, lineChart, { right: `<a class="btn small" href="#/trend?mode=compare">Full trend →</a>` })}
        ${card('🍩 Class Mix · MTD', classDonut)}
      </div>
      <div class="grid g-3">
        ${card('🗓️ Monthly Issuance by Class', monthlyClass)}
        ${card('🔁 Issuance vs Replacement', monthlyType)}
        ${card('🤝 First Forward vs GV Partner', monthlyChannel)}
      </div>
      <div class="grid g-2">
        ${agents ? card(`🏅 Top 10 TLs · ${cm} <span class="dim">(ghost bar = ${lm})</span>`, C.hbars({ items: topTls, compareLabel: lm, valueLabel: cm })) : sectionError('Top TLs', agentsR.reason)}
        ${agents ? card(`⭐ Top 10 Agents · ${cm}`, C.hbars({ items: topAgents, valueLabel: cm })) : sectionError('Top Agents', agentsR.reason)}
      </div>
      <div class="grid g-3">
        ${stock ? card('📦 Stock by Class (StockDataa)', stockByClass) : sectionError('Stock by Class', stockR.reason)}
        ${stock ? card('🏬 Top TLs by Stock', stockTls) : sectionError('Top TLs by Stock', stockR.reason)}
        ${status ? card('🚦 Tag Status · MTD', statusDonut) : sectionError('Tag Status', statusR.reason)}
      </div>
      <div class="grid g-3">
        ${card('📆 Weekday Pattern <span class="dim">(avg/day, last 8 weeks)</span>', weekdayChart)}
        ${card('🔖 VRN Type · MTD', vrnDonut)}
        ${card('🕒 Last 14 Days', `<div class="table-wrap"><table class="tbl compact"><thead><tr><th>Date</th><th class="num">Total</th><th class="num">VC4</th><th class="num">Comm</th><th class="num">Repl</th><th class="num">GV</th><th>vs prev</th></tr></thead><tbody>${recentRows}</tbody></table></div>`)}
      </div>
      <p class="foot-note">Source: EIR (issuance log) · StockDataa (inventory) · Google Sheet live · Loaded ${U.timeLabel(FF.data.lastLoadAt)} · Months in data: ${monthLabels.join(', ')}</p>`;
    C.mount(body);
  }

  FF.pages.dashboard = { title: 'Dashboard', render };
})(window.FF);
