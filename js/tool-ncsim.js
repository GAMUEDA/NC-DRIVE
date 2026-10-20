/* =====================================================================================================
   TOOL PAGE · NC PART SIMULATOR — the shop's NC Path Simulator (js/ncsim-app.js) as NC Drive's 6th tool
   Links to index.html like the other tool pages (no screen scaling here: the simulator lays itself out).
   A program handed over from another page (▶ in DXF to NC) arrives as ls 'simFile' {name, text, t}
   + NCLink 'sim-file', and opens as if it had been dropped on the page.
   ===================================================================================================== */
// Every simulator window that is open (or opens within two minutes) plays it; each takes a hand-off once.
let simTaken = 0;
function takeSimHandoff() {
  let h = null;
  try { h = JSON.parse(ls.get('simFile', 'null')); } catch (e) {}
  if (!h || !h.text || h.t === simTaken || Date.now() - h.t > 120000) return false;
  simTaken = h.t;
  if (window.NCSim.open(h.text, h.name)) log(`simulating ${h.name}`, 'ok');
  window.focus();
  return true;
}

(function startSimPage() {
  window.name = 'ncdrive-ncsim'; // so the main page's Tools dock brings this window forward
  $('#openMain').onclick = openMain;
  $('#ncdHome').onclick = e => { e.preventDefault(); openMain(); };
  NCLink.on('changed', refreshMain);
  NCLink.on('bye', () => setMain(null));
  NCLink.on('sim-file', takeSimHandoff);
  // a file dropped outside the drop zone must not replace the page
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());
  renderLinkState();
  refreshMain();
  takeSimHandoff();
})();

window.NCDriveTool = { CONFIG, sim: window.NCSim, link: NCLink };
