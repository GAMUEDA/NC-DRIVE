/* =====================================================================================================
   P5 · NESTING — true-shape, raster, bottom-left fill (nest_admin 5 rules)
   nestJob(parts, settings, onProgress) → {groups:[{gauge, r, req}], ms}   one nest per gauge (the Nest button)
   nestGauge(list, settings, onProgress) → r                              one gauge, with the 4' × 14' retry
   groupByGauge(parts)                  → [{gauge, list}]                   parts with qty > 0, by gauge
   nestGroup(list, mat, gap, margin, opts) → {sheets, skipped:Map(part→count), bed, grid, grain, sectMM, strategy}
   addToGroup(r, adds, opts)            → pieces gained per sheet: new copies fitted around a nest without moving anything
   Each part is rasterised at cell size c (gap/3, 1.5–6 mm); holes stay open so small parts can sit inside them,
   and the outline is grown by the gap. Placement and overlap tests are bit operations on packed rows.
   GRAIN: parts only sit at 0°/180°, or (the whole nest turned a quarter) at 90°/270° — never a mix. Both are tried
   and the shorter layout wins. Parts are never mirrored.
   SECTION CUTS (settings.sections): long sheets are nested as 4' slots, one slot's layout repeated while parts remain,
   so the sheet can be cut into handleable pieces; used whenever every part fits a slot. The lines are drawn, not cut.
   LONG SHEET: on the default 4' × 10', a gauge with parts that don't fit is redone on a 4' × 14' sheet.
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
// lanes = {mm, c, k}: a clear strip across the sheet at every section line, so no part straddles it.
function newSheet(Wc, Hc, P, mc, lanes) {
  const Ha = Hc + 2 * P, sw = Math.ceil((Wc + 2 * P) / 32) + 2, bits = new Uint32Array(Ha * sw);
  const set = (x, y) => { bits[(y + P) * sw + ((x + P) >> 5)] |= 1 << ((x + P) & 31); };
  for (let y = 0; y < Hc; y++) for (let x = 0; x < Wc; x++) if (x < mc || x >= Wc - mc || y < mc || y >= Hc - mc) set(x, y);
  if (lanes && lanes.mm)
    for (let b = lanes.mm; b < (Hc - mc) * lanes.c; b += lanes.mm) {
      const yc = Math.round(b / lanes.c), half = Math.max(1, Math.ceil(lanes.k / 2));
      for (let y = Math.max(0, yc - half); y < Math.min(Hc, yc + half); y++) for (let x = 0; x < Wc; x++) set(x, y);
    }
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

// The raster grid for one material, gap and margin: cell size, gap in cells, sheet size in cells, and a raster cache.
// off = grain direction (0 → parts at 0°/180°, 90 → 90°/270°); sect = section-line spacing in mm (0 = none).
function nestGrid(mat, gap, margin, off, sect) {
  const N = CONFIG.nest;
  const c = Math.min(N.cellMax, Math.max(N.cellMin, gap / N.cellPerGap)), k = Math.max(1, Math.ceil(gap / c)), P = k + 1;
  const cache = new Map();
  const getR = (p, a) => { let m = cache.get(p); if (!m) { m = {}; cache.set(p, m); } return m[a] || (m[a] = rasterizePart(p, a, c, k)); };
  return { c, k, P, margin, gap, off: off || 0, sect: sect || 0, Wc: Math.floor(mat.w / c), Hc: Math.floor(mat.h / c), mc: Math.ceil(margin / c), getR };
}
const gridSheet = G => newSheet(G.Wc, G.Hc, G.P, G.mc, { mm: G.sect, c: G.c, k: G.k });

// One entry per piece, biggest first; every piece starts at the grain angle. adds: [{p, n}]
function pieceList(adds, G) {
  const inst = [];
  for (const { p, n } of adds) {
    if (!(n > 0)) continue;
    p._ar = G.getR(p, G.off).area;
    for (let i = 0; i < n; i++) inst.push(p);
  }
  return inst.sort((a, b) => b._ar - a._ar);
}

// Place the pieces on the sheets: each goes to the lowest-then-leftmost spot on the first sheet it fits (0°/180° in the
// grain direction only), new sheets as needed. Pieces that fit nowhere go in skipped (Map part → count).
// added = flag the new items (Add to nest).
async function placePieces(G, inst, sheets, skipped, opts, added) {
  const N = CONFIG.nest, getR = G.getR, tol = N.tieTol, angs = [G.off, (G.off + 180) % 360];
  const pick = S => {
    let best = null;
    for (const a of angs) {
      const R = getR(S._p, a), pos = findPos(S, R, 1, Math.round(N.bandFrac * R.bh));
      if (!pos) continue;
      if (!best || pos.y < best.y - tol || (Math.abs(pos.y - best.y) <= tol && pos.x < best.x - tol)) best = { x: pos.x, y: pos.y, R };
    }
    return best;
  };
  let lastTick = Date.now();
  for (let n = 0; n < inst.length; n++) {
    const p = inst[n];
    if (opts.onProgress && Date.now() - lastTick > N.progressMs) { opts.onProgress(n, inst.length); await tick(); lastTick = Date.now(); }
    for (let at = 0; at <= sheets.length; at++) {
      const fresh = at === sheets.length, S = fresh ? gridSheet(G) : sheets[at];
      if (!fresh && S._full && S._full.has(p)) continue; // an identical copy already failed here: skip straight on
      S._p = p;
      const best = pick(S);
      if (best) {
        stampPart(S, best.R, best.x, best.y);
        const it = { p, R: best.R, rot: best.R.ang, x: best.x * G.c, y: best.y * G.c };
        if (added) { it.added = true; S.added = (S.added || 0) + 1; }
        S.items.push(it);
        if (fresh) sheets.push(S);
        break;
      }
      if (fresh) { skipped.set(p, (skipped.get(p) || 0) + 1); break; }
      (S._full || (S._full = new Set())).add(p);
    }
  }
  if (opts.onProgress) opts.onProgress(inst.length, inst.length);
}

// Finish each sheet: use, length used, section lines (drawn, not cut), optional skeleton cut; then free the raster.
function finishSheets(sheets, G, mat, skeleton) {
  const N = CONFIG.nest, c = G.c, usableTop = (G.Hc - G.mc) * c, x0 = G.mc * c, x1 = (G.Wc - G.mc) * c;
  for (const S of sheets) {
    let a = 0, top = 0;
    for (const it of S.items) { a += it.R.area; top = Math.max(top, it.y + it.R.bh * c); }
    S.util = (a * c * c) / (mat.w * mat.h);
    S.used = top + G.margin;
    S.skeleton = [];
    if (G.sect && S.items.length) for (let b = G.sect; b < usableTop; b += G.sect) if (b < top) S.skeleton.push({ y: b, x0, x1, section: true });
    if (skeleton && S.items.length) { const y = top + N.skeletonOffset; if (y < usableTop) S.skeleton.push({ y, x0, x1 }); }
    delete S.bits; delete S._lb; delete S._col; delete S._full; delete S._p;
  }
}
const skippedCount = r => [...r.skipped.values()].reduce((a, b) => a + b, 0);
// Sheet length actually used: every sheet but the last in full, the last as far as it was used (anything left out counts hugely).
const consumedLen = (r, mat) => skippedCount(r) * 1e9 + Math.max(0, r.sheets.length - 1) * mat.h + (r.sheets.length ? r.sheets[r.sheets.length - 1].used : 0);

// One plain nest in one grain direction. adds: [{p, n}]
async function nestPlain(adds, mat, gap, margin, off, opts) {
  const G = nestGrid(mat, gap, margin, off, 0), sheets = [], skipped = new Map();
  await placePieces(G, pieceList(adds, G), sheets, skipped, opts, false);
  finishSheets(sheets, G, mat, opts.skeleton);
  return { sheets, skipped, bed: mat, grid: { c: G.c, k: G.k, margin, gap }, _G: G, skeleton: !!opts.skeleton, grain: off, sectMM: 0 };
}

// SECTIONED NESTING: the sheet is a stack of slots (4' + 4' + the remainder). One slot is nested as its own small sheet and
// that layout is repeated into the next slot while enough parts remain, so every full section is identical; a shorter
// slot gets whatever fits it. Parts never cross a section line.
async function nestSections(adds, mat, gap, margin, off, secMM, opts) {
  const G = nestGrid(mat, gap, margin, off, secMM), rem = new Map(adds.map(a => [a.p, a.n])), left = () => [...rem.values()].reduce((a, b) => a + b, 0);
  const slots = [];
  for (let st = 0; st < mat.h - 1; st += secMM) { const h = Math.min(secMM, mat.h - st); if (h >= 2 * margin + 40) slots.push({ start: st, h }); }
  const cache = new Map(), sheets = [];
  let guard = 0;
  while (left() > 0 && guard++ < 400) {
    const S = { items: [] };
    let any = false;
    for (const sl of slots) {
      if (!left()) break;
      let L = cache.get(sl.h);
      if (L) for (const [p, q] of L.counts) if ((rem.get(p) || 0) < q) { L = null; break; }
      if (!L) {
        const sub = [...rem].filter(([, n]) => n > 0).map(([p, n]) => ({ p, n }));
        const r = await nestPlain(sub, { w: mat.w, h: sl.h }, gap, margin, off, { onProgress: opts.onProgress });
        const first = r.sheets[0], counts = new Map();
        if (first) for (const it of first.items) counts.set(it.p, (counts.get(it.p) || 0) + 1);
        L = { items: first ? first.items : [], counts };
        cache.set(sl.h, L);
      }
      if (!L.items.length) continue;
      for (const it of L.items) S.items.push({ p: it.p, R: it.R, rot: it.rot, x: it.x, y: Math.round((it.y + sl.start) / G.c) * G.c });
      for (const [p, q] of L.counts) rem.set(p, rem.get(p) - q);
      any = true;
    }
    if (!any) break;
    sheets.push(S);
  }
  const skipped = new Map([...rem].filter(([, n]) => n > 0));
  finishSheets(sheets, G, mat, opts.skeleton);
  return { sheets, skipped, bed: mat, grid: { c: G.c, k: G.k, margin, gap }, _G: G, skeleton: !!opts.skeleton, grain: off, sectMM: secMM };
}

// Nest one gauge group: both grain directions, sectioned and plain; a sectioned layout that fits everything always wins,
// otherwise the shortest. list: parts with .qty. mat: {w,h} mm. opts: {skeleton, sections (mm, 0 = off), onProgress(n, total)}.
async function nestGroup(list, mat, gap, margin, opts) {
  opts = opts || {};
  const adds = list.filter(p => p.qty > 0).map(p => ({ p, n: p.qty })), secMM = opts.sections && mat.h > opts.sections + margin + 5 ? opts.sections : 0;
  const ext = (p, off) => (off ? p.w : p.h); // the part's length along the sheet in this grain direction
  const tries = [];
  for (const off of [0, 90]) for (const sec of secMM ? [secMM, 0] : [0]) tries.push({ off, sec });
  const secOK = {};
  let best = null;
  for (const t of tries) {
    if (!t.sec && secOK[t.off]) continue; // a sectioned layout worked in this direction — it is always the one used
    if (t.sec && adds.some(a => ext(a.p, t.off) > t.sec - gap - 2 * margin)) continue; // a part is longer than a section
    const r = t.sec ? await nestSections(adds, mat, gap, margin, t.off, t.sec, opts) : await nestPlain(adds, mat, gap, margin, t.off, opts);
    r.len_ = consumedLen(r, mat);
    if (t.sec && !r.skipped.size) secOK[t.off] = true;
    if (t.sec && r.skipped.size) continue; // sections didn't work out for this job — the plain run covers it
    if (!best || (!!r.sectMM > !!best.sectMM) || (!!r.sectMM === !!best.sectMM && r.len_ < best.len_ - 0.5)) best = r;
  }
  best.strategy = [best.sectMM ? "section cuts every 4'" : '', best.grain ? 'grain across the sheet (90°/270°)' : 'grain along the sheet (0°/180°)'].filter(Boolean).join(' · ');
  return best;
}

// ADD TO THE CURRENT NEST — parts already placed are never moved. Each sheet's occupancy is rebuilt from where its parts
// really are (section lanes kept clear), then the new copies go into free space on the existing sheets first, then onto
// new sheets — in the nest's own grain direction. r: a nestGroup result. adds: [{p, n}]. → pieces gained per sheet
async function addToGroup(r, adds, opts) {
  opts = opts || {};
  const G = nestGrid(r.bed, r.grid.gap, r.grid.margin, r.grain || 0, r.sectMM || 0), before = r.sheets.map(S => S.items.length);
  for (const S of r.sheets) {
    const T = gridSheet(G);
    for (const it of S.items) stampPart(T, it.R, Math.round(it.x / G.c), Math.round(it.y / G.c));
    Object.assign(S, { bits: T.bits, sw: T.sw, Wc: T.Wc, Hc: T.Hc, P: T.P });
  }
  await placePieces(G, pieceList(adds, G), r.sheets, r.skipped, opts, true);
  finishSheets(r.sheets, G, r.bed, r.skeleton);
  r._G = G;
  return r.sheets.map((S, i) => S.items.length - (before[i] || 0));
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

// One gauge with the settings: nestGroup, and — on the default 4' × 10' — a retry on a 4' × 14' sheet when parts don't fit.
// settings: {mat:{w,h}, gap, margin, skeleton, sections}
async function nestGauge(list, settings, onProgress) {
  const N = CONFIG.nest, o = { skeleton: settings.skeleton, sections: settings.sections ? N.sectionMM : 0, onProgress };
  let r = await nestGroup(list, settings.mat, settings.gap, settings.margin, o);
  const d = N.defaultSheet, L = N.longSheet;
  if (L && r.skipped.size && Math.abs(settings.mat.w - d.w) < 1 && Math.abs(settings.mat.h - d.h) < 1) {
    const r2 = await nestGroup(list, { w: L.w, h: L.h }, settings.gap, settings.margin, o);
    if (skippedCount(r2) < skippedCount(r)) { r2.auto = true; r2.strategy += " · 4' × 14' sheet (part longer than 10')"; r = r2; }
  }
  return r;
}

// The whole nesting step. settings: {mat:{w,h}, gap, margin, skeleton, sections}. onGroupDone(group, index, count) is optional.
async function nestJob(parts, settings, onProgress, onGroupDone) {
  const t0 = performance.now(), byGauge = groupByGauge(parts), groups = [];
  for (let gi = 0; gi < byGauge.length; gi++) {
    const { gauge, list } = byGauge[gi];
    const r = await nestGauge(list, settings, onProgress && ((n, t) => onProgress(gi, byGauge.length, n, t)));
    const g = { gauge, r, req: list.map(p => ({ part: p, qty: p.qty })) };
    groups.push(g);
    if (onGroupDone) onGroupDone(g, gi, byGauge.length);
  }
  return { groups, ms: performance.now() - t0 };
}
