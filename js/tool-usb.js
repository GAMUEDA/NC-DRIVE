/* =====================================================================================================
   ERASE / CLEAR USB page (erase_usb.html) — screen for P11
   Works on its own: choose the stick, list its files, erase them (second click within 4 s). "Copy this job to USB"
   takes the .nc files of NC Drive's current nest (opening NC Drive if it isn't open).
   ===================================================================================================== */
const usb = { handle: null, files: [], armed: false, armT: null };

function updUsbCopy() {
  const n = MAIN ? MAIN.sheets : 0;
  $('#usbCopy').disabled = !usb.handle || !n;
  $('#usbCopy').textContent = n ? `Copy this job to USB (${n} .nc)` : MAIN ? 'Copy this job to USB (nothing nested)' : 'Copy this job to USB (NC Drive not open)';
}
async function pickUsb() {
  try {
    const h = await pickFolder({ id: 'ncdrive-usb', mode: 'readwrite' });
    if (!h) return;
    usb.handle = h;
    await saveTargetDrive(h);
    $('#usbRefresh').disabled = false;
    await scanUsb();
  } catch (e) {
    $('#usbStatus').innerHTML = `<span class="bad">${esc(e && e.name === 'SecurityError' ? "The browser won't allow that location. Pick a folder on the stick instead." : 'Could not open it: ' + ((e && e.message) || e))}</span>`;
  }
}
async function scanUsb() {
  disarmErase();
  if (!(await ensurePerm(usb.handle, 'readwrite'))) { $('#usbStatus').innerHTML = '<span class="bad">Permission to change the USB was not given.</span>'; return; }
  const onlyNc = $('#usbOnlyNc').checked, sub = $('#usbSub').checked;
  try { usb.files = await scanDrive(usb.handle, { onlyNc, sub }); }
  catch (e) { $('#usbStatus').innerHTML = `<span class="bad">Could not read the drive: ${esc(e.message || e)}</span>`; return; }
  const n = usb.files.length;
  $('#usbName').textContent = usb.handle.name;
  $('#usbWrap').hidden = false;
  $('#usbTable').innerHTML = '<thead><tr><th>File</th><th>Size</th><th>Modified</th></tr></thead><tbody>'
    + (n ? usb.files.map(f => `<tr><td class="mono">${esc(f.path)}</td><td class="n">${(f.size / 1024).toFixed(1)} KB</td><td class="mono" style="font-size:11px;">${f.mod ? fmtDate(f.mod) : ''}</td></tr>`).join('') : `<tr><td colspan="3" class="muted">No ${onlyNc ? '.nc ' : ''}files — the USB is clear.</td></tr>`)
    + '</tbody>';
  $('#usbErase').disabled = !n;
  $('#usbErase').textContent = n ? `Erase ${n} file${n > 1 ? 's' : ''}` : 'Erase';
  $('#usbStatus').textContent = `${n} ${onlyNc ? '.nc ' : ''}file${n === 1 ? '' : 's'} on ${usb.handle.name}${onlyNc ? '' : ' — every file type is included'}`;
  updUsbCopy();
}
function disarmErase() {
  usb.armed = false;
  clearTimeout(usb.armT);
  const b = $('#usbErase');
  b.classList.remove('armed');
  if (usb.files.length) b.textContent = `Erase ${usb.files.length} file${usb.files.length > 1 ? 's' : ''}`;
}
// First click arms the button; a second click within CONFIG.usb.eraseConfirmMs erases.
async function eraseUsb() {
  if (!usb.files.length) return;
  if (!usb.armed) {
    usb.armed = true;
    const b = $('#usbErase');
    b.classList.add('armed');
    b.textContent = `Click again to erase ${usb.files.length} — can't be undone`;
    usb.armT = setTimeout(disarmErase, CONFIG.usb.eraseConfirmMs);
    return;
  }
  disarmErase();
  $('#usbErase').disabled = true;
  reportProgress('Erase USB', `erasing ${usb.files.length} files`, null);
  const { ok, fail } = await eraseFiles(usb.files);
  log(`USB ${usb.handle.name}: erased ${ok} file${ok === 1 ? '' : 's'}${fail.length ? `, ${fail.length} could not be erased` : ''}`, fail.length ? 'warn' : 'ok');
  reportProgress('Erase USB', `${ok} files erased`, 1, true);
  await scanUsb();
  $('#usbStatus').innerHTML = `<span class="ok">Erased ${ok} file${ok === 1 ? '' : 's'}.</span>` + (fail.length ? ` <span class="bad">Could not erase: ${esc(fail.slice(0, 5).join(', '))}${fail.length > 5 ? '…' : ''}</span>` : '');
}
// Write the .nc files of NC Drive's current nest onto the stick.
async function copyJobToUsb() {
  if (!usb.handle) return;
  const opening = ensureMain();
  let job;
  try { await opening; job = await NCLink.request('jobNc', null, 30000); }
  catch (e) { $('#usbStatus').innerHTML = `<span class="bad">${esc(e.message || e)}</span>`; return; }
  if (!job.files.length) { $('#usbStatus').innerHTML = '<span class="bad">Nothing is nested in NC Drive yet.</span>'; return; }
  if (!(await ensurePerm(usb.handle, 'readwrite'))) { $('#usbStatus').innerHTML = '<span class="bad">Permission to write to the USB was not given.</span>'; return; }
  $('#usbCopy').disabled = true;
  reportProgress('Copy job to USB', `${job.files.length} .nc files`, null);
  const { written: n, error } = await writeJobToDrive(usb.handle, job.files);
  if (error) $('#usbStatus').innerHTML = `<span class="bad">Copy stopped after ${n} file${n === 1 ? '' : 's'}: ${esc(error.message || error)}</span>`;
  log(`USB ${usb.handle.name}: copied ${n} .nc file${n === 1 ? '' : 's'}${job.stale ? ' (nest is out of date!)' : ''}`, job.stale ? 'warn' : 'ok');
  reportProgress('Copy job to USB', `${n} of ${job.files.length} copied`, n / job.files.length, true);
  await scanUsb();
  if (n === job.files.length) $('#usbStatus').innerHTML = `<span class="ok">Copied ${n} .nc file${n === 1 ? '' : 's'} to ${esc(usb.handle.name)}.</span>${job.stale ? ' <span class="warnc">The nest is out of date — re-nest before cutting.</span>' : ''}`;
}
function startUsbPage() {
  startToolPage('usb');
  const reloadTarget = () => loadTargetDrive().then(h => { if (h) { usb.handle = h; $('#usbName').textContent = h.name + ' (click Refresh)'; $('#usbRefresh').disabled = false; updUsbCopy(); } });
  if (FS_OK) reloadTarget();
  else { $('#usbStatus').textContent = FS_MSG; $('#usbPick').disabled = true; }
  NCLink.on('drive-changed', reloadTarget);
  $('#usbPick').onclick = pickUsb;
  $('#usbRefresh').onclick = scanUsb;
  ['usbOnlyNc', 'usbSub'].forEach(id => ($('#' + id).onchange = () => { if (usb.handle) scanUsb(); }));
  $('#usbErase').onclick = eraseUsb;
  $('#usbCopy').onclick = copyJobToUsb;
  onMainChange(updUsbCopy);
  updUsbCopy();
}

window.NCDriveTool = { CONFIG, process: { scanDrive, eraseFiles, writeJobToDrive }, usb, link: NCLink };
startUsbPage();
