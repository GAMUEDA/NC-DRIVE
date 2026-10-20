/* =====================================================================================================
   P14 · TURRET REPORT PDF — the one-page program sheet that goes with each turret .nc
   turretReportPdf(prog) → Uint8Array (a letter-size PDF)
     The same layout as the shop's samples (14443_10073 - 1.pdf …): program name, sheet and efficiency,
     the nest drawing with the clamps, machining time, tools, sheets to cut, part list.
     Machining times are estimates fitted to the sample reports (CONFIG.turret.report).
     Written directly as PDF (Helvetica, the logo as a JPEG), so it needs nothing from the internet.
   ===================================================================================================== */

// Helvetica widths (1/1000 em) for ASCII 32–126
const HELV_W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const textW = (s, size, bold) => [...String(s)].reduce((a, ch) => a + (HELV_W[ch.charCodeAt(0) - 32] || 556), 0) * size / 1000 * (bold ? 1.07 : 1);

// a tiny one-page PDF writer: top-left coordinates in points, y down
function pdfPage() {
  const H = 792, ops = [];
  const esc = s => String(s).replace(/[\\()]/g, m => '\\' + m).replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
  const n = v => (Math.round(v * 100) / 100).toString();
  const P = {
    ops,
    text(x, y, s, o) {
      o = o || {};
      const size = o.size || 7, w = textW(s, size, o.bold);
      const tx = o.align === 'center' ? x - w / 2 : o.align === 'right' ? x - w : x;
      ops.push(`BT /${o.bold ? 'F2' : 'F1'} ${size} Tf ${o.color || '0 g'} ${n(tx)} ${n(H - y)} Td (${esc(s)}) Tj ET`);
    },
    rect(x, y, w, h, o) {
      o = o || {};
      let s = 'q ';
      if (o.fill) s += `${o.fill} `;
      if (o.stroke) s += `${o.stroke} `;
      s += `${n(o.lw || 0.5)} w ${o.dash ? `[${o.dash}] 0 d ` : ''}${n(x)} ${n(H - y - h)} ${n(w)} ${n(h)} re ${o.fill && o.stroke ? 'B' : o.fill ? 'f' : 'S'} Q`;
      ops.push(s);
    },
    path(pts, o) { // [[x,y],…] polyline in page points
      if (pts.length < 2) return;
      o = o || {};
      ops.push(`q ${o.stroke || '0 G'} ${n(o.lw || 0.4)} w ${pts.map((p, i) => `${n(p[0])} ${n(H - p[1])} ${i ? 'l' : 'm'}`).join(' ')} ${o.close ? 'h ' : ''}S Q`);
    },
    image(x, y, w, h) { ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(H - y - h)} cm /Im1 Do Q`); },
  };
  return P;
}
function pdfBytes(page, jpeg) {
  const content = page.ops.join('\n'), objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >>${jpeg ? ' /XObject << /Im1 7 0 R >>' : ''} >> /Contents 6 0 R >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  objs.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  if (jpeg) objs.push(`<< /Type /XObject /Subtype /Image /Width ${jpeg.w} /Height ${jpeg.h} /ColorSpace /${jpeg.comp === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.bin.length} >>\nstream\n${jpeg.bin}\nendstream`);
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  const b = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) b[i] = out.charCodeAt(i) & 255;
  return b;
}
// JPEG data URL → {bin (binary string), w, h, comp}
function jpegInfo(dataUrl) {
  try {
    const bin = atob(dataUrl.split(',')[1]);
    for (let i = 2; i < bin.length;) {
      const m = bin.charCodeAt(i + 1), len = bin.charCodeAt(i + 2) * 256 + bin.charCodeAt(i + 3);
      if (m === 0xc0 || m === 0xc1 || m === 0xc2) return { bin, h: bin.charCodeAt(i + 5) * 256 + bin.charCodeAt(i + 6), w: bin.charCodeAt(i + 7) * 256 + bin.charCodeAt(i + 8), comp: bin.charCodeAt(i + 9) };
      i += 2 + len;
    }
  } catch (e) {}
  return null;
}

const nf = (v, d) => Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOfYear = d => Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);

// area of the part (outline minus holes), m²
function turretPartArea(part) {
  const loops = entitiesToLoops(part.outline).filter(l => l.closed);
  if (!loops.length) return (part.L * part.H) / 1e6;
  const big = loops.reduce((a, b) => (b.area > a.area ? b : a));
  const holes = loops.filter(l => l !== big).reduce((a, l) => a + l.area, 0);
  return (big.area - holes) / 1e6;
}

function turretReportPdf(prog) {
  const C = CONFIG.turret, R = C.report, tpl = prog.tpl, part = prog.part, st = prog.stats, n = prog.count, d = prog.date;
  const pg = pdfPage(), logo = typeof FALK_LOGO !== 'undefined' ? jpegInfo(FALK_LOGO) : null;
  const sW = prog.sheet[0] * IN, sH = prog.sheet[1] * IN, t = tpl.thicknessMM;
  const area = turretPartArea(part), kgPart = area * (t / 1000) * C.densityKgM3;
  const usefulX = (st.maxX + tpl.edge) * IN, usefulY = (st.maxY + tpl.edge) * IN;
  const nesting = `${d.getFullYear()}-${dayOfYear(d)}-${prog.programNo}`;
  const T = {
    rapid: st.rapidM * R.rapidMinPerM, nib: st.nibLenM * R.nibbleMinPerM + st.nibbles * R.nibbleMinPerHit,
    punch: st.hits * R.punchMinPerHit, tools: st.tools.length * R.toolChangeMin,
  };
  const total = T.rapid + T.nib + T.punch + T.tools + R.loadMin;
  const LIGHT = '0.83 g', HEAD = '0.75 g', LINE = '0.35 G';
  const cell = (x, y, w, h, s, o) => { o = o || {}; pg.rect(x, y, w, h, { stroke: LINE, fill: o.fill, lw: 0.4 }); if (s !== '' && s != null) pg.text(o.align === 'center' ? x + w / 2 : o.align === 'right' ? x + w - 3 : x + 3, y + h - 2.6, s, { size: o.size || 6.6, bold: o.bold, align: o.align }); };

  // ---- title block ----
  if (logo) pg.image(22, 18, 112, 112 * logo.h / logo.w); else pg.text(24, 40, 'FALK', { size: 20, bold: true });
  cell(138, 18, 104, 14, 'PROGRAM NAME:', { bold: true, size: 10, fill: HEAD });
  cell(242, 18, 340, 14, prog.name, { bold: true, size: 10, align: 'center' });
  cell(138, 32, 62, 9, 'Nesting', { bold: true, fill: HEAD }); cell(200, 32, 382, 9, nesting, { bold: true, align: 'center' });
  cell(138, 41, 62, 9, 'Machine', { bold: true, fill: HEAD }); cell(200, 41, 190, 9, C.machine, { bold: true });
  cell(390, 41, 95, 9, 'Program number', { bold: true, fill: HEAD }); cell(485, 41, 97, 9, String(prog.programNo), { bold: true });

  // ---- sheet / efficiency ----
  const kv = (x, y, title, rows, lw, vw) => {
    cell(x, y, lw + vw, 9, title, { bold: true, fill: HEAD });
    rows.forEach(([k, v], i) => { cell(x, y + 9 + i * 9, lw, 9, k, { align: 'right' }); cell(x + lw, y + 9 + i * 9, vw, 9, v, { bold: true }); });
  };
  kv(22, 64, 'Sheet', [['Dimensions', `${nf(sW, 2)} x ${nf(sH, 2)} x ${nf(t, 2)} mm`], ['Weight (kg)', nf((sW / 1000) * (sH / 1000) * (t / 1000) * C.densityKgM3, 2)], ['Grade', tpl.grade], ['Sheet', '']], 52, 156);
  kv(234, 64, 'Efficiency', [['Useful dimensions', `${nf(usefulX, 2)} x ${nf(usefulY, 2)} mm`], ['Multiplicity', '1'], ['Total waste (%)', nf(100 * (1 - (n * area) / ((sW / 1000) * (sH / 1000))), 2)], ['Front waste (%)', nf(100 * (1 - (n * area) / ((sH / 1000) * ((usefulX + 6.35) / 1000))), 2)]], 98, 112);

  // ---- nest drawing ----
  const box = { x: 22, y: 118, w: 568, h: 334 };
  pg.rect(box.x, box.y, box.w, box.h, { stroke: '0.6 G', lw: 0.6 });
  const k = Math.min((box.h - 20) / sH, (box.w - 20) / sW), ox = box.x + (box.w - sW * k) / 2, oy = box.y + 8; // sheet top-left on the page
  const px = xmm => ox + xmm * k, py = ymm => oy + (sH - ymm) * k;                                             // sheet mm → page
  pg.rect(px(0), py(sH), sW * k, sH * k, { fill: '0.9 g', stroke: '0.55 G', lw: 0.5 });
  const loops = entitiesToLoops(part.outline);
  for (let i = 0; i < n; i++) {
    const bx = tpl.origin.x * IN, by = (tpl.origin.y + i * (part.H / IN + tpl.gap)) * IN;
    for (const l of loops) {
      const pts = [[px(bx + l.segs[0].p0.x - part.minX), py(by + l.segs[0].p0.y - part.minY)]];
      for (const s of l.segs) {
        if (s.arc) { // a few points along the arc
          const a0 = Math.atan2(s.p0.y - s.arc.cy, s.p0.x - s.arc.cx), r = Math.hypot(s.p0.x - s.arc.cx, s.p0.y - s.arc.cy);
          let a1 = Math.atan2(s.p1.y - s.arc.cy, s.p1.x - s.arc.cx), sw = s.arc.ccw ? a1 - a0 : a0 - a1;
          if (sw <= 1e-9) sw += 2 * Math.PI;
          for (let q = 1; q <= 8; q++) { const a = a0 + (s.arc.ccw ? 1 : -1) * sw * q / 8; pts.push([px(bx + s.arc.cx + r * Math.cos(a) - part.minX), py(by + s.arc.cy + r * Math.sin(a) - part.minY)]); }
        } else pts.push([px(bx + s.p1.x - part.minX), py(by + s.p1.y - part.minY)]);
      }
      pg.path(pts, { stroke: '0.2 G', lw: 0.35, close: l.closed });
    }
  }
  for (const c of tpl.clamps) { // clamps on the sheet's front edge
    const cw = 4 * IN * k, ch = 1.6 * IN * k, cx = px(c * IN);
    pg.rect(cx - cw / 2, py(0) - ch * 0.55, cw, ch, { stroke: '0.85 0.1 0.1 RG', lw: 0.6 });
  }

  // ---- comments ----
  cell(22, 456, 60, 9, 'Comments', { bold: true, fill: HEAD }); cell(82, 456, 508, 9, '');

  // ---- machining time ----
  const mt = [['Rapid crossing length (m)', `${nf(st.rapidM, 2)} m`, `${nf(T.rapid, 2)} min`], ['Nibbling length (m)', `${nf(st.nibLenM, 2)} m`, `${nf(T.nib, 2)} min`],
    ['Number of punching operation(s)', String(st.hits), `${nf(T.punch, 2)} min`], ['Number of nibbling operation(s)', String(st.nibbles), ''],
    ['Number of tool change(s)', String(st.tools.length), `${nf(T.tools, 2)} min`], ['Number of repositioning operation(s)', '0', '0.00 min'],
    ['Number of trap door(s)', '0', '0.00 min'], ['Number of machine stops', '0', '0.00 min'], ['Total time (min)', '', `${nf(total, 2)} min`]];
  cell(22, 474, 158, 9, 'Machining time', { bold: true, fill: HEAD }); cell(180, 474, 60, 9, 'Nb/Length', { bold: true, fill: HEAD }); cell(240, 474, 60, 9, 'Time', { bold: true, fill: HEAD });
  mt.forEach((r, i) => { const y = 483 + i * 9, last = i === mt.length - 1; cell(22, y, 158, 9, r[0], { bold: true }); cell(180, y, 60, 9, r[1]); cell(240, y, 60, 9, r[2], { bold: last }); });

  // ---- clamps / tools ----
  cell(320, 474, 252, 9, 'Clamps', { bold: true, fill: HEAD });
  tpl.clamps.forEach((c, i) => cell(322 + i * 34, 486, 32, 9, nf(c * IN, 2) + (i < tpl.clamps.length - 1 ? ';' : '')));
  cell(320, 500, 236, 9, 'Tools', { bold: true, fill: HEAD });
  const tc = [[320, 80, 'Tool'], [400, 78, 'Dimensions'], [478, 38, 'Angle (°)'], [516, 40, 'Position']];
  tc.forEach(([x, w, s]) => cell(x, 509, w, 9, s, { bold: true, align: s === 'Tool' ? undefined : 'center' }));
  st.tools.forEach((tl, i) => { const y = 518 + i * 9; cell(320, y, 80, 9, tl.name); cell(400, y, 78, 9, tl.dims, { align: 'center' }); cell(478, y, 38, 9, '0.00', { align: 'center' }); cell(516, y, 40, 9, `${tl.no} / 0`, { align: 'center' }); });

  // ---- sheets to cut ----
  const sy = 590;
  cell(22, sy, 344, 9, 'Sheets to cut', { bold: true, fill: HEAD, align: 'center' });
  cell(22, sy + 9, 130, 9, 'Multiplicity name', { bold: true, align: 'center' }); cell(152, sy + 9, 120, 9, 'Name', { bold: true }); cell(272, sy + 9, 94, 9, 'Cast number', { bold: true, align: 'center' });
  cell(22, sy + 18, 130, 9, `1 - ${nesting}`, { align: 'center' }); cell(152, sy + 18, 120, 9, ''); cell(272, sy + 18, 94, 9, '');

  // ---- part list ----
  const ly = 630;
  cell(22, ly, 568, 9, 'Part list', { bold: true, fill: HEAD, align: 'center' });
  const pc = [[22, 22, 'No.'], [44, 138, 'Name'], [182, 30, 'Quantity'], [212, 128, 'Part'], [340, 92, 'Dimensions'], [432, 66, 'Customer order id.'], [498, 44, 'Surface (m²)'], [542, 48, 'Weight (kg)']];
  pc.forEach(([x, w, s]) => cell(x, ly + 9, w, 9, s, { bold: true, align: 'center', size: 6 }));
  const vals = ['1', part.name, String(n), part.name, `${nf(part.L, 2)} x ${nf(part.H, 2)} mm`, part.name, nf(area, 2), nf(kgPart, 2)];
  pc.forEach(([x, w], i) => cell(x, ly + 18, w, 10, vals[i], { align: 'center', size: i === 4 ? 6 : 6.6 }));

  // ---- footer ----
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  pg.text(22, 772, `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${hh}:${mm}`, { size: 7, color: '0.25 g' });
  pg.text(590, 772, '1/1', { size: 7, align: 'right' });
  return pdfBytes(pg, logo);
}
