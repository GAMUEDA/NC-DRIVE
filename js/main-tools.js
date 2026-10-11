/* =====================================================================================================
   MAIN · TOOLS — the Tools dock opens each tool as its own page, and the main page answers their requests
   The tool pages work on their own too; when this page is open they link to it (link.js):
     nc_search.html      P8   NC Search          → loadFiles (Load selected)
     parts_list.html     P9   PartsList from PDF → state, setQuantities, setJob, loadFiles (Find & load missing)
     copy_to_drive.html  P10  Copy Parts to Drive → state (job name for the job folder)
     erase_usb.html      P11  Erase / Clear USB   → jobNc (Copy this job to USB)
     dxf_to_nc.html      P12  DXF to NC           (works on its own: one .nc per .dxf, to a USB drive or a folder)
   Every tool also sends its log lines here, so the main log shows what the tools did.
   ===================================================================================================== */
const TOOL_PAGES = { search: 'nc_search.html', copy: 'copy_to_drive.html', plist: 'parts_list.html', usb: 'erase_usb.html', dxfnc: 'dxf_to_nc.html' };
const TOOL_KEYS = { 1: 'search', 2: 'copy', 3: 'plist', 4: 'usb', 5: 'dxfnc' }; // Alt+1..5

// Open (or bring forward) a tool page. params are added to its address, e.g. {terms: '19992 14738'} (reloads it).
function openTool(key, params) {
  const q = params ? '?' + new URLSearchParams(params) : '';
  const w = openNamed(TOOL_PAGES[key] + q, 'ncdrive-' + key, !!params);
  if (!w) log('the browser blocked the tool window — allow pop-ups for this page', 'bad');
}

// What the tool pages see of this job.
function mainState() {
  return { job: jobName(), parts: S.parts.map(p => ({ name: p.name, qty: p.qty })), sheets: flatSheets().length, stale: S.stale };
}
// Set quantities from a parts list: sums = [[partNumber, qty], ...]. → number of loaded parts set
function applyQuantities(sums) {
  let set = 0;
  for (const [part, q] of sums) for (const p of S.parts.filter(x => termMatcher(part)(x.name))) { p.qty = q; set++; }
  if (set) { markStale(); renderParts(); }
  return set;
}
// Tell the tool pages that parts / nest / job changed (at most once per 100 ms).
let changedTimer = null;
function announceChange() {
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => NCLink.notify('changed'), 100);
}

function wireToolsDock() {
  $('#dock').addEventListener('click', e => { const b = e.target.closest('.tile[data-act]'); if (b) openTool(b.dataset.act); });
  document.addEventListener('keydown', e => {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const act = TOOL_KEYS[e.key];
    if (act) { e.preventDefault(); openTool(act); }
  });
}
function wireToolLink() {
  window.name = 'ncdrive-main'; // so the tool pages' "Open NC Drive" comes back to this window
  NCLink.handle('state', mainState);
  NCLink.handle('loadFiles', async d => { await handleFiles(d.files || []); return mainState(); });
  NCLink.handle('setQuantities', d => applyQuantities(d.sums || []));
  NCLink.handle('setJob', d => {
    if (d.job && !jobName().trim()) { $('#jobIn').value = d.job; if (S.view === 'report') renderView(); announceChange(); }
    return mainState();
  });
  NCLink.handle('jobNc', () => ({ files: makeJobNcFiles(S.groups, jobName()), stale: S.stale }));
  NCLink.on('log', d => log(d.msg, d.kind));
  window.addEventListener('pagehide', () => NCLink.notify('bye'));
  announceChange();
}
