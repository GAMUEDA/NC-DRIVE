/* =====================================================================================================
   P11 · USB — list, erase and write .nc files on a USB stick / target drive
   scanDrive(handle, {onlyNc, sub}) → [{dir, name, path, size, mod}]   files on the drive (sorted by path)
   eraseFiles(files)                → {ok, fail:[paths]}               deletes files only, never folders
   writeJobToDrive(handle, files)   → {written, error}                  files = [{name, text}] from makeJobNcFiles()
   ===================================================================================================== */

async function scanDrive(handle, opts) {
  const onlyNc = !!opts.onlyNc, sub = !!opts.sub, out = [], U = CONFIG.usb;
  const walk = async (dir, path, depth) => {
    for await (const e of dir.values()) {
      if (e.kind === 'file') {
        if (!onlyNc || /\.nc$/i.test(e.name)) {
          let f = null;
          try { f = await e.getFile(); } catch (x) {}
          out.push({ dir, name: e.name, path: path + e.name, size: f ? f.size : 0, mod: f ? f.lastModified : 0 });
        }
      } else if (sub && depth < U.maxDepth && !U.skipFolders.test(e.name)) await walk(e, path + e.name + '/', depth + 1);
    }
  };
  await walk(handle, '', 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function eraseFiles(files) {
  let ok = 0;
  const fail = [];
  for (const f of files) {
    try { await f.dir.removeEntry(f.name); ok++; } catch (e) { fail.push(f.path); }
  }
  return { ok, fail };
}

async function writeJobToDrive(handle, files) {
  let written = 0;
  try {
    for (const f of files) { await writeFileTo(handle, f.name, f.text); written++; }
  } catch (e) {
    return { written, error: e };
  }
  return { written, error: null };
}
