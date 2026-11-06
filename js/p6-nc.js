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
  all.forEach(l => (l.area = Math.abs(polyArea(segsPolyline(l.segs))))); // arcs counted (a full circle is not area 0)
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

// ---- lead-in / end gap / lead-out on the outer perimeter ----
// Arc sweep (radians, > 0) from p to q around c in the given direction; p == q is a full circle.
function arcSweep(p, q, c, ccw) {
  const a0 = Math.atan2(p.y - c.cy, p.x - c.cx), a1 = Math.atan2(q.y - c.cy, q.x - c.cx);
  let sw = ccw ? a1 - a0 : a0 - a1;
  if (sw <= 1e-9) sw += 2 * Math.PI;
  return sw;
}
// pts ([{x,y,arc}], pts[0] = start) → segments [{p0, p1, arc, len}]
function ptsToSegs(pts) {
  const out = [];
  for (let i = 1; i < pts.length; i++) {
    const p0 = { x: pts[i - 1].x, y: pts[i - 1].y }, p1 = { x: pts[i].x, y: pts[i].y }, arc = pts[i].arc;
    const len = arc ? Math.hypot(p0.x - arc.cx, p0.y - arc.cy) * arcSweep(p0, p1, arc, arc.ccw) : Math.hypot(p1.x - p0.x, p1.y - p0.y);
    out.push({ p0, p1, arc, len });
  }
  return out;
}
const segsToPts = segs => [{ x: segs[0].p0.x, y: segs[0].p0.y, arc: null }].concat(segs.map(s => ({ x: s.p1.x, y: s.p1.y, arc: s.arc })));
// Points along a segment list, arcs broken into short chords (for area and inside tests).
function segsPolyline(segs) {
  const out = [[segs[0].p0.x, segs[0].p0.y]];
  for (const s of segs) {
    if (s.arc) {
      const r = Math.hypot(s.p0.x - s.arc.cx, s.p0.y - s.arc.cy), sw = arcSweep(s.p0, s.p1, s.arc, s.arc.ccw);
      const a0 = Math.atan2(s.p0.y - s.arc.cy, s.p0.x - s.arc.cx), n = Math.max(4, Math.ceil(sw / (Math.PI / 18)));
      for (let k = 1; k <= n; k++) { const a = a0 + (s.arc.ccw ? 1 : -1) * (sw * k) / n; out.push([s.arc.cx + r * Math.cos(a), s.arc.cy + r * Math.sin(a)]); }
    } else out.push([s.p1.x, s.p1.y]);
  }
  return out;
}
function polyArea(pl) { let a = 0; for (let i = 0; i < pl.length; i++) { const p = pl[i], q = pl[(i + 1) % pl.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function pointInPoly(x, y, pl) {
  let inside = false;
  for (let i = 0, j = pl.length - 1; i < pl.length; j = i++) {
    const [xi, yi] = pl[i], [xj, yj] = pl[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Unit tangent (direction of travel) of a segment at its start (at = 0) or its end (at = 1).
function segTangent(s, at) {
  if (!s.arc) { const dx = s.p1.x - s.p0.x, dy = s.p1.y - s.p0.y, d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; }
  const p = at ? s.p1 : s.p0, rx = p.x - s.arc.cx, ry = p.y - s.arc.cy, r = Math.hypot(rx, ry) || 1;
  return s.arc.ccw ? { x: -ry / r, y: rx / r } : { x: ry / r, y: -rx / r };
}
// Outer perimeter(s) of a part: closed loops that sit inside no other closed loop. → Set of loops
function outerLoops(loops) {
  const closed = loops.filter(l => l.closed && l.segs.length);
  const polys = closed.map(l => segsPolyline(l.segs));
  const outer = new Set();
  closed.forEach((l, i) => {
    const [x, y] = polys[i][0];
    if (!closed.some((m, j) => j !== i && m.area > l.area && pointInPoly(x, y, polys[j]))) outer.add(l);
  });
  return outer;
}
// One outer contour (sheet coordinates) → {pts, leadOut}: starts on the middle of its longest straight edge (else
// where it was), the pierce point lead.length mm away on the scrap side at lead.angle° to the contour (90 = square),
// the cut stops lead.endGap mm short of the start, then an optional straight lead-out of lead.leadOut mm.
function applyLead(pts, lead) {
  let segs = ptsToSegs(pts);
  if (!segs.length) return { pts, leadOut: null };
  const perim = segs.reduce((a, s) => a + s.len, 0);
  // start on the middle of the longest straight edge
  let bi = -1;
  segs.forEach((s, i) => { if (!s.arc && (bi < 0 || s.len > segs[bi].len)) bi = i; });
  if (bi >= 0 && segs[bi].len > 2 * Math.max(lead.endGap, 0.01)) {
    const s = segs[bi], m = { x: (s.p0.x + s.p1.x) / 2, y: (s.p0.y + s.p1.y) / 2 };
    const a = { p0: s.p0, p1: m, arc: null, len: s.len / 2 }, b = { p0: m, p1: s.p1, arc: null, len: s.len / 2 };
    segs = [b].concat(segs.slice(bi + 1), segs.slice(0, bi), [a]);
  }
  const ccwLoop = polyArea(segsPolyline(segs)) > 0;
  const outN = t => (ccwLoop ? { x: t.y, y: -t.x } : { x: -t.y, y: t.x }); // scrap side of the travel direction
  // end gap: take lead.endGap mm off the end of the path (never more than half the perimeter)
  let gap = Math.min(Math.max(lead.endGap || 0, 0), perim / 2);
  while (gap > 1e-9 && segs.length > 1) {
    const s = segs[segs.length - 1];
    if (s.len <= gap + 1e-9) { segs.pop(); gap -= s.len; continue; }
    const f = (s.len - gap) / s.len;
    if (s.arc) {
      const r = Math.hypot(s.p0.x - s.arc.cx, s.p0.y - s.arc.cy), a0 = Math.atan2(s.p0.y - s.arc.cy, s.p0.x - s.arc.cx);
      const a = a0 + (s.arc.ccw ? 1 : -1) * arcSweep(s.p0, s.p1, s.arc, s.arc.ccw) * f;
      segs[segs.length - 1] = { p0: s.p0, p1: { x: s.arc.cx + r * Math.cos(a), y: s.arc.cy + r * Math.sin(a) }, arc: s.arc, len: s.len - gap };
    } else segs[segs.length - 1] = { p0: s.p0, p1: { x: s.p0.x + (s.p1.x - s.p0.x) * f, y: s.p0.y + (s.p1.y - s.p0.y) * f }, arc: null, len: s.len - gap };
    gap = 0;
  }
  if (segs.length === 1 && segs[0].arc && gap > 1e-9) {
    // a full circle: shorten its single arc
    const s = segs[0], r = Math.hypot(s.p0.x - s.arc.cx, s.p0.y - s.arc.cy), a0 = Math.atan2(s.p0.y - s.arc.cy, s.p0.x - s.arc.cx);
    const a = a0 + (s.arc.ccw ? 1 : -1) * (s.len - gap) / r;
    segs[0] = { p0: s.p0, p1: { x: s.arc.cx + r * Math.cos(a), y: s.arc.cy + r * Math.sin(a) }, arc: s.arc, len: s.len - gap };
  }
  const out = segsToPts(segs);
  // lead-in: pierce off the contour, then a straight line onto the start point
  const L = Math.max(lead.length || 0, 0);
  if (L > 1e-9) {
    const t = segTangent(segs[0], 0), n = outN(t), ang = ((lead.angle == null ? 90 : lead.angle) * Math.PI) / 180;
    const p = { x: segs[0].p0.x + L * (Math.sin(ang) * n.x - Math.cos(ang) * t.x), y: segs[0].p0.y + L * (Math.sin(ang) * n.y - Math.cos(ang) * t.y) };
    out.unshift({ x: p.x, y: p.y, arc: null });
  }
  // lead-out: straight off the end, square to the contour, onto the scrap side
  let leadOut = null;
  const LO = Math.max(lead.leadOut || 0, 0);
  if (LO > 1e-9) {
    const last = segs[segs.length - 1], n = outN(segTangent(last, 1));
    leadOut = { x: last.p1.x + LO * n.x, y: last.p1.y + LO * n.y };
  }
  return { pts: out, leadOut };
}

// ---- one sheet → G-code ----
// opts.lead = {length, angle, endGap, leadOut} (mm, degrees) puts a lead-in / end gap / lead-out on each part's
// outer perimeter (DXF to NC); without it every contour is cut start-to-start as before.
function makeSheetNc(sheet, opts) {
  const lead = opts && opts.lead;
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
  const emitLoop = (pts, comp, closed, onCodes, offCodes, leadOut) => {
    if (!pts.length) return;
    if (!closed) openCount++;
    pierces++;
    rapid(pts[0].x, pts[0].y);
    if (comp) L.push(C.compOn);
    onCodes.forEach(c => L.push(c));
    for (let i = 1; i < pts.length; i++) { const s = pts[i]; s.arc ? arcTo(s.x, s.y, s.arc.cx, s.arc.cy, s.arc.ccw) : lineTo(s.x, s.y); }
    if (leadOut) lineTo(leadOut.x, leadOut.y);
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
    const loops = buildLoops(p), outer = lead ? outerLoops(loops) : null;
    for (const loop of loops) {
      if (outer && outer.has(loop)) {
        const r = applyLead(loopPts(loop, T), lead);
        emitLoop(r.pts, true, true, C.cutOn, C.cutOff, r.leadOut);
      } else emitLoop(loopPts(loop, T), true, loop.closed, C.cutOn, C.cutOff);
    }
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
