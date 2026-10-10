/* =====================================================================================================
   UI · PROCESSING STATUS — right side of the Tools bar
   The round dial shows the current step, the bar shows the whole task:
     showProgress(task, detail, stepFrac, totalFrac)  fractions 0..1, or null = busy (no % known)
     finishProgress(task, detail, ok)                 full dial and bar, green (ok) or red
   Nesting: dial = the gauge group being nested, bar = every piece. Loading files: dial and bar = files read.
   The tool pages report here too (link.js notice "progress").
   ===================================================================================================== */
function setDial(frac, label, cls) {
  setGauge('pDial', frac, label, cls);
  $('#pDial').classList.toggle('busy', cls === 'busy');
}
function showProgress(task, detail, stepFrac, totalFrac) {
  const busy = stepFrac == null && totalFrac == null;
  const total = totalFrac == null ? stepFrac : totalFrac;
  $('#pTask').textContent = task;
  $('#pDetail').textContent = detail || '';
  setDial(busy ? 0.25 : stepFrac == null ? total : stepFrac, busy ? '…' : Math.round(100 * (stepFrac == null ? total : stepFrac)) + '%', busy ? 'busy' : '');
  $('#pPct').textContent = busy ? '' : Math.round(100 * total) + '%';
  const bar = $('#procBar');
  bar.className = 'procBar' + (busy ? ' busy' : '');
  $('#pBar').style.width = busy ? '' : (100 * Math.max(0, Math.min(1, total))).toFixed(1) + '%';
}
function finishProgress(task, detail, ok) {
  $('#pTask').textContent = task;
  $('#pDetail').textContent = detail || '';
  setDial(1, ok === false ? '✕' : '✓', ok === false ? 'bad' : 'ok');
  $('#pPct').textContent = ok === false ? 'FAILED' : 'DONE';
  $('#procBar').className = 'procBar ' + (ok === false ? 'bad' : 'ok');
  $('#pBar').style.width = '100%';
}
function wireProgress() {
  setDial(0, '—', '');
  NCLink.on('progress', d => { if (d.done) finishProgress(d.task, d.detail, d.frac !== 0); else showProgress(d.task, d.detail, d.frac, d.frac); });
}
