/* =====================================================================================================
   P8 · NC SEARCH — find part files by part number in the linked parts folders (Edge / Chrome only)
   searchLibrary(terms, {exts, progress, maxDepth}) → {found:[{term, name, path, ext, handle, file, old}], dirs, stopped}
   bestPicks(found, term) → default choice: newest current .NC, else newest .DXF (flat pattern first), plus newest PDF
   newestFile(list, ext)  → newest file of one type (current folders before old/backup ones)
   The linked folders are remembered in the browser (folders.js), so every page shares them.
   ===================================================================================================== */

// ---- the linked parts folders ----
const lib = { roots: [], dirCache: new Map(), stop: false, results: [] };
async function listDir(h) {
  if (lib.dirCache.has(h)) return lib.dirCache.get(h);
  const out = [];
  for await (const e of h.values()) {
    if (e.kind === 'directory' && (CONFIG.search.neverOpen.test(e.name) || /^[.$~]/.test(e.name))) continue; // folders with AMADA in the name are never opened
    out.push(e);
  }
  lib.dirCache.set(h, out);
  return out;
}
async function saveRoots() { await idb.set('libs', lib.roots.map(r => r.handle)); NCLink.notify('roots-changed'); }
async function loadRoots() { const a = await idb.get('libs'); lib.roots = (a || []).filter(h => h && !CONFIG.search.neverOpen.test(h.name)).map(h => ({ handle: h, name: h.name })); }
// Add a folder handle to the linked folders. → 'added' | 'duplicate' | 'never'
async function addRoot(h) {
  if (CONFIG.search.neverOpen.test(h.name)) return 'never';
  for (const r of lib.roots) if (r.handle.isSameEntry && (await r.handle.isSameEntry(h))) return 'duplicate';
  lib.roots.push({ handle: h, name: h.name });
  await saveRoots();
  return 'added';
}

// One pass through every linked folder that checks all terms at once. A folder whose NAME carries a term counts for
// everything inside it ("14034 - Bracket/flat.dxf" belongs to 14034).
async function searchLibrary(terms, opt) {
  opt = opt || {};
  const exts = opt.exts || CONFIG.search.exts, M = terms.map(t => ({ t, m: termMatcher(t) })), found = [];
  if (!lib.roots.length) throw new Error('Link a parts folder first.');
  for (const r of lib.roots) if (!(await ensurePerm(r.handle, 'read'))) throw new Error(`Permission to read “${r.name}” was not given.`);
  const queue = lib.roots.map(r => ({ h: r.handle, path: r.name, depth: 0, inh: [] }));
  let dirs = 0, lastUi = 0;
  while (queue.length) {
    if (lib.stop) break;
    const cur = queue.shift();
    dirs++;
    if (opt.progress && Date.now() - lastUi > 120) { opt.progress(dirs, found.length); lastUi = Date.now(); await new Promise(r => setTimeout(r, 0)); }
    let entries;
    try { entries = await listDir(cur.h); } catch (e) { continue; }
    for (const e of entries) {
      if (e.kind === 'file') {
        const m = /\.([^.]+)$/.exec(e.name);
        if (!m || !exts.includes(m[1].toLowerCase())) continue;
        for (const { t, m: f } of M)
          if (cur.inh.includes(t) || f(e.name)) found.push({ term: t, name: e.name, path: cur.path + '/' + e.name, ext: m[1].toLowerCase(), handle: e, old: CONFIG.search.oldFolder.test(cur.path + '/' + e.name) });
      } else if (cur.depth < (opt.maxDepth || CONFIG.search.maxDepth))
        queue.push({ h: e, path: cur.path + '/' + e.name, depth: cur.depth + 1, inh: cur.inh.concat(M.filter(x => x.m(e.name) && !cur.inh.includes(x.t)).map(x => x.t)) });
    }
  }
  for (const f of found) { try { f.file = await f.handle.getFile(); } catch (e) { f.file = null; } }
  return { found: found.filter(f => f.file), dirs, stopped: lib.stop };
}

function bestPicks(found, term) {
  const of = ext => found.filter(f => f.term === term && f.ext === ext), fresh = l => { const k = l.filter(f => !f.old); return k.length ? k : l; };
  const newest = l => l.slice().sort((a, b) => b.file.lastModified - a.file.lastModified)[0];
  const ncs = fresh(of('nc')), dxfs = fresh(of('dxf')), flat = dxfs.filter(f => /flat/i.test(f.name));
  return [ncs.length ? newest(ncs) : flat.length ? newest(flat) : newest(dxfs), newest(fresh(of('pdf')))].filter(Boolean);
}

function newestFile(list, ext) {
  const fresh = list.filter(f => !f.old), pool = fresh.length ? fresh : list, flat = ext === 'dxf' ? pool.filter(f => /flat/i.test(f.name)) : [];
  return (flat.length ? flat : pool).slice().sort((a, b) => b.file.lastModified - a.file.lastModified)[0] || null;
}
