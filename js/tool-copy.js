/* =====================================================================================================
   COPY PARTS TO DRIVE page (copy_to_drive.html) — screen for P10
   1 default drive (source = the linked parts folders) · 2 target drive (default E:) · 3 file types
   (only names starting with "1"; .nc / .pdf and the 1… / Amada folders in the main folder, .dxf in DXF\)
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
// Step 4: part numbers from a PDF (or CSV / text), shown as a list: each one can be edited in place or removed (✕),
// and more added one by one at the bottom. The hidden #cpParts textarea holds the list (one per line) for the copy.
const cpPartsNow = () => splitTerms($('#cpParts').value);
function storeCopyParts(list) { $('#cpParts').value = [...new Set(list.map(s => s.trim()).filter(Boolean))].join('\n'); countParts(); }
function setCopyParts(list, src) {
  storeCopyParts(list);
  renderCopyParts();
  if (src) $('#cpListSrc').innerHTML = `from <b>${esc(src)}</b>`;
}
function countParts() { const n = cpPartsNow().length; $('#cpCount').textContent = n ? `${n} part number${n > 1 ? 's' : ''}` : ''; }
function renderCopyParts() {
  const list = cpPartsNow();
  $('#cpPartList').innerHTML = list.length
    ? list.map((n, i) => `<div class="cpItem" data-i="${i}"><span class="mono muted">${i + 1}</span><input class="txt mono cpEdit" value="${esc(n)}" aria-label="Part number ${i + 1}" spellcheck="false"><button class="ghost mini cpDel" title="Remove ${esc(n)} from the list" aria-label="Remove">✕</button></div>`).join('')
    : '<div class="muted cpEmpty">No part numbers yet. Drop the parts-list PDF above, or add them below.</div>';
  $('#cpClearList').disabled = !list.length;
}
function addCopyParts() {
  const inp = $('#cpAddIn'), add = splitTerms(inp.value);
  if (!add.length) { inp.focus(); return; }
  const before = cpPartsNow(), fresh = add.filter(t => !before.includes(t));
  storeCopyParts(before.concat(add));
  renderCopyParts();
  inp.value = '';
  inp.focus();
  log(`Copy: added ${fresh.length ? fresh.join(', ') : 'nothing new'}${fresh.length < add.length ? ` (${add.length - fresh.length} already in the list)` : ''}`, 'ok');
  const last = $('#cpPartList').lastElementChild;
  if (last) last.scrollIntoView({ block: 'nearest' });
}
function wireCopyPartList() {
  const box = $('#cpPartList');
  // edit in place: Enter or leaving the box saves; an emptied box removes that part
  box.addEventListener('change', e => {
    const row = e.target.closest('.cpItem');
    if (!row || !e.target.classList.contains('cpEdit')) return;
    const list = cpPartsNow(), i = +row.dataset.i, v = splitTerms(e.target.value);
    list.splice(i, 1, ...v);
    storeCopyParts(list);
    renderCopyParts();
  });
  box.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('cpEdit') && !e.ctrlKey && !e.metaKey) { e.preventDefault(); e.target.blur(); } });
  box.addEventListener('click', e => {
    const b = e.target.closest('.cpDel');
    if (!b) return;
    const list = cpPartsNow(), i = +b.closest('.cpItem').dataset.i, [gone] = list.splice(i, 1);
    storeCopyParts(list);
    renderCopyParts();
    log(`Copy: removed ${gone} from the list`);
  });
  $('#cpAdd').onclick = addCopyParts;
  $('#cpAddIn').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); addCopyParts(); } });
  $('#cpAddIn').addEventListener('paste', () => setTimeout(() => { if (/[\s,;]/.test($('#cpAddIn').value.trim())) addCopyParts(); }, 0)); // a pasted column goes straight in
  let armed = 0;
  $('#cpClearList').onclick = () => {
    if (Date.now() - armed > 3000) { armed = Date.now(); $('#cpClearList').textContent = 'Click again to clear'; setTimeout(() => { $('#cpClearList').textContent = 'Clear list'; }, 3000); return; }
    armed = 0; $('#cpClearList').textContent = 'Clear list';
    setCopyParts([]); $('#cpListSrc').textContent = ''; log('Copy: part list cleared');
  };
  renderCopyParts();
}
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
    return `<tr${first ? ' style="border-top:2px solid var(--line)"' : ''}><td class="mono">${first ? esc(r.part) : ''}</td><td><span class="ext ${r.type}">${r.type === 'dir' ? 'FOLDER' : r.type.toUpperCase()}</span></td><td>${r.f ? `<span title="${esc(r.f.path)}">${esc(r.f.name)}</span>` : '<span class="muted">—</span>'}</td><td>${res}</td></tr>`;
  }).join('') + '</tbody>';
}
// Two windows when copying is done. COPIED: every file copied, in the order it was copied, and where it went (then
// anything else not copied). MISSING: every .nc and .pdf that was not found for a part (also when its DXF went instead).
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
function copyListText() {
  const d = cp.done;
  if (!d) return '';
  const lines = [`NC Drive v${CONFIG.version} · Copy to Drive · ${d.when}`, `${plural(d.files.length, 'file')} copied to ${d.target}${d.stopped ? ' (stopped)' : ''}`, ''];
  d.files.forEach((f, i) => lines.push(`${String(i + 1).padStart(3)}  ${f.part.padEnd(8)}  ${f.to}${f.how === 'dxf' ? '   (DXF instead)' : ''}`));
  if (d.miss.length) lines.push('', 'Also not copied:', ...d.miss.map(m => `     ${m.part.padEnd(8)}  ${m.type.toUpperCase()}  ${m.why}`));
  return lines.join('\r\n');
}
function missingListText() {
  const d = cp.done;
  if (!d) return '';
  const lines = [`NC Drive v${CONFIG.version} · Copy to Drive · ${d.when}`, `${plural(d.lost.length, 'missing .nc / .pdf file')} (${plural(new Set(d.lost.map(m => m.part)).size, 'part')})`, ''];
  d.lost.forEach((m, i) => lines.push(`${String(i + 1).padStart(3)}  ${m.part.padEnd(8)}  .${m.type.padEnd(4)}  ${m.note}`));
  return lines.join('\r\n');
}
// The two windows open side by side and both can be used, so they are not modal: a dimmed layer covers the page instead.
const syncDlgShade = () => document.body.classList.toggle('cpDlgOpen', !!document.querySelector('dialog.cpDoneDlg[open]'));
function openDlg(id) { const dlg = $('#' + id); if (!dlg.open) dlg.show(); syncDlgShade(); }
function showCopyDone() {
  const d = cp.done;
  if (!d) return;
  $('#cpDoneT').textContent = d.stopped ? '■ Copying stopped' : d.files.length ? '✓ Copying done' : 'Copying done — nothing copied';
  $('#cpDoneSum').innerHTML = `<b>${d.files.length}</b> file${d.files.length === 1 ? '' : 's'} copied to <b>${esc(d.target)}</b> in ${d.secs} s · ${esc(d.when)}`
    + ` · ${d.lost.length ? `<span class="bad">${plural(d.lost.length, 'missing .nc / .pdf file')}</span> (see the other window)` : '<span class="ok">no .nc / .pdf missing</span>'}`;
  $('#cpDoneTable').innerHTML = '<thead><tr><th>#</th><th>Part</th><th>File</th><th>Copied to</th></tr></thead><tbody>'
    + (d.files.length ? d.files.map((f, i) => `<tr><td class="mono muted">${i + 1}</td><td class="mono">${esc(f.part)}</td><td>${esc(f.name)}${f.how === 'dxf' ? ' <span class="warnc">(DXF instead)</span>' : ''}</td><td class="mono muted">${esc(f.to.slice(0, f.to.length - f.name.length - 1))}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">No files were copied.</td></tr>') + '</tbody>';
  $('#cpDoneMiss').innerHTML = d.miss.length ? `<b class="bad">Also not copied (${d.miss.length}):</b> ` + d.miss.map(m => `<span class="mono">${esc(m.part)}</span> ${m.type.toUpperCase()} <span class="muted">${esc(m.why)}</span>`).join(' · ') : '';
  $('#cpDoneNote').textContent = '';
  openDlg('cpDone');
  $('#cpDoneOk').focus();
}
function showMissing() {
  const d = cp.done;
  if (!d) return;
  $('#cpMissSum').innerHTML = d.lost.length
    ? `<b class="bad">${d.lost.length}</b> .nc / .pdf file${d.lost.length === 1 ? ' was' : 's were'} not found, for <b>${plural(new Set(d.lost.map(m => m.part)).size, 'part')}</b>`
    : '<span class="ok">Every part had its .nc and .pdf.</span>';
  $('#cpMissTable').innerHTML = '<thead><tr><th>#</th><th>Part</th><th>Missing file</th><th>Note</th></tr></thead><tbody>'
    + (d.lost.length ? d.lost.map((m, i) => `<tr><td class="mono muted">${i + 1}</td><td class="mono">${esc(m.part)}</td><td><span class="ext ${m.type}">${m.type.toUpperCase()}</span></td><td class="${m.dxf ? 'warnc' : 'bad'}">${esc(m.note)}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">Nothing missing.</td></tr>') + '</tbody>';
  $('#cpMissNote').textContent = '';
  openDlg('cpMiss');
  $('#cpMissOk').focus();
}
// Third column of the page: the copied files list, always on screen (the same list as the COPIED window).
function renderCopiedPanel() {
  const d = cp.done, head = '<thead><tr><th>#</th><th>Part</th><th>File</th><th>Copied to</th></tr></thead><tbody>';
  $('#cpListCopy').disabled = $('#cpListSave').disabled = !d;
  $('#cpListNote').textContent = '';
  if (!d) {
    $('#cpListCount').textContent = ''; $('#cpListSum').innerHTML = ''; $('#cpListMiss').innerHTML = '';
    $('#cpListTable').innerHTML = head + '<tr><td colspan="4" class="empty">The files copied by the last run are listed here, in order.</td></tr></tbody>';
    return;
  }
  $('#cpListCount').textContent = String(d.files.length);
  $('#cpListSum').innerHTML = `${d.stopped ? '<span class="warnc">Stopped.</span> ' : ''}<b>${d.files.length}</b> file${d.files.length === 1 ? '' : 's'} → <b>${esc(d.target)}</b> · ${d.secs} s · ${esc(d.when)}`
    + (d.lost.length ? ` · <span class="bad">${plural(d.lost.length, 'missing .nc / .pdf')}</span>` : '');
  $('#cpListTable').innerHTML = head
    + (d.files.length ? d.files.map((f, i) => `<tr><td class="mono muted">${i + 1}</td><td class="mono">${esc(f.part)}</td><td>${esc(f.name)}${f.how === 'dxf' ? ' <span class="warnc">(DXF instead)</span>' : ''}</td><td class="mono muted">${esc(f.to.slice(0, f.to.length - f.name.length - 1))}</td></tr>`).join('')
      : '<tr><td colspan="4" class="empty">No files were copied.</td></tr>') + '</tbody>';
  $('#cpListMiss').innerHTML = d.miss.length ? `<b class="bad">Also not copied (${d.miss.length}):</b> ` + d.miss.map(m => `<span class="mono">${esc(m.part)}</span> ${m.type.toUpperCase()} <span class="muted">${esc(m.why)}</span>`).join(' · ') : '';
}
async function copyListToClipboard(textFn, noteEl) {
  try { await navigator.clipboard.writeText(textFn()); noteEl.textContent = 'List copied to the clipboard.'; }
  catch (e) { noteEl.textContent = 'The browser would not use the clipboard — use Save list.'; }
}
function saveListFile(textFn, fileWord) {
  const a = document.createElement('a'), stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  a.href = URL.createObjectURL(new Blob([textFn()], { type: 'text/plain' }));
  a.download = `${fileWord}-${(cp.done.job || stamp).replace(/[\\/:*?"<>|]+/g, '_')}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Both windows after a copy: COPIED on the left, MISSING on the right (stacked on a narrow screen).
function showCopyWindows() {
  const both = cp.done && cp.done.lost.length;
  document.body.classList.toggle('cpPair', !!both);
  showCopyDone();
  if (both) showMissing();
}
function wireListDlg(id, textFn, fileWord) {
  const close = () => { $('#' + id).close(); document.body.classList.remove('cpPair'); syncDlgShade(); };
  $('#' + id).addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); close(); } });
  $('#' + id + 'Ok').onclick = close; $('#' + id + 'X').onclick = close;
  $('#' + id + 'Copy').onclick = () => copyListToClipboard(textFn, $('#' + id + 'Note'));
  $('#' + id + 'Save').onclick = () => saveListFile(textFn, fileWord);
}
function wireCopyDone() {
  wireListDlg('cpDone', copyListText, 'copied-files');
  wireListDlg('cpMiss', missingListText, 'missing-files');
  $('#cpShowList').onclick = () => { document.body.classList.remove('cpPair'); showCopyDone(); };
  $('#cpShowMiss').onclick = () => { document.body.classList.remove('cpPair'); showMissing(); };
  $('#cpListCopy').onclick = () => cp.done && copyListToClipboard(copyListText, $('#cpListNote'));
  $('#cpListSave').onclick = () => cp.done && saveListFile(copyListText, 'copied-files');
  renderCopiedPanel();
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
  ls.set('types1', $('#cpTypes').value.trim()); ls.set('dst', $('#cpDst').value.trim()); ls.set('src', $('#cpSrcTxt').value.trim());
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
    const why = { missing: 'missing (no DXF either)', fail: 'could not write' };
    cp.done = { files: res.files, target: res.dir === cp.target ? cp.target.name : cp.target.name + '\\' + res.dir.name,
      secs: ((performance.now() - t0) / 1000).toFixed(1), when: new Date().toLocaleString(), stopped: !!res.stopped, job: $('#cpJobDir').checked ? $('#cpJob').value.trim() : '',
      // every .nc / .pdf not found (a DXF may have gone instead) — the MISSING window
      lost: cp.rows.filter(x => (x.type === 'nc' || x.type === 'pdf') && (x.how === 'missing' || x.how === 'dxf' || x.how === 'dxfdup'))
        .map(x => ({ part: x.part, type: x.type, dxf: x.how !== 'missing', note: x.how === 'missing' ? 'not found — no DXF either' : 'not found — the DXF was copied instead' })),
      miss: cp.rows.filter(x => (x.st === 'missing' && x.type !== 'nc' && x.type !== 'pdf') || x.st === 'fail' || x.st === 'wait').map(x => ({ part: x.part, type: x.type, why: x.st === 'fail' ? (x.err || why.fail) : x.st === 'wait' ? 'not copied (stopped)' : x.type === CONFIG.copy.fallbackType ? 'missing' : why.missing })) };
    $('#cpShowList').hidden = false; $('#cpShowMiss').hidden = false;
    renderCopiedPanel();
    showCopyWindows();
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
  $('#cpTypes').value = ls.get('types1', CONFIG.copy.defaultTypes); // new key: DXF is in the default types now
  [['cpSrcTxt', 'src'], ['cpDst', 'dst'], ['cpTypes', 'types1']].forEach(([id, k]) => $('#' + id).addEventListener('change', () => {
    ls.set(k, $('#' + id).value.trim());
    if (id === 'cpTypes') showTypes();
    if (id === 'cpDst') showTarget();
  }));
  $('#cpSrcLocate').onclick = locateSource;
  $('#cpDstPick').onclick = openTarget;
  wireCopyPartList();
  wireCopyDone();
  $('#cpJob').addEventListener('input', () => { cp.jobTyped = true; });
  wireDropZone('cpDrop', 'cpFile', readCopyList);
  window.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readCopyList(f); }); // a drop anywhere on the page
  $('#cpRun').onclick = runCopy;
  $('#cpStop').onclick = () => { lib.stop = true; };
  $('#cpPartList').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runCopy(); } });
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
