/* =====================================================================================================
   NC SEARCH page (nc_search.html) — screen for P8
   Works on its own: link folders, search, tick files. "Load selected" sends the files to NC Drive's parts list
   (opening NC Drive if it isn't open). Address: nc_search.html?terms=19992%2014738 searches straight away.
   ===================================================================================================== */
const loadedNames = () => (MAIN ? MAIN.parts.map(p => p.name.toLowerCase()) : []);

function renderRoots() {
  $('#srRoots').innerHTML = lib.roots.length
    ? lib.roots.map((r, i) => `<div class="chip"><span class="ok">✓</span><span class="nm" title="${esc(r.name)}">${esc(r.name)}</span><button class="x" data-i="${i}" title="Unlink">✕</button></div>`).join('')
    : `<div class="note">No folder linked yet. Link the folder(s) that hold your part programs and drawings — nothing is copied or uploaded, the page only reads them.</div>`;
  $('#srRoots').querySelectorAll('.x').forEach(b => (b.onclick = async () => { lib.roots.splice(+b.dataset.i, 1); await saveRoots(); renderRoots(); }));
  $('#srLink').textContent = lib.roots.length ? 'Link another folder…' : 'Link a folder…';
}
async function runSearch() {
  const terms = splitTerms($('#srTerms').value), exts = ['nc', 'dxf', 'pdf'].filter(x => $('#sr' + x[0].toUpperCase() + x.slice(1)).checked);
  if (!terms.length) { $('#srStatus').textContent = 'Type at least one part number or name.'; return; }
  lib.stop = false; lib.dirCache = new Map();
  $('#srGo').disabled = true; $('#srStop').hidden = false; $('#srLoad').disabled = true;
  const t0 = performance.now();
  try {
    const r = await searchLibrary(terms, {
      exts,
      progress: (d, n) => { $('#srStatus').textContent = `Searching… ${d.toLocaleString()} folders, ${n} files found`; reportProgress('NC Search', `${d.toLocaleString()} folders · ${n} files`, null); },
    });
    lib.results = r.found;
    const picks = new Set(terms.flatMap(t => bestPicks(r.found, t)));
    r.found.forEach(f => (f.sel = picks.has(f)));
    renderSearch(terms);
    const miss = terms.filter(t => !r.found.some(f => f.term === t));
    $('#srStatus').innerHTML = `${r.stopped ? 'Stopped — ' : ''}${r.dirs.toLocaleString()} folders in ${((performance.now() - t0) / 1000).toFixed(1)} s · ${terms.length - miss.length} of ${terms.length} found` + (miss.length ? ` · <span class="bad">not found: ${esc(miss.join(', '))}</span>` : '');
    log(`NC Search: ${terms.length - miss.length}/${terms.length} found${miss.length ? ' — missing ' + miss.join(', ') : ''}`, miss.length ? 'warn' : 'ok');
    reportProgress('NC Search', `${terms.length - miss.length} of ${terms.length} found`, 1, true);
  } catch (e) {
    $('#srStatus').innerHTML = `<span class="bad">${esc(e.message || e)}</span>`;
    reportProgress('NC Search', 'stopped', 0, true);
  }
  $('#srGo').disabled = false; $('#srStop').hidden = true;
}
function renderSearch(terms) {
  const R = lib.results, wrap = $('#srWrap'), loaded = loadedNames();
  wrap.hidden = !terms.length;
  let html = '<thead><tr><th style="width:28px;"></th><th>File</th><th>Type</th><th>Modified</th><th>Folder</th></tr></thead><tbody>';
  for (const t of terms) {
    const rows = R.filter(f => f.term === t).sort((a, b) => (a.ext > b.ext ? 1 : a.ext < b.ext ? -1 : 0) || b.file.lastModified - a.file.lastModified);
    html += `<tr class="grp"><td colspan="5">${esc(t)} ${rows.length ? `<span class="muted" style="font-weight:400;">· ${rows.length} file${rows.length > 1 ? 's' : ''}</span>` : '<span class="bad" style="font-weight:400;">· not found</span>'}</td></tr>`;
    for (const f of rows) {
      const i = R.indexOf(f), isLoaded = loaded.includes(f.name.replace(/\.(dxf|nc)$/i, '').toLowerCase());
      html += `<tr><td><input type="checkbox" data-i="${i}" ${f.sel ? 'checked' : ''} aria-label="Select ${esc(f.name)}"></td><td>${esc(f.name)}${f.old ? ' <span class="warnc">(old/backup folder)</span>' : ''}${isLoaded ? ' <span class="ok">· loaded</span>' : ''}</td><td><span class="ext ${f.ext}">${f.ext.toUpperCase()}</span></td><td class="mono" style="font-size:11px;">${fmtDate(f.file.lastModified)}</td><td class="path" title="${esc(f.path)}">${esc(f.path.replace(/\/[^/]*$/, ''))}</td></tr>`;
    }
  }
  $('#srTable').innerHTML = html + '</tbody>';
  $('#srTable').querySelectorAll('input[data-i]').forEach(c => (c.onchange = () => { R[+c.dataset.i].sel = c.checked; updSel(); }));
  updSel();
}
function updSel() {
  const n = lib.results.filter(f => f.sel).length;
  $('#srLoad').disabled = !n;
  $('#srLoad').textContent = n ? `Load ${n} selected into NC Drive` : 'Load selected into NC Drive';
}
async function linkSearchFolder() {
  if (!FS_OK) { $('#srFsNote').textContent = FS_MSG; return; }
  try {
    const h = await pickFolder({ id: 'ncdrive-lib', mode: 'read' });
    if (!h) return;
    const r = await addRoot(h);
    if (r === 'never') { $('#srStatus').textContent = `Not linked: “${h.name}” has AMADA in its name and those folders are never opened.`; return; }
    if (r === 'added') renderRoots();
  } catch (e) {
    $('#srStatus').textContent = 'Could not open that folder: ' + ((e && e.message) || e);
  }
}
// Send the ticked files to NC Drive (opens it if needed).
async function loadSelectedSearch() {
  const sel = lib.results.filter(f => f.sel);
  if (!sel.length) return;
  $('#srLoad').disabled = true;
  try {
    const opening = ensureMain();
    $('#srStatus').textContent = 'Sending to NC Drive…';
    await opening;
    setMain(await NCLink.request('loadFiles', { files: sel.map(f => f.file) }, 120000));
    $('#srStatus').innerHTML = `<span class="ok">Loaded ${sel.length} file${sel.length > 1 ? 's' : ''} into the parts list.</span>`;
  } catch (e) {
    $('#srStatus').innerHTML = `<span class="bad">${esc(e.message || e)}</span>`;
  }
  renderSearch(splitTerms($('#srTerms').value));
}
function startSearchPage() {
  startToolPage('search');
  $('#srLink').onclick = linkSearchFolder;
  if (FS_OK) loadRoots().then(renderRoots);
  else { $('#srFsNote').textContent = FS_MSG; $('#srLink').disabled = true; }
  NCLink.on('roots-changed', () => loadRoots().then(renderRoots));
  renderRoots();
  $('#srGo').onclick = runSearch;
  $('#srStop').onclick = () => { lib.stop = true; };
  $('#srTerms').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runSearch(); } });
  $('#srLoad').onclick = loadSelectedSearch;
  onMainChange(() => { if (lib.results.length) renderSearch(splitTerms($('#srTerms').value)); });
  if (params.get('terms')) { $('#srTerms').value = params.get('terms'); runSearch(); }
  $('#srTerms').focus();
}

window.NCDriveTool = { CONFIG, process: { searchLibrary, bestPicks, newestFile, termMatcher, splitTerms }, lib, link: NCLink };
startSearchPage();
