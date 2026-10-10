/* =====================================================================================================
   P1 · GEOMETRY — turn DXF curves into point lists ("tessellation")
   Input : one entity {type:'LINE'|'ARC'|'CIRCLE'|'POLY'|'SPLINE'|'ELLIPSE', ...}
   Output: [{pts:[[x,y],...], closed}]  — used for drawing, nesting and size boxes.
   No screen access in P1–P7, so these blocks can be moved into a Web Worker or tested on their own.
   ===================================================================================================== */

// How many straight segments an arc of radius r and sweep sw (radians) needs to stay within chordTol.
function arcSegments(r, sw) {
  const T = CONFIG.tessellate;
  const step = 2 * Math.acos(Math.max(0, Math.min(1, 1 - T.chordTol / Math.max(r, T.minRadius))));
  return Math.min(T.maxSegments, Math.max(2, Math.ceil(Math.abs(sw) / step)));
}

// Points along an arc: centre (cx,cy), radius r, start angle a0, sweep sw (radians, + = counter-clockwise).
function arcPts(cx, cy, r, a0, sw) {
  const n = arcSegments(r, sw), out = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sw * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

// Polyline segment p→q with a DXF "bulge" b (0 = straight, ±1 = half circle).
function bulgePts(p, q, b) {
  const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
  if (!b || d < 1e-9) return [[p.x, p.y], [q.x, q.y]];
  const th = 4 * Math.atan(b), h = d / 2 / Math.tan(th / 2);
  const mx = (p.x + q.x) / 2 - (dy / d) * h, my = (p.y + q.y) / 2 + (dx / d) * h;
  return arcPts(mx, my, Math.hypot(p.x - mx, p.y - my), Math.atan2(p.y - my, p.x - mx), th);
}

// B-spline of degree deg with knot vector kn and control points ctrl, sampled at samples+1 points (de Boor).
function bspline(deg, kn, ctrl, samples) {
  const n = ctrl.length - 1, t0 = kn[deg], t1 = kn[n + 1], pts = [];
  for (let s = 0; s <= samples; s++) {
    const t = t0 + ((t1 - t0) * s) / samples - (s === samples ? 1e-9 : 0);
    let k = deg;
    while (k < n && t >= kn[k + 1]) k++;
    const d = [];
    for (let j = 0; j <= deg; j++) d.push({ x: ctrl[j + k - deg][0], y: ctrl[j + k - deg][1] });
    for (let r = 1; r <= deg; r++)
      for (let j = deg; j >= r; j--) {
        const den = kn[j + 1 + k - r] - kn[j + k - deg], a = den ? (t - kn[j + k - deg]) / den : 0;
        d[j] = { x: (1 - a) * d[j - 1].x + a * d[j].x, y: (1 - a) * d[j - 1].y + a * d[j].y };
      }
    pts.push([d[deg].x, d[deg].y]);
  }
  return pts;
}

// One entity → list of point chains.
function tessellate(e) {
  if (e.type === 'LINE') return [{ pts: [[e.x1, e.y1], [e.x2, e.y2]], closed: false }];
  if (e.type === 'CIRCLE') return [{ pts: arcPts(e.x, e.y, e.r, 0, 2 * Math.PI).slice(0, -1), closed: true }];
  if (e.type === 'ARC') {
    let sw = (((e.a2 - e.a1) % 360) + 360) % 360;
    if (sw === 0) sw = 360;
    if (e.ccw === false) sw -= 360;
    return [{ pts: arcPts(e.x, e.y, e.r, (e.a1 * Math.PI) / 180, (sw * Math.PI) / 180), closed: false }];
  }
  if (e.type === 'POLY') {
    const n = e.pts.length;
    if (n < 2) return [];
    const out = [], m = e.closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const s = bulgePts(e.pts[i], e.pts[(i + 1) % n], e.pts[i].b);
      for (let j = i ? 1 : 0; j < s.length; j++) out.push(s[j]);
    }
    if (e.closed && out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
    return [{ pts: out, closed: e.closed }];
  }
  if (e.type === 'SPLINE') {
    const c = e.ctrl, d = e.deg, S = CONFIG.tessellate.splineSamples;
    let pts;
    if (c.length > d && d > 0 && e.knots.length === c.length + d + 1) pts = bspline(d, e.knots, c, Math.min(S.max, Math.max(S.min, c.length * S.perCtrl)));
    else pts = e.fit.length > 1 ? e.fit : c;
    return pts.length > 1 ? [{ pts, closed: false }] : [];
  }
  if (e.type === 'ELLIPSE') {
    let sw = e.t1 - e.t0;
    if (sw <= 0) sw += 2 * Math.PI;
    const n = arcSegments(Math.hypot(e.mx, e.my), sw), pts = [];
    for (let i = 0; i <= n; i++) {
      const t = e.t0 + (sw * i) / n, cs = Math.cos(t), sn = Math.sin(t);
      pts.push([e.x + cs * e.mx - sn * e.ratio * e.my, e.y + cs * e.my + sn * e.ratio * e.mx]);
    }
    return [{ pts, closed: false }];
  }
  return [];
}

// Bounding box of one tessellated entity.
function entBox(e) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pl of e._t)
    for (const [x, y] of pl.pts) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  return { x0, y0, x1, y1 };
}

// Bounding box of a list of entities → {minX, minY, maxX, maxY}.
function bboxOf(ents) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of ents) {
    const b = entBox(e);
    minX = Math.min(minX, b.x0);
    minY = Math.min(minY, b.y0);
    maxX = Math.max(maxX, b.x1);
    maxY = Math.max(maxY, b.y1);
  }
  return { minX, minY, maxX, maxY };
}

// Tessellate every entity and keep the ones that produced points.
function withTessellation(ents) {
  const out = [];
  for (const e of ents) {
    e._t = tessellate(e);
    if (e._t.length) out.push(e);
  }
  return out;
}
