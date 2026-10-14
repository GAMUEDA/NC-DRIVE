/* =====================================================================================================
   UI · SCREEN — state, layout, log, command line, settings panel
   The screen code reads the boxes on the page, calls the process functions (P1–P11) and draws the results.
   Each panel has a render…() function and a wire…() function (its buttons and boxes); startNcDrive() in
   start.js wires them all once. The four tools (P8–P11) are separate pages: see main-tools.js.
   ===================================================================================================== */


// ---- state: everything the page knows about the current job ----
const S = {
  parts: [], // loaded parts (P2/P3), each with qty and thick (gauge label)
  pdfMats: [], // drawings read (P4): {name, material, raw, partNo, notStocked}
  groups: [], // last nest (P5): [{gauge, r:{sheets, skipped, bed, grid}, req}]
  gi: 0, si: 0, // selected sheet (group index, sheet index)
  view: 'sheet', // 'sheet' | 'report'
  bed: 0, sheetCustom: false,
  idc: 0, // part id counter
  stale: false, // parts or settings changed since the last nest
  nestMs: 0, nestedAt: null, nestSettings: null,
  busy: false,
};

// ---- small readers of the settings panel ----
const cleanOpts = () => ({ clean: $('#cleanChk').checked, bend: $('#bendChk').checked, etch: $('#etchChk').checked, feat: $('#featChk').checked });
const jobName = () => $('#jobIn').value || '';
function getMaterial() {
  const b = CONFIG.beds[S.bed];
  return { w: Math.max(1, parseFloat($('#sheetW').value) || b.w), h: Math.max(1, parseFloat($('#sheetH').value) || b.h) };
}
function nestSettingsFromPanel() {
  return {
    mat: getMaterial(),
    gap: Math.max(0, parseFloat($('#gapIn').value) || 0),
    margin: Math.max(0, parseFloat($('#marginIn').value) || 0),
    skeleton: $('#skelChk').checked,
    sections: $('#sectChk').checked,
  };
}
// The job as the report (P7) sees it.
const currentJob = () => ({ name: jobName(), groups: S.groups, settings: S.nestSettings, nestedAt: S.nestedAt, nestMs: S.nestMs, stale: S.stale });
const flatSheets = () => flatSheetsOf(S.groups);
const sheetNo = (gi, si) => sheetNumber(S.groups, gi, si);
const ncName = (gi, si) => ncFileName(jobName(), S.groups[gi].gauge, si);

// ---- colours ----
const gaugeKeys = () => { const seen = []; S.parts.forEach(p => { const k = normThick(p.thick); if (!seen.includes(k)) seen.push(k); }); return seen; };
const gaugeColor = g => {
  const k = normThick(g);
  if (!k) return 'var(--muted)';
  const i = gaugeKeys().filter(Boolean).indexOf(k);
  return CONFIG.gaugeColors[(i < 0 ? 0 : i) % CONFIG.gaugeColors.length];
};
const partColor = name => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 85% 64%)`; };

// =====================================================================================================
// LAYOUT — the resizable boxes (drag the walls, arrow keys on a focused wall, Reset layout, Full screen)
// =====================================================================================================
const WALL = 8, MIN = 60;
let lay = { ...CONFIG.layout };
function applyLayout() {
  const app = $('#app'), middle = $('#middle'), left = $('#left');
  left.style.gridTemplateRows = `minmax(0,${lay.split}fr) ${WALL}px minmax(0,${1 - lay.split}fr)`;
  const avail = middle.clientWidth - 2 * WALL;
  let listPx = Math.max(MIN, lay.listFrac * middle.clientWidth), rightPx = Math.max(MIN, lay.rightFrac * middle.clientWidth);
  let over = listPx + rightPx + MIN - avail;
  if (over > 0) { const c = Math.min(over, rightPx - MIN); rightPx -= c; over -= c; }
  if (over > 0) listPx = Math.max(MIN, listPx - over);
  app.style.gridTemplateRows = `${lay.header}px ${WALL}px minmax(0,1fr) ${WALL}px ${lay.dock}px ${WALL}px ${lay.command}px`;
  middle.style.gridTemplateColumns = `${listPx}px ${WALL}px minmax(0,1fr) ${WALL}px ${rightPx}px`;
}
function startDrag(wall, ev0) {
  const app = $('#app'), middle = $('#middle'), left = $('#left');
  const kind = wall.dataset.target, edge = wall.dataset.edge, sx = ev0.clientX, sy = ev0.clientY;
  const k = parseFloat(document.documentElement.style.zoom) || 1; // mouse moves are in screen pixels, the layout is in page pixels (fitScreen)
  const start = { ...lay, listPx: $('#listBox').offsetWidth, rightPx: $('#side').offsetWidth, topPx: $('#listBox').offsetHeight };
  wall.classList.add('active');
  document.body.classList.add('dragging', kind === 'cols' ? 'col' : 'row');
  function move(e) {
    if (kind === 'cols') {
      const w = middle.clientWidth, avail = w - 2 * WALL, dx = (e.clientX - sx) / k;
      if (edge === 'right') lay.rightFrac = Math.min(Math.max(start.rightPx - dx, MIN), avail - MIN - start.listPx) / w;
      else lay.listFrac = Math.min(Math.max(start.listPx + dx, MIN), avail - MIN - start.rightPx) / w;
    } else if (kind === 'split') {
      const h = left.clientHeight - WALL;
      lay.split = Math.min(Math.max(start.topPx + (e.clientY - sy) / k, MIN), h - MIN) / h;
    } else {
      const total = app.clientHeight - 3 * WALL, dy = (e.clientY - sy) / k;
      if (edge === 'header') lay.header = Math.min(Math.max(start.header + dy, 40), total - start.dock - start.command - MIN);
      else if (edge === 'command') lay.dock = Math.min(Math.max(start.dock - dy, 44), total - start.header - start.command - MIN); // the wall above the tools: grows or shrinks the tool box
      else { const both = start.dock + start.command; lay.dock = Math.min(Math.max(start.dock + dy, 44), both - 50); lay.command = both - lay.dock; } // between tools and command line
    }
    applyLayout();
  }
  function up() {
    wall.classList.remove('active');
    document.body.classList.remove('dragging', 'col', 'row');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
function nudgeWall(wall, e) {
  const middle = $('#middle'), left = $('#left');
  const step = e.shiftKey ? 40 : 10, d = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
  if (!d) return;
  e.preventDefault();
  if (wall.dataset.target === 'cols' && wall.dataset.edge === 'right') lay.rightFrac = Math.max(0.05, lay.rightFrac - (d * step) / middle.clientWidth);
  else if (wall.dataset.target === 'cols') lay.listFrac = Math.max(0.05, lay.listFrac + (d * step) / middle.clientWidth);
  else if (wall.dataset.target === 'split') lay.split = Math.min(0.9, Math.max(0.1, lay.split + (d * step) / left.clientHeight));
  else if (wall.dataset.edge === 'header') lay.header = Math.max(40, lay.header + d * step);
  else if (wall.dataset.edge === 'command') lay.dock = Math.max(44, lay.dock - d * step);
  else { const both = lay.dock + lay.command; lay.dock = Math.min(Math.max(44, lay.dock + d * step), both - 50); lay.command = both - lay.dock; }
  applyLayout();
}
const toggleFullScreen = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); };
function wireLayout() {
  document.querySelectorAll('.wall').forEach(wall => {
    wall.addEventListener('pointerdown', e => { e.preventDefault(); startDrag(wall, e); });
    wall.addEventListener('keydown', e => nudgeWall(wall, e));
  });
  $('#reset').addEventListener('click', () => { lay = { ...CONFIG.layout }; applyLayout(); });
  $('#fs').addEventListener('click', toggleFullScreen);
  document.addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !e.ctrlKey && !e.metaKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) toggleFullScreen(); });
  document.addEventListener('fullscreenchange', () => { $('#fs').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen'; });
  window.addEventListener('resize', () => { fitScreen(); applyLayout(); });
  fitScreen();
  applyLayout();
}

// =====================================================================================================
// LOG + COMMAND LINE
// To add a command: add an entry to COMMANDS (name → function(rest, arg, text)) and a line to HELP.
// =====================================================================================================
function log(msg, kind) {
  const el = $('#log');
  el.insertAdjacentHTML('beforeend', `<span class="t">${timeStamp()}</span> <span class="${kind || ''}">${esc(msg)}</span>\n`);
  el.scrollTop = el.scrollHeight;
}
const HELP = [
  'nest                      nest every part (one nest per gauge)',
  'qty <part> <n>            set a quantity  (part = name or the start of it, or * for all)',
  'gauge <part> <text>       set a gauge, e.g.  gauge 19992 14ga Satincoat',
  'gap <mm> · margin <mm>    spacing',
  'sheet <w> <l>             sheet size in mm   ·  bed 1 | 2  (4x10 | 6x14)',
  'job <name>                job name',
  'nc [n]                    download sheet n (or the selected sheet) as .nc',
  'zip                       download every .nc in one .zip',
  'report · print · csv      show / print / export the report sheet',
  'parts · sheets            list them here',
  'remove <part> · clear     remove a part / all parts',
  'cls                       clear this log',
  'search [numbers]          NC Search  ·  usb  Erase / Clear USB  ·  plist  PartsList from PDF',
  'copy                      Copy Parts to Drive (NC, PDF… or the DXF when a type is missing)',
  'dxfnc                     DXF to NC: one .nc per .dxf, saved to a USB drive or a folder',
];
// Parts whose name is q, else starts with / contains q; '*' or 'all' = every part.
function findParts(q) {
  q = String(q || '').toLowerCase();
  if (q === '*' || q === 'all') return S.parts;
  const ex = S.parts.filter(p => p.name.toLowerCase() === q);
  return ex.length ? ex : S.parts.filter(p => p.name.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q));
}
const setPartsDone = (ps, what) => { markStale(); renderParts(); log(`${ps.length} part${ps.length > 1 ? 's' : ''} → ${what}`, 'ok'); };
const COMMANDS = {
  help: () => HELP.forEach(h => log(h)),
  nest: () => nestAll(),
  qty: rest => {
    const n = parseInt(rest[rest.length - 1], 10), ps = findParts(rest.slice(0, -1).join(' '));
    if (!(n >= 0) || !ps.length) return log('usage: qty <part> <n>', 'bad');
    ps.forEach(p => (p.qty = n));
    setPartsDone(ps, 'qty ' + n);
  },
  gauge: rest => {
    const ps = findParts(rest[0]), g = rest.slice(1).join(' ');
    if (!ps.length || !g) return log('usage: gauge <part> <text>', 'bad');
    const n = normalizeMaterial(g);
    ps.forEach(p => { p.thick = n.label || g; p._fromPdf = false; });
    setPartsDone(ps, ps[0].thick);
  },
  gap: rest => setSpacing('gap', rest[0]),
  margin: rest => setSpacing('margin', rest[0]),
  sheet: rest => {
    const w = parseFloat(rest[0]), h = parseFloat(rest[1]);
    if (!(w > 0 && h > 0)) return log('usage: sheet <w> <l>', 'bad');
    $('#sheetW').value = w; $('#sheetH').value = h; S.sheetCustom = true;
    updateBedNote(); markStale(); log(`sheet = ${w} × ${h} mm`, 'ok');
  },
  bed: rest => {
    const b = parseInt(rest[0], 10) - 1;
    if (!(b === 0 || b === 1)) return log('usage: bed 1 | 2', 'bad');
    setBed(b); log('bed = ' + CONFIG.beds[b].name, 'ok');
  },
  job: (rest, arg) => { $('#jobIn').value = arg; log('job = ' + arg, 'ok'); if (S.view === 'report') renderView(); announceChange(); },
  nc: rest => {
    if (!S.groups.length) return log('nothing nested yet', 'bad');
    if (rest[0]) {
      const n = parseInt(rest[0], 10), flat = flatSheets();
      if (!(n >= 1 && n <= flat.length)) return log(`sheet 1–${flat.length}`, 'bad');
      S.gi = flat[n - 1].gi; S.si = flat[n - 1].si;
    }
    downloadSheetNC(S.gi, S.si);
  },
  zip: () => downloadZip(),
  report: () => setView('report'),
  print: () => { if (!S.groups.length) return log('nothing nested yet', 'bad'); setView('report'); setTimeout(() => window.print(), 50); },
  csv: () => downloadCSV(),
  parts: () => {
    if (!S.parts.length) log('no parts');
    S.parts.forEach(p => log(`${p.name.padEnd(28)} qty ${String(p.qty).padStart(4)}  ${p.w.toFixed(1)}×${p.h.toFixed(1)}  ${p.thick || '(no gauge)'}`));
  },
  sheets: () => {
    if (!S.groups.length) log('nothing nested yet');
    flatSheets().forEach((f, i) => { const sh = S.groups[f.gi].r.sheets[f.si]; log(`${String(i + 1).padStart(3)}  ${(S.groups[f.gi].gauge || '(no gauge)').padEnd(18)} ${String(sh.items.length).padStart(4)} parts  ${(sh.util * 100).toFixed(1)}%`); });
  },
  remove: (rest, arg) => {
    const ps = findParts(arg);
    if (!arg || !ps.length) return log('usage: remove <part>', 'bad');
    S.parts = S.parts.filter(p => !ps.includes(p)); markStale(); renderParts(); log(`removed ${ps.length}`, 'ok');
  },
  clear: () => { S.parts = []; S.pdfMats = []; S.groups = []; S.stale = false; renderParts(); renderSheets(); renderView(); log('cleared', 'ok'); },
  cls: () => { $('#log').innerHTML = ''; },
  search: (rest, arg) => openTool('search', arg ? { terms: arg } : null),
  usb: () => openTool('usb'),
  plist: () => openTool('plist'),
  copy: () => openTool('copy'),
  dxfnc: () => openTool('dxfnc'),
  theme: rest => { document.documentElement.dataset.theme = rest[0] === 'dark' ? 'dark' : rest[0] === 'light' ? 'light' : ''; },
};
COMMANDS['?'] = COMMANDS.help;
COMMANDS.partslist = COMMANDS.plist;

function setSpacing(which, val) {
  if (typeof isAdmin === 'function' && !isAdmin()) return log('spacing is locked — type: unlock <admin key>', 'bad');
  const v = parseFloat(val);
  if (!(v >= 0)) return log(`usage: ${which} <mm>`, 'bad');
  $('#' + which + 'In').value = v; markStale(); log(`${which} = ${v} mm`, 'ok');
}
async function runCommand(text) {
  const [cmd0, ...rest] = text.trim().split(/\s+/), cmd = (cmd0 || '').toLowerCase(), arg = rest.join(' ');
  log('> ' + text, 'cmd');
  const fn = Object.prototype.hasOwnProperty.call(COMMANDS, cmd) ? COMMANDS[cmd] : null;
  if (fn) await fn(rest, arg, text);
  else log(`unknown command “${cmd0}” — type help`, 'bad');
}
function wireCommandLine() {
  $('#cmdForm').addEventListener('submit', e => { e.preventDefault(); const i = $('#cmd'), t = i.value.trim(); if (!t) return; i.value = ''; runCommand(t); });
}

// =====================================================================================================
// SETTINGS PANEL — machine bed, sheet size, spacing, clean-up options
// =====================================================================================================
function setBed(b) {
  S.bed = b;
  document.querySelectorAll('#bedSeg button').forEach(x => x.classList.toggle('on', +x.dataset.b === b));
  if (!S.sheetCustom) { $('#sheetW').value = Math.round(CONFIG.beds[b].w); $('#sheetH').value = Math.round(CONFIG.beds[b].h); }
  updateBedNote();
  markStale();
}
function updateBedNote() {
  const b = CONFIG.beds[S.bed], m = getMaterial(), overW = m.w > b.w + 0.5, overH = m.h > b.h + 0.5, fitsRot = m.h <= b.w + 0.5 && m.w <= b.h + 0.5;
  $('#bedNote').innerHTML = `machine bed: ${Math.round(b.w)} × ${Math.round(b.h)} mm` +
    ((overW || overH) && !fitsRot ? '<br><span style="color:var(--bad)">⚠ material is larger than the bed both ways</span>' : overW || overH ? '<br><span style="color:var(--warn)">fits rotated 90° on the bed</span>' : '');
  $('#resetSheet').disabled = !S.sheetCustom;
}
// Anything that changes the nest marks the last nest out of date.
function markStale() { if (S.groups.length) { S.stale = true; renderSheets(); } }
function wireSettings() {
  document.querySelectorAll('#bedSeg button').forEach(b => (b.onclick = () => setBed(+b.dataset.b)));
  ['sheetW', 'sheetH'].forEach(id => $('#' + id).addEventListener('input', () => { S.sheetCustom = true; updateBedNote(); markStale(); }));
  ['gapIn', 'marginIn', 'skelChk', 'sectChk'].forEach(id => $('#' + id).addEventListener('change', markStale));
  // a clean-up option changed: re-clean every part (P3)
  ['cleanChk', 'bendChk', 'etchChk', 'featChk'].forEach(id => $('#' + id).addEventListener('change', () => { S.parts.forEach(p => cleanPart(p, cleanOpts())); markStale(); renderParts(); }));
  $('#jobIn').addEventListener('input', () => { if (S.view === 'report') renderView(); announceChange(); });
  $('#resetSheet').onclick = () => { S.sheetCustom = false; setBed(S.bed); };
  setBed(0);
}

// ---- bulls-eye speed (the slider next to Sheet / Report): 0 = stopped, 4 = normal (12 s / 18 s a turn), 10 = 8× ----
const SPIN_RATES = [0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
function setSpinSpeed(i) {
  i = Math.max(0, Math.min(SPIN_RATES.length - 1, Math.round(+i)));
  if (!Number.isFinite(i)) i = 4;
  const rate = SPIN_RATES[i];
  // playbackRate keeps each ring where it is and only changes its speed
  document.querySelectorAll('.scope .spin, .scope .spin2').forEach(el => el.getAnimations().forEach(a => (a.playbackRate = rate)));
  $('#spinSpeed').value = i;
  $('#spinVal').textContent = rate ? rate + '×' : 'stop';
  ls.set('spinSpeed', String(i));
}
function wireSpinSpeed() {
  if (!$('#spinSpeed')) return;
  $('#spinSpeed').addEventListener('input', e => setSpinSpeed(e.target.value));
  setSpinSpeed(ls.get('spinSpeed', '4'));
}
