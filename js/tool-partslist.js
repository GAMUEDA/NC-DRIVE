/* =====================================================================================================
   PARTS LIST page (parts_list.html) — screen for P9
   Works on its own: read a parts list / work order and edit the lines. "Set quantities" and "Find & load missing"
   act on NC Drive's parts list (opening NC Drive if it isn't open). "Copy to drive…" opens copy_to_drive.html
   with these part numbers.
   ===================================================================================================== */
const pl = { lines: [], src: '' };
const plMatch = part => (MAIN ? MAIN.parts.filter(p => termMatcher(part)(p.name)) : []); // loaded parts for a list line

async function readPlist(f) {
  $('#plStatus').textContent = `Reading ${f.name}…`;
  reportProgress('Parts list', `reading ${f.name}`, null);
  try {
    const r = await readPartsList(f);
    if (!r.lines.length) { $('#plStatus').innerHTML = `<span class="bad">No part numbers (5–6 digits) found in ${esc(f.name)}.</span> ${r.rows.length ? 'If it is a scanned PDF it has no text to read.' : ''}`; reportProgress('Parts list', 'no part numbers', 0, true); return; }
    pl.lines = r.lines;
    pl.src = f.name;
    if (r.job && MAIN) NCLink.request('setJob', { job: r.job }).then(setMain, () => {}); // fills NC Drive's job name when it is empty
    $('#plInfo').innerHTML = `<b>${esc(f.name)}</b><span class="muted">${r.job ? '· job ' + esc(r.job) + ' ' : ''}· ${r.lines.length} lines · ${r.lines.reduce((a, l) => a + l.qty, 0)} pieces${r.header ? '' : ' · no column headings found, read line by line — check the quantities'}</span>`;
    log(`PartsList: ${f.name} — ${r.lines.length} lines`, 'ok');
    reportProgress('Parts list', `${r.lines.length} lines read`, 1, true);
    renderPlist();
  } catch (e) {
    $('#plStatus').innerHTML = `<span class="bad">Couldn't read ${esc(f.name)}: ${esc(e.message || e)}</span>`;
    reportProgress('Parts list', 'could not read', 0, true);
  }
}
function renderPlist() {
  const L = pl.lines;
  $('#plWrap').hidden = !L.length;
  $('#plAddRow').hidden = !L.length;
  $('#plTable').innerHTML = '<thead><tr><th>#</th><th>Part number</th><th>Qty</th><th>Description</th><th>Status</th><th></th></tr></thead><tbody>' + L.map((l, i) => {
    const m = plMatch(l.part);
    const status = !MAIN ? '<span class="muted">NC Drive not open</span>'
      : m.length ? `<span class="ok">✓ loaded${m.length > 1 ? ` (${m.length} files)` : ''}${m[0].qty === l.qty && m.length === 1 ? '' : ` · now ${m.reduce((a, p) => a + p.qty, 0)}`}</span>` : '<span class="warnc">not loaded</span>';
    return `<tr data-i="${i}"><td class="muted mono">${i + 1}</td><td><input class="txt plP" value="${esc(l.part)}" style="width:110px;"></td><td><input class="num plQ" type="number" min="0" value="${l.qty}"></td><td style="font-size:11px;color:var(--muted);">${esc(l.desc)}</td>
        <td style="font-size:11px;">${status}${l.warn ? ` <span class="warnc">· ${esc(l.warn)}</span>` : ''}</td><td><button class="x" title="Remove line">✕</button></td></tr>`;
  }).join('') + '</tbody>';
  const missing = L.filter(l => !plMatch(l.part).length).length;
  $('#plApply').disabled = !L.length;
  $('#plFind').disabled = !L.length;
  $('#plToCopy').disabled = !L.length;
  $('#plFind').textContent = !L.length ? 'Find & load missing, set quantities' : missing ? `Find & load ${new Set(L.filter(l => !plMatch(l.part).length).map(l => l.part)).size} missing, set quantities` : 'Set quantities';
  if (L.length) $('#plStatus').textContent = !MAIN ? 'NC Drive is not open — it opens when you set quantities.' : missing ? `${missing} line${missing > 1 ? 's' : ''} not loaded yet.` : 'Every part on the list is loaded.';
}
// Quantities per part number (lines for the same part add up).
function plSums() {
  const sums = new Map();
  pl.lines.forEach(l => { if (l.part) sums.set(l.part, (sums.get(l.part) || 0) + l.qty); });
  return [...sums];
}
// Set every loaded part's quantity in NC Drive. → number of parts set
async function applyPlist() {
  const opening = ensureMain();
  try {
    await opening;
    const set = await NCLink.request('setQuantities', { sums: plSums() }, 10000);
    log(`PartsList: quantities set on ${set} part${set === 1 ? '' : 's'}`, 'ok');
    await refreshMain();
    renderPlist();
    return set;
  } catch (e) {
    $('#plStatus').innerHTML = `<span class="bad">${esc(e.message || e)}</span>`;
    return 0;
  }
}
// Find the parts NC Drive doesn't have in the linked folders (P8), load them into NC Drive, then set every quantity.
async function findAndLoadPlist() {
  const opening = ensureMain();
  try { await opening; } catch (e) { $('#plStatus').innerHTML = `<span class="bad">${esc(e.message || e)}</span>`; return; }
  const miss = [...new Set(pl.lines.filter(l => l.part && !plMatch(l.part).length).map(l => l.part))];
  if (!miss.length) { await applyPlist(); return; }
  if (!lib.roots.length) { $('#plStatus').innerHTML = '<span class="bad">Link a parts folder first (NC Search tool → Link a folder).</span>'; return; }
  $('#plFind').disabled = true;
  lib.stop = false; lib.dirCache = new Map();
  try {
    const r = await searchLibrary(miss, { progress: d => { $('#plStatus').textContent = `Searching the parts folders… ${d.toLocaleString()} folders`; reportProgress('Parts list', `searching · ${d.toLocaleString()} folders`, null); } });
    const files = miss.flatMap(t => bestPicks(r.found, t)).map(f => f.file), notFound = miss.filter(t => !r.found.some(f => f.term === t && f.ext !== 'pdf'));
    if (files.length) setMain(await NCLink.request('loadFiles', { files }, 120000));
    const set = await applyPlist();
    $('#plStatus').innerHTML = `Loaded ${files.filter(f => !/\.pdf$/i.test(f.name)).length} part file${files.length === 1 ? '' : 's'}, quantities set on ${set}.` + (notFound.length ? ` <span class="bad">No .nc/.dxf found for ${esc(notFound.join(', '))}.</span>` : '');
    reportProgress('Parts list', `quantities set on ${set}`, 1, true);
  } catch (e) {
    $('#plStatus').innerHTML = `<span class="bad">${esc(e.message || e)}</span>`;
  }
  $('#plFind').disabled = false;
}
function startPartsListPage() {
  startToolPage('plist');
  wireDropZone('plDrop', 'plFile', readPlist);
  window.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) readPlist(f); }); // a drop anywhere on the page
  if (FS_OK) loadRoots();
  NCLink.on('roots-changed', loadRoots);
  $('#plTable').addEventListener('change', e => {
    const tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    const l = pl.lines[+tr.dataset.i];
    if (e.target.classList.contains('plP')) l.part = e.target.value.trim();
    if (e.target.classList.contains('plQ')) { l.qty = Math.max(0, parseInt(e.target.value, 10) || 0); l.warn = ''; }
    renderPlist();
  });
  $('#plTable').addEventListener('click', e => { if (!e.target.classList.contains('x')) return; pl.lines.splice(+e.target.closest('tr').dataset.i, 1); renderPlist(); });
  $('#plAdd').onclick = () => { pl.lines.push({ part: '', qty: 1, desc: '', warn: '' }); renderPlist(); const ins = $('#plTable').querySelectorAll('.plP'); ins[ins.length - 1].focus(); };
  $('#plApply').onclick = applyPlist;
  $('#plFind').onclick = findAndLoadPlist;
  $('#plToCopy').onclick = () => {
    const parts = [...new Set(pl.lines.map(l => l.part).filter(Boolean))];
    openNamed('copy_to_drive.html?' + new URLSearchParams({ parts: parts.join(' '), src: pl.src || 'PartsList' }), 'ncdrive-copy', true);
  };
  onMainChange(renderPlist);
  renderPlist();
}

window.NCDriveTool = { CONFIG, process: { readPartsList, parsePartsRows, pdfToRows, textToRows, searchLibrary }, pl, link: NCLink };
startPartsListPage();
