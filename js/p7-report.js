/* =====================================================================================================
   P7 · REPORT SHEET — what was nested, on which sheet, and what is short
   job = {name, groups, settings:{bed, mat, gap, margin}, nestedAt, nestMs, stale}   (built by currentJob() in the UI)
   reportData(groups) → {rows:[{gi, gauge, name, size, req, n, on}], req, nested, sheets}
   reportHtml(job)    → the report page (screen and print)
   reportCsv(job)     → the same as CSV text
   ===================================================================================================== */

const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

// Sheets numbered 1..n across every gauge group.
function sheetNumber(groups, gi, si) {
  let n = 0;
  for (let g = 0; g < gi; g++) n += groups[g].r.sheets.length;
  return n + si + 1;
}
function flatSheetsOf(groups) {
  const out = [];
  groups.forEach((g, gi) => g.r.sheets.forEach((s, si) => out.push({ gi, si })));
  return out;
}

function reportData(groups) {
  const rows = [];
  let req = 0, nested = 0, sheets = 0;
  groups.forEach((g, gi) => {
    // count each part per sheet
    const per = new Map();
    g.r.sheets.forEach((sh, si) => {
      sheets++;
      sh.items.forEach(it => {
        const e = per.get(it.p) || { n: 0, on: new Map() }, k = sheetNumber(groups, gi, si);
        e.n++;
        e.on.set(k, (e.on.get(k) || 0) + 1);
        per.set(it.p, e);
      });
    });
    g.req.forEach(q => {
      const e = per.get(q.part) || { n: 0, on: new Map() };
      req += q.qty;
      nested += e.n;
      rows.push({ gi, gauge: g.gauge || '(no gauge)', name: q.part.name, size: `${q.part.w.toFixed(1)} × ${q.part.h.toFixed(1)}`, req: q.qty, n: e.n, on: [...e.on].map(([k, v]) => `${k}: ${v}`).join('  ') });
    });
  });
  return { rows, req, nested, sheets };
}

function reportHtml(job) {
  const groups = job.groups, d = reportData(groups), st = job.settings || {}, title = (job.name || '').trim() || 'Untitled job', when = job.nestedAt ? job.nestedAt.toLocaleString() : '';
  const allUtil = avg(groups.flatMap(g => g.r.sheets.map(s => s.util)));
  let html = `<div class="report">
      <div class="tools"><button class="ghost mini" id="rPrint">Print / save as PDF</button><button class="ghost mini" id="rCsv">Download CSV</button></div>
      ${job.stale ? '<div class="staleNote">Parts or settings changed since this nest — this report is for the last nest.</div>' : ''}
      <div class="rhead"><div><div class="muted" style="font-size:11px;letter-spacing:.08em;">JOB REPORT</div><h3>${esc(title)}</h3><div class="muted">${esc(when)}</div></div>
        <div class="kv"><span>Machine</span><span>${esc(st.bed || '')}</span><span>Sheet</span><span class="mono">${Math.round(st.mat ? st.mat.w : 0)} × ${Math.round(st.mat ? st.mat.h : 0)} mm</span><span>Gap / margin</span><span class="mono">${st.gap} / ${st.margin} mm</span><span>Sheets</span><b>${d.sheets}</b><span>Parts nested</span><b class="${d.nested < d.req ? 'short' : ''}">${d.nested} of ${d.req}${d.nested < d.req ? ` — ${d.req - d.nested} NOT NESTED` : ''}</b><span>Average use</span><span class="mono">${(allUtil * 100).toFixed(1)}%</span><span>Nest time</span><span class="mono">${(job.nestMs / 1000).toFixed(2)} s</span></div></div>`;
  groups.forEach((g, gi) => {
    // sheets table
    html += `<h4><span class="dot" style="background:${gaugeColor(g.gauge)}"></span>${esc(g.gauge || '(no gauge set)')} — ${g.r.sheets.length} sheet${g.r.sheets.length > 1 ? 's' : ''}${g.r.auto ? ` <span class="muted">· ${Math.round(g.r.bed.w)} × ${Math.round(g.r.bed.h)} mm (4' × 14')</span>` : ''}${g.r.strategy ? ` <span class="muted" style="font-weight:400">· ${esc(g.r.strategy)}</span>` : ''}</h4>
        <table><thead><tr><th>Sheet</th><th class="thumb">Layout</th><th>NC file</th><th>Parts</th><th>Use</th><th>Length used</th><th>Pierces</th><th>Cut length</th></tr></thead><tbody>`;
    g.r.sheets.forEach((sh, si) => {
      const gc = makeSheetNc(sh);
      html += `<tr><td class="n">${sheetNumber(groups, gi, si)}</td><td class="thumb">${sheetSvg(sh, g.r.bed, g.r.grid.margin, true)}</td><td class="mono" style="font-size:11px;">${esc(ncFileName(job.name, g.gauge, si))}</td><td class="n">${sh.items.length}</td><td class="n">${(sh.util * 100).toFixed(1)}%</td><td class="n">${Math.round(sh.used)} mm</td><td class="n">${gc.pierces}</td><td class="n">${(gc.cutLen / 1000).toFixed(1)} m</td></tr>`;
    });
    // parts table
    html += `</tbody></table><table><thead><tr><th>Part</th><th>Size (mm)</th><th>Required</th><th>Nested</th><th>On sheets</th><th>Status</th></tr></thead><tbody>`;
    d.rows
      .filter(r => r.gi === gi)
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(r => {
        const ok = r.n >= r.req;
        html += `<tr><td>${esc(r.name)}</td><td class="mono">${r.size}</td><td class="n">${r.req}</td><td class="n">${r.n}</td><td class="mono" style="font-size:11px;">${esc(r.on)}</td><td class="${ok ? 'okc' : 'short'}">${ok ? 'OK' : 'SHORT ' + (r.req - r.n)}</td></tr>`;
      });
    html += '</tbody></table>';
  });
  return html + '</div>';
}

function reportCsv(job) {
  const q = v => { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const groups = job.groups, name = (job.name || '').trim();
  const lines = [['Job', 'Gauge', 'Part', 'Size mm', 'Required', 'Nested', 'On sheets', 'Status'].join(',')];
  reportData(groups).rows.forEach(r => lines.push([name, r.gauge, r.name, r.size, r.req, r.n, r.on, r.n >= r.req ? 'OK' : 'SHORT ' + (r.req - r.n)].map(q).join(',')));
  lines.push('');
  lines.push(['Sheet', 'Gauge', 'NC file', 'Parts', 'Use %', 'Length used mm'].join(','));
  flatSheetsOf(groups).forEach(f => {
    const g = groups[f.gi], sh = g.r.sheets[f.si];
    lines.push([sheetNumber(groups, f.gi, f.si), g.gauge || '(no gauge)', ncFileName(job.name, g.gauge, f.si), sh.items.length, (sh.util * 100).toFixed(1), Math.round(sh.used)].map(q).join(','));
  });
  return lines.join('\r\n') + '\r\n';
}
