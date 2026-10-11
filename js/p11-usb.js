/* =====================================================================================================
   P11 · USB — list, erase and write .nc files on a USB stick / target drive
   scanDrive(handle, {onlyNc, sub}) → [{dir, name, path, size, mod}]   files on the drive (sorted by path)
   driveStatus(handle)              → 'ready' | 'locked' | 'missing'    plugged in? ('locked' = needs a click to allow)
   readPreview(file, maxBytes)      → {text, binary, cut}               the start of a file, for the preview screen
   eraseFiles(files, onFile)        → {ok, fail:[paths]}               deletes files only, never folders;
                                                                        onFile(i, file, 'start'|'done'|'fail') per file
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
  return out.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

async function driveStatus(handle) {
  let p = 'granted';
  try { if (handle.queryPermission) p = await handle.queryPermission({ mode: 'readwrite' }); } catch (e) {}
  if (p !== 'granted') return 'locked';
  try { for await (const k of handle.keys()) break; return 'ready'; } catch (e) { return 'missing'; }
}

async function readPreview(f, maxBytes) {
  const file = await (await f.dir.getFileHandle(f.name)).getFile();
  const text = await file.slice(0, maxBytes).text();
  return { text, binary: /\u0000/.test(text), cut: file.size > maxBytes };
}

async function eraseFiles(files, onFile) {
  let ok = 0;
  const fail = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (onFile) await onFile(i, f, 'start');
    try { await f.dir.removeEntry(f.name); ok++; if (onFile) await onFile(i, f, 'done'); }
    catch (e) { fail.push(f.path); if (onFile) await onFile(i, f, 'fail'); }
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
