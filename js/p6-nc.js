/* =====================================================================================================
   P6 · NC OUTPUT — one Bodor .nc program per sheet
   makeSheetNc(sheet) → {text, openCount, pierces, cutLen}
     G92 zero / G21 metric / G91 incremental; one pierce (G41 + M07 … M08 + G40) per closed contour,
     holes before the outer profile, etching as M11/M09 … M10/M12, M02 at the end. Codes are in CONFIG.nc.
   ncFileName(job, gauge, sheetIndex) → "JOB_14ga_Satincoat_sheet1.nc"
   makeJobZip(files)                  → Blob of a .zip ({name, text} each)
   ===================================================================================================== */

// ---- contours: entities → closed loops of line / arc segments ----
function bulgeArc(p, q, b) {
  const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
  const th = 4 * Math.atan(b), h = d / 2 / Math.tan(th / 2);
  return { cx: (p.x + q.x) / 2 - (dy / d) * h, cy: (p.y + q.y) / 2 + (dx / d) * h, ccw: b > 0 };
}
function reverseSeg(s) {
  return s.arc ? { p0: s.p1, p1: s.p0, arc: { cx: s.arc.cx, cy: s.arc.cy, ccw: !s.arc.ccw } } : { p0: s.p1, p1: s.p0, arc: null };
}
// Chain loose segments end-to-end into loops (ends within tol join).
function stitchSegs(segs, tol) {
  const buckets = {}, key = (x, y) => Math.round(x / tol) + '_' + Math.round(y / tol);
  const add = (x, y, ref) => { const k = key(x, y); (buckets[k] = buckets[k] || []).push(ref); };
  segs.forEach((s, i) => { add(s.p0.x, s.p0.y, { i, end: 0 }); add(s.p1.x, s.p1.y, { i, end: 1 }); });
  const used = new Uint8Array(segs.length);
  function findMatch(x, y) {
    const cx = Math.round(x / tol), cy = Math.round(y / tol);
    let best = null, bd = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const arr = buckets[cx + dx + '_' + (cy + dy)];
        if (!arr) continue;
        for (const ref of arr) {
          if (used[ref.i]) continue;
          const s = segs[ref.i], pt = ref.end === 0 ? s.p0 : s.p1, d = Math.hypot(pt.x - x, pt.y - y);
          if (d <= tol && d < bd) { bd = d; best = ref; }
        }
      }
    return best;
  }
  const loops = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const chain = [segs[i]], startPt = segs[i].p0;
    let cur = segs[i].p1;
    while (true) {
      const m = findMatch(cur.x, cur.y);
      if (!m) break;
      let s = segs[m.i];
      if (m.end === 1) s = reverseSeg(s);
      used[m.i] = 1;
      chain.push(s);
      cur = s.p1;
      if (Math.hypot(cur.x - startPt.x, cur.y - startPt.y) <= tol) break;
    }
    loops.push({ segs: chain, closed: Math.hypot(cur.x - startPt.x, cur.y - startPt.y) <= tol });
  }
  return loops;
}
function loopSignedArea(segs) { let a = 0; for (const s of segs) a += s.p0.x * s.p1.y - s.p1.x * s.p0.y; return a / 2; }

// Entities → loops sorted smallest first (holes before the outer profile).
function entitiesToLoops(entities) {
  const segs = [], loops = [];
  const addSeg = (p0, p1, arc) => { if (!arc && Math.hypot(p1.x - p0.x, p1.y - p0.y) < 1e-6) return; segs.push({ p0, p1, arc }); };
  for (const e of entities) {
    if (e.type === 'LINE') addSeg({ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }, null);
    else if (e.type === 'ARC') {
      const a1 = (e.a1 * Math.PI) / 180, a2 = (e.a2 * Math.PI) / 180;
      addSeg({ x: e.x + e.r * Math.cos(a1), y: e.y + e.r * Math.sin(a1) }, { x: e.x + e.r * Math.cos(a2), y: e.y + e.r * Math.sin(a2) }, { cx: e.x, cy: e.y, ccw: e.ccw !== false });
    } else if (e.type === 'CIRCLE') {
      loops.push({ segs: [{ p0: { x: e.x + e.r, y: e.y }, p1: { x: e.x + e.r, y: e.y }, arc: { cx: e.x, cy: e.y, ccw: true } }], closed: true });
    } else if (e.type === 'POLY') {
      const n = e.pts.length;
      if (n < 2) continue;
      const m = e.closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const a = e.pts[i], b = e.pts[(i + 1) % n];
        if (!a.b) addSeg({ x: a.x, y: a.y }, { x: b.x, y: b.y }, null);
        else { const arc = bulgeArc(a, b, a.b); addSeg({ x: a.x, y: a.y }, { x: b.x, y: b.y }, { cx: arc.cx, cy: arc.cy, ccw: arc.ccw }); }
      }
    } else
      for (const pl of e._t) {
        // splines / ellipses: cut as the tessellated polyline
        if (pl.pts.length < 2) continue;
        const n = pl.pts.length, chain = [];
        for (let i = 0; i + 1 < n; i++) chain.push({ p0: { x: pl.pts[i][0], y: pl.pts[i][1] }, p1: { x: pl.pts[i + 1][0], y: pl.pts[i + 1][1] }, arc: null });
        if (pl.closed) chain.push({ p0: { x: pl.pts[n - 1][0], y: pl.pts[n - 1][1] }, p1: { x: pl.pts[0][0], y: pl.pts[0][1] }, arc: null });
        loops.push({ segs: chain, closed: pl.closed });
      }
  }
  const all = loops.concat(stitchSegs(segs, CONFIG.nc.stitchTol));
  all.forEach(l => (l.area = Math.abs(loopSignedArea(l.segs))));
  all.sort((a, b) => a.area - b.area); // holes first, outer profile last
  return all;
}
function buildLoops(part) { return part._loops || (part._loops = entitiesToLoops(part.entities)); }
function buildEtchLoops(part) {
  if (part._etchLoops) return part._etchLoops;
  return (part._etchLoops = part.etchEntities && part.etchEntities.length ? entitiesToLoops(part.etchEntities) : []);
}

// Incremental value with up to CONFIG.nc.decimals places, always with a decimal point ("12.5", "3.0").
function fmtInc(v) {
  const f = Math.pow(10, CONFIG.nc.decimals);
  let r = Math.round(v * f) / f;
  if (Object.is(r, -0)) r = 0;
  const s = r.toString();
  return s.includes('.') ? s : s + '.0';
}

// ---- one sheet → G-code ----
function makeSheetNc(sheet) {
  const C = CONFIG.nc, L = [];
  let cur = [0, 0], openCount = 0, pierces = 0, cutLen = 0;
  const rapid = (x, y) => { L.push(`G00X${fmtInc(x - cur[0])}Y${fmtInc(y - cur[1])}`); cur = [x, y]; };
  const lineTo = (x, y) => { cutLen += Math.hypot(x - cur[0], y - cur[1]); L.push(`G01X${fmtInc(x - cur[0])}Y${fmtInc(y - cur[1])}`); cur = [x, y]; };
  const arcTo = (x, y, cx, cy, ccw) => {
    const i = cx - cur[0], j = cy - cur[1];
    let t = '';
    if (Math.abs(i) > 1e-6) t += 'I' + fmtInc(i);
    if (Math.abs(j) > 1e-6) t += 'J' + fmtInc(j);
    const r = Math.hypot(i, j), a0 = Math.atan2(-j, -i), a1 = Math.atan2(y - cy, x - cx);
    let sw = ccw ? a1 - a0 : a0 - a1;
    if (sw <= 1e-9) sw += 2 * Math.PI;
    cutLen += r * sw;
    L.push(`${ccw ? 'G03' : 'G02'}X${fmtInc(x - cur[0])}Y${fmtInc(y - cur[1])}${t}`);
    cur = [x, y];
  };
  // one contour: rapid to its start, switch on, follow it, switch off
  const emitLoop = (pts, comp, closed, onCodes, offCodes) => {
    if (!pts.length) return;
    if (!closed) openCount++;
    pierces++;
    rapid(pts[0].x, pts[0].y);
    if (comp) L.push(C.compOn);
    onCodes.forEach(c => L.push(c));
    for (let i = 1; i < pts.length; i++) { const s = pts[i]; s.arc ? arcTo(s.x, s.y, s.arc.cx, s.arc.cy, s.arc.ccw) : lineTo(s.x, s.y); }
    offCodes.forEach(c => L.push(c));
    if (comp) L.push(C.compOff);
  };
  const loopPts = (loop, T) => {
    const first = T(loop.segs[0].p0.x, loop.segs[0].p0.y), pts = [{ x: first[0], y: first[1], arc: null }];
    for (const s of loop.segs) {
      const end = T(s.p1.x, s.p1.y);
      if (s.arc) { const cc = T(s.arc.cx, s.arc.cy); pts.push({ x: end[0], y: end[1], arc: { cx: cc[0], cy: cc[1], ccw: s.arc.ccw } }); }
      else pts.push({ x: end[0], y: end[1], arc: null });
    }
    return pts;
  };

  C.header.forEach(l => L.push(l));
  for (const it of sheet.items) {
    const p = it.p, R = it.R, rad = (it.rot * Math.PI) / 180, co = Math.cos(rad), si = Math.sin(rad);
    const T = (x, y) => { const lx = x - p.minX, ly = y - p.minY; return [lx * co - ly * si - R.minx + it.x, lx * si + ly * co - R.miny + it.y]; }; // part → sheet
    if (p._ncBlocks) {
      // a part loaded from .nc: replay its own blocks
      for (const blk of p._ncBlocks) {
        const first = T(blk.rapid.x, blk.rapid.y), pts = [{ x: first[0], y: first[1], arc: null }];
        for (const c of blk.cmds) {
          const e = T(c.x, c.y);
          if (c.cmd === 'G01') pts.push({ x: e[0], y: e[1], arc: null });
          else { const cc = T(c.cx, c.cy); pts.push({ x: e[0], y: e[1], arc: { cx: cc[0], cy: cc[1], ccw: c.cmd === 'G03' } }); }
        }
        if (blk.kind === 'mark') emitLoop(pts, false, true, C.markOn, C.markOff);
        else emitLoop(pts, true, true, C.cutOn, C.cutOff);
      }
      continue;
    }
    for (const loop of buildEtchLoops(p)) emitLoop(loopPts(loop, T), false, true, C.markOn, C.markOff);
    for (const loop of buildLoops(p)) emitLoop(loopPts(loop, T), true, loop.closed, C.cutOn, C.cutOff);
  }
  // skeleton: a straight strip cut, open by design (not a fault). Section lines are only drawn, never cut.
  for (const cut of (sheet.skeleton || []).filter(c => !c.section)) emitLoop([{ x: cut.x0, y: cut.y, arc: null }, { x: cut.x1, y: cut.y, arc: null }], false, true, C.cutOn, C.cutOff);
  C.footer.forEach(l => L.push(l));
  return { text: L.join(C.lineEnd) + C.lineEnd, openCount, pierces, cutLen };
}

// ---- file names ----
const jobSlug = job => { const v = (job || '').trim(); return v ? v.replace(/[^a-z0-9_-]+/gi, '_') : 'job'; };
const gaugeSlug = g => (g ? '_' + g.trim().replace(/(\d)\s*\/\s*(\d)/g, '$1-$2').replace(/"/g, 'in').replace(/\s+/g, '_').replace(/[^a-z0-9_.-]+/gi, '') : '_nogauge');
const ncFileName = (job, gauge, si) => `${jobSlug(job)}${gaugeSlug(gauge)}_sheet${si + 1}.nc`;

// Every sheet of a nest → [{name, text, openCount, pierces, gi, si}]
function makeJobNcFiles(groups, job) {
  const out = [];
  groups.forEach((g, gi) => g.r.sheets.forEach((sh, si) => { const nc = makeSheetNc(sh); out.push({ name: ncFileName(job, g.gauge, si), gi, si, ...nc }); }));
  return out;
}

// files: [{name, text}] → zip Blob (needs JSZip, loaded from the internet)
async function makeJobZip(files) {
  const zip = new JSZip();
  files.forEach(f => zip.file(f.name, f.text));
  return zip.generateAsync({ type: 'blob' });
}
