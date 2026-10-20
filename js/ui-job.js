/* =====================================================================================================
   UI · JOB SCREEN — load files, parts list, nest, sheets list, preview / report, downloads, status dials
   ===================================================================================================== */

// ---- LOAD FILES: drawing PDFs (P4) first, then DXF / NC parts (P2 + P3) ----
// Give a drawing's material to the loaded parts it belongs to (unless their gauge was typed by hand).
function applyDrawingToParts(entry) {
  const hit = S.parts.filter(p => (!p.thick || p._fromPdf) && pdfMatchesPart(entry, p.name));
  hit.forEach(p => { p.thick = entry.material; p._thickRaw = entry.raw; p._fromPdf = true; });
  return hit;
}
function partNotes(p) {
  return [p.removed && `${p.removed} stray removed`, p.bendRemoved && `${p.bendRemoved} bend line${p.bendRemoved > 1 ? 's' : ''} removed`, p.etchFound && `etch text found`, p.featSkipped && `${p.featSkipped} feature outline${p.featSkipped > 1 ? 's' : ''} skipped`, p._fixed && `gauge fixed by the laser rules`].filter(Boolean);
}
async function handleFiles(files) {
  // PDFs first, so a drawing dropped together with its DXF is already known when the DXF arrives
  files.sort((a, b) => (/\.pdf$/i.test(b.name) ? 1 : 0) - (/\.pdf$/i.test(a.name) ? 1 : 0));
  let added = 0, done = 0;
  for (const f of files) {
    showProgress('Loading files', `${f.name} · ${done + 1} of ${files.length}`, done / files.length, done / files.length);
    done++;
    const lower = f.name.toLowerCase();
    if (lower.endsWith('.pdf')) {
      const r = await readDrawingPdf(f);
      if (r.error) { log(r.error, r.kind); continue; }
      const entry = r.entry;
      S.pdfMats.push(entry);
      const hit = applyDrawingToParts(entry);
      log(`${f.name}: ${entry.material}${entry.raw ? ` (“${entry.raw}”)` : ''}${hit.length ? ` → ${hit.map(p => p.name).join(', ')}` : ' — waiting for its DXF'}`, entry.notStocked ? 'warn' : 'ok');
      if (entry.notStocked) log(`  “${entry.raw}” is not stocked (Satincoat, Galv, Stainless, 1/4" HRS) — check before cutting`, 'warn');
      if (hit.length) markStale();
      continue;
    }
    if (!lower.endsWith('.dxf') && !lower.endsWith('.nc')) { log(`${f.name}: not a .dxf, .nc or .pdf — skipped`, 'warn'); continue; }
    const name = f.name.replace(/\.(dxf|nc)$/i, '');
    const om = omitHitName(f.name);
    if (om) { log(`${f.name}: ${om} is never programmed (laser rules) — skipped`, 'warn'); continue; }
    if (S.parts.some(p => p.name.toLowerCase() === name.toLowerCase())) { log(`${name} is already loaded — change its quantity instead`, 'warn'); continue; }
    const r = await loadPartFile(f, cleanOpts(), S.pdfMats);
    if (r.error) { log(r.error, r.kind); continue; }
    const part = Object.assign({ id: 'p' + ++S.idc }, r.part);
    applyPartRules(part);
    S.parts.push(part);
    added++;
    const notes = partNotes(part);
    log(`${f.name}: ${part.w.toFixed(1)} × ${part.h.toFixed(1)} mm${part.thick ? ' · ' + part.thick : ''}${notes.length ? ' · ' + notes.join(', ') : ''}`, 'ok');
  }
  if (added) markStale();
  if (files.length) finishProgress('Loading files', `${files.length} file${files.length > 1 ? 's' : ''} read · ${added} part${added === 1 ? '' : 's'} added`, true);
  renderParts();
}
function wireFileDrop() {
  const fileInput = $('#fileInput'), drop = $('#drop');
  $('#loadBtn').onclick = () => fileInput.click();
  drop.onclick = () => fileInput.click();
  fileInput.onchange = () => { handleFiles([...fileInput.files]); fileInput.value = ''; };
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; drop.classList.add('over'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.classList.remove('over'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    drop.classList.remove('over');
    const fs = [...e.dataTransfer.files];
    if (!fs.length) return;
    handleFiles(fs);
  });
}

// ---- DRAWING: part thumbnails and sheet layouts as SVG ----
function thumbSvg(part, w, h) {
  const pad = 3, s = Math.min((w - 2 * pad) / (part.w || 1), (h - 2 * pad) / (part.h || 1)), ox = pad + (w - 2 * pad - part.w * s) / 2, oy = pad + (h - 2 * pad - part.h * s) / 2;
  const path = (ents, close) => {
    let d = '';
    for (const e of ents) for (const pl of e._t) d += pl.pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + (x - part.minX) * s).toFixed(1)},${(h - oy - (y - part.minY) * s).toFixed(1)}`).join('') + (close && pl.closed ? 'Z' : '');
    return d;
  };
  const d = path(part.entities, true), e2 = path(part.etchEntities || [], false);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}" fill="none" stroke="var(--accent)" stroke-width="1"/>${e2 ? `<path d="${e2}" fill="none" stroke="var(--muted)" stroke-width=".7"/>` : ''}</svg>`;
}
// Shown with the sheet LENGTH running left→right (machine origin bottom-left): screen X = sheet y, screen Y = sheet x.
function sheetSvg(sh, bed, margin, small) {
  const W = bed.w, H = bed.h;
  let g = '';
  for (const it of sh.items) {
    let d = '';
    for (const pl of it.R.polys) d += pl.pts.map(([X, Y], j) => `${j ? 'L' : 'M'}${(X - it.R.minx + it.x).toFixed(1)} ${(Y - it.R.miny + it.y).toFixed(1)}`).join('') + (pl.closed ? 'Z' : '');
    g += `<path d="${d}" stroke="${partColor(it.p.name)}"${it.added ? ' class="added"' : ''}><title>${esc(it.p.name)} · ${it.rot}°${it.added ? ' · added to the nest' : ''}</title></path>`;
  }
  let sk = '';
  for (const c of sh.skeleton || []) sk += `<line x1="${c.x0}" y1="${c.y}" x2="${c.x1}" y2="${c.y}" stroke="${c.section ? 'var(--warn)' : 'var(--bad)'}" stroke-width="${c.section ? 2.5 : 1.5}" stroke-dasharray="${c.section ? '14 8' : '20 12'}"><title>${c.section ? "section cut line (4') — drawn only, not in the .nc" : 'skeleton cut'}</title></line>`;
  return `<svg class="${small ? '' : 'sheetSvg'}" viewBox="-20 -20 ${H + 40} ${W + 40}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Sheet layout">
      <g transform="matrix(0,-1,1,0,0,${W})" fill="none" stroke-width="${small ? 1.6 : 1}" vector-effect="non-scaling-stroke" style="vector-effect:non-scaling-stroke">
        <rect x="0" y="0" width="${W}" height="${H}" fill="var(--sheet)" stroke="var(--sheet-line)" stroke-width="2"/>
        ${margin > 0 ? `<rect x="${margin}" y="${margin}" width="${W - 2 * margin}" height="${H - 2 * margin}" stroke="var(--line)" stroke-dasharray="8 8"/>` : ''}
        <line x1="0" y1="${sh.used}" x2="${W}" y2="${sh.used}" stroke="var(--accent)" stroke-opacity=".35" stroke-dasharray="4 10"/>
        <g class="parts" style="vector-effect:non-scaling-stroke">${g}</g>${sk}
        <circle cx="0" cy="0" r="${small ? 25 : 14}" fill="var(--accent2)" stroke="none"/>
      </g></svg>`;
}
function sheetLegend(sh) {
  const m = new Map();
  sh.items.forEach(it => m.set(it.p.name, (m.get(it.p.name) || 0) + 1));
  return [...m].sort((a, b) => a[0].localeCompare(b[0])).map(([n, c]) => `<span><span class="dot" style="background:${partColor(n)}"></span>${esc(n)} <b class="mono">×${c}</b></span>`).join('');
}

// ---- PARTS PANEL ----
function renderParts() {
  announceChange();
  if (typeof updateHud === 'function') try { updateHud(); } catch (e) {}
  if (typeof updateStatusPanel === 'function') try { updateStatusPanel(); } catch (e) {}
  const list = $('#partList'), mat = getMaterial();
  const total = S.parts.reduce((a, p) => a + (p.qty || 0), 0);
  $('#partCount').textContent = S.parts.length ? `${S.parts.length} parts · ${total} pcs` : '';
  $('#nestBtn').disabled = !S.parts.length || S.busy;
  const un = S.parts.filter(p => !hasGauge(p.thick));
  $('#gaugeWarn').innerHTML = un.length ? `<div class="warnbox">${un.length} part${un.length > 1 ? 's have' : ' has'} no gauge. ${un.length > 1 ? 'They' : 'It'} will nest in a separate “(no gauge)” group — set the gauge or drop the drawing PDF.</div>` : '';
  list.innerHTML = S.parts
    .map(p => {
      const fits = (p.w <= mat.w && p.h <= mat.h) || (p.h <= mat.w && p.w <= mat.h), noG = !hasGauge(p.thick), col = noG ? 'var(--bad)' : gaugeColor(p.thick);
      const notes = [p.removed && `${p.removed} stray`, p.bendRemoved && `${p.bendRemoved} bend`, p.etchFound && 'etch', p.featSkipped && `${p.featSkipped} feature`].filter(Boolean).join(' · ');
      return `<li class="part${noG ? ' nogauge' : ''}" data-id="${p.id}" style="border-left-color:${col}">
        <div>${thumbSvg(p, 40, 40)}</div>
        <div style="min-width:0"><div class="pn" title="${esc(p.name)}">${esc(p.name)} <span class="muted mono" style="font-weight:400;font-size:10px;">.${p.src}</span></div>
          <div class="pd mono ${fits ? '' : 'warn'}">${p.w.toFixed(1)} × ${p.h.toFixed(1)}${fits ? '' : ' — larger than the sheet'}${notes ? ' · ' + notes : ''}</div></div>
        <div class="ctl"><input class="num qIn" type="number" min="0" value="${p.qty}" title="Quantity" aria-label="Quantity"><button class="x" title="Remove" aria-label="Remove">✕</button></div>
        <div class="row2"><label>Gauge</label><input class="txt gIn" value="${esc(p.thick)}" placeholder="e.g. 14ga Satincoat" title="${esc(p._thickRaw ? 'From the drawing: ' + p._thickRaw : '')}">${p._fromPdf ? '<span class="tag">PDF</span>' : ''}</div>
        <label class="row2 turnRow${p.turn90 ? ' on' : ''}" title="This part always sits 90° (or 270°) from how it is drawn, whichever way the rest of the job runs"><input type="checkbox" class="turnChk"${p.turn90 ? ' checked' : ''}> Turn this part 90° from its drawing${p.turn90 ? ' · <b>on</b>' : ''}</label>
      </li>`;
    })
    .join('');
}
function wirePartsPanel() {
  $('#partList').addEventListener('change', e => {
    const li = e.target.closest('.part');
    if (!li) return;
    const p = S.parts.find(x => x.id === li.dataset.id);
    if (!p) return;
    if (e.target.classList.contains('qIn')) p.qty = Math.max(0, parseInt(e.target.value, 10) || 0);
    if (e.target.classList.contains('turnChk')) p.turn90 = e.target.checked;
    if (e.target.classList.contains('gIn')) { const raw = e.target.value.trim(), n = normalizeMaterial(raw); p.thick = n.label || raw; p._thickRaw = raw !== p.thick ? raw : ''; p._fromPdf = false; }
    markStale();
    renderParts();
  });
  $('#partList').addEventListener('click', e => {
    if (!e.target.classList.contains('x')) return;
    const li = e.target.closest('.part');
    S.parts = S.parts.filter(p => p.id !== li.dataset.id);
    markStale();
    renderParts();
  });
}

// ---- NEST (calls P5) ----
async function nestAll() {
  if (S.busy) return;
  if (!S.parts.length) { log('no parts to nest', 'bad'); return; }
  const banned = S.parts.filter(p => omitHitName(p.name));
  if (banned.length) { S.parts = S.parts.filter(p => !banned.includes(p)); log(`removed ${banned.length} part${banned.length > 1 ? 's' : ''} on the never-programmed list before nesting: ${banned.map(p => p.name).join(', ')}`, 'warn'); renderParts(); if (!S.parts.length) return; }
  const set = nestSettingsFromPanel(), byGauge = groupByGauge(S.parts);
  if (!byGauge.length) { log('every quantity is 0', 'bad'); return; }
  S.busy = true;
  setHudState('NESTING', 'busy');
  const btn = $('#nestBtn');
  btn.disabled = true;
  const t0 = performance.now();
  const pieces = byGauge.reduce((a, g) => a + g.list.reduce((b, p) => b + p.qty, 0), 0);
  log(`nesting ${pieces} pieces in ${byGauge.length} gauge${byGauge.length > 1 ? 's' : ''} on ${Math.round(set.mat.w)} × ${Math.round(set.mat.h)} mm, gap ${set.gap}, margin ${set.margin}…`);
  try {
    const before = byGauge.map((g, i) => byGauge.slice(0, i).reduce((a, x) => a + x.list.reduce((b, p) => b + p.qty, 0), 0)); // pieces in the groups before each one
    const onProgress = (gi, count, n, t) => {
      btn.textContent = `${count > 1 ? gi + 1 + '/' + count + ' ' : ''}${n}/${t}…`;
      showProgress('Nesting', `${byGauge[gi].gauge || '(no gauge)'} · ${n}/${t} pieces${count > 1 ? ` · group ${gi + 1} of ${count}` : ''}`, t ? n / t : 0, pieces ? (before[gi] + n) / pieces : 0);
    };
    const onGroupDone = g => {
      const sk = [...g.r.skipped].map(([p, n]) => `${p.name} ×${n}`);
      log(`${g.gauge || '(no gauge)'}: ${g.r.sheets.length} sheet${g.r.sheets.length === 1 ? '' : 's'}${g.r.auto ? " on 4' × 14'" : ''}, ${(avg(g.r.sheets.map(s => s.util)) * 100).toFixed(1)}% average use · ${g.r.strategy}${sk.length ? ' · did not fit (parts stay square-on for grain): ' + sk.join(', ') : ''}`, sk.length ? 'warn' : 'ok');
    };
    const res = await nestJob(S.parts, set, onProgress, onGroupDone);
    S.groups = res.groups; S.gi = 0; S.si = 0; S.stale = false;
    S.nestMs = performance.now() - t0; S.nestedAt = new Date();
    S.nestSettings = { ...set, bed: CONFIG.beds[S.bed].name };
    log(`done in ${(S.nestMs / 1000).toFixed(2)} s — ${flatSheets().length} sheets total`, 'ok');
    const d = reportData(S.groups);
    finishProgress('Nesting', `${flatSheets().length} sheets · ${d.nested} of ${d.req} pieces · ${(S.nestMs / 1000).toFixed(2)} s`, d.nested >= d.req);
  } catch (e) {
    log('nesting failed: ' + ((e && e.message) || e), 'bad');
    finishProgress('Nesting', 'failed — see the log', false);
    console.error(e);
  }
  S.busy = false;
  btn.textContent = 'Nest';
  renderParts(); renderSheets(); renderView(); updateHud();
}

// ---- SHEETS PANEL ----
function renderSheets() {
  announceChange();
  if (typeof updateHud === 'function') try { updateHud(); } catch (e) {}
  if (typeof updateStatusPanel === 'function') try { updateStatusPanel(); } catch (e) {}
  const ul = $('#sheetList'), flat = flatSheets();
  $('#sheetCount').textContent = flat.length ? `${flat.length} sheet${flat.length > 1 ? 's' : ''}${S.nestMs ? ' · ' + (S.nestMs / 1000).toFixed(2) + ' s' : ''}` : '';
  $('#staleNote').innerHTML = S.stale ? '<div class="staleNote">Parts or settings changed since this nest — press Nest again.</div>' : '';
  $('#zipBtn').disabled = !flat.length;
  $('#reportBtn').disabled = !flat.length;
  if (!flat.length) { ul.innerHTML = '<li class="muted" style="font-size:12px;">No nest yet.</li>'; return; }
  let n = 0, html = '';
  S.groups.forEach((g, gi) => {
    html += `<li class="groupHead"><span class="dot" style="background:${gaugeColor(g.gauge)}"></span>${esc(g.gauge || '(no gauge)')} · ${g.r.sheets.length} sheet${g.r.sheets.length > 1 ? 's' : ''}</li>`;
    g.r.sheets.forEach((s, si) => {
      n++;
      html += `<li class="sheetItem${gi === S.gi && si === S.si ? ' sel' : ''}" data-g="${gi}" data-s="${si}"><div class="si"><div class="sn">Sheet ${n}</div><div class="sm mono">${s.items.length} parts · ${(s.util * 100).toFixed(1)}% · ${Math.round(s.used)} mm</div><div class="ubar"><i class="${s.util < 0.5 ? 'lo' : ''}" style="width:${Math.min(100, s.util * 100).toFixed(1)}%"></i></div></div><button class="ghost mini ncBtn" title="Download this sheet's .nc">.nc</button></li>`;
    });
  });
  ul.innerHTML = html;
}
function wireSheetsPanel() {
  $('#nestBtn').onclick = nestAll;
  $('#sheetList').addEventListener('click', e => {
    const li = e.target.closest('.sheetItem');
    if (!li) return;
    const gi = +li.dataset.g, si = +li.dataset.s;
    if (e.target.classList.contains('ncBtn')) { downloadSheetNC(gi, si); return; }
    S.gi = gi; S.si = si; S.view = 'sheet';
    syncViewSeg(); renderSheets(); renderView();
  });
}

// ---- CENTRE VIEW: one sheet, or the report (P7) ----
function renderView() {
  const v = $('#view');
  if (!S.groups.length) {
    $('#mainTitle').textContent = 'Preview';
    v.innerHTML = `<div class="empty">${S.parts.length ? 'Set quantities and gauges, then press <b>Nest</b>.' : 'Load DXF files on the left (add the drawing PDFs too and the gauge is read from them).<br>Set quantities, then press <b>Nest</b>.<br>Each sheet gets its own .nc file, and the report sheet lists everything.'}</div>`;
    return;
  }
  if (S.view === 'report') {
    $('#mainTitle').textContent = 'Report sheet';
    v.innerHTML = reportHtml(currentJob());
    $('#rPrint').onclick = () => window.print();
    $('#rCsv').onclick = downloadCSV;
    return;
  }
  const g = S.groups[S.gi], sh = g.r.sheets[S.si], n = sheetNo(S.gi, S.si), gc = makeSheetNc(sh);
  $('#mainTitle').textContent = `Sheet ${n} of ${flatSheets().length} · ${g.gauge || '(no gauge)'}${g.r.auto ? " · 4' × 14'" : ''}`;
  v.innerHTML = `<div class="stats"><span><b>${sh.items.length}</b> parts</span><span><b>${(sh.util * 100).toFixed(1)}%</b> material used</span><span><b>${Math.round(sh.used)}</b> of ${Math.round(g.r.bed.h)} mm length</span><span><b>${gc.pierces}</b> pierces</span>${(() => { const k = sh.skeleton || [], nS = k.filter(x => x.section).length, nK = k.length - nS; return (nS ? `<span><b>${nS}</b> section line${nS > 1 ? 's' : ''} (4')</span>` : '') + (nK ? `<span><b>${nK}</b> skeleton cut</span>` : ''); })()}${sh.added ? `<span style="color:var(--ok)">+${sh.added} added</span>` : ''}<span><b>${(gc.cutLen / 1000).toFixed(1)}</b> m cut</span>${gc.openCount ? `<span style="color:var(--warn)"><b>${gc.openCount}</b> open contour${gc.openCount > 1 ? 's' : ''}</span>` : ''}
      <span style="margin-left:auto"><button class="ghost mini" id="dlThis">Download ${esc(ncName(S.gi, S.si))}</button></span></div>
      ${sheetSvg(sh, g.r.bed, g.r.grid.margin, false)}<div class="legend">${sheetLegend(sh)}</div>`;
  $('#dlThis').onclick = () => downloadSheetNC(S.gi, S.si);
}
function setView(v) { S.view = v; syncViewSeg(); renderView(); }
function syncViewSeg() { document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.v === S.view)); }
function wireView() {
  document.querySelectorAll('#viewSeg button').forEach(b => (b.onclick = () => setView(b.dataset.v)));
  $('#reportBtn').onclick = () => setView('report');
}

// ---- DOWNLOADS (P6 / P7 output to files) ----
function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function downloadSheetNC(gi, si) {
  const g = makeSheetNc(S.groups[gi].r.sheets[si]);
  saveBlob(ncName(gi, si), new Blob([g.text], { type: 'text/plain' }));
  log(`saved ${ncName(gi, si)} (${g.pierces} pierces)`, 'ok');
  if (g.openCount) log(`  ${g.openCount} contour(s) did not close — check those parts`, 'warn');
}
async function downloadZip() {
  if (!S.groups.length) { log('nothing nested yet', 'bad'); return; }
  if (typeof JSZip === 'undefined') { log('zip library not loaded — downloading the files one by one', 'warn'); flatSheets().forEach(f => downloadSheetNC(f.gi, f.si)); return; }
  const job = currentJob(), files = makeJobNcFiles(S.groups, job.name), open = files.reduce((a, f) => a + f.openCount, 0), slug = jobSlug(job.name);
  saveBlob(`${slug}_nc.zip`, await makeJobZip(files.concat({ name: `${slug}_report.csv`, text: reportCsv(job) })));
  log(`saved ${slug}_nc.zip — ${files.length} .nc files + report.csv`, 'ok');
  if (open) log(`  ${open} contour(s) did not close — check those parts before cutting`, 'warn');
}
function downloadCSV() {
  if (!S.groups.length) { log('nothing nested yet', 'bad'); return; }
  const slug = jobSlug(jobName());
  saveBlob(`${slug}_report.csv`, new Blob([reportCsv(currentJob())], { type: 'text/csv' }));
  log(`saved ${slug}_report.csv`, 'ok');
}
function wireDownloads() { $('#zipBtn').onclick = downloadZip; }

// ---- STATUS: title-bar state, clock, dial gauges, readouts ----
function setHudState(text, cls) { const el = $('#hudState'); el.textContent = text; el.className = 'hudState' + (cls ? ' ' + cls : ''); }
function setGauge(id, frac, label, cls) {
  const g = $('#' + id), c = g.querySelector('.val'), L = 2 * Math.PI * 38;
  c.style.strokeDasharray = L;
  c.style.strokeDashoffset = L * (1 - Math.max(0, Math.min(1, frac || 0)));
  g.querySelector('b').textContent = label;
  g.className = 'gauge' + (cls ? ' ' + cls : '');
}
function updateHud() {
  const pcs = S.parts.reduce((a, p) => a + (p.qty || 0), 0), withG = S.parts.filter(p => hasGauge(p.thick)).length, flat = flatSheets();
  $('#roParts').textContent = S.parts.length;
  $('#roPcs').textContent = pcs;
  $('#roSheets').textContent = flat.length;
  $('#roTime').textContent = S.nestMs && flat.length ? (S.nestMs / 1000).toFixed(2) + ' s' : '—';
  setGauge('gGauge', S.parts.length ? withG / S.parts.length : 0, S.parts.length ? Math.round((100 * withG) / S.parts.length) + '%' : '—', !S.parts.length ? '' : withG === S.parts.length ? 'ok' : 'warn');
  if (flat.length) {
    const use = avg(S.groups.flatMap(g => g.r.sheets.map(s => s.util))), d = reportData(S.groups), nf = d.req ? d.nested / d.req : 0;
    setGauge('gUse', use, Math.round(use * 100) + '%', use < 0.5 ? 'warn' : '');
    setGauge('gNest', nf, Math.round(nf * 100) + '%', nf < 1 ? 'bad' : 'ok');
  } else { setGauge('gUse', 0, '—'); setGauge('gNest', 0, '—'); }
  if (S.busy) return;
  if (!S.parts.length) setHudState('IDLE');
  else if (!flat.length) setHudState('READY');
  else if (S.stale) setHudState('RE-NEST', 'stale');
  else { const d = reportData(S.groups); d.nested < d.req ? setHudState('SHORT ' + (d.req - d.nested), 'bad') : setHudState('NEST OK', 'ok'); }
}
function startClock() {
  const p = v => String(v).padStart(2, '0');
  const clk = () => { const d = new Date(); $('#hudClock').textContent = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
  clk();
  setInterval(clk, 1000);
}
