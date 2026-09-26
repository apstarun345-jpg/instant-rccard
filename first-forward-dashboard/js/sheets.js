/* Sheet viewer: shows any tab of the Google Sheet as a grid.
   Small tabs load fully (client-side search/sort). Big tabs (EIR ~60k rows, StockDataa ~1 lakh rows) are paged,
   searched and sorted by Google itself via gviz `limit/offset`, `where` and `order by`. */
window.FF = window.FF || {};
FF.pages = FF.pages || {};
(function (FF) {
  'use strict';
  const U = FF.util, D = FF.data;
  const esc = U.esc;
  const FULL_LIMIT = 2500;
  const states = new Map();

  function getState(name) {
    if (!states.has(name)) states.set(name, { q: '', page: 0, pageSize: 100, sort: null, dir: 'asc', mode: null, total: null, full: null, headerRows: null });
    return states.get(name);
  }
  function isNumericText(t) { return U.num(t) !== null; }
  function detectHeaderRows(rows, cols) {
    const out = [];
    for (let i = 0; i < Math.min(3, rows.length); i++) {
      const texts = cols.map((c, j) => D.cellText(rows[i][j], c));
      const filled = texts.filter((t) => t !== '');
      if (filled.length < 2) break;
      if (filled.some(isNumericText)) break;
      out.push(texts);
    }
    return out;
  }
  function cellHtml(text, col) {
    if (text === '') return '<td></td>';
    const t = text;
    if (/^✔|^✓|^yes$/i.test(t)) return `<td class="ok">${esc(t)}</td>`;
    if (/^✗|^✘|^x$|^no$/i.test(t)) return `<td class="bad">${esc(t)}</td>`;
    if (/^▲/.test(t)) return `<td class="up">${esc(t)}</td>`;
    if (/^▼|^🔻/.test(t)) return `<td class="down">${esc(t)}</td>`;
    const isNum = (col && col.type === 'number') || isNumericText(t);
    return `<td class="${isNum ? 'num' : ''}" title="${esc(t)}">${esc(t)}</td>`;
  }
  function headerHtml(labels, headerRows, cols, state, sortable) {
    const rowsHtml = [];
    if (headerRows && headerRows.length) {
      headerRows.forEach((hr, ri) => {
        if (ri === 0 && headerRows.length > 1) {
          // merged section-style header
          let cells = '';
          for (let i = 0; i < hr.length;) {
            let span = 1;
            while (i + span < hr.length && hr[i + span] === '' && hr[i] !== '') span++;
            cells += `<th colspan="${span}" class="section ${hr[i] ? 'has' : ''}">${esc(hr[i])}</th>`;
            i += span;
          }
          rowsHtml.push(`<tr class="hdr-section">${cells}</tr>`);
        } else {
          rowsHtml.push(`<tr>${hr.map((t, i) => thHtml(t || labels[i] || U.colLetter(i), cols[i], state, sortable)).join('')}</tr>`);
        }
      });
      if (headerRows.length === 1 && labels.some((l) => l)) rowsHtml.unshift(`<tr>${labels.map((l, i) => thHtml(l || U.colLetter(i), cols[i], state, sortable)).join('')}</tr>`);
    } else {
      rowsHtml.push(`<tr>${cols.map((c, i) => thHtml(labels[i] || U.colLetter(i), c, state, sortable)).join('')}</tr>`);
    }
    return rowsHtml.join('');
  }
  function thHtml(label, col, state, sortable) {
    const id = col ? col.id : '';
    const active = state.sort === id;
    return `<th class="${sortable ? 'sortable' : ''} ${active ? 'sorted' : ''}" data-sort="${esc(id)}" title="Column ${esc(id)} · click to sort"><span>${esc(label)}</span><small class="col-id">${esc(id)}</small>${active ? `<i>${state.dir === 'asc' ? '▲' : '▼'}</i>` : ''}</th>`;
  }

  async function render(root, params, ctx) {
    const name = params.name || '';
    const cfg = FF.config.sheetByName(name) || { name, icon: '📄', title: name, desc: '' };
    const state = getState(name);
    if (ctx && ctx.fresh) { state.full = null; state.total = null; state.mode = null; state.headerRows = null; }
    const csvUrl = cfg.gid ? `https://docs.google.com/spreadsheets/d/${FF.config.sheetId}/export?format=csv&gid=${cfg.gid}` : `https://docs.google.com/spreadsheets/d/${FF.config.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;
    root.innerHTML = `<div class="page-head"><div><h1>${cfg.icon || '📄'} ${esc(cfg.title || name)}</h1><p class="sub">${esc(cfg.desc || `Sheet tab "${name}"`)} · <span id="sh-info">loading…</span></p></div>
      <div class="head-actions"><button class="btn primary" data-action="refresh">↻ Refresh</button><button class="btn" data-action="export-visible">⬇ Export visible</button><a class="btn" href="${esc(csvUrl)}" target="_blank" rel="noopener">⬇ Full CSV</a><a class="btn" target="_blank" rel="noopener" href="${esc(FF.config.sheetUrl(name))}">Open in Google ↗</a></div></div>
      <div id="sh-warn"></div>
      <div class="card grid-card"><div class="toolbar"><input id="sh-q" class="input wide" placeholder="Search… (Enter)" value="${esc(state.q)}"><span id="sh-mode" class="dim small"></span><div class="pager" id="sh-pager"></div></div>
      <div class="table-wrap grid-wrap" id="sh-grid">${U.spinner('Sheet load ho rahi hai…')}</div></div>`;

    const grid = U.$('#sh-grid', root), info = U.$('#sh-info', root), modeEl = U.$('#sh-mode', root), pagerEl = U.$('#sh-pager', root), warn = U.$('#sh-warn', root), qInput = U.$('#sh-q', root);
    let current = { cols: [], rows: [], labels: [], headerRows: [] };
    const fresh = !!(ctx && ctx.fresh);

    function checkFallback(table) {
      if (name !== 'EIR' && D.looksLikeEIR(table)) {
        warn.innerHTML = `<div class="warn-box">⚠️ Google ne "<b>${esc(name)}</b>" naam ka tab nahi pehchana, isliye pehla tab (EIR) dikh raha hai. Sheet me tab ka exact naam check karo ya <code>js/config.js</code> me is sheet ka <code>gid</code> set karo (URL me <code>#gid=…</code>).</div>`;
      } else warn.innerHTML = '';
    }
    function searchableCols(cols) {
      const letters = cfg.search && cfg.search.length ? cfg.search : cols.slice(0, 15).map((c) => c.id);
      return letters.filter((l) => { const c = cols.find((x) => x.id === l); return c && c.type === 'string'; });
    }
    function buildTq(cols) {
      const parts = ['select *'];
      if (state.q) {
        const sc = searchableCols(cols);
        const q = state.q.toLowerCase().replace(/["\\]/g, '');
        if (sc.length) parts.push(`where (${sc.map((l) => `lower(${l}) contains "${q}"`).join(' or ')})`);
      }
      if (state.sort) parts.push(`order by ${state.sort} ${state.dir}`);
      parts.push(`limit ${state.pageSize} offset ${state.page * state.pageSize}`);
      return parts.join(' ');
    }
    function renderTable(table, dataRows, totalRows) {
      const cols = table.cols;
      const labels = cols.map((c) => c.label || '');
      const headerRows = state.headerRows || [];
      current = { cols, rows: dataRows, labels, headerRows };
      const sortable = true;
      const bodyHtml = dataRows.map((r) => `<tr>${cols.map((c, i) => cellHtml(D.cellText(r[i], c), c)).join('')}</tr>`).join('');
      grid.innerHTML = `<table class="tbl grid sticky-first"><thead>${headerHtml(labels, headerRows, cols, state, sortable)}</thead><tbody>${bodyHtml || `<tr><td colspan="${cols.length}" class="empty">Koi row nahi mili${state.q ? ` for "${esc(state.q)}"` : ''}.</td></tr>`}</tbody></table>`;
      const pages = Math.max(1, Math.ceil(totalRows / state.pageSize));
      pagerEl.innerHTML = `<button class="btn small" data-pg="prev" ${state.page <= 0 ? 'disabled' : ''}>‹ Prev</button><span>Page <input class="pg-input" type="number" min="1" max="${pages}" value="${state.page + 1}"> / ${U.fmt(pages)}</span><button class="btn small" data-pg="next" ${state.page >= pages - 1 ? 'disabled' : ''}>Next ›</button><select data-pg="size">${[50, 100, 250, 500].map((n) => `<option value="${n}" ${n === state.pageSize ? 'selected' : ''}>${n}/page</option>`).join('')}</select>`;
      info.textContent = `${U.fmt(totalRows)} rows · ${cols.length} columns`;
    }
    function clientSort(rows, cols) {
      if (!state.sort) return rows;
      const idx = cols.findIndex((c) => c.id === state.sort);
      if (idx < 0) return rows;
      const dir = state.dir === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        const na = D.cellNumber(a[idx]), nb = D.cellNumber(b[idx]);
        if (na !== null && nb !== null) return (na - nb) * dir;
        const ta = D.cellText(a[idx]), tb = D.cellText(b[idx]);
        if (ta === tb) return 0;
        if (ta === '') return 1;
        if (tb === '') return -1;
        return ta.localeCompare(tb) * dir;
      });
    }
    function renderFull() {
      const table = state.full;
      const cols = table.cols;
      let rows = table.rows.slice(state.headerRows ? state.headerRows.length : 0);
      if (state.q) {
        const q = state.q.toLowerCase();
        rows = rows.filter((r) => r.some((cell, i) => cell && D.cellText(cell, cols[i]).toLowerCase().includes(q)));
      }
      rows = clientSort(rows, cols);
      const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
      if (state.page > pages - 1) state.page = pages - 1;
      renderTable(table, rows.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize), rows.length);
      modeEl.textContent = `Full sheet loaded · search/sort instant`;
    }
    async function loadPaged() {
      grid.innerHTML = U.spinner(`Page ${state.page + 1} load ho raha hai…`);
      try {
        const probe = state.probeCols || (await D.query(name, 'select * limit 1', { fresh })).cols;
        state.probeCols = probe;
        const table = await D.query(name, buildTq(probe), { fresh });
        if (!root.isConnected) return;
        checkFallback(table);
        if (table.headers === 0 && !state.headerRows && state.page === 0 && !state.q) state.headerRows = detectHeaderRows(table.rows, table.cols);
        const dataRows = state.page === 0 && !state.q && !state.sort && state.headerRows ? table.rows.slice(state.headerRows.length) : table.rows;
        let total = state.total;
        if (state.q) {
          // count filtered rows (cheap aggregate)
          try {
            const sc = searchableCols(probe);
            const q = state.q.toLowerCase().replace(/["\\]/g, '');
            const ct = await D.query(name, `select count(${probe[0].id}) where (${sc.map((l) => `lower(${l}) contains "${q}"`).join(' or ')})`, { fresh });
            total = D.cellNumber(ct.rows[0] && ct.rows[0][0]) || 0;
          } catch (e) { total = dataRows.length + state.page * state.pageSize; }
        }
        renderTable(table, dataRows, total || dataRows.length);
        modeEl.innerHTML = `Big sheet · Google se page-wise · search in: <b>${esc(searchableCols(probe).map((l) => { const c = probe.find((x) => x.id === l); return c && c.label ? c.label : l; }).join(', ') || '—')}</b>`;
      } catch (err) {
        if (root.isConnected) grid.innerHTML = U.errorBox(err, 'data-action="refresh"');
      }
    }
    async function load() {
      try {
        const [countT, firstT] = await Promise.all([
          D.query(name, 'select count(A)', { fresh }).catch(() => null),
          D.query(name, `select * limit ${state.pageSize}`, { fresh })
        ]);
        if (!root.isConnected) return;
        checkFallback(firstT);
        const total = countT && countT.rows[0] ? D.cellNumber(countT.rows[0][0]) : null;
        state.total = total;
        state.probeCols = firstT.cols;
        if (total !== null && total > FULL_LIMIT) {
          state.mode = 'paged';
          if (firstT.headers === 0) state.headerRows = detectHeaderRows(firstT.rows, firstT.cols);
          if (state.page === 0 && !state.q && !state.sort) {
            const dataRows = state.headerRows ? firstT.rows.slice(state.headerRows.length) : firstT.rows;
            renderTable(firstT, dataRows, total);
            modeEl.innerHTML = `Big sheet · Google se page-wise · search in: <b>${esc(searchableCols(firstT.cols).map((l) => { const c = firstT.cols.find((x) => x.id === l); return c && c.label ? c.label : l; }).join(', ') || '—')}</b>`;
          } else await loadPaged();
        } else {
          state.mode = 'full';
          // show first page instantly, then load the whole tab
          if (firstT.headers === 0) state.headerRows = detectHeaderRows(firstT.rows, firstT.cols);
          renderTable(firstT, state.headerRows ? firstT.rows.slice(state.headerRows.length) : firstT.rows, total || firstT.rows.length);
          modeEl.textContent = 'Full sheet load ho rahi hai…';
          const fullT = await D.query(name, '', { fresh });
          if (!root.isConnected) return;
          if (fullT.headers === 0) state.headerRows = detectHeaderRows(fullT.rows, fullT.cols); else state.headerRows = null;
          state.full = fullT;
          renderFull();
        }
      } catch (err) {
        if (root.isConnected) grid.innerHTML = U.errorBox(err, 'data-action="refresh"');
      }
    }
    function refreshView() {
      if (state.mode === 'full' && state.full) renderFull(); else loadPaged();
    }

    // events
    const doSearch = () => { state.q = qInput.value.trim(); state.page = 0; refreshView(); };
    qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
    qInput.addEventListener('input', U.debounce(() => { if (state.mode === 'full') doSearch(); else if (!qInput.value.trim() && state.q) doSearch(); }, 250));
    pagerEl.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pg]'); if (!b) return;
      if (b.dataset.pg === 'prev') state.page = Math.max(0, state.page - 1);
      if (b.dataset.pg === 'next') state.page += 1;
      refreshView();
    });
    pagerEl.addEventListener('change', (e) => {
      if (e.target.matches('.pg-input')) { state.page = Math.max(0, (parseInt(e.target.value, 10) || 1) - 1); refreshView(); }
      if (e.target.matches('[data-pg="size"]')) { state.pageSize = parseInt(e.target.value, 10); state.page = 0; refreshView(); }
    });
    grid.addEventListener('click', (e) => {
      const th = e.target.closest('th.sortable'); if (!th) return;
      const id = th.dataset.sort; if (!id) return;
      if (state.sort === id) { if (state.dir === 'asc') state.dir = 'desc'; else { state.sort = null; state.dir = 'asc'; } } else { state.sort = id; state.dir = 'asc'; }
      state.page = 0; refreshView();
    });
    root.addEventListener('click', (e) => {
      if (e.target.closest('[data-action="export-visible"]')) {
        const header = current.cols.map((c, i) => c.label || (current.headerRows[current.headerRows.length - 1] || [])[i] || c.id);
        U.downloadCsv(`${name}-page${state.page + 1}.csv`, header, current.rows.map((r) => current.cols.map((c, i) => D.cellText(r[i], c))));
      }
    });
    if (state.mode === 'full' && state.full && !fresh) { renderFull(); info.textContent = `${U.fmt(state.full.rows.length)} rows · ${state.full.cols.length} columns`; }
    else await load();
  }

  FF.pages.sheet = { title: 'Sheet', render };
})(window.FF);
