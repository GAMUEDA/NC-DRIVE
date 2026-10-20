/* =====================================================================================================
   TOOL · DXF TO NC (dxf_to_nc.html) — DXF files on the left, their .nc files on the right (P12 dxfToNc)
   nest_admin 5's conversion with its default conditions: all four clean-ups on, OMIT-list parts refused at the drop.
   Turret parts (a CONFIG.turret template, e.g. 14443): four AMADA programs, each a .nc + .pdf (P13 / P14) — these
   are on the OMIT list for the laser, so they are let in here instead of refused.
   A part number typed in the box is looked up in the list, else in the linked parts folders (newest DXF).
   DXF files are listed when they are added; RUN CONVERSION (or Ctrl+Enter) makes the output files. Changing a clean-up
   option marks them out of date until RUN CONVERSION is pressed again.
   Bottom options: RUN CONVERSION · 1 save ALL to a USB drive · 2 copy ALL to a folder · 3 clear and input new DXF.
   The USB drive is the same one Copy to Drive and Erase USB use (folders.js 'usb'); the folder is remembered as 'ncFolder'.
   ===================================================================================================== */
const dx = { rows: [], sel: -1, busy: false, usb: null, folder: null };
// rows: [{file, nc, working}] — nc = null until converted, else {error} or {w, h, notes, turret, files:[{name, data, kind, info}]}
const DX_OPT_IDS = ['dxClean', 'dxBend', 'dxEtch', 'dxFeat']; // nest_admin 5 default: every one on

const dxOpts = () => ({ clean: $('#dxClean').checked, bend: $('#dxBend').checked, etch: $('#dxEtch').checked, feat: $('#dxFeat').checked });
const kb = n => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');
const okRows = () => dx.rows.filter(r => r.nc && !r.nc.error);
const outFiles = () => okRows().flatMap(r => r.nc.files);
const fileSize = d => (typeof d === 'string' ? new Blob([d]).size : d.length);
const pendingRows = () => dx.rows.filter(r => !r.nc);

// ---- the two lists ----
function renderDx() {
  const files = outFiles();
  $('#dxCount').textContent = dx.rows.length ? `${dx.rows.length} file${dx.rows.length > 1 ? 's' : ''}` : '';
  $('#ncCount').textContent = files.length ? `${files.filter(f => f.kind === 'nc').length} .nc · ${files.filter(f => f.kind === 'pdf').length} .pdf` : '';
  $('#dxTable').innerHTML = '<tr><th>#</th><th>DXF file</th><th>Size (mm)</th><th>Clean-up</th></tr>' + (dx.rows.length
    ? dx.rows.map((r, i) => `<tr data-i="${i}" class="${i === dx.sel ? 'sel' : ''}"><td class="mono">${i + 1}</td><td class="nm" title="${esc(r.file.name)}">${esc(r.file.name)}${turretTemplateFor(r.file.name) ? ' <span class="tag" title="Punched on the AMADA turret">TURRET</span>' : ''}</td><td class="mono">${r.nc && !r.nc.error ? r.nc.w.toFixed(1) + ' × ' + r.nc.h.toFixed(1) : ''}</td><td class="muted">${r.nc ? (r.nc.error ? '' : esc(r.nc.notes.join(', ') || '—')) : r.working ? 'reading…' : '—'}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">No DXF files yet. Type a part number above, or drop the DXF files.</td></tr>');
  $('#ncTable').innerHTML = '<tr><th>#</th><th>Output file</th><th>Details</th><th>Size</th><th></th></tr>' + (dx.rows.length
    ? dx.rows.map((r, i) => {
        const n = r.nc, sel = i === dx.sel ? 'sel' : '';
        if (!n) return `<tr data-i="${i}"><td class="mono">${i + 1}</td><td colspan="4" class="wait">${r.working ? 'converting…' : 'press RUN CONVERSION'}</td></tr>`;
        if (n.error) return `<tr data-i="${i}" class="${sel}"><td class="mono">${i + 1}</td><td colspan="4" class="bad">${esc(n.error)}</td></tr>`;
        return n.files.map((f, k) => `<tr data-i="${i}" data-f="${k}" class="${sel}"><td class="mono">${k ? '' : i + 1}</td><td class="nm" title="${esc(f.name)}"><span class="ext ${f.kind}">${f.kind.toUpperCase()}</span> ${esc(f.name)}</td><td class="muted">${f.info}</td><td class="mono">${kb(fileSize(f.data))}</td><td class="nowrap">${f.kind === 'nc' ? '<button class="ghost mini simNc" title="Play this program in the NC Part Simulator">▶</button> ' : ''}<button class="ghost mini dlNc" title="Download this file">⬇</button></td></tr>`).join('');
      }).join('')
    : '<tr><td colspan="5" class="muted">The .nc (and .pdf) files appear here.</td></tr>');
  updDxButtons();
}
function updDxButtons() {
  const n = outFiles().length, waiting = pendingRows().length;
  $('#dxConvert').disabled = dx.busy || (!waiting && !$('#dxPart').value.trim());
  $('#dxConvert').classList.toggle('stale', !!waiting);
  $('#dxUsb').disabled = !n || dx.busy;
  $('#dxFolder').disabled = !n || dx.busy;
  $('#dxNew').disabled = dx.busy;
  $('#dxUsbName').textContent = dx.usb ? driveLabel(dx.usb) : 'no drive chosen';
  $('#dxFolderName').textContent = dx.folder ? dx.folder.name : 'no folder chosen';
}

// ---- bottom progress bar ----
function setDxBar(task, done, total, state) {
  $('#dxProg').hidden = false;
  $('#dxPTask').textContent = task;
  $('#dxPPct').textContent = total ? Math.round((100 * done) / total) + '%' : '';
  $('#dxBar').className = 'procBar' + (state ? ' ' + state : '');
  $('#dxBar').firstElementChild.style.width = (total ? (100 * done) / total : 0).toFixed(1) + '%';
}

// ---- list, then convert ----
// Dropped files go in the left list (nest_admin 5's drop rules: .dxf only, never twice, never an OMIT-list part).
function addDxf(files) {
  if (dx.busy) return;
  const refused = [];
  files = [...files].filter(f => {
    if (!/\.dxf$/i.test(f.name)) { log(`${f.name}: not a .dxf — skipped`, 'warn'); return false; }
    const om = omitHitName(f.name);
    if (om && !turretTemplateFor(f.name)) { refused.push(f.name); log(`${f.name} is on the OMIT list (${om}) — it can't be done on the laser, so it was not added`, 'warn'); return false; }
    if (dx.rows.some(r => r.file.name.toLowerCase() === f.name.toLowerCase())) { log(`${f.name} is already in the list`, 'warn'); return false; }
    return true;
  });
  files.forEach(file => dx.rows.push({ file, nc: null }));
  if (files.length) log(`${files.length} DXF added — press RUN CONVERSION`, 'ok');
  const waiting = pendingRows().length;
  $('#dxStatus').innerHTML = (waiting ? `${waiting} DXF ready. Press <b>RUN CONVERSION</b>.` : '') + (refused.length ? ` <span class="warnc">Not added (OMIT list): ${esc(refused.join(', '))}.</span>` : '');
  renderDx();
  return files.length;
}
// One DXF → its output files: a turret part's four programs (.nc + .pdf each), else one laser .nc.
async function convertDxf(file, opts) {
  const tpl = turretTemplateFor(file.name);
  if (!tpl) {
    const r = await dxfToNc(file, opts);
    if (r.error) return r;
    return { w: r.w, h: r.h, notes: r.notes, files: [{ name: r.ncName, data: r.text, kind: 'nc', info: `${r.pierces} pierces · ${(r.cutLen / 1000).toFixed(2)} m cut${r.openCount ? ` · <span class="warnc">${r.openCount} open</span>` : ''}` }], laser: r };
  }
  const parsed = parseDXF(await file.text());
  if (!parsed) return { error: `${file.name}: no drawable geometry in the DXF` };
  const base = file.name.replace(/\.dxf$/i, ''), part = turretPart(parsed.raw, base);
  if (part.error) return part;
  if (!part.holes.length) return { error: `${file.name}: no holes found — this does not look like a ${partToken(base)} strip` };
  const first = Math.max(0, parseInt($('#dxProgNo').value, 10) || 0);
  const progs = turretPrograms(part, { template: tpl, programNo: first, date: new Date(), name: base });
  $('#dxProgNo').value = first + progs.length; // the next part continues the numbering
  ls.set('turretProgNo', String(first + progs.length));
  const files = [];
  for (const p of progs) {
    files.push({ name: p.name + '.nc', data: p.text, kind: 'nc', info: `O${String(p.programNo).padStart(4, '0')} · ${p.count} part${p.count > 1 ? 's' : ''} · ${p.stats.hits} hits` });
    files.push({ name: p.name + '.pdf', data: turretReportPdf(p), kind: 'pdf', info: 'program sheet' });
  }
  return { w: part.L, h: part.H, notes: [`turret · ${progs.length} programs`], files, turret: progs };
}
// The part number box: take the DXF from the list, else the newest one in the linked parts folders.
async function findPartDxf() {
  const term = $('#dxPart').value.trim();
  if (!term) return true;
  const m = termMatcher ? termMatcher(term) : null, hit = dx.rows.findIndex(r => (m ? m(r.file.name) : r.file.name.toLowerCase().includes(term.toLowerCase())));
  if (hit >= 0) { dx.sel = hit; renderDx(); return true; }
  if (!FS_OK) { $('#dxStatus').innerHTML = `<span class="bad">${esc(FS_MSG)}</span>`; return false; }
  if (!lib.roots.length) { $('#dxStatus').innerHTML = `<span class="bad">${esc(term)}: drop its DXF, or link the parts folder first (Link parts folder…).</span>`; return false; }
  for (const r of lib.roots) await ensurePerm(r.handle, 'read');
  lib.stop = false; lib.dirCache = new Map();
  setDxBar(`Looking for ${term}`, 0, 0);
  $('#dxBar').className = 'procBar busy';
  const res = await searchLibrary([term], { exts: ['dxf'], progress: (d, n) => { $('#dxStatus').textContent = `Looking for ${term}… ${d.toLocaleString()} folders`; } });
  const f = newestFile(res.found.filter(x => x.ext === 'dxf'), 'dxf');
  if (!f) { setDxBar(`${term} not found`, 0, 1, 'bad'); $('#dxStatus').innerHTML = `<span class="bad">No DXF found for ${esc(term)} in ${esc(lib.roots.map(r => r.name).join(', '))}.</span>`; log(`${term}: no DXF found`, 'warn'); return false; }
  const file = f.file || (await f.handle.getFile());
  setDxBar(`Found ${file.name}`, 1, 1, 'ok');
  log(`${term}: found ${f.path || file.name}`, 'ok');
  addDxf([file]);
  dx.sel = dx.rows.findIndex(r => r.file.name.toLowerCase() === file.name.toLowerCase());
  renderDx();
  return true;
}
async function linkPartsFolder() {
  if (!FS_OK) return log(FS_MSG, 'bad');
  const h = await pickFolder({ id: 'ncdrive-lib', mode: 'read' });
  if (!h) return;
  const r = await addRoot(h);
  log(r === 'added' ? `linked ${h.name}` : r === 'duplicate' ? `${h.name} is already linked` : `${h.name} can't be used (never opened)`, r === 'added' ? 'ok' : 'warn');
  showLib();
}
function showLib() { $('#dxLib').textContent = lib.roots.length ? `Parts folders: ${lib.roots.map(r => r.name).join(', ')}` : 'No parts folder linked — drop DXF files, or link the folder.'; }
// CONVERT: every DXF without a current .nc goes through nest_admin 5's program (P2 read → P3 clean → P6 write).
async function convertAll() {
  if (dx.busy) return;
  if (!(await findPartDxf())) return;
  const todo = pendingRows();
  if (!todo.length) { if (okRows().length) $('#dxStatus').innerHTML = `${outFiles().length} files ready — nothing new to convert.`; return; }
  dx.busy = true;
  const opts = dxOpts();
  let done = 0, bad = 0;
  for (const r of todo) {
    r.working = true;
    renderDx();
    setDxBar(`Converting ${r.file.name}`, done, todo.length);
    reportProgress('DXF to NC', `${r.file.name} · ${done + 1} of ${todo.length}`, done / todo.length);
    try { r.nc = await convertDxf(r.file, opts); } catch (e) { r.nc = { error: `${r.file.name}: ${e.message || e}` }; }
    r.working = false;
    if (r.nc.error) { bad++; log(r.nc.error, r.nc.kind || 'bad'); }
    else if (r.nc.turret) log(`${r.file.name} → ${r.nc.turret.map(p => `${p.name} (${p.count})`).join(', ')} · .nc + .pdf each`, 'ok');
    else log(`${r.file.name} → ${r.nc.laser.ncName} · ${r.nc.laser.pierces} pierces${r.nc.laser.openCount ? ` · ${r.nc.laser.openCount} open contour${r.nc.laser.openCount > 1 ? 's' : ''}` : ''}`, r.nc.laser.openCount ? 'warn' : 'ok');
    done++;
  }
  dx.busy = false;
  setDxBar(`Converted ${done - bad} of ${done}`, done, todo.length, bad ? 'bad' : 'ok');
  reportProgress('DXF to NC', `${done - bad} .nc made${bad ? ` · ${bad} failed` : ''}`, 1, true);
  $('#dxStatus').innerHTML = `${outFiles().length} file${outFiles().length === 1 ? '' : 's'} ready.` + (bad ? ` <span class="bad">${bad} DXF could not be converted.</span>` : '');
  renderDx();
}
// a clean-up option changed: every .nc is out of date until CONVERT is pressed again
function optionsChanged() {
  if (dx.busy) return;
  if (!dx.rows.length) return;
  dx.rows.forEach(r => (r.nc = null));
  $('#dxProg').hidden = true;
  $('#dxStatus').innerHTML = 'Clean-up changed. Press <b>RUN CONVERSION</b> to make the files again.';
  renderDx();
}
function dxDefaults() {
  const changed = DX_OPT_IDS.filter(id => !$('#' + id).checked);
  changed.forEach(id => ($('#' + id).checked = true));
  log('clean-up set to the nest_admin 5 defaults (all on)', 'ok');
  if (changed.length) optionsChanged();
}
function clearDx(openPicker) {
  if (dx.busy) return;
  dx.rows = []; dx.sel = -1;
  $('#dxProg').hidden = true;
  $('#dxStatus').textContent = '';
  renderDx();
  log('lists cleared');
  if (openPicker) $('#dxFile').click();
}
// ▶ hands the .nc to the NC Part Simulator (nc_sim.html), opening it when it isn't open
function simulateNc(i, k) {
  const n = dx.rows[i] && dx.rows[i].nc, f = n && !n.error && n.files[k || 0];
  if (!f || f.kind !== 'nc') return;
  ls.set('simFile', JSON.stringify({ name: f.name, text: typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data), t: Date.now() }));
  openNamed('nc_sim.html', 'ncdrive-ncsim');
  NCLink.notify('sim-file');
  log(`${f.name} → NC Part Simulator`, 'ok');
}
function downloadNc(i, k) {
  const n = dx.rows[i] && dx.rows[i].nc, f = n && !n.error && n.files[k || 0];
  if (!f) return;
  const url = URL.createObjectURL(new Blob([f.data], { type: f.kind === 'pdf' ? 'application/pdf' : 'text/plain' })), a = document.createElement('a');
  a.href = url; a.download = f.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  log(`downloaded ${f.name}`, 'ok');
}

// ---- 1 · USB drive  ·  2 · folder ----
async function pickDxUsb() {
  if (!FS_OK) return log(FS_MSG, 'bad');
  const h = await pickFolder({ id: 'ncdrive-usb', mode: 'readwrite' });
  if (!h) return null;
  dx.usb = h;
  await saveTargetDrive(h);
  const list = await loadUsbDrives();
  if ((await sameHandleIndex(list, h)) < 0) { list.push(h); await saveUsbDrives(list); }
  updDxButtons();
  return h;
}
async function pickDxFolder() {
  if (!FS_OK) return log(FS_MSG, 'bad');
  const h = await pickFolder({ id: 'ncdrive-ncfolder', mode: 'readwrite' });
  if (!h) return null;
  dx.folder = h;
  await idb.set('ncFolder', h);
  updDxButtons();
  return h;
}
async function writeAllNc(dest, what) {
  const list = outFiles();
  if (!list.length || dx.busy) return;
  if (!(await ensurePerm(dest, 'readwrite'))) { $('#dxStatus').innerHTML = `<span class="bad">Permission to write to ${esc(what)} was not given.</span>`; return; }
  dx.busy = true;
  updDxButtons();
  let n = 0, error = null;
  setDxBar(`Writing to ${what}`, 0, list.length);
  for (const r of list) {
    try { await writeFileTo(dest, r.name, r.data); } catch (e) { error = e; break; }
    n++;
    setDxBar(`Writing to ${what}`, n, list.length);
    reportProgress('DXF to NC', `${n} of ${list.length} written to ${what}`, n / list.length);
  }
  dx.busy = false;
  setDxBar(error ? `Stopped at ${n} of ${list.length}` : `${n} files written to ${what}`, n, list.length, error ? 'bad' : 'ok');
  reportProgress('DXF to NC', `${n} of ${list.length} written to ${what}`, n / list.length, true);
  log(`${what}: wrote ${n} file${n === 1 ? '' : 's'}${error ? ' — stopped: ' + (error.message || error) : ''}`, error ? 'bad' : 'ok');
  $('#dxStatus').innerHTML = error ? `<span class="bad">Stopped after ${n} file${n === 1 ? '' : 's'}: ${esc(error.message || error)}</span>` : `<span class="ok">${n} file${n === 1 ? '' : 's'} written to ${esc(what)}.</span>`;
  updDxButtons();
}
async function saveToUsb() {
  const h = dx.usb || (await pickDxUsb());
  if (h) await writeAllNc(h, driveLabel(h));
}
async function copyToFolder() {
  const h = dx.folder || (await pickDxFolder());
  if (h) await writeAllNc(h, h.name);
}

function startDxfNcPage() {
  startToolPage('dxfnc');
  const zone = $('#dxDrop'), input = $('#dxFile');
  zone.onclick = () => input.click();
  zone.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = () => { addDxf(input.files); input.value = ''; };
  zone.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); addDxf(e.dataTransfer.files); });
  window.addEventListener('drop', e => { if (e.dataTransfer.files.length) addDxf(e.dataTransfer.files); }); // a drop anywhere on the page
  DX_OPT_IDS.forEach(id => $('#' + id).addEventListener('change', optionsChanged));
  $('#dxDefaults').onclick = dxDefaults;
  $('#dxConvert').onclick = convertAll;
  $('#dxFind').onclick = () => !dx.busy && findPartDxf();
  $('#dxLink').onclick = linkPartsFolder;
  $('#dxPart').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (!dx.busy) findPartDxf(); } });
  $('#dxPart').addEventListener('input', updDxButtons);
  $('#dxProgNo').value = ls.get('turretProgNo', $('#dxProgNo').value);
  $('#dxProgNo').addEventListener('change', () => ls.set('turretProgNo', $('#dxProgNo').value.trim()));
  document.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); convertAll(); } });
  // a row click selects the pair; ⬇ downloads that .nc
  const onRow = e => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    dx.sel = +tr.dataset.i;
    if (e.target.closest('.dlNc')) downloadNc(dx.sel, +(tr.dataset.f || 0));
    if (e.target.closest('.simNc')) simulateNc(dx.sel, +(tr.dataset.f || 0));
    renderDx();
  };
  $('#dxTable').addEventListener('click', onRow);
  $('#ncTable').addEventListener('click', onRow);
  $('#dxUsb').onclick = saveToUsb;
  $('#dxUsbPick').onclick = pickDxUsb;
  $('#dxFolder').onclick = copyToFolder;
  $('#dxFolderPick').onclick = pickDxFolder;
  $('#dxNew').onclick = () => clearDx(true);
  if (!FS_OK) { ['dxUsbPick', 'dxFolderPick'].forEach(id => ($('#' + id).disabled = true)); $('#dxStatus').textContent = FS_MSG; }
  else {
    loadTargetDrive().then(h => { dx.usb = h; updDxButtons(); });
    idb.get('ncFolder').then(h => { dx.folder = h; updDxButtons(); });
    NCLink.on('drive-changed', () => loadTargetDrive().then(h => { dx.usb = h; updDxButtons(); }));
    loadRoots().then(showLib);
    NCLink.on('roots-changed', () => loadRoots().then(showLib));
  }
  renderDx();
}

window.NCDriveTool = { CONFIG, process: { dxfToNc, makeSheetNc, loadPartFile, convertAll, convertDxf, findPartDxf, omitHitName, turretPart, turretPrograms, turretReportPdf }, dx, link: NCLink };
startDxfNcPage();
