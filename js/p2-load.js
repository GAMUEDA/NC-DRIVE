/* =====================================================================================================
   P2 · LOAD DXF / NC — read a part file into raw entities
   parseDXF(text) → {raw:[entities]} or null        (LINE, ARC, CIRCLE, LWPOLYLINE/POLYLINE, SPLINE, ELLIPSE)
   parseNC(text)  → {raw:[entities], ncBlocks} or null   (a Bodor .nc program; its mark/cut blocks are kept
                                                          so etching survives re-nesting)
   loadPartFile(file, cleanOpts, pdfMats) → part     (the whole "load one file" step used by the Parts list)
   ===================================================================================================== */

// ---- DXF ----
function parseDXF(text) {
  const lines = text.split(/\r\n|\r|\n/), P = [];
  for (let i = 0; i + 1 < lines.length; i += 2) P.push([parseInt(lines[i], 10), lines[i + 1].trim()]);
  let i = 0;
  while (i < P.length && !(P[i][0] === 2 && P[i][1] === 'ENTITIES')) i++;
  i++;
  const out = [];
  const grab = () => { const d = []; while (i < P.length && P[i][0] !== 0) { d.push(P[i]); i++; } return d; };
  const num = (d, c, def = 0) => { const f = d.find(x => x[0] === c); return f ? parseFloat(f[1]) : def; };
  const str = (d, c, def = '0') => { const f = d.find(x => x[0] === c); return f ? f[1] : def; };
  const all = (d, c) => d.filter(x => x[0] === c).map(x => parseFloat(x[1]));

  while (i < P.length && !(P[i][0] === 0 && P[i][1] === 'ENDSEC')) {
    if (P[i][0] !== 0) { i++; continue; }
    const t = P[i][1];
    i++;
    if (t === 'POLYLINE') {
      const h = grab(), pts = [];
      while (i < P.length && !(P[i][0] === 0 && P[i][1] === 'SEQEND')) {
        if (P[i][0] === 0 && P[i][1] === 'VERTEX') { i++; const v = grab(); pts.push({ x: num(v, 10), y: num(v, 20), b: num(v, 42) }); }
        else i++;
      }
      out.push({ type: 'POLY', pts, closed: (num(h, 70) & 1) === 1, layer: str(h, 8) });
      continue;
    }
    const d = grab(), layer = str(d, 8);
    if (t === 'LINE') out.push({ type: 'LINE', x1: num(d, 10), y1: num(d, 20), x2: num(d, 11), y2: num(d, 21), layer });
    else if (t === 'CIRCLE') out.push({ type: 'CIRCLE', x: num(d, 10), y: num(d, 20), r: num(d, 40), layer });
    else if (t === 'ARC') out.push({ type: 'ARC', x: num(d, 10), y: num(d, 20), r: num(d, 40), a1: num(d, 50), a2: num(d, 51, 360), layer });
    else if (t === 'LWPOLYLINE') {
      const pts = [];
      for (const [c, v] of d) {
        if (c === 10) pts.push({ x: parseFloat(v), y: 0, b: 0 });
        else if (c === 20 && pts.length) pts[pts.length - 1].y = parseFloat(v);
        else if (c === 42 && pts.length) pts[pts.length - 1].b = parseFloat(v);
      }
      out.push({ type: 'POLY', pts, closed: (num(d, 70) & 1) === 1, layer });
    } else if (t === 'SPLINE') {
      const ctrl = [], fit = [];
      let a = null, b = null;
      for (const [c, v] of d) {
        if (c === 10) a = parseFloat(v);
        else if (c === 20 && a !== null) { ctrl.push([a, parseFloat(v)]); a = null; }
        else if (c === 11) b = parseFloat(v);
        else if (c === 21 && b !== null) { fit.push([b, parseFloat(v)]); b = null; }
      }
      out.push({ type: 'SPLINE', deg: num(d, 71, 3), knots: all(d, 40), ctrl, fit, layer });
    } else if (t === 'ELLIPSE') {
      out.push({ type: 'ELLIPSE', x: num(d, 10), y: num(d, 20), mx: num(d, 11), my: num(d, 21), ratio: num(d, 40, 1), t0: num(d, 41, 0), t1: num(d, 42, 2 * Math.PI), layer });
    }
  }
  const ents = withTessellation(out);
  return ents.length ? { raw: ents } : null;
}

// ---- NC (Bodor post) ----
// Cut blocks become LINE / ARC / CIRCLE entities for preview and nesting; mark (etch) blocks are only kept as blocks.
function ncBlocksToEntities(blocks) {
  const ents = [];
  for (const blk of blocks) {
    if (blk.kind !== 'cut') continue;
    let prev = blk.rapid;
    for (const c of blk.cmds) {
      if (c.cmd === 'G01') ents.push({ type: 'LINE', x1: prev.x, y1: prev.y, x2: c.x, y2: c.y });
      else {
        const r = Math.hypot(prev.x - c.cx, prev.y - c.cy);
        if (Math.hypot(c.x - prev.x, c.y - prev.y) < 1e-6) ents.push({ type: 'CIRCLE', x: c.cx, y: c.cy, r });
        else
          ents.push({
            type: 'ARC', x: c.cx, y: c.cy, r,
            a1: (Math.atan2(prev.y - c.cy, prev.x - c.cx) * 180) / Math.PI,
            a2: (Math.atan2(c.y - c.cy, c.x - c.cx) * 180) / Math.PI,
            ccw: c.cmd === 'G03',
          });
      }
      prev = c;
    }
  }
  return withTessellation(ents);
}

function parseNC(text) {
  const lines = text.split(/\r\n|\r|\n/).map(l => l.trim()).filter(Boolean);
  let cur = { x: 0, y: 0 }, i = 0;
  const blocks = [];
  const tag = (l, t) => new RegExp('^' + t, 'i').test(l);
  function parseMove(line) {
    let m;
    if ((m = line.match(/^G0?1X(-?[\d.]+)Y(-?[\d.]+)/i))) return { cmd: 'G01', x: cur.x + parseFloat(m[1]), y: cur.y + parseFloat(m[2]) };
    if ((m = line.match(/^G0?([23])X(-?[\d.]+)Y(-?[\d.]+)(?:I(-?[\d.]+))?(?:J(-?[\d.]+))?/i))) {
      const ccw = m[1] === '3', dx = parseFloat(m[2]), dy = parseFloat(m[3]);
      const ii = m[4] !== undefined ? parseFloat(m[4]) : 0, jj = m[5] !== undefined ? parseFloat(m[5]) : 0;
      return { cmd: ccw ? 'G03' : 'G02', x: cur.x + dx, y: cur.y + dy, cx: cur.x + ii, cy: cur.y + jj };
    }
    return null;
  }
  // read moves until the line that starts with endTag
  const readMoves = endTag => {
    const cmds = [];
    while (i < lines.length && !tag(lines[i], endTag)) {
      const c = parseMove(lines[i]);
      if (c) { cmds.push(c); cur = { x: c.x, y: c.y }; }
      i++;
    }
    return cmds;
  };
  while (i < lines.length) {
    const L = lines[i];
    if (!tag(L, 'G0?0')) { i++; continue; }
    const m = L.match(/X(-?[\d.]+)Y(-?[\d.]+)/);
    cur = { x: cur.x + (m ? parseFloat(m[1]) : 0), y: cur.y + (m ? parseFloat(m[2]) : 0) };
    const rapid = { x: cur.x, y: cur.y };
    i++;
    if (i < lines.length && tag(lines[i], 'M11')) {
      // etch / mark block: M11 M09 ... M10 M12
      i++;
      if (i < lines.length && tag(lines[i], 'M09')) i++;
      const cmds = readMoves('M10');
      if (i < lines.length && tag(lines[i], 'M10')) i++;
      if (i < lines.length && tag(lines[i], 'M12')) i++;
      blocks.push({ kind: 'mark', rapid, cmds });
    } else if (i < lines.length && (tag(lines[i], 'G41') || tag(lines[i], 'M07'))) {
      // cut block: G41 M07 ... M08 G40
      if (tag(lines[i], 'G41')) i++;
      if (i < lines.length && tag(lines[i], 'M07')) i++;
      const cmds = readMoves('M08');
      if (i < lines.length && tag(lines[i], 'M08')) i++;
      if (i < lines.length && tag(lines[i], 'G40')) i++;
      blocks.push({ kind: 'cut', rapid, cmds });
    }
  }
  const raw = ncBlocksToEntities(blocks);
  return raw.length ? { raw, ncBlocks: blocks } : null;
}

// ---- one file → one part ----
// cleanOpts: {clean, bend, etch, feat} (see P3). pdfMats: drawings already read (P4), used to set the gauge.
// Returns {part} or {error}. The part gets id/qty from the caller.
async function loadPartFile(file, cleanOpts, pdfMats) {
  const lower = file.name.toLowerCase(), isNC = lower.endsWith('.nc');
  if (!lower.endsWith('.dxf') && !isNC) return { error: `${file.name}: not a .dxf, .nc or .pdf — skipped`, kind: 'warn' };
  const name = file.name.replace(/\.(dxf|nc)$/i, '');
  let parsed;
  try {
    const text = await file.text();
    parsed = isNC ? parseNC(text) : parseDXF(text);
  } catch (e) {
    parsed = null;
  }
  if (!parsed) return { error: `${file.name}: no drawable geometry found`, kind: 'bad' };
  const part = { name, qty: 1, raw: parsed.raw, thick: '', src: isNC ? 'nc' : 'dxf' };
  if (parsed.ncBlocks) part._ncBlocks = parsed.ncBlocks;
  const m = (pdfMats || []).find(pm => pdfMatchesPart(pm, name));
  if (m) { part.thick = m.material; part._thickRaw = m.raw; part._fromPdf = true; }
  cleanPart(part, cleanOpts);
  return { part };
}
