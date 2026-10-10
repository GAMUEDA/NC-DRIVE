/* =====================================================================================================
   COMMON — small helpers every page uses
   ===================================================================================================== */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const fmtDate = ms => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const timeStamp = () => { const d = new Date(), p = v => String(v).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
// Remembered text boxes (browser localStorage, prefix "ncdrive.")
const ls = {
  get(k, d) { try { const v = localStorage.getItem('ncdrive.' + k); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('ncdrive.' + k, v); } catch (e) {} },
};
// A drop zone that hands its first file to onFile (click opens the file picker).
function wireDropZone(zoneId, inputId, onFile) {
  const zone = $('#' + zoneId), input = $('#' + inputId);
  zone.onclick = () => input.click();
  input.onchange = () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; };
  zone.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); zone.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) onFile(f); });
}

// ---- part-number matching (NC Search, Parts List, Copy to Drive, main page) ----
// A numeric part number must stand alone in a name ("14799A", "P14800_flat" match 14799/14800; 114798 does not). Anything else matches as text.
const termMatcher = t => /^\d+$/.test(t) ? (re => n => re.test(n))(new RegExp('(?<!\\d)' + t + '(?!\\d)')) : (lc => n => n.toLowerCase().includes(lc))(t.toLowerCase());
// "19992, 14738 110296" → ['19992', '14738', '110296']
const splitTerms = s => [...new Set(String(s || '').split(/[\s,;]+/).map(t => t.trim()).filter(t => t.length >= 2))];

// Open a page in a named window. An already-open window is only brought forward (not reloaded, so its work is
// kept) unless reload is true. Returns the window, or null when the browser blocked it.
function openNamed(url, name, reload) {
  const abs = new URL(url, location.href).href;
  if (reload) return window.open(abs, name);
  const w = window.open('', name);
  if (!w) return null;
  try { if (w.location.href === 'about:blank') w.location.href = abs; } catch (e) { /* another page is already there */ }
  w.focus();
  return w;
}

// Scale the whole page to the window (see CONFIG.screen). Called when a page opens and whenever the window is resized.
function fitScreen() {
  const c = CONFIG.screen, k = Math.min(Math.max(Math.min(innerWidth / c.designW, innerHeight / c.designH), c.minScale), c.maxScale);
  document.documentElement.style.zoom = String(Math.round(k * 1000) / 1000);
  return k;
}
