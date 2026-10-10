/* =====================================================================================================
   P4 · READ PDF — drawing title block → material + drawing number → one shop label
   readDrawingPdf(file)            → {entry:{name, material, raw, partNo, notStocked}} or {error}
   readPdfTitleBlock(arrayBuffer)  → {material, finish, desc, partNo, hint, nItems}
   normalizeMaterial(mat, finish, extra) → {label:"14ga Satincoat" | "16ga Galv" | "12ga Stainless 304" | '1/4" HRS', gauge, type, notStocked, raw}
   pdfMatchesPart(entry, partName) → true when the drawing belongs to that part
   The PDF reader (pdf.js) loads from the internet the first time.
   ===================================================================================================== */

// ---- title block scanning ----
const LABEL_WORDS = /^(project( name)?|description|finish|date|scale|units|sheet|rev(ision)?( number)?|drawn by|designed by|part( no\.?| number)?|dwg( no\.?)?|drawing( no\.?| number)?|material|approved( by)?|checked( by)?|qty|weight|title|size)\b/i;
const isLabelText = s => /:\s*$/.test(s) || /^[A-Z][A-Z0-9 \/'#.*&()-]{1,30}:\s/.test(s) || (s.length <= 22 && LABEL_WORDS.test(s));

// The value written after (or under) the label at items[idx].
function valueAfterLabel(items, idx, labelRe) {
  const L = items[idx], colon = L.s.lastIndexOf(':');
  let rest = colon >= 0 ? L.s.slice(colon + 1).trim() : L.s.replace(labelRe, '').replace(/^[^a-z0-9]+/i, '').replace(/^(no\.?|num(ber)?)(\s+|$)/i, '').trim();
  if (/[a-z0-9]/i.test(rest)) return rest;
  const join = (first, rowTol) => {
    const row = items.filter(it => it !== L && Math.abs(it.y - first.y) <= rowTol && it.x >= first.x - 1).sort((a, b) => a.x - b.x);
    const out = [];
    let end = null;
    for (const it of row) {
      if (isLabelText(it.s)) break;
      if (end !== null && it.x - end > Math.max(12, it.h * 2.2)) break;
      out.push(it.s);
      end = it.x + it.w;
    }
    return out.join(' ');
  };
  const tolOf = h => Math.min(4, Math.max(2, h * 0.4)), rowTol = tolOf(L.h);
  const right = items.filter(it => it !== L && Math.abs(it.y - L.y) <= rowTol && it.x > L.x + L.w * 0.5 && !isLabelText(it.s)).sort((a, b) => a.x - b.x)[0];
  if (right && right.x - (L.x + L.w) <= 260) { const v = join(right, rowTol); if (v) return v; }
  const below = items
    .filter(it => it !== L && it.y < L.y - 1 && L.y - it.y <= Math.max(18, L.h * 4) && it.x < L.x + Math.max(L.w, 30) && it.x + it.w > L.x - 2 && !isLabelText(it.s))
    .sort((a, b) => b.y - a.y)[0];
  if (below) { const v = join(below, tolOf(below.h)); if (v) return v; }
  return null;
}
function findField(items, labelRe, needColon) {
  for (let i = 0; i < items.length; i++) {
    if (!labelRe.test(items[i].s) || items[i].s.length > 24) continue;
    if (needColon && !/:/.test(items[i].s)) continue;
    const v = valueAfterLabel(items, i, labelRe);
    if (v) return v;
  }
  return null;
}
function scanTitleBlock(items) {
  const xs = items.map(i => i.x), ys = items.map(i => i.y), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const inBlock = it => it.x > x0 + 0.35 * (x1 - x0) && it.y < y0 + 0.4 * (y1 - y0), GAUGE = /\b\d{1,2}\s?-?\s?(ga|gauge|gage)\b/i;
  let material = findField(items, /\b(material|mat'?l\.?)\b/i) || findField(items, /\b(gauge|gage|thickness|thk)\b/i), hint = null;
  const hit = items.find(it => inBlock(it) && GAUGE.test(it.s));
  if (hit) hint = hit.s.match(GAUGE)[0];
  if (!material && hint) material = hint;
  let finish = findField(items, /^fini(?:sh|s)?\b/i);
  if (finish && /^industry\b/i.test(finish)) finish = null;
  const desc = findField(items, /^description\b/i, true);
  let partNo = findField(items, /^(part(?!\s*of\b)|dwg|drawing)\b/i);
  if (partNo && partNo.length > 30) partNo = null;
  return { material, finish, desc, partNo, hint };
}
async function readPdfTitleBlock(buf) {
  return withPdf(buf, async (pdf, src) => {
    const out = { material: null, finish: null, desc: null, partNo: null, hint: null, nItems: 0 };
    for (let pn = 1; pn <= Math.min(pdf.numPages, CONFIG.material.pdfPagesToScan) && !(out.material && out.partNo); pn++) {
      // text is grouped by its rotation (0/90/180/270°) so rotated title blocks read the right way round
      const content = await (await pdf.getPage(pn)).getTextContent(), groups = [[], [], [], []];
      for (const it of content.items) {
        const s = cleanPdfText(it.str);
        if (!s) continue;
        const q = ((Math.round(Math.atan2(it.transform[1], it.transform[0]) / (Math.PI / 2)) % 4) + 4) % 4;
        const th = (q * Math.PI) / 2, cs = Math.cos(th), sn = Math.sin(th), X = it.transform[4], Y = it.transform[5];
        groups[q].push({ s, x: cs * X + sn * Y, y: -sn * X + cs * Y, w: it.width || 0, h: Math.abs(it.height || 6) });
      }
      out.nItems += groups.reduce((n, g) => n + g.length, 0);
      for (const g of groups.filter(g => g.length >= 2).sort((a, b) => b.length - a.length)) {
        const r = scanTitleBlock(g);
        for (const k of ['material', 'finish', 'desc', 'partNo', 'hint']) if (!out[k] && r[k]) out[k] = r[k];
      }
    }
    const isLast = src === CONFIG.pdfjs[CONFIG.pdfjs.length - 1];
    return out.material || isLast ? out : null; // null → try the next pdf.js version
  });
}

// The whole "read one drawing PDF" step.
async function readDrawingPdf(file) {
  try {
    const info = await readPdfTitleBlock(await file.arrayBuffer());
    const norm = info.material ? normalizeMaterial(info.material, info.finish, [info.desc, info.hint].filter(Boolean).join(' ')) : null;
    if (!norm || !norm.label) return { error: `${file.name}: no MATERIAL / gauge found in the title block (${info.nItems} text items) — set the gauge by hand`, kind: 'warn' };
    return { entry: { name: file.name.replace(/\.pdf$/i, ''), material: norm.label, raw: norm.raw, partNo: info.partNo, notStocked: !!norm.notStocked } };
  } catch (e) {
    return { error: `${file.name}: couldn't read the PDF (${(e && e.message) || e}). The reader needs internet access once.`, kind: 'bad' };
  }
}

// ---- MATERIAL: reduce whatever the drawing says to one shop label ----
const normThick = t => (t || '').trim().toLowerCase().replace(/\s+/g, '');
const hasGauge = t => { t = String(t || ''); return /\d\s*-?\s*ga(uge)?\b/i.test(t) || /\d(\.\d+)?\s*mm\b/i.test(t) || /\d\/\d+"?\s*hrs\b/i.test(t); };

// Plate thickness as a fraction ("1/4"), from inches, decimals or mm. relaxed: accept a bare fraction/decimal.
function plateThicknessOf(t, relaxed) {
  t = String(t || '').toLowerCase();
  if (relaxed) {
    let r = /(?:^|[^\d.\/])(\d{1,2})\s*\/\s*(\d{1,2})(?![\d\/])/.exec(t);
    if (r && +r[2] && +r[1] / +r[2] <= 1.5) return +r[1] + '/' + +r[2];
    r = /(?:^|[^\d])(0?\.\d{2,3})(?!\d)/.exec(t);
    if (r) { const v = parseFloat(r[1]); for (const [num, den] of [[1, 8], [3, 16], [1, 4], [5, 16], [3, 8], [1, 2]]) if (Math.abs(v - num / den) < 0.004) return num + '/' + den; }
  }
  let m = /(?:^|[^\d.\/])(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:"|''|in\b|inch(?:es)?\b)/.exec(t);
  if (m && +m[2]) return +m[1] / +m[2] <= 1.5 ? +m[1] + '/' + +m[2] : null;
  m = /(?:^|[^\d])(0?\.\d{2,3}|\d\.\d{1,3})\s*(?:"|''|in\b|inch(?:es)?\b)/.exec(t);
  if (m) {
    const v = parseFloat(m[1]);
    for (const [num, den] of [[1, 8], [3, 16], [1, 4], [5, 16], [3, 8], [1, 2], [5, 8], [3, 4], [1, 1]]) if (Math.abs(v - num / den) < 0.004) return num + '/' + den;
    return null;
  }
  m = /(?:^|[^\d.])(\d+(?:\.\d+)?)\s*mm\b/.exec(t);
  if (m) { const v = parseFloat(m[1]); for (const [num, den] of [[1, 8], [3, 16], [1, 4], [5, 16], [3, 8], [1, 2]]) if (Math.abs(v - (25.4 * num) / den) < 0.06) return num + '/' + den; }
  return null;
}

function normalizeMaterial(matText, finishText, extraText) {
  const clean = t => (t || '').toString().replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const mat = clean(matText), fin = clean(finishText), ext = clean(extraText);
  const low = (mat + ' | ' + fin).toLowerCase();
  // plate (a thickness in inches / mm rather than a gauge)
  {
    const gaugeInMat = /\b\d{1,2}\s*-?\s*(?:ga|gauge|gage)\b/.test(mat.toLowerCase());
    const plateWord = /\bhrs\b|hot[\s-]?rolled|\bplate\b/.test(low), pf = gaugeInMat ? null : plateThicknessOf(mat, plateWord) || plateThicknessOf(fin);
    if (pf) {
      if (/\b(stainless|sst|alumin\w*|brass|copper|bronze|titanium|zinc|galv\w*)\b/.test(low)) return { label: mat || fin, gauge: pf + '"', type: null, notStocked: true, raw: mat || fin };
      if (CONFIG.material.plateStock[pf]) return { label: CONFIG.material.plateStock[pf].label, gauge: pf + '"', type: 'HRS', raw: [mat, fin && 'finish: ' + fin].filter(Boolean).join(' · ') };
      return { label: mat || fin, gauge: pf + '"', type: null, notStocked: true, raw: mat || fin };
    }
  }
  // sheet (a gauge)
  const gaugeOf = t => {
    t = t.toLowerCase();
    let m = t.match(/\b(\d{1,2})\s*-?\s*(?:ga|gauge|gage)\b/);
    if (!m) m = t.match(/\b(\d{1,2})g\b/);
    if (m && +m[1] >= 3 && +m[1] <= 30) return m[1] + 'ga';
    m = t.match(/\b(\d+(?:\.\d+)?)\s*mm\b/);
    return m ? m[1] + 'mm' : null;
  };
  const gauge = gaugeOf(mat) || gaugeOf(ext) || gaugeOf(fin);
  let type = 'Satincoat';
  const stainless = /\bstainless\b|\bsst\b|\bs\/s\b|\bss\b|\b(?:304|316|430|201)l?\b(?!\s*mpa)/.exec(low);
  const galv = /galv|\bg-?(?:30|40|60|90)\b|\bhdg\b|\bhot[\s-]?dip|\belectro(?![\s-]*polish)/.test(low);
  const unstocked = /\b(alumin\w*|brass|copper|bronze|titanium|zinc)\b/.test(low);
  if (unstocked) return { label: mat || fin, gauge, type: null, notStocked: true, raw: mat };
  if (stainless) { const g = /\b(304|316|430|201)(l?)\b(?!\s*mpa)/.exec(low); type = 'Stainless' + (g ? ' ' + g[1] + g[2].toUpperCase() : ''); }
  else if (galv) type = 'Galv';
  if (!mat && !fin && !gauge) return { label: '', gauge: null, type: null, raw: '' };
  return { label: [gauge, type].filter(Boolean).join(' '), gauge, type, raw: [mat, fin && 'finish: ' + fin].filter(Boolean).join(' · ') };
}

// ---- which drawing belongs to which part ----
// A drawing PDF belongs to a part when the names share 2+ leading words, or the drawing number appears in the part's name.
function normName(s) { return s.replace(/\.(dxf|nc|pdf)$/i, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function lcpWords(a, b) {
  const wa = normName(a).split(' '), wb = normName(b).split(' ');
  let n = 0;
  while (n < wa.length && n < wb.length && wa[n] === wb[n]) n++;
  return n;
}
function pdfMatchesPart(info, partName) {
  if (lcpWords(partName, info.name) >= 2) return true;
  const pn = info.partNo ? normName(info.partNo) : '';
  if (pn.length >= 3 && (' ' + normName(partName) + ' ').includes(' ' + pn + ' ')) return true;
  const lead = /^\s*(\d{4,6})(?!\d)/.exec(info.name); // "19992 - 12ga Cladding Clip.pdf" <-> "19992_FLAT.dxf"
  return !!lead && new RegExp('(?<!\\d)' + lead[1] + '(?!\\d)').test(partName);
}
