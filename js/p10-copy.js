/* =====================================================================================================
   P10 · COPY PARTS TO DRIVE — copy each part's files of the chosen types; a missing type → the part's DXF
   parseTypes("NC, PDF")                 → ['nc', 'pdf']
   planCopy(parts, types, found)         → rows [{part, type, f, how:'ok'|'dxf'|'dxfdup'|'missing', st}]
   copyPlannedFiles(rows, dir, destLabel, {onRow, isStopped}) → {copied}  writes every 'wait' row into dir
   copyPartsToDrive(parts, types, targetDir, opts) → the whole step: search (P8) → plan → copy
   The DXF stand-in goes to the very same target (and job folder) as the missing file would have.
   ===================================================================================================== */

const parseTypes = s => [...new Set(String(s || '').split(/[\s,;]+/).map(t => t.replace(/^\*?\./, '').toLowerCase()).filter(t => /^[a-z0-9]{1,6}$/.test(t)))];

function planCopy(parts, types, found) {
  const FB = CONFIG.copy.fallbackType, rows = [];
  for (const part of parts) {
    const mine = found.filter(f => f.term === part), dxf = newestFile(mine.filter(f => f.ext === FB), FB);
    let dxfUsed = false; // the stand-in DXF is copied once per part
    for (const t of types) {
      const f = newestFile(mine.filter(x => x.ext === t), t);
      if (f) { rows.push({ part, type: t, f, how: 'ok', st: 'wait' }); if (t === FB) dxfUsed = true; }
      else if (t !== FB && dxf) { rows.push({ part, type: t, f: dxfUsed ? null : dxf, how: dxfUsed ? 'dxfdup' : 'dxf', st: dxfUsed ? 'dxfdup' : 'wait' }); dxfUsed = true; }
      else rows.push({ part, type: t, f: null, how: 'missing', st: 'missing' });
    }
  }
  return rows;
}

async function copyPlannedFiles(rows, dir, destLabel, opts) {
  opts = opts || {};
  const todo = rows.filter(x => x.st === 'wait'), done = new Map();
  for (const row of todo) {
    if (opts.isStopped && opts.isStopped()) break;
    row.st = 'copying';
    if (opts.onRow) opts.onRow(row, 'start');
    try {
      if (!done.has(row.f.path)) { await writeFileTo(dir, row.f.name, row.f.file); done.set(row.f.path, true); }
      row.st = row.how === 'dxf' ? 'dxf' : 'ok';
      row.dest = destLabel;
    } catch (e) {
      row.st = 'fail';
      row.err = (e && e.message) || String(e);
    }
    if (opts.onRow) opts.onRow(row, 'done');
  }
  return { copied: done.size };
}

// targetDir: the target drive handle. opts: {jobFolder (name or ''), progress, onPlan(rows), onRow(row, phase)}
// → {rows, dir, copied, stopped, stoppedWhileSearching}
async function copyPartsToDrive(parts, types, targetDir, opts) {
  opts = opts || {};
  // one pass through the source for every part and every type (+ the DXF fallback)
  const r = await searchLibrary(parts, { exts: [...new Set(types.concat(CONFIG.copy.fallbackType))], progress: opts.progress });
  if (r.stopped) return { rows: [], stoppedWhileSearching: true };
  const rows = planCopy(parts, types, r.found);
  if (opts.onPlan) opts.onPlan(rows);
  let dir = targetDir;
  if (opts.jobFolder) dir = await targetDir.getDirectoryHandle(opts.jobFolder.replace(/[\\/:*?"<>|]+/g, '_'), { create: true });
  const destLabel = dir === targetDir ? targetDir.name : targetDir.name + '\\' + dir.name;
  const res = await copyPlannedFiles(rows, dir, destLabel, { onRow: opts.onRow, isStopped: () => lib.stop });
  return { rows, dir, copied: res.copied, stopped: lib.stop };
}
