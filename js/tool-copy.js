/* =====================================================================================================
   COPY PARTS TO DRIVE page (copy_to_drive.html) — screen for P10
   1 default drive (source = the linked parts folders) · 2 target drive (default E:) · 3 file types
   4 part numbers from a PDF · 5 process. Works fully on its own; when NC Drive is open its job name is used
   for the job folder. Address: copy_to_drive.html?parts=19992%2014738&src=WO-55123.pdf fills step 4.
   ===================================================================================================== */
const cp = { running: false, rows: [], target: null, jobTyped: false };
const CLIP_HINT = 'is on the clipboard — in the folder window press <b>Ctrl+V</b> in the address bar, <b>Enter</b>, then <b>Select Folder</b>.';

function showTypes() {
  const t = parseTypes($('#cpTypes').value);
  $('#cpTypesNote').innerHTML = t.length ? t.map(x => `<span class="ext ${x}">${x.toUpperCase()}</span>`).join(' ') + (t.every(x => x === 'dxf') ? '' : " &nbsp;· a missing type is replaced by the part's <span class=\"ext\">DXF</span>") : '<span class="bad">Type at least one file type, e.g. NC, PDF</span>';
}
// The browser can't open a typed path by itself, so the box's path is put on the clipboard and the folder window opens: Ctrl+V in its address bar, Enter, Select Folder.
async function pathToClipboard(id) {
  const v = ($('#' + id).value || '').trim();
  if (!v) return false;
  let p = v;
  if (/^[a-z]:?$/i.test(p)) p = p[0].toUpperCase() + ':\\';
  try { await navigator.clipboard.writeText(p); return p; } catch (e) { return false; }
}
function renderCpRoots() {
  $('#cpSrcRoots').innerHTML = lib.roots.length ? lib.roots.map(r => `<div class="chip"><span class="ok">✓</span><span class="nm">${esc(r.name)}</span><span class="muted" style="font-size:11px;">linked</span></div>`).join('') : '<div class="note bad">No source folder located yet.</div>';
}
// Step 1: link a source folder (starts in the last linked one).
async function linkLibrary(statusEl) {
  if (!FS_OK) { statusEl.textContent = FS_MSG; return false; }
  try {
    const last = lib.roots.length ? lib.roots[lib.roots.length - 1].handle : null;
    let h;
    try { h = await pickFolder(Object.assign({ id: 'ncdrive-lib', mode: 'read' }, last ? { startIn: last } : {})); }
    catch (e) { if (e && e.name === 'SecurityError') throw e; h = await pickFolder({ id: 'ncdrive-lib', mode: 'read' }); }
    if (!h) return false;
    const r = await addRoot(h);
    if (r === 'never') { statusEl.textContent = `Not linked: “${h.name}” has AMADA in its name and those folders are never opened.`; return false; }
    if (r === 'duplicate') { statusEl.textContent = `“${h.name}” is already linked.`; return true; }
    return true;
  } catch (e) {
    statusEl.textContent = e && e.name === 'SecurityError' ? "The browser won't open that location — pick a folder inside it." : 'Could not open that folder: ' + ((e && e.message) || e);
    return false;
  }
}
async function locateSource() {
  const p = await pathToClipboard('cpSrcTxt');
  $('#cpStatus').innerHTML = p ? `“${esc(p)}” ${CLIP_HINT}` : '';
  await linkLibrary($('#cpStatus'));
  renderCpRoots();
}
// Step 2: the target drive (shared with Erase USB).
function showTarget() {
  const want = ($('#cpDst').value || '').trim(), h = cp.target, el = $('#cpDstState');
  if (!h) { el.innerHTML = '<span class="warnc">not opened yet — press Open</span>'; return; }
  const dl = /^([a-z]):?\\?$/i.exec(want), hl = /^([a-z]):/i.exec(h.name);
  el.innerHTML = `<span class="ok">✓ ${esc(h.name)}</span>` + (dl && hl && dl[1].toUpperCase() !== hl[1].toUpperCase() ? ` <span class="bad">— that is drive ${hl[1].toUpperCase()}:, not ${dl[1].toUpperCase()}:</span>` : '');
}
async function openTarget() {
  if (!FS_OK) { $('#cpStatus').textContent = FS_MSG; return; }
  const p = await pathToClipboard('cpDst');
  $('#cpStatus').innerHTML = p ? `“${esc(p)}” ${CLIP_HINT} If the drive itself can't be picked, pick a folder on it.` : '';
  try {
    const h = await pickFolder({ id: 'ncdrive-usb', mode: 'readwrite' });
    if (!h) return;
    cp.target = h;
    await saveTargetDrive(h);
    showTarget();
    $('#cpStatus').textContent = '';
  } catch (e) {
    $('#cpStatus').innerHTML = `<span class="bad">${esc(e && e.name === 'SecurityError' ? "The browser won't open the drive itself — make a folder on it (e.g. NC) and pick that." : 'Could not open it: ' + ((e && e.message) || e))}</span>`;
  }
}
// Step 4: part numbers from a PDF (or CSV / text), editable.
function setCopyParts(list, src) {
  $('#cpParts').value = list.join('\n');
  countParts();
  if (src) $('#cpListSrc').innerHTML = `from <b>${esc(src)}</b>`;
}
function countParts() { const n = splitTerms($('#cpParts').value).length; $('#cpCount').textContent = n ? `${n} part number${n > 1 ? 's' : ''}` : ''; }
async function readCopyList(f) {
  $('#cpListSrc').textContent = `Reading ${f.name}…`;
  try {
    const r = await readPartsList(f);
    if (!r.lines.length) { $('#cpListSrc').innerHTML = `<span class="bad">No part numbers (5–6 digits) found in ${esc(f.name)}${/\.pdf$/i.test(f.name) ? ' — a scanned PDF has no text to read' : ''}.</span>`; return; }
    setCopyParts([...new Set(r.lines.map(l => l.part))], f.name);
    if (r.job && !cp.jobTyped && !$('#cpJob').value.trim()) $('#cpJob').value = r.job;
    log(`Copy: ${f.name} — ${splitTerms($('#cpParts').value).length} part numbers`, 'ok');
  } catch (e) {
    $('#cpListSrc').innerHTML = `<span class="bad">Couldn't read ${esc(f.name)}: ${esc(e.message || e)}</span>`;
  }
}
// Step 5: results table.
function renderCopyRows() {
  const done = cp.rows.filter(r => r.st === 'ok' || r.st === 'dxf').length;
  $('#cpDoneCount').textContent = cp.rows.length ? `${done} of ${cp.rows.filter(r => r.st !== 'dxfdup').length}` : '';
  if (!cp.rows.length) { $('#cpTable').innerHTML = '<thead><tr><th>Part</th><th>Type</th><th>File</th><th>Result</th></tr></thead><tbody><tr><td colspan="4" class="empty">Press Copy files. Each part\'s files show here as they are copied.</td></tr></tbody>'; return; }
  let last = '';
  $('#cpTable').innerHTML = '<thead><tr><th>Part</th><th>Type</th><th>File</th><th>Result</th></tr></thead><tbody>' + cp.rows.map(r => {
    const first = r.part !== last;
    last = r.part;
    const res = {
      wait: '<span class="muted">waiting…</span>',
      copying: '<span class="muted">copying…</span>',
      ok: `<span class="ok">✓ copied → ${esc(r.dest || '')}</span>`,
      dxf: `<span class="warnc">✓ DXF copied instead → ${esc(r.dest || '')}</span>`,
      dxfdup: `<span class="warnc">missing — DXF already copied</span>`,
      missing: '<span class="bad">✗ missing (no DXF either)</span>',
      fail: `<span class="bad">✗ ${esc(r.err || 'could not write')}</span>`,
    }[r.st] || '';
    return `<tr${first ? ' style="border-top:2px solid var(--line)"' : ''}><td class="mono">${first ? esc(r.part) : ''}</td><td><span class="ext ${r.type}">${r.type.toUpperCase()}</span></td><td>${r.f ? `<span title="${esc(r.f.path)}">${esc(r.f.name)}</span>` : '<span class="muted">—</span>'}</td><td>${res}</td></tr>`;
  }).join('') + '</tbody>';
}
// Step 5: check the four boxes, then run copyPartsToDrive (P10).
async function runCopy() {
  if (cp.running) return;
  const parts = splitTerms($('#cpParts').value), types = parseTypes($('#cpTypes').value), st = $('#cpStatus');
  const fail = m => { st.innerHTML = `<span class="bad">${m}</span>`; };
  if (!lib.roots.length) return fail('Step 1: locate the default drive (where the parts are) first.');
  if (!cp.target) return fail('Step 2: open the target drive first.');
  if (!types.length) return fail('Step 3: type at least one file type.');
  if (!parts.length) return fail('Step 4: read a PDF or type the part numbers.');
  if (!(await ensurePerm(cp.target, 'readwrite'))) return fail(`Permission to write to “${esc(cp.target.name)}” was not given.`);
  ls.set('types', $('#cpTypes').value.trim()); ls.set('dst', $('#cpDst').value.trim()); ls.set('src', $('#cpSrcTxt').value.trim());
  cp.running = true; lib.stop = false; lib.dirCache = new Map();
  $('#cpRun').disabled = true; $('#cpStop').hidden = false;
  cp.rows = [];
  renderCopyRows();
  const t0 = performance.now(), bar = $('#cpBar');
  bar.hidden = false;
  bar.removeAttribute('value');
  try {
    const res = await copyPartsToDrive(parts, types, cp.target, {
      jobFolder: $('#cpJobDir').checked ? $('#cpJob').value.trim() || 'job' : '',
      progress: (d, n) => { st.textContent = `Searching ${d.toLocaleString()} folders… ${n} files found`; reportProgress('Copy to drive', `searching · ${d.toLocaleString()} folders`, null); },
      onPlan: rows => { cp.rows = rows; renderCopyRows(); bar.max = rows.filter(x => x.st === 'wait').length || 1; bar.value = 0; },
      onRow: (row, phase) => {
        if (phase === 'start') { renderCopyRows(); st.textContent = `Copying ${row.f.name}…`; }
        else { bar.value++; renderCopyRows(); reportProgress('Copy to drive', `${bar.value} of ${bar.max} files`, bar.value / bar.max); }
      },
    });
    if (res.stoppedWhileSearching) { st.innerHTML = '<span class="warnc">Stopped while searching — nothing was copied.</span>'; reportProgress('Copy to drive', 'stopped', 0, true); return; }
    renderCopyRows();
    const n = k => cp.rows.filter(x => x.st === k).length, missParts = [...new Set(cp.rows.filter(x => x.st === 'missing').map(x => x.part))];
    const noneParts = parts.filter(p => !cp.rows.some(x => x.part === p && (x.st === 'ok' || x.st === 'dxf' || x.st === 'dxfdup')));
    st.innerHTML = `${res.stopped ? '<span class="warnc">Stopped.</span> ' : ''}<b>${res.copied}</b> file${res.copied === 1 ? '' : 's'} copied to <b>${esc(res.dir.name)}</b> in ${((performance.now() - t0) / 1000).toFixed(1)} s`
      + (n('dxf') ? ` · <span class="warnc">${n('dxf')} DXF instead</span>` : '') + (n('fail') ? ` · <span class="bad">${n('fail')} failed</span>` : '')
      + (noneParts.length ? ` · <span class="bad">nothing found for ${esc(noneParts.join(', '))}</span>` : missParts.length ? ` · <span class="bad">missing: ${esc(missParts.join(', '))}</span>` : '');
    log(`Copy to ${res.dir.name}: ${res.copied} files, ${n('dxf')} DXF instead, ${noneParts.length} part(s) not found${noneParts.length ? ' — ' + noneParts.join(', ') : ''}`, noneParts.length || n('fail') ? 'warn' : 'ok');
    reportProgress('Copy to drive', `${res.copied} files copied`, 1, true);
  } catch (e) {
    fail(esc(e.message || e));
    reportProgress('Copy to drive', 'failed', 0, true);
  } finally {
    cp.running = false;
    $('#cpRun').disabled = false; $('#cpStop').hidden = true;
    bar.hidden = true;
  }
}
function startCopyPage() {
  startToolPage('copy');
  $('#cpSrcTxt').value = ls.get('src', '');
  $('#cpDst').value = ls.get('dst', CONFIG.copy.defaultTarget);
  $('#cpTypes').value = ls.get('types', CONFIG.copy.defaultTypes);
  [['cpSrcTxt', 'src'], ['cpDst', 'dst'], ['cpTypes', 'types']].forEach(([id, k]) => $('#' + id).addEventListener('change', () => {
    ls.set(k, $('#' + id).value.trim());
    if (id === 'cpTypes') showTypes();
    if (id === 'cpDst') showTarget();
  }));
  $('#cpSrcLocate').onclick = locateSource;
  $('#cpDstPick').onclick = openTarget;
  $('#cpParts').addEventListener('input', countParts);
  $('#cpJob').addEventListener('input', () => { cp.jobTyped = true; });
  wireDropZone('cpDrop', 'cpFile', readCopyList);
  window.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readCopyList(f); }); // a drop anywhere on the page
  $('#cpRun').onclick = runCopy;
  $('#cpStop').onclick = () => { lib.stop = true; };
  $('#cpParts').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runCopy(); } });
  // shared with the other pages
  const reloadRoots = () => loadRoots().then(renderCpRoots);
  const reloadTarget = () => loadTargetDrive().then(h => { cp.target = h; showTarget(); });
  if (FS_OK) { reloadRoots(); reloadTarget(); }
  NCLink.on('roots-changed', reloadRoots);
  NCLink.on('drive-changed', reloadTarget);
  onMainChange(m => { if (m && m.job && !cp.jobTyped) $('#cpJob').value = m.job; });
  if (params.get('parts')) setCopyParts(splitTerms(params.get('parts')), params.get('src'));
  renderCpRoots(); showTypes(); showTarget(); countParts(); renderCopyRows();
}

window.NCDriveTool = { CONFIG, process: { copyPartsToDrive, planCopy, copyPlannedFiles, parseTypes, searchLibrary, readPartsList }, cp, lib, link: NCLink };
startCopyPage();
