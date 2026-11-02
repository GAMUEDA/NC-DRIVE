/* =====================================================================================================
   P10 · COPY PARTS TO DRIVE — copy each part's files of the chosen types; a missing type → the part's DXF
   Only files whose name starts with "1" are copied (CONFIG.copy.nameStarts). On the target:
     main folder   the .nc and .pdf files, and the folders named 1… or Amada… inside a part's folder (copied whole)
     DXF\          the .dxf files (CONFIG.copy.dxfFolder)
   parseTypes("NC, PDF")                 → ['nc', 'pdf']
   planCopy(parts, types, found, folders) → rows [{part, type, f, how:'ok'|'dxf'|'dxfdup'|'missing', st}]
                                           (a folder row has type 'dir' and f = {name, path, handle})
   copyPlannedFiles(rows, dir, destLabel, {onRow, isStopped}) → {copied}  writes every 'wait' row into dir
   copyPartsToDrive(parts, types, targetDir, opts) → the whole step: search (P8) → plan → copy
   The DXF stand-in goes to the same DXF folder as every other DXF.
   ===================================================================================================== */

const parseTypes = s => [...new Set(String(s || '').split(/[\s,;]+/).map(t => t.replace(/^\*?\./, '').toLowerCase()).filter(t => /^[a-z0-9]{1,6}$/.test(t)))];
const copyNameOk = name => CONFIG.copy.nameStarts.test(name);
// A folder named 1… or Amada… that sits inside a part's folder is copied whole, and so is an Amada folder whose own
// name carries the part number. The part's own folder is not copied whole: its files are picked one by one above.
const copyFolderOk = (name, own) => CONFIG.copy.folderStarts.test(name) && !CONFIG.search.oldFolder.test(name) && (!own || CONFIG.search.neverOpen.test(name));

function planCopy(parts, types, found, folders) {
  const FB = CONFIG.copy.fallbackType, rows = [];
  found = found.filter(f => copyNameOk(f.name));
  // a folder inside another folder that is copied anyway is left out
  const dirs = (folders || []).filter((d, i, a) => !a.some(o => o !== d && d.path.startsWith(o.path + '/')) && a.findIndex(o => o.path === d.path) === i);
  for (const part of parts) {
    const mine = found.filter(f => f.term === part), dxf = newestFile(mine.filter(f => f.ext === FB), FB);
    let dxfUsed = false; // the stand-in DXF is copied once per part
    for (const t of types) {
      const f = newestFile(mine.filter(x => x.ext === t), t);
      if (f) { rows.push({ part, type: t, f, how: 'ok', st: 'wait' }); if (t === FB) dxfUsed = true; }
      else if (t !== FB && dxf) { rows.push({ part, type: t, f: dxfUsed ? null : dxf, how: dxfUsed ? 'dxfdup' : 'dxf', st: dxfUsed ? 'dxfdup' : 'wait' }); dxfUsed = true; }
      else rows.push({ part, type: t, f: null, how: 'missing', st: 'missing' });
    }
    for (const d of dirs.filter(d => d.term === part)) rows.push({ part, type: 'dir', f: d, how: 'ok', st: 'wait' });
  }
  return rows;
}

// Copy a whole folder (and everything in it) into dir. → number of files written
async function copyFolderInto(src, dir) {
  const out = await dir.getDirectoryHandle(src.name, { create: true });
  let n = 0;
  for await (const e of src.values()) {
    if (e.kind === 'file') { await writeFileTo(out, e.name, await e.getFile()); n++; }
    else n += await copyFolderInto(e, out);
  }
  return n;
}

async function copyPlannedFiles(rows, dir, destLabel, opts) {
  opts = opts || {};
  const todo = rows.filter(x => x.st === 'wait'), done = new Map();
  let dxfDir = null, copied = 0;
  for (const row of todo) {
    if (opts.isStopped && opts.isStopped()) break;
    row.st = 'copying';
    if (opts.onRow) opts.onRow(row, 'start');
    try {
      if (row.type === 'dir') {
        if (!done.has(row.f.path)) { copied += await copyFolderInto(row.f.handle, dir); done.set(row.f.path, true); }
        row.dest = destLabel + '\\' + row.f.name;
      } else if (row.f.ext === 'dxf') {
        dxfDir = dxfDir || (await dir.getDirectoryHandle(CONFIG.copy.dxfFolder, { create: true }));
        if (!done.has(row.f.path)) { await writeFileTo(dxfDir, row.f.name, row.f.file); done.set(row.f.path, true); copied++; }
        row.dest = destLabel + '\\' + CONFIG.copy.dxfFolder;
      } else {
        if (!done.has(row.f.path)) { await writeFileTo(dir, row.f.name, row.f.file); done.set(row.f.path, true); copied++; }
        row.dest = destLabel;
      }
      row.st = row.how === 'dxf' ? 'dxf' : 'ok';
    } catch (e) {
      row.st = 'fail';
      row.err = (e && e.message) || String(e);
    }
    if (opts.onRow) opts.onRow(row, 'done');
  }
  return { copied };
}

// targetDir: the target drive handle. opts: {jobFolder (name or ''), progress, onPlan(rows), onRow(row, phase)}
// → {rows, dir, copied, stopped, stoppedWhileSearching}
async function copyPartsToDrive(parts, types, targetDir, opts) {
  opts = opts || {};
  // one pass through the source for every part and every type (+ the DXF fallback), and the 1… / Amada folders
  const r = await searchLibrary(parts, { exts: [...new Set(types.concat(CONFIG.copy.fallbackType))], progress: opts.progress, dirs: copyFolderOk });
  if (r.stopped) return { rows: [], stoppedWhileSearching: true };
  const rows = planCopy(parts, types, r.found, r.folders);
  if (opts.onPlan) opts.onPlan(rows);
  let dir = targetDir;
  if (opts.jobFolder) dir = await targetDir.getDirectoryHandle(opts.jobFolder.replace(/[\\/:*?"<>|]+/g, '_'), { create: true });
  const destLabel = dir === targetDir ? targetDir.name : targetDir.name + '\\' + dir.name;
  const res = await copyPlannedFiles(rows, dir, destLabel, { onRow: opts.onRow, isStopped: () => lib.stop });
  return { rows, dir, copied: res.copied, stopped: lib.stop };
}
