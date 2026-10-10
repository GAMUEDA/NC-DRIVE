/* =====================================================================================================
   P9 · PARTS LIST — read part numbers and quantities from a parts list / work order
   readPartsList(file)   → {rows, job, lines:[{part, qty, desc, warn}], header}   (PDF, CSV, TSV or text)
   pdfToRows(buf)        → rows of cells (text grouped into lines; a wide gap starts a new cell)
   textToRows(text)      → rows of cells from CSV / tab / spaced text
   parsePartsRows(rows)  → {job, lines, header}   finds the Qty / Part columns, else reads line by line
   Part numbers are 5–6 digits (CONFIG.partsList.partNumber).
   ===================================================================================================== */

async function pdfToRows(buf) {
  return withPdf(buf, async pdf => {
    const rows = [];
    for (let pn = 1; pn <= Math.min(pdf.numPages, CONFIG.partsList.maxPages); pn++) {
      const tc = await (await pdf.getPage(pn)).getTextContent();
      const items = tc.items.map(it => ({ s: cleanPdfText(it.str), x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.height || it.transform[3] || 8) })).filter(it => it.s);
      // group into lines (top to bottom), then into cells (left to right)
      items.sort((a, b) => b.y - a.y || a.x - b.x);
      const lines = [];
      for (const it of items) {
        const L = lines[lines.length - 1];
        if (L && Math.abs(L.y - it.y) <= Math.max(2.5, it.h * 0.5)) L.items.push(it);
        else lines.push({ y: it.y, items: [it] });
      }
      for (const L of lines) {
        L.items.sort((a, b) => a.x - b.x);
        const cells = [], h = L.items[0].h;
        let cur = '', end = null;
        for (const it of L.items) {
          if (end !== null && it.x - end > Math.max(5, h * 0.9)) { cells.push(cur.trim()); cur = it.s; }
          else cur += (cur && end !== null && it.x - end > 0.5 ? ' ' : '') + it.s;
          end = it.x + it.w;
        }
        cells.push(cur.trim());
        rows.push(cells);
      }
    }
    return rows;
  });
}

function csvToRows(text) {
  const first = text.split(/\r?\n/).slice(0, 6).join('\n'), cnt = c => first.split(c).length - 1, delim = [',', ';', '\t'].sort((a, b) => cnt(b) - cnt(a))[0];
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.map(r => r.map(c => c.trim()));
}

function textToRows(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.some(l => l.includes('\t'))) return lines.map(l => l.split('\t').map(c => c.trim()));
  if (lines.filter(l => (l.match(/,/g) || []).length >= 2).length >= Math.max(2, lines.length / 2)) return csvToRows(text);
  return lines.map(l => (/\s{2,}/.test(l.trim()) ? l.trim().split(/\s{2,}/) : [l.trim()]));
}

const WO_HDR = { qty: /^(qty|quantity|qnty|pcs|pieces|count|order\s*qty|req(uired)?|#\s*req)\b/i, desc: /^desc/i, part: /^(part|p\/?n|component|drawing|dwg|sku|stock)\b/i, item: /^(item|line)\b/i };
const cellKind = c => { c = (c || '').trim(); if (!c || c.length > 28) return null; for (const k of ['qty', 'desc', 'part', 'item']) if (WO_HDR[k].test(c)) return k; return null; };
function cellQty(cell) { cell = (cell || '').trim(); const m = /^(\d{1,5})(?:\.0+)?\s*(?:ea|each|pcs?|pieces)?$/i.exec(cell); return m ? +m[1] : NaN; }

function parsePartsRows(rows) {
  const WO_PN = CONFIG.partsList.partNumber;
  const out = { job: '', lines: [], header: false };
  rows = rows.map(r => (r || []).map(c => (c == null ? '' : String(c)).replace(/\s+/g, ' ').trim()));
  // 1. job / work-order number near the top
  for (const row of rows.slice(0, 25))
    for (let i = 0; i < row.length && !out.job; i++) {
      const c = row[i], m = /(?:work\s*order|\bWO\b|job|project)\s*(?:#|no\.?|number)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-_.\/]{3,})/i.exec(c);
      let v = m && m[1];
      if (!v && /^(work\s*order|wo|job|project)\s*(#|no\.?|number)?\s*:?$/i.test(c)) v = (row[i + 1] || '').trim(); // label in one cell, value in the next
      if (v && !/^(date|name|desc|part|qty|number)/i.test(v)) out.job = v;
    }
  // 2. header row with a Qty column
  let hi = -1;
  const cols = {};
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const k = rows[r].map(cellKind);
    if (k.includes('qty') && (k.includes('part') || k.includes('item') || k.includes('desc'))) { hi = r; k.forEach((x, i) => { if (x && !(x in cols)) cols[x] = i; }); break; }
  }
  out.header = hi >= 0;
  // "12 x 19992", "19992 x 12", "19992 ... qty: 12"
  const anchored = (txt, pn) => {
    const m = new RegExp('(?<!\\d)(\\d{1,4})\\s*[x×]\\s*' + pn + '(?![\\d_])').exec(txt) || new RegExp('(?<![\\d_])' + pn + '(?![\\d_])\\s*[x×]\\s*(\\d{1,4})(?!\\d)').exec(txt)
      || new RegExp('(?<![\\d_])' + pn + '(?![\\d_])[^\\d]{0,14}?(?:qty|quantity|pcs)\\s*[:=]?\\s*(\\d{1,4})(?!\\d)', 'i').exec(txt);
    return m ? +m[1] : NaN;
  };
  // 3. one line per part number
  for (const cells of rows.slice(hi + 1)) {
    const txt = cells.filter(Boolean).join('  ');
    if (!txt) continue;
    let targets;
    if (cols.part != null) { const pn = (WO_PN.exec(cells[cols.part] || '') || [])[1] || (WO_PN.exec(txt) || [])[1]; targets = pn ? [pn] : []; }
    else targets = [...new Set([...txt.matchAll(new RegExp(WO_PN.source, 'g'))].map(m => m[1]))]; // free text: every part number on the line
    for (const pn of targets) {
      let qty = NaN, warn = '';
      if (cols.qty != null) qty = cellQty(cells[cols.qty]);
      if (isNaN(qty)) qty = anchored(txt, pn);
      if (isNaN(qty) && cols.qty == null && targets.length === 1) {
        // no Qty column: the last stand-alone whole number on the line
        const skip = cols.item != null ? cells[cols.item] : null, rest = cells.filter(c => c && c !== skip).join('  ').replace(pn, ' ');
        const ints = [...rest.matchAll(/(?<![\d.\-\/_])(\d{1,4})(?![\d.\-\/_])/g)].map(x => +x[1]).filter(n => n > 0 && n < 10000);
        if (ints.length) qty = ints[ints.length - 1];
      }
      if (isNaN(qty) || qty <= 0) { qty = 1; warn = 'no quantity found — assumed 1'; }
      out.lines.push({ part: pn, qty, desc: cols.desc != null ? cells[cols.desc] || '' : '', warn });
    }
  }
  return out;
}

// The whole "read a parts list file" step.
async function readPartsList(file) {
  const rows = /\.pdf$/i.test(file.name) ? await pdfToRows(await file.arrayBuffer()) : textToRows(await file.text());
  return { rows, ...parsePartsRows(rows) };
}
