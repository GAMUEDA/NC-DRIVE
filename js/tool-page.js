/* =====================================================================================================
   TOOL PAGE — the frame shared by the four tool pages: link to NC Drive, log, progress
   MAIN holds the main page's job ({job, parts:[{name, qty}], sheets, stale}) while nc_drive.html is open,
   and null when it isn't. Each tool works on its own; the parts that need the main page open it when needed.
   ===================================================================================================== */
let MAIN = null;
const mainHooks = []; // called with MAIN whenever it changes
const params = new URLSearchParams(location.search);
function onMainChange(fn) { mainHooks.push(fn); }

// Log here and in the main page's log.
function log(msg, kind) {
  const el = $('#toolLog');
  if (el) { el.insertAdjacentHTML('beforeend', `<span class="t">${timeStamp()}</span> <span class="${kind || ''}">${esc(msg)}</span>\n`); el.scrollTop = el.scrollHeight; }
  NCLink.notify('log', { msg, kind });
}
// Report progress to the main page's status dial: frac 0..1 (null = busy, no %), done = finished.
function reportProgress(task, detail, frac, done) { NCLink.notify('progress', { task, detail, frac, done: !!done }); }

function renderLinkState() {
  $('#linkState').innerHTML = MAIN
    ? `<span class="ok">● linked to NC Drive</span>${MAIN.job ? ` <span class="muted">· job ${esc(MAIN.job)}</span>` : ''}`
    : '<span class="warnc">○ NC Drive is not open</span>';
}
function setMain(m) { MAIN = m; renderLinkState(); mainHooks.forEach(fn => fn(MAIN)); }
async function refreshMain() {
  let m = null;
  try { m = await NCLink.request('state', null, 800); } catch (e) {}
  setMain(m);
}
function openMain() { return openNamed('nc_drive.html', 'ncdrive-main'); }
// Make sure the main page is open (opens it when it isn't — call this first thing in a click), then wait for it.
async function ensureMain(ms) {
  if (!MAIN) openMain();
  const t0 = Date.now();
  while (Date.now() - t0 < (ms || 10000)) {
    try { const m = await NCLink.request('state', null, 700); setMain(m); return m; } catch (e) {}
  }
  throw new Error('NC Drive did not answer — open nc_drive.html from the same folder and try again.');
}

function startToolPage(key) {
  window.name = 'ncdrive-' + key; // so the main page's Tools dock brings this window forward
  fitScreen();
  window.addEventListener('resize', fitScreen);
  $('#openMain').onclick = openMain;
  NCLink.on('changed', refreshMain);
  NCLink.on('bye', () => setMain(null));
  // a file dropped outside a drop zone must not replace the page
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());
  renderLinkState();
  refreshMain();
}
