/* =====================================================================================================
   UI · STATUS BOX (#side) — the control panel from nest_admin 2, in NC Drive's look
     Nest           Add new parts to the current nest (placed parts never move) · quantities by zone · clear all
     Parts folder   link folders, pull parts by number (.NC, else .DXF, plus the PDF)          uses P8 (p8-search.js)
     Machine        material on hand, checked against the bed · reset to bed size                    (ui-core.js)
     Laser rules    never-programmed numbers, fixed materials, DXF-only parts                 CONFIG.rules
     Settings lock  Spacing and DXF clean-up locked until the admin key is typed               CONFIG.admin
   ===================================================================================================== */

// =====================================================================================================
// LASER RULES — omit list (never programmed), fixed materials, DXF-only parts
// =====================================================================================================
let omitExtra = [];
try { omitExtra = JSON.parse(ls.get('omitExtra', '[]')).map(String).filter(x => /^\d{4,6}[A-Za-z]{0,3}$/.test(x)); } catch (e) {}
const omitList = () => [...new Set([...CONFIG.rules.omit, ...omitExtra])];
// the first part-number token in a file or part name ("14443_6781.dxf" → "14443", "13824W_0508 - 1" → "13824W")
const partToken = name => { const m = /(?<!\d)(\d{4,6}[A-Za-z]*)(?![A-Za-z0-9])/.exec(String(name || '').replace(/\.[^.]+$/, '')); return m ? m[1] : ''; };
// An entry covers a number that starts with it and isn't continued by another digit: 13824 covers 13824_0508 and 13824W, not 138240.
const omitMatch = (tok, e) => { tok = String(tok).toLowerCase(); e = String(e).toLowerCase(); return tok.startsWith(e) && (tok.length === e.length || !/\d/.test(tok[e.length])); };
// → the omit entry a part / file name belongs to, or ''
function omitHitName(name) {
  const stem = String(name || '').replace(/\.[^.]+$/, '');
  if (/^ON/i.test(stem)) return '';
  const t = partToken(stem), L = omitList();
  return t ? L.find(e => e.toLowerCase() === t.toLowerCase()) || L.find(e => omitMatch(t, e)) || '' : '';
}
// → the gauge a part always gets, or ''
function fixedMaterialOf(name) {
  const stem = String(name || '').replace(/\.[^.]+$/, '').replace(/[\s_]+-[\s_]*\d{1,2}$/, '').replace(/\s+/g, '_');
  if (/^ON[-_]?\d{3,6}.*_(HR|CR|SR)$/i.test(stem)) return CONFIG.rules.railMaterial;
  if (/^ON/i.test(stem)) return '';
  return CONFIG.rules.fixedMaterial[partToken(stem)] || '';
}
const isDxfOnly = term => CONFIG.rules.dxfOnly.includes(partToken(term) || String(term));
// Called by handleFiles for every part it adds: a fixed material wins over the drawing.
function applyPartRules(p) {
  const fm = fixedMaterialOf(p.name);
  if (fm && p.thick !== fm) { p._thickRaw = p.thick || ''; p.thick = fm; p._fromPdf = false; p._fixed = true; }
}
function renderRules() {
  const admin = isAdmin();
  $('#omitChips').innerHTML = CONFIG.rules.omit.map(n => `<span class="rchip locked mono">🔒 ${esc(n)}</span>`).join('') +
    omitExtra.map(n => `<span class="rchip mono">${esc(n)}${admin ? ` <button class="x omitx" data-n="${esc(n)}" title="Remove">✕</button>` : ''}</span>`).join('') +
    '<span class="hint">and all their variants</span>';
  $('#omitAdmin').hidden = !admin;
  const fx = Object.keys(CONFIG.rules.fixedMaterial);
  $('#fixedNote').innerHTML = `Always <b>${esc(CONFIG.rules.railMaterial)}</b>: ${fx.map(esc).join(', ')} and ON rails (_HR, _CR, _SR).` +
    (CONFIG.rules.dxfOnly.length ? `<br>Always cut from the DXF: ${CONFIG.rules.dxfOnly.map(esc).join(', ')}.` : '');
}
function wireRules() {
  $('#omitChips').addEventListener('click', e => {
    const b = e.target.closest('.omitx');
    if (!b || !isAdmin()) return;
    omitExtra = omitExtra.filter(x => x !== b.dataset.n);
    ls.set('omitExtra', JSON.stringify(omitExtra));
    renderRules();
  });
  $('#omitAdd').onclick = () => {
    const i = $('#omitIn'), v = i.value.trim();
    if (!isAdmin()) return;
    if (!/^\d{4,6}[A-Za-z]{0,3}$/.test(v)) { i.style.borderColor = 'var(--bad)'; return; }
    i.style.borderColor = '';
    if (!omitList().includes(v)) { omitExtra.push(v); ls.set('omitExtra', JSON.stringify(omitExtra)); log(`${v} added to the never-programmed list`, 'ok'); }
    i.value = '';
    renderRules();
  };
  $('#omitIn').addEventListener('keydown', e => { if (e.key === 'Enter') $('#omitAdd').click(); });
  $('#omitCopy').onclick = async () => {
    const t = omitList().join(', ');
    try { await navigator.clipboard.writeText(t); $('#omitCopy').textContent = 'Copied'; setTimeout(() => ($('#omitCopy').textContent = 'Copy list'), 1500); }
    catch (e) { prompt('Never-programmed list:', t); }
  };
  renderRules();
}

// =====================================================================================================
// SETTINGS LOCK — Spacing and DXF clean-up are locked until the admin key is typed (remembered by this browser)
// =====================================================================================================
const isAdmin = () => !CONFIG.admin.lockedByDefault || ls.get('admin', '') === '1';
function applyLockState() {
  const admin = isAdmin();
  CONFIG.admin.lockIds.forEach(id => { const el = $('#' + id); if (el) el.disabled = !admin; });
  $('#lockStatus').textContent = admin ? '🔓 Admin mode' : '🔒 Settings locked';
  $('#lockStatus').title = admin ? 'Click to lock the Spacing and DXF clean-up settings again' : 'Spacing and DXF clean-up are locked. Click to type the admin key.';
  $('#unlockRow').hidden = true;
  $('#side').classList.toggle('locked', !admin);
  renderRules();
}
function unlockSettings(key) {
  if (key !== CONFIG.admin.key) return false;
  ls.set('admin', '1');
  applyLockState();
  log('settings unlocked (admin mode)', 'ok');
  return true;
}
function lockSettings() { ls.set('admin', ''); applyLockState(); log('settings locked'); }
function wireLock() {
  $('#lockStatus').onclick = () => {
    if (!CONFIG.admin.lockedByDefault) return;
    if (isAdmin()) return lockSettings();
    $('#unlockRow').hidden = !$('#unlockRow').hidden;
    if (!$('#unlockRow').hidden) $('#unlockKey').focus();
  };
  $('#unlockGo').onclick = () => {
    const k = $('#unlockKey');
    if (!unlockSettings(k.value)) { k.value = ''; k.placeholder = 'wrong key'; }
    else k.value = '';
  };
  $('#unlockKey').addEventListener('keydown', e => { if (e.key === 'Enter') $('#unlockGo').click(); });
  applyLockState();
}

// =====================================================================================================
// ADD TO THE CURRENT NEST — only the new copies are fitted; nothing already placed moves (P5 addToGroup)
// =====================================================================================================
// What changed since the nest was made: copies to add per group, parts in a gauge with no nest yet, quantities that went down.
function nestDeltas() {
  const out = { adds: [], newGauge: [], cut: [], total: 0 };
  if (!S.groups.length) return out;
  const nested = new Map(), live = new Set();
  S.groups.forEach((g, gi) => g.req.forEach(q => nested.set(gi + '|' + q.part.id, q.qty)));
  for (const p of S.parts) {
    if (!(p.qty > 0)) continue;
    const gi = S.groups.findIndex(g => normThick(g.gauge) === normThick(p.thick));
    if (gi < 0) { out.newGauge.push(p); out.total += p.qty; continue; }
    live.add(gi + '|' + p.id);
    const d = p.qty - (nested.get(gi + '|' + p.id) || 0);
    if (d > 0) { out.adds.push({ gi, p, n: d }); out.total += d; }
    else if (d < 0) out.cut.push(`${p.name} (−${-d})`);
  }
  S.groups.forEach((g, gi) => g.req.forEach(q => { if (!live.has(gi + '|' + q.part.id) && q.qty > 0) out.cut.push(`${q.part.name} (removed)`); }));
  return out;
}
// The placements stay valid only for the same gap, margin and sheet size.
function nestStillFits() {
  const set = nestSettingsFromPanel(), o = S.nestSettings;
  return !!o && o.gap === set.gap && o.margin === set.margin && o.mat.w === set.mat.w && o.mat.h === set.mat.h;
}
function updateAddNestBtn() {
  const b = $('#addNestBtn');
  if (!b) return;
  let n = 0;
  try { n = nestDeltas().total; } catch (e) {}
  b.hidden = !(S.groups.length && S.parts.length && n > 0);
  b.disabled = S.busy;
  if (!S.busy) b.textContent = `Add ${n} new part${n === 1 ? '' : 's'} to the current nest`;
}
async function addToCurrentNest() {
  if (S.busy) return false;
  const D = nestDeltas(), btn = $('#addNestBtn');
  if (!S.groups.length) { log('there is no nest yet — press Nest', 'bad'); return false; }
  if (!D.total) { log(D.cut.length ? `quantities went down for ${D.cut.join(', ')}; a placed part can't be removed this way — press Nest to nest again` : 'nothing new to add', 'warn'); return false; }
  if (!nestStillFits()) { log('the gap, margin or sheet size changed since this nest was made, so new parts can\'t be fitted around it — press Nest to nest everything again', 'bad'); return false; }
  S.busy = true;
  setHudState('ADDING', 'busy');
  btn.disabled = true;
  const t0 = performance.now(), notes = [], set = S.nestSettings;
  let first = null;
  try {
    const byGroup = new Map();
    D.adds.forEach(a => { if (!byGroup.has(a.gi)) byGroup.set(a.gi, []); byGroup.get(a.gi).push({ p: a.p, n: a.n }); });
    for (const [gi, adds] of byGroup) {
      const g = S.groups[gi], nBefore = g.r.sheets.length, total = adds.reduce((a, x) => a + x.n, 0);
      const gained = await addToGroup(g.r, adds, { onProgress: (n, t) => { btn.textContent = `Adding ${g.gauge || '(no gauge)'} ${n}/${t}…`; showProgress('Add to nest', `${g.gauge || '(no gauge)'} · ${n}/${t} pieces`, t ? n / t : 0, t ? n / t : 0); } });
      const onOld = gained.slice(0, nBefore).reduce((a, x) => a + x, 0), onNew = gained.slice(nBefore).reduce((a, x) => a + x, 0);
      const where = gained.map((x, i) => (x ? `sheet ${sheetNo(gi, i)} +${x}` : '')).filter(Boolean);
      const sk = [...g.r.skipped].map(([p, n]) => `${p.name} ×${n}`);
      notes.push(`${g.gauge || '(no gauge)'}: ${total} added, ${onOld} into free space on existing sheets${onNew ? `, ${onNew} on ${g.r.sheets.length - nBefore} new sheet${g.r.sheets.length - nBefore > 1 ? 's' : ''}` : ''}${where.length ? ' (' + where.join(', ') + ')' : ''}${sk.length ? ' · did not fit: ' + sk.join(', ') : ''}`);
      // the group's requirement now matches the parts list
      for (const { p, n } of adds) { const q = g.req.find(x => x.part === p); if (q) q.qty += n; else g.req.push({ part: p, qty: n }); }
      if (!first) { const si = gained.findIndex(x => x > 0); first = { gi, si: Math.max(0, si) }; }
    }
    // parts in a gauge that has no nest yet get their own nest
    for (const { gauge, list } of groupByGauge(D.newGauge)) {
      const r = await nestGroup(list, set.mat, set.gap, set.margin, { skeleton: set.skeleton, onProgress: (n, t) => { btn.textContent = `Nesting ${gauge || '(no gauge)'} ${n}/${t}…`; } });
      S.groups.push({ gauge, r, req: list.map(p => ({ part: p, qty: p.qty })) });
      notes.push(`${gauge || '(no gauge)'}: a new gauge, ${list.reduce((a, p) => a + p.qty, 0)} pieces on ${r.sheets.length} new sheet${r.sheets.length === 1 ? '' : 's'}`);
      if (!first) first = { gi: S.groups.length - 1, si: 0 };
    }
    notes.forEach(n => log(n, /did not fit/.test(n) ? 'warn' : 'ok'));
    if (D.cut.length) log(`quantities went down for ${D.cut.join(', ')} — placed parts were left alone; press Nest to nest again if they must come off`, 'warn');
    $('#addInfo').textContent = notes.join(' · ');
    S.nestMs += performance.now() - t0;
    S.stale = false;
    if (first) { S.gi = first.gi; S.si = first.si; S.view = 'sheet'; syncViewSeg(); }
    const d = reportData(S.groups);
    finishProgress('Add to nest', `${flatSheets().length} sheets · ${d.nested} of ${d.req} pieces`, d.nested >= d.req);
  } catch (e) {
    log('adding to the nest failed: ' + ((e && e.message) || e), 'bad');
    finishProgress('Add to nest', 'failed — see the log', false);
    console.error(e);
  }
  S.busy = false;
  renderParts(); renderSheets(); renderView(); updateHud();
  return true;
}

// =====================================================================================================
// ZONES — parts down the side, zones across the top, quantities typed straight into the grid
// =====================================================================================================
let zones = [], zoneSeq = 0;
const newZone = name => ({ id: ++zoneSeq, name: name || 'Zone ' + (zones.length + 1) });
const zq = (p, z) => (p.zq && p.zq[z.id]) || 0;
// "12 + 8"  ·  "3x4"  ·  "4 x 6 + 10"  → total, or NaN
function zoneCellQty(txt) {
  txt = String(txt || '').trim();
  if (!txt) return 0;
  let total = 0;
  for (const tok of txt.split(/[+,;\n]+/)) {
    const t = tok.trim();
    if (!t) continue;
    const m = /^(?:.+?\s*[:=]\s*)?(\d+(?:\s*[x×*]\s*\d+)*)$/i.exec(t);
    if (!m) return NaN;
    total += m[1].split(/\s*[x×*]\s*/i).reduce((a, b) => a * parseInt(b, 10), 1);
  }
  return Math.min(total, 9999);
}
function setZoneQty(p, z, q) { p.zq = p.zq || {}; if (q > 0) p.zq[z.id] = q; else delete p.zq[z.id]; }
// a part's quantity comes from its zone cells (a part with no zone quantity keeps the quantity in the parts list)
function syncPartFromZones(p) {
  const ents = zones.map(z => ({ zone: z.name, qty: zq(p, z) })).filter(e => e.qty > 0);
  if (ents.length) { p.zones = ents; p.qty = Math.min(9999, ents.reduce((a, e) => a + e.qty, 0)); p._zoneMode = true; }
  else if (p._zoneMode) { p.zones = null; p._zoneMode = false; }
}
const syncAllFromZones = () => S.parts.forEach(syncPartFromZones);
function openZoneGrid() {
  if (!S.parts.length) return log('load parts first', 'bad');
  if (!zones.length) zones.push(newZone());
  renderZoneGrid();
  $('#zoneModal').classList.add('open');
  const f = $('#zoneGrid .zq');
  if (f) f.focus();
}
function closeZoneGrid() {
  $('#zoneModal').classList.remove('open');
  syncAllFromZones();
  markStale();
  renderParts();
  const used = zones.filter(z => S.parts.some(p => zq(p, z)));
  if (used.length) log(`quantities set from ${used.length} zone${used.length > 1 ? 's' : ''}: ${used.map(z => z.name).join(', ')}`, 'ok');
}
function zoneFooterNumbers() {
  const g = $('#zoneGrid');
  S.parts.forEach(p => { const t = g.querySelector(`.zt[data-p="${p.id}"]`); if (t) t.textContent = p._zoneMode ? p.qty : p.zq && Object.keys(p.zq).length ? '' : '(' + p.qty + ')'; });
  let grand = 0;
  zones.forEach(z => { const sum = S.parts.reduce((a, p) => a + zq(p, z), 0); grand += sum; const c = g.querySelector(`.zc[data-z="${z.id}"]`); if (c) c.textContent = sum; });
  const gt = g.querySelector('#zGrand');
  if (gt) gt.textContent = grand;
  const using = S.parts.some(p => p._zoneMode), missing = using ? S.parts.filter(p => !p._zoneMode) : [];
  $('#zWarn').textContent = missing.length ? `${missing.length} part${missing.length > 1 ? 's have' : ' has'} no zone quantity: ${missing.length > 1 ? 'they' : 'it'} will nest with the quantity in the parts list.` : '';
}
function renderZoneGrid() {
  $('#zoneGrid').innerHTML = `<thead><tr><th class="zp">Part</th>${zones.map(z => `<th><input class="txt zn" data-z="${z.id}" value="${esc(z.name)}"><div><button class="ghost mini zdup" data-z="${z.id}" title="Copy this zone's quantities into a new zone">Duplicate</button> <button class="ghost mini zdel" data-z="${z.id}" title="Delete this zone">✕</button></div></th>`).join('')}<th>Total</th></tr></thead>
  <tbody>${S.parts.map((p, r) => `<tr><td class="zp" title="${esc(p.name)}">${esc(p.name)}<small>${esc(p.thick || 'no gauge set')}</small></td>${zones.map((z, c) => `<td><input class="num zq" inputmode="numeric" data-r="${r}" data-c="${c}" data-p="${p.id}" data-z="${z.id}" value="${zq(p, z) || ''}"></td>`).join('')}<td class="zt mono" data-p="${p.id}"></td></tr>`).join('')}</tbody>
  <tfoot><tr><td class="zp">Zone total</td>${zones.map(z => `<td class="zc mono" data-z="${z.id}"></td>`).join('')}<td class="zc mono" id="zGrand"></td></tr></tfoot>`;
  zoneFooterNumbers();
}
function wireZones() {
  const g = $('#zoneGrid'), part = id => S.parts.find(x => x.id === id), zone = id => zones.find(x => x.id == id);
  g.addEventListener('focusin', e => { if (e.target.classList.contains('zq')) e.target.select(); });
  g.addEventListener('input', e => {
    const t = e.target;
    if (!t.classList.contains('zq')) return;
    const p = part(t.dataset.p), q = zoneCellQty(t.value);
    t.classList.toggle('bad', isNaN(q));
    if (isNaN(q)) return;
    setZoneQty(p, zone(t.dataset.z), q); syncPartFromZones(p); zoneFooterNumbers();
  });
  g.addEventListener('change', e => {
    const t = e.target;
    if (t.classList.contains('zq')) { const q = zoneCellQty(t.value); if (!isNaN(q)) t.value = q || ''; }
    if (t.classList.contains('zn')) { const z = zone(t.dataset.z); z.name = t.value.trim() || z.name; t.value = z.name; syncAllFromZones(); }
  });
  g.addEventListener('keydown', e => {
    const t = e.target;
    if (!t.classList.contains('zq')) return;
    const r = +t.dataset.r, c = +t.dataset.c;
    let nr = r, nc = c;
    if (e.key === 'Enter') { nr = r + (e.shiftKey ? -1 : 1); if (nr >= S.parts.length) { nr = 0; nc = c + 1; } else if (nr < 0) { nr = S.parts.length - 1; nc = c - 1; } }
    else if (e.key === 'ArrowDown') nr = r + 1;
    else if (e.key === 'ArrowUp') nr = r - 1;
    else if (e.key === 'ArrowRight' && t.selectionStart === t.value.length) nc = c + 1;
    else if (e.key === 'ArrowLeft' && t.selectionStart === 0) nc = c - 1;
    else return;
    e.preventDefault();
    const n = g.querySelector(`.zq[data-r="${nr}"][data-c="${nc}"]`);
    if (n) { n.focus(); n.select(); }
  });
  // a block copied from a spreadsheet fills the grid from the selected cell (adding zones if the block is wider)
  g.addEventListener('paste', e => {
    const t = e.target;
    if (!t.classList.contains('zq')) return;
    const txt = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (!/[\t\n]/.test(txt.trim())) return;
    e.preventDefault();
    const r0 = +t.dataset.r, c0 = +t.dataset.c;
    txt.replace(/\r/g, '').split('\n').filter(l => l.trim() !== '').forEach((line, i) => {
      const p = S.parts[r0 + i];
      if (!p) return;
      line.split('\t').forEach((v, j) => { const q = zoneCellQty(v); if (isNaN(q) || v.trim() === '') return; while (c0 + j >= zones.length) zones.push(newZone()); setZoneQty(p, zones[c0 + j], q); });
    });
    syncAllFromZones(); renderZoneGrid();
    const n = g.querySelector(`.zq[data-r="${r0}"][data-c="${c0}"]`);
    if (n) n.focus();
  });
  g.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const z = zone(b.dataset.z);
    if (b.classList.contains('zdup')) {
      const nz = newZone(z.name + ' (copy)');
      zones.splice(zones.indexOf(z) + 1, 0, nz);
      S.parts.forEach(p => { if (zq(p, z)) setZoneQty(p, nz, zq(p, z)); });
      syncAllFromZones(); renderZoneGrid();
    }
    if (b.classList.contains('zdel')) {
      if (!armButton(b, 'sure?')) return;
      S.parts.forEach(p => { if (p.zq) delete p.zq[z.id]; });
      zones = zones.filter(x => x !== z);
      syncAllFromZones(); renderZoneGrid();
    }
  });
  $('#zAdd').onclick = () => { zones.push(newZone()); renderZoneGrid(); const f = g.querySelector(`.zq[data-r="0"][data-c="${zones.length - 1}"]`); if (f) f.focus(); };
  $('#zClear').onclick = function () { if (!armButton(this, 'Click again to clear everything')) return; S.parts.forEach(p => { p.zq = {}; }); syncAllFromZones(); renderZoneGrid(); };
  $('#zDone').onclick = closeZoneGrid;
  $('#zoneBtn').onclick = openZoneGrid;
  $('#zoneModal').addEventListener('keydown', e => { if (e.key === 'Escape') closeZoneGrid(); });
  $('#zoneModal').addEventListener('click', e => { if (e.target.id === 'zoneModal') closeZoneGrid(); });
}

// A button that needs a second click within a few seconds. → true on the second click.
function armButton(b, armedText) {
  if (b.dataset.armed) { clearTimeout(+b.dataset.armed); delete b.dataset.armed; b.textContent = b.dataset.text; b.classList.remove('armed'); return true; }
  b.dataset.text = b.textContent;
  b.textContent = armedText;
  b.classList.add('armed');
  b.dataset.armed = String(setTimeout(() => { delete b.dataset.armed; b.textContent = b.dataset.text; b.classList.remove('armed'); }, 3000));
  return false;
}

// =====================================================================================================
// CLEAR ALL PARTS
// =====================================================================================================
function clearAllParts() {
  S.parts = []; S.pdfMats = []; S.groups = []; S.stale = false; zones = [];
  $('#addInfo').textContent = '';
  renderParts(); renderSheets(); renderView();
  log('all parts cleared', 'ok');
}

// =====================================================================================================
// PARTS FOLDER — link folders and pull parts by number (P8 search; the same linked folders as NC Search)
// =====================================================================================================
async function renderLibRoots() {
  const box = $('#libRoots');
  if (!FS_OK) { box.innerHTML = `<div class="hint">${esc(FS_MSG)}</div>`; $('#libLink').disabled = true; return; }
  let locked = false;
  for (const r of lib.roots) { try { r.ok = (await r.handle.queryPermission({ mode: 'read' })) === 'granted'; } catch (e) { r.ok = false; } if (!r.ok) locked = true; }
  box.innerHTML = lib.roots.length
    ? lib.roots.map((r, i) => `<div class="libRoot"><span class="dot" style="background:${r.ok ? 'var(--ok)' : 'var(--warn)'}"></span><span class="mono" title="${esc(r.name)}">${esc(r.name)}</span><button class="x" data-i="${i}" title="Unlink this folder">✕</button></div>`).join('')
    : '<div class="hint">No parts folder linked yet. In the folder window, paste the folder path in the address bar, press Enter, then Select Folder.</div>';
  $('#libReconnect').hidden = !locked;
  $('#libGo').disabled = !lib.roots.length;
}
async function linkLibrary() {
  if (!FS_OK) return log(FS_MSG, 'bad');
  const h = await pickFolder({ id: 'ncdrive-parts', mode: 'read' });
  if (!h) return;
  const r = await addRoot(h);
  log(r === 'added' ? `parts folder linked: ${h.name}` : r === 'duplicate' ? `${h.name} is already linked` : `${h.name}: folders with AMADA in the name are never opened`, r === 'added' ? 'ok' : 'warn');
  renderLibRoots();
}
async function pullParts(text) {
  const terms = splitTerms(text);
  if (!terms.length) return log('type the part numbers first', 'bad');
  if (!lib.roots.length) return log('link a parts folder first', 'bad');
  const omitted = terms.filter(t => omitHitName(t)), want = terms.filter(t => !omitHitName(t));
  if (omitted.length) log(`never programmed (laser rules), skipped: ${omitted.join(', ')}`, 'warn');
  if (!want.length) return;
  const go = $('#libGo'), res = $('#libResult');
  go.disabled = true;
  lib.stop = false; lib.dirCache = new Map();
  try {
    const r = await searchLibrary(want, { progress: (d, n) => { res.textContent = `Searching… ${d.toLocaleString()} folders · ${n} files`; showProgress('Pull parts', `searching · ${d.toLocaleString()} folders`, null, null); } });
    const files = [], notFound = [];
    for (const t of want) {
      let picks = bestPicks(r.found, t);
      if (isDxfOnly(t)) { const dxf = newestFile(r.found.filter(f => f.term === t && f.ext === 'dxf'), 'dxf'); if (dxf) picks = picks.filter(f => f.ext === 'pdf').concat(dxf); }
      if (!picks.some(f => f.ext !== 'pdf')) notFound.push(t);
      picks.forEach(f => files.push(f.file));
    }
    if (files.length) await handleFiles(files);
    const nParts = files.filter(f => !/\.pdf$/i.test(f.name)).length;
    res.innerHTML = `Pulled ${nParts} part file${nParts === 1 ? '' : 's'}${files.length > nParts ? ` + ${files.length - nParts} PDF` : ''}.` + (notFound.length ? ` <span class="bad">Not found: ${esc(notFound.join(', '))}.</span>` : '');
    if (notFound.length) log(`no .nc / .dxf found for ${notFound.join(', ')}`, 'warn');
    finishProgress('Pull parts', `${nParts} part file${nParts === 1 ? '' : 's'} loaded${notFound.length ? ` · ${notFound.length} not found` : ''}`, !notFound.length);
  } catch (e) {
    res.innerHTML = `<span class="bad">${esc(e.message || e)}</span>`;
    finishProgress('Pull parts', 'failed', false);
  }
  go.disabled = !lib.roots.length;
}
async function wireLibrary() {
  $('#libLink').onclick = linkLibrary;
  $('#libReconnect').onclick = async () => { for (const r of lib.roots) await ensurePerm(r.handle, 'read'); renderLibRoots(); };
  $('#libRoots').addEventListener('click', async e => {
    const b = e.target.closest('.x');
    if (!b) return;
    const [r] = lib.roots.splice(+b.dataset.i, 1);
    await saveRoots();
    log(`unlinked ${r.name}`);
    renderLibRoots();
  });
  $('#libGo').onclick = () => pullParts($('#libNums').value);
  $('#libNums').addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); $('#libGo').click(); } });
  NCLink.on('roots-changed', async () => { await loadRoots(); renderLibRoots(); });
  if (FS_OK) await loadRoots();
  renderLibRoots();
}

// =====================================================================================================
// the whole box: called by renderParts / renderSheets whenever the job changes
// =====================================================================================================
function updateStatusPanel() {
  updateAddNestBtn();
  $('#zoneBtn').disabled = !S.parts.length || S.busy;
  $('#clearAllBtn').disabled = !S.parts.length || S.busy;
  if (!S.groups.length) $('#addInfo').textContent = '';
}
function wireStatusPanel() {
  wireLock();
  wireRules();
  wireZones();
  wireLibrary();
  $('#addNestBtn').onclick = addToCurrentNest;
  $('#clearAllBtn').onclick = function () { if (armButton(this, `Click again to clear ${S.parts.length} part${S.parts.length > 1 ? 's' : ''}`)) clearAllParts(); };
  Object.assign(COMMANDS, {
    add: () => addToCurrentNest(),
    zones: () => openZoneGrid(),
    pull: (rest, arg) => pullParts(arg),
    unlock: (rest, arg) => { if (!unlockSettings(arg)) log('wrong key', 'bad'); },
    lock: () => lockSettings(),
    omit: () => log('never programmed: ' + omitList().join(', ')),
  });
  HELP.push('add                       add new parts to the current nest (placed parts stay put)',
    'zones                     quantities by zone  ·  pull <numbers>  pull parts from the linked folders',
    'unlock <key> · lock       settings lock  ·  omit  show the never-programmed list');
  updateStatusPanel();
}
