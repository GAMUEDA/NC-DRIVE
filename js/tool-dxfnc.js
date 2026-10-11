/* =====================================================================================================
   TOOL · DXF TO NC (dxf_to_nc.html) — DXF files on the left, their .nc files on the right (P12 dxfToNc)
   Bottom options: 1 save the .nc files to a USB drive · 2 copy them to a folder · 3 clear and input new DXF.
   The USB drive is the same one Copy to Drive and Erase USB use (folders.js 'usb'); the folder is remembered as 'ncFolder'.
   ===================================================================================================== */
const dx = { rows: [], sel: -1, busy: false, usb: null, folder: null }; // rows: [{file, nc}] — nc = dxfToNc() result

const dxOpts = () => ({ clean: $('#dxClean').checked, bend: $('#dxBend').checked, etch: $('#dxEtch').checked, feat: $('#dxFeat').checked });
const kb = n => (n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB');
const okRows = () => dx.rows.filter(r => r.nc && !r.nc.error);

// ---- the two lists ----
function renderDx() {
  const ok = okRows();
  $('#dxCount').textContent = dx.rows.length ? `${dx.rows.length} file${dx.rows.length > 1 ? 's' : ''}` : '';
  $('#ncCount').textContent = ok.length ? `${ok.length} .nc` : '';
  $('#dxTable').innerHTML = '<tr><th>#</th><th>DXF file</th><th>Size (mm)</th><th>Clean-up</th></tr>' + (dx.rows.length
    ? dx.rows.map((r, i) => `<tr data-i="${i}" class="${i === dx.sel ? 'sel' : ''}"><td class="mono">${i + 1}</td><td class="nm" title="${esc(r.file.name)}">${esc(r.file.name)}</td><td class="mono">${r.nc && !r.nc.error ? r.nc.w.toFixed(1) + ' × ' + r.nc.h.toFixed(1) : ''}</td><td class="muted">${r.nc ? (r.nc.error ? '' : esc(r.nc.notes.join(', ') || '—')) : 'reading…'}</td></tr>`).join('')
    : '<tr><td colspan="4" class="muted">No DXF files yet. Drop them above.</td></tr>');
  $('#ncTable').innerHTML = '<tr><th>#</th><th>NC file</th><th>Pierces</th><th>Cut</th><th>Size</th><th></th></tr>' + (dx.rows.length
    ? dx.rows.map((r, i) => {
        const n = r.nc;
        if (!n) return `<tr data-i="${i}"><td class="mono">${i + 1}</td><td colspan="5" class="muted">converting…</td></tr>`;
        if (n.error) return `<tr data-i="${i}" class="${i === dx.sel ? 'sel' : ''}"><td class="mono">${i + 1}</td><td colspan="5" class="bad">${esc(n.error)}</td></tr>`;
        return `<tr data-i="${i}" class="${i === dx.sel ? 'sel' : ''}"><td class="mono">${i + 1}</td><td class="nm"><span class="ext nc">NC</span> ${esc(n.ncName)}${n.openCount ? ` <span class="warnc" title="Contours that do not close: check the drawing">· ${n.openCount} open</span>` : ''}</td><td class="mono">${n.pierces}</td><td class="mono">${(n.cutLen / 1000).toFixed(2)} m</td><td class="mono">${kb(new Blob([n.text]).size)}</td><td><button class="ghost mini dlNc" title="Download this .nc">⬇</button></td></tr>`;
      }).join('')
    : '<tr><td colspan="6" class="muted">The .nc files appear here.</td></tr>');
  updDxButtons();
}
function updDxButtons() {
  const n = okRows().length;
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

// ---- read and convert ----
async function addDxf(files) {
  files = [...files].filter(f => { if (/\.dxf$/i.test(f.name)) return true; log(`${f.name}: not a .dxf — skipped`, 'warn'); return false; });
  if (!files.length || dx.busy) return;
  const fresh = files.filter(f => !dx.rows.some(r => r.file.name.toLowerCase() === f.name.toLowerCase()));
  files.filter(f => !fresh.includes(f)).forEach(f => log(`${f.name} is already in the list`, 'warn'));
  if (!fresh.length) return;
  dx.busy = true;
  const start = dx.rows.length;
  fresh.forEach(file => dx.rows.push({ file, nc: null }));
  renderDx();
  let done = 0, bad = 0;
  for (const r of dx.rows.slice(start)) {
    setDxBar(`Converting ${r.file.name}`, done, fresh.length);
    reportProgress('DXF to NC', `${r.file.name} · ${done + 1} of ${fresh.length}`, done / fresh.length);
    try { r.nc = await dxfToNc(r.file, dxOpts()); } catch (e) { r.nc = { error: `${r.file.name}: ${e.message || e}` }; }
    if (r.nc.error) { bad++; log(r.nc.error, r.nc.kind || 'bad'); }
    else log(`${r.file.name} → ${r.nc.ncName} · ${r.nc.pierces} pierces${r.nc.openCount ? ` · ${r.nc.openCount} open contour${r.nc.openCount > 1 ? 's' : ''}` : ''}`, r.nc.openCount ? 'warn' : 'ok');
    done++;
    renderDx();
  }
  dx.busy = false;
  setDxBar(`Converted ${done - bad} of ${done}`, done, fresh.length, bad ? 'bad' : 'ok');
  reportProgress('DXF to NC', `${done - bad} .nc made${bad ? ` · ${bad} failed` : ''}`, 1, true);
  $('#dxStatus').innerHTML = `${okRows().length} .nc file${okRows().length === 1 ? '' : 's'} ready.` + (bad ? ` <span class="bad">${bad} DXF could not be converted.</span>` : '');
  renderDx();
}
// a clean-up option changed: convert every file again
async function reconvert() {
  if (!dx.rows.length || dx.busy) return;
  const files = dx.rows.map(r => r.file);
  dx.rows = [];
  await addDxf(files);
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
function downloadNc(i) {
  const n = dx.rows[i] && dx.rows[i].nc;
  if (!n || n.error) return;
  const url = URL.createObjectURL(new Blob([n.text], { type: 'text/plain' })), a = document.createElement('a');
  a.href = url; a.download = n.ncName;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  log(`downloaded ${n.ncName}`, 'ok');
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
  const list = okRows();
  if (!list.length || dx.busy) return;
  if (!(await ensurePerm(dest, 'readwrite'))) { $('#dxStatus').innerHTML = `<span class="bad">Permission to write to ${esc(what)} was not given.</span>`; return; }
  dx.busy = true;
  updDxButtons();
  let n = 0, error = null;
  setDxBar(`Writing to ${what}`, 0, list.length);
  for (const r of list) {
    try { await writeFileTo(dest, r.nc.ncName, r.nc.text); } catch (e) { error = e; break; }
    n++;
    setDxBar(`Writing to ${what}`, n, list.length);
    reportProgress('DXF to NC', `${n} of ${list.length} written to ${what}`, n / list.length);
  }
  dx.busy = false;
  setDxBar(error ? `Stopped at ${n} of ${list.length}` : `${n} .nc written to ${what}`, n, list.length, error ? 'bad' : 'ok');
  reportProgress('DXF to NC', `${n} of ${list.length} written to ${what}`, n / list.length, true);
  log(`${what}: wrote ${n} .nc file${n === 1 ? '' : 's'}${error ? ' — stopped: ' + (error.message || error) : ''}`, error ? 'bad' : 'ok');
  $('#dxStatus').innerHTML = error ? `<span class="bad">Stopped after ${n} file${n === 1 ? '' : 's'}: ${esc(error.message || error)}</span>` : `<span class="ok">${n} .nc file${n === 1 ? '' : 's'} written to ${esc(what)}.</span>`;
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
  ['dxClean', 'dxBend', 'dxEtch', 'dxFeat'].forEach(id => $('#' + id).addEventListener('change', reconvert));
  // a row click selects the pair; ⬇ downloads that .nc
  const onRow = e => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    dx.sel = +tr.dataset.i;
    if (e.target.closest('.dlNc')) downloadNc(dx.sel);
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
  }
  renderDx();
}

window.NCDriveTool = { CONFIG, process: { dxfToNc, makeSheetNc, loadPartFile }, dx, link: NCLink };
startDxfNcPage();
