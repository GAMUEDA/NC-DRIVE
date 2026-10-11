/* =====================================================================================================
   ERASE / CLEAR USB page (erase_usb.html) — screen for P11
   Works on its own: add one or more USB sticks, pick the active one, list its files with a preview, and erase them
   (second click within 4 s) while the preview shows each file being deleted and the bar at the bottom shows progress.
   "Copy this job to USB" takes the .nc files of NC Drive's current nest (opening NC Drive if it isn't open).
   ===================================================================================================== */
const usb = { drives: [], status: [], handle: null, files: [], sel: -1, armed: false, armT: null, busy: false };
const STATUS_TXT = { ready: 'plugged in', locked: 'click to allow', missing: 'not plugged in' };

function updUsbCopy() {
  const n = MAIN ? MAIN.sheets : 0;
  $('#usbCopy').disabled = !usb.handle || !n || usb.busy;
  $('#usbCopy').textContent = n ? `Copy this job to USB (${n} .nc)` : MAIN ? 'Copy this job to USB (nothing nested)' : 'Copy this job to USB (NC Drive not open)';
}
const kb = b => (b / 1024).toFixed(1) + ' KB';

// ---- options (All / NC / DXF / other files, sub-folders), kept as the default for the next run ----
function usbOpts() {
  const r = document.querySelector('input[name=usbShow]:checked');
  return { show: r ? r.value : 'all', sub: $('#usbSub').checked };
}
function loadUsbOpts() {
  let o = CONFIG.usb.defaults;
  try { o = { ...o, ...JSON.parse(ls.get('usbOpts', '{}')) }; } catch (e) {}
  const r = document.querySelector(`input[name=usbShow][value="${o.show}"]`) || document.querySelector('input[name=usbShow][value=all]');
  r.checked = true;
  $('#usbSub').checked = !!o.sub;
}
const saveUsbOpts = () => ls.set('usbOpts', JSON.stringify(usbOpts()));

// ---- drive names: the browser only gives a folder's own name, so a drive letter can be added by hand (✎) ----
function setDriveLabel() {
  if (!usb.handle) return;
  const h = usb.handle, cur = driveLabel(h);
  const v = prompt(`Where is "${h.name}"? Type its drive and folder, e.g. D:\\${h.name}`, cur.startsWith('…') ? `D:\\${h.name}` : cur);
  if (v == null) return;
  const labels = usbLabels();
  if (v.trim()) labels[h.name] = v.trim(); else delete labels[h.name];
  ls.set('usbLabels', JSON.stringify(labels));
  renderDrives();
  showActive();
}
// "Active: D:\NC · 12 files · 34.5 KB", shown right after the Refresh button
function showActive(extra, state) {
  if (!usb.handle) { $('#usbActive').innerHTML = '<span class="muted">No USB drive chosen</span>'; return; }
  usb.activeExtra = extra != null ? extra : usb.activeExtra || '';
  usb.activeState = state || usb.activeState || 'ready';
  $('#usbActive').innerHTML = `<span class="dot ${usb.activeState}"></span>Active: <b class="mono">${esc(driveLabel(usb.handle))}</b> ${usb.activeExtra}`
    + '<button class="x" id="usbLabel" title="Set the drive letter / folder shown here">✎</button>';
  $('#usbLabel').onclick = setDriveLabel;
}

// ---- bottom progress bar ----
function setUsbBar(task, done, total, state) {
  const bar = $('#usbBar'), frac = total ? done / total : 0;
  $('#usbProg').hidden = false;
  bar.className = 'procBar' + (state ? ' ' + state : '');
  bar.firstElementChild.style.width = Math.round(frac * 100) + '%';
  $('#usbPTask').textContent = task;
  $('#usbPPct').textContent = total ? `${done} of ${total} · ${Math.round(frac * 100)}%` : '';
}

// ---- drive list (every stick picked so far; the active one is used for everything below) ----
async function renderDrives() {
  usb.status = await Promise.all(usb.drives.map(driveStatus));
  const box = $('#usbDrives');
  box.hidden = !usb.drives.length;
  box.innerHTML = usb.drives.map((h, i) => {
    const on = usb.handle === h, st = usb.status[i];
    return `<label class="drv ${st}${on ? ' on' : ''}" title="${esc(h.name)}: ${STATUS_TXT[st]}"><input type="radio" name="usbDrv" value="${i}"${on ? ' checked' : ''}>`
      + `<span class="dot ${st}"></span><b class="mono">${esc(driveLabel(h))}</b><small>${STATUS_TXT[st]}</small><button class="x" data-rm="${i}" title="Forget this drive">✕</button></label>`;
  }).join('');
  box.querySelectorAll('input[name=usbDrv]').forEach(r => (r.onchange = () => selectDrive(+r.value)));
  box.querySelectorAll('[data-rm]').forEach(b => (b.onclick = e => { e.preventDefault(); forgetDrive(+b.dataset.rm); }));
  const ready = usb.status.filter(s => s === 'ready').length;
  $('#usbCount').textContent = usb.drives.length > 1 ? `${ready} of ${usb.drives.length} drives plugged in — pick one` : '';
}
async function selectDrive(i) {
  if (usb.busy) return;
  usb.handle = usb.drives[i];
  await saveTargetDrive(usb.handle);
  $('#usbRefresh').disabled = false;
  await scanUsb();
}
async function forgetDrive(i) {
  if (usb.busy) return;
  const h = usb.drives.splice(i, 1)[0];
  await saveUsbDrives(usb.drives);
  if (usb.handle === h) {
    usb.handle = usb.drives[0] || null;
    if (usb.handle) await saveTargetDrive(usb.handle);
    else showEmpty();
  }
  if (usb.handle) await scanUsb(); else await renderDrives();
}
async function pickUsb() {
  try {
    const h = await pickFolder({ id: 'ncdrive-usb', mode: 'readwrite' });
    if (!h) return;
    const at = await sameHandleIndex(usb.drives, h);
    if (at >= 0) usb.drives[at] = h; else usb.drives.push(h);
    await saveUsbDrives(usb.drives);
    await selectDrive(at >= 0 ? at : usb.drives.length - 1);
  } catch (e) {
    $('#usbStatus').innerHTML = `<span class="bad">${esc(e && e.name === 'SecurityError' ? "The browser won't allow that location. Pick a folder on the stick instead." : 'Could not open it: ' + ((e && e.message) || e))}</span>`;
  }
}
function showEmpty() {
  usb.files = [];
  showActive();
  $('#usbView').hidden = true;
  $('#usbErase').disabled = true;
  $('#usbErase').textContent = 'Erase';
  updUsbCopy();
}

// ---- file list + preview ----
async function scanUsb() {
  disarmErase();
  if (!usb.handle) return showEmpty();
  if (!(await ensurePerm(usb.handle, 'readwrite'))) { $('#usbStatus').innerHTML = '<span class="bad">Permission to change the USB was not given.</span>'; return renderDrives(); }
  const opts = usbOpts(), word = USB_SHOW[opts.show].word;
  try { usb.files = await scanDrive(usb.handle, opts); }
  catch (e) {
    usb.files = [];
    showActive('<span class="bad">not plugged in</span>', 'missing');
    $('#usbView').hidden = true;
    $('#usbErase').disabled = true;
    $('#usbStatus').innerHTML = `<span class="bad">Could not read ${esc(driveLabel(usb.handle))}: plug it in and press Refresh.</span>`;
    return renderDrives();
  }
  await renderDrives();
  const n = usb.files.length, total = usb.files.reduce((a, f) => a + f.size, 0);
  showActive(`<span class="mono">· ${n} ${word}file${n === 1 ? '' : 's'}${opts.sub ? '' : ' (top folder)'} · ${kb(total)}</span>`, 'ready');
  $('#usbView').hidden = false;
  $('#usbView').classList.remove('erasing');
  $('#usbTable').innerHTML = '<thead><tr><th>#</th><th>File</th><th>Size</th><th>Modified</th><th>Status</th></tr></thead><tbody>'
    + (n ? usb.files.map((f, i) => `<tr data-i="${i}"><td class="n">${i + 1}</td><td class="mono">${esc(f.path)}</td><td class="n">${kb(f.size)}</td><td class="mono" style="font-size:11px;">${f.mod ? fmtDate(f.mod) : ''}</td><td class="st">on drive</td></tr>`).join('')
      : `<tr><td colspan="5" class="muted">No ${word}files — the USB is clear.</td></tr>`)
    + '</tbody>';
  $('#usbTable').querySelectorAll('tr[data-i]').forEach(tr => (tr.onclick = () => { if (!usb.busy) previewFile(+tr.dataset.i); }));
  $('#usbErase').disabled = !n;
  $('#usbErase').textContent = n ? `Erase ${n} file${n > 1 ? 's' : ''}` : 'Erase';
  $('#usbStatus').textContent = `${n} ${word}file${n === 1 ? '' : 's'} on ${driveLabel(usb.handle)}${opts.show === 'all' ? ' — every file type is included' : ''}${opts.sub ? ', sub-folders included' : ''}`;
  if (n) await previewFile(0);
  else { $('#pvHead').textContent = 'Preview'; $('#pvBody').textContent = 'Nothing to preview.'; }
  updUsbCopy();
}
async function previewFile(i, head) {
  const f = usb.files[i];
  if (!f) return;
  usb.sel = i;
  $('#usbTable').querySelectorAll('tr.sel').forEach(r => r.classList.remove('sel'));
  const tr = $('#usbTable').querySelector(`tr[data-i="${i}"]`);
  if (tr) { tr.classList.add('sel'); tr.scrollIntoView({ block: 'nearest' }); }
  $('#pvHead').innerHTML = head || `Preview · <b>${esc(f.path)}</b> <span class="mono">${kb(f.size)}</span>`;
  try {
    const p = await readPreview(f, CONFIG.usb.previewBytes);
    $('#pvBody').textContent = p.binary ? '(not a text file — no preview)' : p.text + (p.cut ? '\n… (rest of the file not shown)' : '');
  } catch (e) { $('#pvBody').textContent = '(could not read this file)'; }
}

// ---- erase: first click arms the button; a second click within CONFIG.usb.eraseConfirmMs erases ----
function disarmErase() {
  usb.armed = false;
  clearTimeout(usb.armT);
  const b = $('#usbErase');
  b.classList.remove('armed');
  if (usb.files.length) b.textContent = `Erase ${usb.files.length} file${usb.files.length > 1 ? 's' : ''}`;
}
async function eraseUsb() {
  if (!usb.files.length || usb.busy) return;
  if (!usb.armed) {
    usb.armed = true;
    const b = $('#usbErase');
    b.classList.add('armed');
    b.textContent = `Click again to erase ${usb.files.length} — can't be undone`;
    usb.armT = setTimeout(disarmErase, CONFIG.usb.eraseConfirmMs);
    return;
  }
  disarmErase();
  const files = usb.files, n = files.length, name = driveLabel(usb.handle);
  const pause = Math.min(CONFIG.usb.eraseShowMs, 3000 / n); // long enough to see each file go, never more than ~3 s in all
  usb.busy = true;
  $('#usbErase').disabled = true; $('#usbPick').disabled = true; $('#usbRefresh').disabled = true;
  updUsbCopy();
  $('#usbView').classList.add('erasing');
  setUsbBar(`Erasing ${name}`, 0, n);
  reportProgress('Erase USB', `erasing ${n} files`, 0);
  let done = 0;
  const { ok, fail } = await eraseFiles(files, async (i, f, step) => {
    const tr = $('#usbTable').querySelector(`tr[data-i="${i}"]`), st = tr && tr.querySelector('.st');
    if (step === 'start') {
      if (st) { st.textContent = 'deleting…'; tr.className = 'del'; }
      await previewFile(i, `Deleting ${i + 1} of ${n} · <b>${esc(f.path)}</b> <span class="mono">${kb(f.size)}</span>`);
      if (pause > 5) await new Promise(r => setTimeout(r, pause));
      return;
    }
    done++;
    if (st) { st.textContent = step === 'done' ? 'deleted' : 'could not delete'; tr.className = step === 'done' ? 'gone' : 'failed'; }
    setUsbBar(`Erasing ${name}`, done, n);
    reportProgress('Erase USB', `${done} of ${n} files`, done / n);
  });
  usb.busy = false;
  $('#usbPick').disabled = false; $('#usbRefresh').disabled = false;
  log(`USB ${name}: erased ${ok} file${ok === 1 ? '' : 's'}${fail.length ? `, ${fail.length} could not be erased` : ''}`, fail.length ? 'warn' : 'ok');
  setUsbBar(fail.length ? `Erased ${ok}, ${fail.length} failed` : `Erased ${ok} file${ok === 1 ? '' : 's'}`, done, n, fail.length ? 'bad' : 'ok');
  reportProgress('Erase USB', `${ok} files erased`, 1, true);
  // keep the crossed-out list on screen as the record of what was deleted; Refresh lists what is left
  $('#usbView').classList.remove('erasing');
  $('#pvHead').innerHTML = `Erase finished · <b>${esc(name)}</b>`;
  $('#pvBody').textContent = files.map(f => (fail.includes(f.path) ? '✕ could not delete  ' : '✓ deleted  ') + f.path).join('\n');
  usb.files = files.filter(f => fail.includes(f.path));
  $('#usbErase').disabled = !usb.files.length;
  $('#usbErase').textContent = usb.files.length ? `Erase ${usb.files.length} file${usb.files.length > 1 ? 's' : ''}` : 'Erase';
  showActive(`<span class="mono">· ${usb.files.length} file${usb.files.length === 1 ? '' : 's'} left</span>`, 'ready');
  $('#usbStatus').innerHTML = `<span class="ok">Erased ${ok} file${ok === 1 ? '' : 's'}.</span>` + (fail.length ? ` <span class="bad">Could not erase: ${esc(fail.slice(0, 5).join(', '))}${fail.length > 5 ? '…' : ''}</span>` : '');
  updUsbCopy();
}

// Write the .nc files of NC Drive's current nest onto the stick.
async function copyJobToUsb() {
  if (!usb.handle || usb.busy) return;
  const opening = ensureMain();
  let job;
  try { await opening; job = await NCLink.request('jobNc', null, 30000); }
  catch (e) { $('#usbStatus').innerHTML = `<span class="bad">${esc(e.message || e)}</span>`; return; }
  if (!job.files.length) { $('#usbStatus').innerHTML = '<span class="bad">Nothing is nested in NC Drive yet.</span>'; return; }
  if (!(await ensurePerm(usb.handle, 'readwrite'))) { $('#usbStatus').innerHTML = '<span class="bad">Permission to write to the USB was not given.</span>'; return; }
  usb.busy = true;
  updUsbCopy();
  const total = job.files.length, name = driveLabel(usb.handle);
  setUsbBar(`Copying to ${name}`, 0, total);
  reportProgress('Copy job to USB', `${total} .nc files`, 0);
  let n = 0, error = null;
  for (const f of job.files) { // one file at a time so the bar moves
    const r = await writeJobToDrive(usb.handle, [f]);
    if (r.error) { error = r.error; break; }
    n++;
    setUsbBar(`Copying to ${name}`, n, total);
    reportProgress('Copy job to USB', `${n} of ${total} copied`, n / total);
  }
  usb.busy = false;
  log(`USB ${name}: copied ${n} .nc file${n === 1 ? '' : 's'}${job.stale ? ' (nest is out of date!)' : ''}`, job.stale ? 'warn' : 'ok');
  setUsbBar(error ? `Copy stopped at ${n}` : `Copied ${n} .nc file${n === 1 ? '' : 's'}`, n, total, error ? 'bad' : 'ok');
  reportProgress('Copy job to USB', `${n} of ${total} copied`, n / total, true);
  await scanUsb();
  if (error) $('#usbStatus').innerHTML = `<span class="bad">Copy stopped after ${n} file${n === 1 ? '' : 's'}: ${esc(error.message || error)}</span>`;
  else $('#usbStatus').innerHTML = `<span class="ok">Copied ${n} .nc file${n === 1 ? '' : 's'} to ${esc(name)}.</span>${job.stale ? ' <span class="warnc">The nest is out of date — re-nest before cutting.</span>' : ''}`;
}

function startUsbPage() {
  startToolPage('usb');
  const reloadDrives = async () => {
    if (usb.busy) return;
    usb.drives = await loadUsbDrives();
    const t = await loadTargetDrive(), at = t ? await sameHandleIndex(usb.drives, t) : -1;
    usb.handle = at >= 0 ? usb.drives[at] : usb.drives[0] || null;
    $('#usbRefresh').disabled = !usb.handle;
    await renderDrives();
    if (usb.handle) showActive('<span class="muted">(press Refresh to list its files)</span>', usb.status[usb.drives.indexOf(usb.handle)]);
    else showEmpty();
    updUsbCopy();
  };
  if (FS_OK) reloadDrives();
  else { $('#usbStatus').textContent = FS_MSG; $('#usbPick').disabled = true; }
  NCLink.on('drive-changed', reloadDrives);
  $('#usbPick').onclick = pickUsb;
  $('#usbRefresh').onclick = scanUsb;
  loadUsbOpts();
  document.querySelectorAll('input[name=usbShow], #usbSub').forEach(el => (el.onchange = () => { saveUsbOpts(); if (usb.handle && !usb.busy) scanUsb(); }));
  $('#usbErase').onclick = eraseUsb;
  $('#usbCopy').onclick = copyJobToUsb;
  onMainChange(updUsbCopy);
  updUsbCopy();
}

window.NCDriveTool = { CONFIG, process: { scanDrive, USB_SHOW, driveStatus, readPreview, eraseFiles, writeJobToDrive }, usb, link: NCLink };
startUsbPage();
