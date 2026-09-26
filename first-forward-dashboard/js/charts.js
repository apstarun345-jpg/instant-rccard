/* Tiny dependency-free chart kit: vertical bars (stacked), horizontal bars, line charts (SVG), donuts (SVG). */
window.FF = window.FF || {};
(function (FF) {
  'use strict';
  const U = FF.util;
  const esc = U.esc;
  const PALETTE = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#0ea5e9', '#8b5cf6', '#f97316', '#14b8a6', '#ef4444', '#84cc16', '#06b6d4', '#d946ef', '#64748b'];
  const COLORS = {
    VC4: '#6366f1', VC20: '#ec4899', 'VC5+': '#f59e0b', NVC4: '#f59e0b', Commercial: '#f59e0b',
    ISSUANCE: '#10b981', REPLACEMENT: '#f97316',
    'First Forward': '#8b5cf6', 'GV Partner': '#0ea5e9',
    current: '#6366f1', last: '#ec4899',
    ACTIVATED: '#10b981', HOTLISTED: '#ef4444', 'LOW BALANCE': '#f59e0b', ISSUED: '#0ea5e9',
    'With Max': '#6366f1', 'Without max': '#0ea5e9', Chassis: '#f59e0b', 'Wrong VRN': '#ef4444'
  };
  let seq = 0;
  const specs = new Map();

  function color(name, i) { return COLORS[name] || PALETTE[i % PALETTE.length]; }
  function fmtVal(v, f) { return f ? f(v) : U.fmt(v); }
  function niceMax(max) {
    if (!max || max <= 0) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(max)));
    const n = max / exp;
    const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * exp;
  }
  function legend(series) {
    return `<div class="legend">${series.map((s, i) => `<span class="legend-item"><i style="background:${s.color || color(s.name, i)}"></i>${esc(s.name)}</span>`).join('')}</div>`;
  }

  /** Vertical (stacked) bars. opts: { labels, series:[{name, values, color}], height, format, showValues, labelEvery, tips } */
  function bars(opts) {
    const { labels } = opts;
    const series = opts.series.map((s, i) => ({ ...s, color: s.color || color(s.name, i) }));
    const totals = labels.map((_, i) => U.sum(series, (s) => s.values[i] || 0));
    const max = niceMax(Math.max(...totals, 0));
    const height = opts.height || 220;
    const n = labels.length;
    const every = opts.labelEvery || (n > 40 ? 5 : n > 20 ? 2 : 1);
    const showValues = opts.showValues !== undefined ? opts.showValues : n <= 16;
    const cols = labels.map((label, i) => {
      const total = totals[i];
      const segs = series.map((s) => {
        const v = s.values[i] || 0;
        if (v <= 0) return '';
        return `<div class="vseg" style="flex:0 0 ${(v / total) * 100}%;background:${s.color}"></div>`;
      }).join('');
      const tip = opts.tips && opts.tips[i] ? opts.tips[i] : `<b>${esc(opts.tipLabels ? opts.tipLabels[i] : label)}</b><br>${series.length > 1 ? series.map((s) => `<i style="background:${s.color}"></i>${esc(s.name)}: <b>${fmtVal(s.values[i] || 0, opts.format)}</b>`).join('<br>') + '<br>' : ''}Total: <b>${fmtVal(total, opts.format)}</b>`;
      const hl = opts.highlight === i ? ' hl' : '';
      return `<div class="vcol${hl}" data-tip="${esc(tip)}" ${opts.onClickAttr ? opts.onClickAttr(i) : ''}>
        <div class="vcol-bars">${showValues && total > 0 ? `<div class="vcol-val">${U.fmtShort(total)}</div>` : ''}<div class="vcol-stack" style="height:${max ? Math.max(total > 0 ? 1.5 : 0, (total / max) * 100) : 0}%">${segs}</div></div>
        <div class="vcol-label">${i % every === 0 ? esc(label) : ''}</div></div>`;
    }).join('');
    const grid = [1, 0.75, 0.5, 0.25, 0].map((f) => `<div class="vgrid-line"><span>${U.fmtShort(max * f)}</span></div>`).join('');
    return `<div class="vbars" style="--h:${height}px"><div class="vbars-plot"><div class="vgrid">${grid}</div><div class="vbars-cols">${cols}</div></div>${series.length > 1 || opts.legendAlways ? legend(series) : ''}</div>`;
  }

  /** Horizontal bars. opts: { items:[{label, sub, value, compare, color, tip, attr}], max, format, compareLabel } */
  function hbars(opts) {
    const items = opts.items || [];
    const max = opts.max || Math.max(1, ...items.map((it) => Math.max(it.value || 0, it.compare || 0)));
    return `<div class="hbars">${items.map((it, i) => {
      const c = it.color || PALETTE[i % PALETTE.length];
      const w = Math.max(0, ((it.value || 0) / max) * 100);
      const cw = it.compare !== undefined && it.compare !== null ? Math.max(0, (it.compare / max) * 100) : null;
      const g = cw !== null ? U.growth(it.value || 0, it.compare) : null;
      const tip = it.tip || `<b>${esc(it.label)}</b><br>${esc(opts.valueLabel || 'Value')}: <b>${fmtVal(it.value || 0, opts.format)}</b>${cw !== null ? `<br>${esc(opts.compareLabel || 'Compare')}: <b>${fmtVal(it.compare, opts.format)}</b>` : ''}`;
      return `<div class="hbar-row" data-tip="${esc(tip)}" ${it.attr || ''}>
        <div class="hbar-rank">${i + 1}</div>
        <div class="hbar-main"><div class="hbar-head"><span class="hbar-label" title="${esc(it.label)}">${esc(it.label)}</span>${it.sub ? `<span class="hbar-sub">${esc(it.sub)}</span>` : ''}<span class="hbar-value">${fmtVal(it.value || 0, opts.format)}${g !== null ? ` ${U.deltaHtml(g, { decimals: 0 })}` : ''}</span></div>
        <div class="hbar-track">${cw !== null ? `<div class="hbar-compare" style="width:${cw}%"></div>` : ''}<div class="hbar-fill" style="width:${w}%;background:${c}"></div></div></div></div>`;
    }).join('')}${items.length === 0 ? '<div class="empty">No data</div>' : ''}</div>`;
  }

  /** Donut. opts: { items:[{label, value, color}], size, title, subtitle, format } */
  function donut(opts) {
    const items = (opts.items || []).filter((it) => it.value > 0);
    const total = U.sum(items, (it) => it.value);
    const size = opts.size || 170;
    const r = 42, cx = 50, cy = 50, circ = 2 * Math.PI * r;
    let offset = 0;
    const segs = items.map((it, i) => {
      const frac = total ? it.value / total : 0;
      const len = frac * circ;
      const seg = `<circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="${it.color || color(it.label, i)}" stroke-width="14" stroke-dasharray="${len.toFixed(2)} ${(circ - len).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}" data-tip="${esc(`<b>${it.label}</b><br>${fmtVal(it.value, opts.format)} · ${U.fmtPct(frac * 100)}`)}"></circle>`;
      offset += len;
      return seg;
    }).join('');
    const legendHtml = items.map((it, i) => `<div class="donut-leg"><i style="background:${it.color || color(it.label, i)}"></i><span class="donut-leg-label">${esc(it.label)}</span><b>${fmtVal(it.value, opts.format)}</b><span class="donut-leg-pct">${U.fmtPct(total ? (it.value / total) * 100 : 0)}</span></div>`).join('');
    return `<div class="donut"><div class="donut-ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 100 100" width="${size}" height="${size}" style="transform:rotate(-90deg)"><circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="#eef0f6" stroke-width="14"></circle>${segs}</svg>
      <div class="donut-center"><b>${esc(opts.title !== undefined ? opts.title : U.fmtShort(total))}</b><span>${esc(opts.subtitle || 'Total')}</span></div></div>
      <div class="donut-legend">${legendHtml || '<div class="empty">No data</div>'}</div></div>`;
  }

  /** Line chart placeholder; drawn by mount() with real width. opts: { labels, series:[{name, values, color, dash, area}], height, format, tipLabels } */
  function lines(opts) {
    const id = `ch${++seq}`;
    specs.set(id, opts);
    return `<div class="chart-line" data-chart="${id}" style="height:${(opts.height || 240) + (opts.series.length > 1 ? 28 : 0)}px"></div>`;
  }
  function drawLine(el, opts) {
    const W = Math.max(280, el.clientWidth || 640);
    const H = opts.height || 240;
    const L = 46, R = 14, T = 14, B = 26;
    const series = opts.series.map((s, i) => ({ ...s, color: s.color || color(s.name, i) }));
    const n = opts.labels.length;
    const allVals = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
    const max = niceMax(Math.max(...allVals, 0));
    const x = (i) => L + (n > 1 ? (i / (n - 1)) * (W - L - R) : (W - L - R) / 2);
    const y = (v) => T + (H - T - B) * (1 - v / max);
    const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(max * f).toFixed(1)}" y2="${y(max * f).toFixed(1)}" class="grid"></line><text x="${L - 6}" y="${(y(max * f) + 4).toFixed(1)}" class="ylab" text-anchor="end">${U.fmtShort(max * f)}</text>`).join('');
    const every = n > 40 ? 5 : n > 20 ? 2 : 1;
    const xlabels = opts.labels.map((lab, i) => (i % every === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="xlab" text-anchor="middle">${esc(lab)}</text>` : '')).join('');
    let defs = '';
    const paths = series.map((s, si) => {
      const pts = s.values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
      let d = '', started = false;
      pts.forEach((p) => { if (!p) { started = false; return; } d += `${started ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)} `; started = true; });
      const gid = `g${seq}_${si}`;
      defs += `<linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${s.color}" stop-opacity="0.28"></stop><stop offset="100%" stop-color="${s.color}" stop-opacity="0"></stop></linearGradient>`;
      const valid = pts.filter(Boolean);
      const area = s.area !== false && valid.length > 1 ? `<path d="M${valid[0][0].toFixed(1)},${(H - B).toFixed(1)} ${valid.map((p) => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} L${valid[valid.length - 1][0].toFixed(1)},${(H - B).toFixed(1)} Z" fill="url(#${gid})"></path>` : '';
      const dots = pts.map((p, i) => (p ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${n > 40 ? 2.2 : 3.4}" fill="#fff" stroke="${s.color}" stroke-width="2" data-tip="${esc(`<b>${(opts.tipLabels || opts.labels)[i]}</b><br>${series.map((ss) => `<i style="background:${ss.color}"></i>${ss.name}: <b>${ss.values[i] === null || ss.values[i] === undefined ? '—' : fmtVal(ss.values[i], opts.format)}</b>`).join('<br>')}`)}"></circle>` : '')).join('');
      return `${area}<path d="${d.trim()}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="6 5"' : ''}></path>${dots}`;
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="linesvg"><defs>${defs}</defs>${grid}${xlabels}${paths}</svg>${series.length > 1 ? legend(series) : ''}`;
  }
  function mount(root) {
    U.$$('[data-chart]', root || document).forEach((el) => {
      const spec = specs.get(el.getAttribute('data-chart'));
      if (spec) drawLine(el, spec);
    });
  }
  window.addEventListener('resize', U.debounce(() => mount(document), 150));

  /** Sparkline (inline svg) */
  function spark(values, colorHex) {
    const max = Math.max(1, ...values);
    const w = 6, gap = 1.5, hgt = 22;
    return `<svg class="spark" viewBox="0 0 ${values.length * (w + gap)} ${hgt}" width="${values.length * (w + gap)}" height="${hgt}">${values.map((v, i) => `<rect x="${i * (w + gap)}" y="${(hgt - Math.max(1.5, (v / max) * hgt)).toFixed(1)}" width="${w}" height="${Math.max(1.5, (v / max) * hgt).toFixed(1)}" rx="1.2" fill="${colorHex || '#6366f1'}" opacity="${i === values.length - 1 ? 1 : 0.55}"></rect>`).join('')}</svg>`;
  }

  FF.charts = { PALETTE, COLORS, color, bars, hbars, donut, lines, mount, legend, spark };
})(window.FF);
