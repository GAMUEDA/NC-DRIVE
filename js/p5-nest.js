/* =====================================================================================================
   P5 · NESTING — true-shape, raster, bottom-left fill
   nestJob(parts, settings, onProgress) → {groups:[{gauge, r, req}], ms}   one nest per gauge (the Nest button)
   groupByGauge(parts)                  → [{gauge, list}]                   parts with qty > 0, by gauge
   nestGroup(list, mat, gap, margin, opts) → {sheets, skipped:Map(part→count), bed, grid}
   Each part is rasterised at cell size c (gap/3, 1.5–6 mm); holes stay open so small parts can sit inside them,
   and the outline is grown by the gap. Placement and overlap tests are bit operations on packed rows.
   Largest parts go first; each goes to the lowest-then-leftmost spot on the first sheet it fits, trying 0°/180° first
   and a quarter-turn only when it lands clearly lower. Parts are never mirrored.
   ===================================================================================================== */

// One part at one angle → bitmap (solid = part incl. hole-free areas, dil = part grown by the gap) + outline for drawing.
function rasterizePart(p, ang, c, k) {
  const rad = (ang * Math.PI) / 180, co = Math.cos(rad), si = Math.sin(rad), polys = [];
  let mx = Infinity, my = Infinity, Mx = -Infinity, My = -Infinity;
  for (const e of p.entities)
    for (const pl of e._t) {
      const pts = pl.pts.map(([x, y]) => {
        const lx = x - p.minX, ly = y - p.minY, X = lx * co - ly * si, Y = lx * si + ly * co;
        if (X < mx) mx = X; if (Y < my) my = Y; if (X > Mx) Mx = X; if (Y > My) My = Y;
        return [X, Y];
      });
      polys.push({ pts, closed: pl.closed });
    }
  const w = Mx - mx, h = My - my, P = k + 1, bw = Math.floor(w / c) + 1, bh = Math.floor(h / c) + 1, gw = bw + 2 * P, gh = bh + 2 * P, N = gw * gh;

  // 1. draw every outline into the grid
  const st = new Uint8Array(N);
  const mark = (X, Y) => { st[(P + Math.floor((Y - my) / c)) * gw + P + Math.floor((X - mx) / c)] = 1; };
  for (const pl of polys) {
    const pts = pl.closed ? pl.pts.concat([pl.pts[0]]) : pl.pts;
    if (pts.length === 1) mark(pts[0][0], pts[0][1]);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (c / 4)));
      for (let s = 0; s <= n; s++) mark(a[0] + ((b[0] - a[0]) * s) / n, a[1] + ((b[1] - a[1]) * s) / n);
    }
  }
  // 2. label the empty regions (flood fill)
  const lab = new Int32Array(N).fill(-1), stack = [];
  let nl = 0;
  for (let s = 0; s < N; s++) {
    if (st[s] || lab[s] >= 0) continue;
    lab[s] = nl;
    stack.push(s);
    while (stack.length) {
      const q = stack.pop(), x = q % gw;
      if (x > 0 && !st[q - 1] && lab[q - 1] < 0) { lab[q - 1] = nl; stack.push(q - 1); }
      if (x < gw - 1 && !st[q + 1] && lab[q + 1] < 0) { lab[q + 1] = nl; stack.push(q + 1); }
      if (q >= gw && !st[q - gw] && lab[q - gw] < 0) { lab[q - gw] = nl; stack.push(q - gw); }
      if (q < N - gw && !st[q + gw] && lab[q + gw] < 0) { lab[q + gw] = nl; stack.push(q + gw); }
    }
    nl++;
  }
  // 3. regions at odd depth from the outside are material, even depth are holes
  const adj = Array.from({ length: nl }, () => new Set());
  for (let q = 0; q < N; q++) {
    if (!st[q]) continue;
    const x = q % gw, ls = [];
    if (x > 0 && lab[q - 1] >= 0) ls.push(lab[q - 1]);
    if (x < gw - 1 && lab[q + 1] >= 0) ls.push(lab[q + 1]);
    if (q >= gw && lab[q - gw] >= 0) ls.push(lab[q - gw]);
    if (q < N - gw && lab[q + gw] >= 0) ls.push(lab[q + gw]);
    for (let a = 0; a < ls.length; a++) for (let b = a + 1; b < ls.length; b++) if (ls[a] !== ls[b]) { adj[ls[a]].add(ls[b]); adj[ls[b]].add(ls[a]); }
  }
  const depth = new Int32Array(nl).fill(-1), qu = [0];
  depth[0] = 0;
  for (let h2 = 0; h2 < qu.length; h2++) { const u = qu[h2]; for (const v of adj[u]) if (depth[v] < 0) { depth[v] = depth[u] + 1; qu.push(v); } }
  const solid = new Uint8Array(N);
  let area = 0;
  for (let q = 0; q < N; q++) if (st[q] || (lab[q] >= 0 && depth[lab[q]] > 0 && depth[lab[q]] % 2 === 1)) { solid[q] = 1; area++; }
  // 4. grow the edge by k cells (the gap)
  const dil = solid.slice(), offs = [];
  for (let dy = -k; dy <= k; dy++)
    for (let dx = -k; dx <= k; dx++) {
      const ax = Math.max(Math.abs(dx) - 1, 0), ay = Math.max(Math.abs(dy) - 1, 0);
      if (ax * ax + ay * ay < k * k) offs.push(dy * gw + dx);
    }
  for (let q = 0; q < N; q++) {
    if (!solid[q]) continue;
    const x = q % gw;
    if ((x > 0 && !solid[q - 1]) || (x < gw - 1 && !solid[q + 1]) || (q >= gw && !solid[q - gw]) || (q < N - gw && !solid[q + gw])) for (const o of offs) dil[q + o] = 1;
  }
  // 5. pack rows into 32-bit words
  const pw = Math.ceil(gw / 32);
  const pack = arr => {
    const b = new Uint32Array(gh * pw);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (arr[y * gw + x]) b[y * pw + (x >> 5)] |= 1 << (x & 31);
    return b;
  };
  return { ang, minx: mx, miny: my, w, h, bw, bh, gw, gh, pw, P, solid: pack(solid), dil: pack(dil), area, polys };
}

// Empty sheet bitmap Wc × Hc cells with the margin (mc cells) already filled.
function newSheet(Wc, Hc, P, mc) {
  const Ha = Hc + 2 * P, sw = Math.ceil((Wc + 2 * P) / 32) + 2, bits = new Uint32Array(Ha * sw);
  const set = (x, y) => { bits[(y + P) * sw + ((x + P) >> 5)] |= 1 << ((x + P) & 31); };
  for (let y = 0; y < Hc; y++) for (let x = 0; x < Wc; x++) if (x < mc || x >= Wc - mc || y < mc || y >= Hc - mc) set(x, y);
  return { Wc, Hc, P, sw, bits, items: [] };
}

// Does part bitmap R at cell (ax, ay) overlap anything already on sheet S?
function collides(S, R, ax, ay) {
  const sw = S.sw, b = S.bits, pr = R.solid, pw = R.pw, s = ax & 31, wb = ax >> 5;
  for (let r = R.P; r < R.P + R.bh; r++) {
    const so = (ay + r) * sw + wb, po = r * pw;
    for (let k = 0; k <= pw; k++) {
      let v = k < pw ? pr[po + k] << s : 0;
      if (s && k > 0) v |= pr[po + k - 1] >>> (32 - s);
      if (v && b[so + k] & v) return true;
    }
  }
  return false;
}

// Mark part R (grown by the gap) as used on sheet S at cell (ax, ay).
function stampPart(S, R, ax, ay) {
  const sw = S.sw, b = S.bits, pr = R.dil, pw = R.pw, s = ax & 31, wb = ax >> 5;
  for (let r = 0; r < R.gh; r++) {
    const so = (ay + r) * sw + wb, po = r * pw;
    for (let k = 0; k <= pw; k++) {
      let v = k < pw ? pr[po + k] << s : 0;
      if (s && k > 0) v |= pr[po + k - 1] >>> (32 - s);
      if (v) b[so + k] |= v;
    }
  }
}

// Lowest (then leftmost) free spot for R on S, slid down/left as far as it goes. → {x, y} in cells, or null.
function findPos(S, R, step, band) {
  const maxX = S.Wc - R.bw, maxY = S.Hc - R.bh;
  if (maxX < 0 || maxY < 0) return null;
  const lbMap = S._lb || (S._lb = new Map()), lb = lbMap.get(R) || 0;
  // Free space only shrinks, so every row below where a column's last search stopped is still blocked for this shape:
  // remember that row per column and start there next time instead of re-testing from the bottom.
  const colMap = S._col || (S._col = new Map());
  let col = colMap.get(R);
  if (!col) { col = new Int32Array(maxX + 1); colMap.set(R, col); }
  const lowestAt = (x0, cap) => {
    let y = Math.max(lb, col[x0]);
    while (y <= maxY && y < cap && collides(S, R, x0, y)) y++;
    if (y > col[x0]) col[x0] = y;
    return y <= maxY && y < cap ? y : null;
  };
  let best = null;
  for (let x0 = 0; x0 <= maxX; x0 += step) {
    const y = lowestAt(x0, best ? best.y + 1 : Infinity);
    if (y === null) continue;
    if (!best || y < best.y) best = { x: x0, y };
    if (best.y <= lb) break;
  }
  if (maxX % step !== 0) { const y = lowestAt(maxX, best ? best.y : Infinity); if (y !== null && (!best || y < best.y)) best = { x: maxX, y }; }
  if (!best) { lbMap.set(R, maxY + 1); return null; }
  const minY = best.y;
  if (band > 0) {
    const lim = minY + band;
    for (let x0 = 0; x0 <= maxX; x0 += step) { const y = lowestAt(x0, lim + 1); if (y !== null && y <= lim) { best = { x: x0, y }; break; } }
  }
  let { x, y } = best, moved = true;
  while (moved) {
    moved = false;
    while (y > 0 && !collides(S, R, x, y - 1)) { y--; moved = true; }
    while (x > 0 && !collides(S, R, x - 1, y)) { x--; moved = true; }
  }
  lbMap.set(R, Math.min(minY, y));
  return { x, y };
}

const tick = () => new Promise(r => setTimeout(r, 0));

// Nest one gauge group. list: parts with .qty. mat: {w,h} mm. opts: {skeleton, onProgress(n, total)}.
async function nestGroup(list, mat, gap, margin, opts) {
  opts = opts || {};
  const N = CONFIG.nest;
  const c = Math.min(N.cellMax, Math.max(N.cellMin, gap / N.cellPerGap)), k = Math.max(1, Math.ceil(gap / c)), P = k + 1;
  const Wc = Math.floor(mat.w / c), Hc = Math.floor(mat.h / c), mc = Math.ceil(margin / c);
  const cache = new Map();
  const getR = (p, a) => { let m = cache.get(p); if (!m) { m = {}; cache.set(p, m); } return m[a] || (m[a] = rasterizePart(p, a, c, k)); };

  // one entry per piece, biggest first; each part's base angle is the one that lies flattest
  const inst = [];
  for (const p of list) {
    if (!(p.qty > 0)) continue;
    const R0 = getR(p, 0), R90 = getR(p, 90);
    p._ar = R0.area;
    p._base = R0.bh <= R90.bh ? 0 : 90;
    for (let i = 0; i < p.qty; i++) inst.push(p);
  }
  inst.sort((a, b) => b._ar - a._ar);

  const sheets = [], skipped = new Map(), tol = N.tieTol;
  const pick = (S, p, angs) => {
    let best = null;
    for (const a of angs) {
      const R = getR(p, a), pos = findPos(S, R, 1, Math.round(N.bandFrac * R.bh));
      if (!pos) continue;
      if (!best || pos.y < best.y - tol || (Math.abs(pos.y - best.y) <= tol && pos.x < best.x - tol)) best = { x: pos.x, y: pos.y, R };
    }
    return best;
  };
  const tryAngles = (S, p) => {
    const b = p._base, flat = [b, (b + 180) % 360], turn = [(b + 90) % 360, (b + 270) % 360];
    let best = pick(S, p, flat);
    const mg = Math.round(N.turnMarginFrac * Math.min(getR(p, b).bh, getR(p, turn[0]).bh));
    if (best && S._lb && turn.every(a => (S._lb.get(getR(p, a)) || 0) >= best.y - mg)) return best;
    const spun = pick(S, p, turn);
    if (spun && (!best || spun.y < best.y - mg)) best = spun;
    return best;
  };

  let lastTick = Date.now();
  for (let n = 0; n < inst.length; n++) {
    const p = inst[n];
    if (opts.onProgress && Date.now() - lastTick > N.progressMs) { opts.onProgress(n, inst.length); await tick(); lastTick = Date.now(); }
    for (let at = 0; at <= sheets.length; at++) {
      const fresh = at === sheets.length, S = fresh ? newSheet(Wc, Hc, P, mc) : sheets[at];
      if (!fresh && S._full && S._full.has(p)) continue; // an identical copy already failed here: skip straight on
      const best = tryAngles(S, p);
      if (best) {
        stampPart(S, best.R, best.x, best.y);
        S.items.push({ p, R: best.R, rot: best.R.ang, x: best.x * c, y: best.y * c });
        if (fresh) sheets.push(S);
        break;
      }
      if (fresh) { skipped.set(p, (skipped.get(p) || 0) + 1); break; }
      (S._full || (S._full = new Set())).add(p);
    }
  }
  if (opts.onProgress) opts.onProgress(inst.length, inst.length);

  // finish each sheet: use, length used, optional skeleton cut
  const usableTop = (Hc - mc) * c;
  for (const S of sheets) {
    let a = 0, top = 0;
    for (const it of S.items) { a += it.R.area; top = Math.max(top, it.y + it.R.bh * c); }
    S.util = (a * c * c) / (mat.w * mat.h);
    S.used = top + margin;
    S.skeleton = [];
    if (opts.skeleton && S.items.length) { const y = top + N.skeletonOffset; if (y < usableTop) S.skeleton.push({ y, x0: mc * c, x1: (Wc - mc) * c }); }
    delete S.bits; delete S._lb; delete S._col; delete S._full; // free the raster once the layout is final
  }
  return { sheets, skipped, bed: mat, grid: { c, k, margin, gap } };
}

// Parts with a quantity, grouped by gauge (in the order the gauges first appear).
function groupByGauge(parts) {
  const byGauge = new Map();
  for (const p of parts) {
    if (!(p.qty > 0)) continue;
    const k = normThick(p.thick);
    if (!byGauge.has(k)) byGauge.set(k, { gauge: (p.thick || '').trim(), list: [] });
    byGauge.get(k).list.push(p);
  }
  return [...byGauge.values()];
}

// The whole nesting step. settings: {mat:{w,h}, gap, margin, skeleton}. onGroupDone(group, index, count) is optional.
async function nestJob(parts, settings, onProgress, onGroupDone) {
  const t0 = performance.now(), byGauge = groupByGauge(parts), groups = [];
  for (let gi = 0; gi < byGauge.length; gi++) {
    const { gauge, list } = byGauge[gi];
    const r = await nestGroup(list, settings.mat, settings.gap, settings.margin, {
      skeleton: settings.skeleton,
      onProgress: onProgress && ((n, t) => onProgress(gi, byGauge.length, n, t)),
    });
    const g = { gauge, r, req: list.map(p => ({ part: p, qty: p.qty })) };
    groups.push(g);
    if (onGroupDone) onGroupDone(g, gi, byGauge.length);
  }
  return { groups, ms: performance.now() - t0 };
}
