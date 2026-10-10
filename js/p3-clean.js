/* =====================================================================================================
   P3 · CLEAN DXF — decide which entities are cut, which are etched, and which are dropped
   cleanPart(part, opts) re-runs from part.raw every time, so the four tick boxes can be switched freely.
     opts.feat  → skipFeatureOutlines()   countersink / feature layers (CONFIG.cleanup.nonCutLayers)
     opts.clean → removeStray()           small clusters far from the part (notes, marks near 0,0)
     opts.bend  → removeBendLines()       straight lines across the part that join nothing, or BEND/FOLD layers
     opts.etch  → splitEtchText()         rows of small line-only letters become etch passes
   ===================================================================================================== */

// Group entities whose boxes touch (union-find). → [{idx:[entity indexes], x0,y0,x1,y1}]
function clusterEntities(entities) {
  const tol = CONFIG.cleanup.touchTol;
  const boxes = entities.map(entBox), n = entities.length, par = Array.from({ length: n }, (_, i) => i);
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const order = boxes.map((b, i) => i).sort((a, b) => boxes[a].x0 - boxes[b].x0);
  for (let ii = 0; ii < n; ii++) {
    const i = order[ii];
    for (let jj = ii + 1; jj < n; jj++) {
      const j = order[jj];
      if (boxes[j].x0 > boxes[i].x1 + tol) break;
      if (boxes[j].y0 <= boxes[i].y1 + tol && boxes[j].y1 >= boxes[i].y0 - tol) par[find(i)] = find(j);
    }
  }
  const cl = {};
  for (let i = 0; i < n; i++) {
    const r = find(i), b = boxes[i], c = cl[r] || (cl[r] = { idx: [], x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });
    c.idx.push(i);
    c.x0 = Math.min(c.x0, b.x0); c.y0 = Math.min(c.y0, b.y0);
    c.x1 = Math.max(c.x1, b.x1); c.y1 = Math.max(c.y1, b.y1);
  }
  return Object.values(cl);
}

// Feature / countersink outlines: drop entities on non-cut layers (unless that would drop everything).
function skipFeatureOutlines(entities) {
  const keep = entities.filter(e => !CONFIG.cleanup.nonCutLayers.test(e.layer || ''));
  return keep.length ? { entities: keep, removed: entities.length - keep.length } : { entities, removed: 0 };
}

// Drop clusters that don't touch the real part (stray marks near 0,0, notes, etc.)
function removeStray(entities) {
  const C = CONFIG.cleanup;
  const list = clusterEntities(entities);
  list.forEach(c => (c.d = Math.hypot(c.x1 - c.x0, c.y1 - c.y0)));
  const main = list.reduce((a, b) => (b.d > a.d ? b : a));
  const reach = Math.max(C.strayReachMin, C.strayReachFrac * Math.max(main.x1 - main.x0, main.y1 - main.y0));
  const kept = [];
  for (const c of list) {
    const gx = Math.max(0, c.x0 - main.x1, main.x0 - c.x1), gy = Math.max(0, c.y0 - main.y1, main.y0 - c.y1);
    if (c === main || Math.hypot(gx, gy) <= reach) c.idx.forEach(i => kept.push(entities[i]));
  }
  return { entities: kept, removed: entities.length - kept.length };
}

// End points of open entities (used to tell whether a line joins anything).
function getEndpoints(e) {
  if (e.type === 'LINE') return [{ x: e.x1, y: e.y1 }, { x: e.x2, y: e.y2 }];
  if (e.type === 'ARC') {
    const a1 = (e.a1 * Math.PI) / 180, a2 = (e.a2 * Math.PI) / 180;
    return [{ x: e.x + e.r * Math.cos(a1), y: e.y + e.r * Math.sin(a1) }, { x: e.x + e.r * Math.cos(a2), y: e.y + e.r * Math.sin(a2) }];
  }
  if (e.type === 'POLY' && !e.closed && e.pts.length > 1) return [{ x: e.pts[0].x, y: e.pts[0].y }, { x: e.pts[e.pts.length - 1].x, y: e.pts[e.pts.length - 1].y }];
  return null;
}
// [x1,y1,x2,y2] when the entity is one straight segment, else null.
function straightEnds(e) {
  if (e.type === 'LINE') return [e.x1, e.y1, e.x2, e.y2];
  if (e.type === 'POLY' && !e.closed && e.pts.length === 2 && !e.pts[0].b && !e.pts[1].b) return [e.pts[0].x, e.pts[0].y, e.pts[1].x, e.pts[1].y];
  return null;
}

// Straight lines that span most of the part but connect to nothing are fold/bend indicators, not cuts.
function removeBendLines(entities, bbox) {
  const C = CONFIG.cleanup;
  const w = bbox.maxX - bbox.minX, h = bbox.maxY - bbox.minY;
  const tol = Math.max(C.bendEndTolMin, Math.min(w, h) * C.bendEndTolFrac);
  const eps = [];
  entities.forEach((e, i) => { const p = getEndpoints(e); if (p) p.forEach(pt => eps.push({ x: pt.x, y: pt.y, idx: i })); });
  const connected = (pt, self) => eps.some(o => o.idx !== self && Math.hypot(o.x - pt.x, o.y - pt.y) <= tol);
  const keep = [];
  let removed = 0;
  entities.forEach((e, i) => {
    if (e.layer && C.bendLayers.test(e.layer)) { removed++; return; }
    const se = straightEnds(e);
    if (!se) { keep.push(e); return; }
    const [x1, y1, x2, y2] = se, dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1e-6) { keep.push(e); return; }
    const horiz = Math.abs(dy) / len < C.bendAxisTol, vert = Math.abs(dx) / len < C.bendAxisTol;
    const spans = (horiz && len >= C.bendSpanFrac * w) || (vert && len >= C.bendSpanFrac * h);
    if ((horiz || vert) && spans && !connected({ x: x1, y: y1 }, i) && !connected({ x: x2, y: y2 }, i)) { removed++; return; }
    keep.push(e);
  });
  return { entities: keep, removed };
}

// Etched text with no dedicated layer: many small line-only clusters sharing a baseline. → {cut, etch}
function splitEtchText(entities) {
  const E = CONFIG.cleanup.etch;
  if (entities.length < 2) return { cut: entities, etch: [] };
  const list = clusterEntities(entities);
  list.forEach(c => { c.h = c.y1 - c.y0; c.w = c.x1 - c.x0; c.allLines = c.idx.every(i => entities[i].type === 'LINE'); c.area = c.w * c.h; });
  const main = list.reduce((a, b) => (b.area > a.area ? b : a));
  const cand = list.filter(c => c !== main && c.allLines && c.h > E.minLetterH && c.h <= E.maxLetterH && c.w <= E.maxLetterW);
  if (cand.length < E.minLetters) return { cut: entities, etch: [] };
  // the longest run of candidates on (nearly) the same baseline
  cand.sort((a, b) => a.y0 - b.y0);
  let bestGroup = [], group = [cand[0]];
  for (let i = 1; i < cand.length; i++) {
    if (cand[i].y0 - group[group.length - 1].y0 <= E.baselineTol) group.push(cand[i]);
    else { if (group.length > bestGroup.length) bestGroup = group; group = [cand[i]]; }
  }
  if (group.length > bestGroup.length) bestGroup = group;
  if (bestGroup.length < E.minLetters) return { cut: entities, etch: [] };
  // plus any candidate inside that text line's box (punctuation, second line)
  const gx0 = Math.min(...bestGroup.map(c => c.x0)), gx1 = Math.max(...bestGroup.map(c => c.x1));
  const gy0 = Math.min(...bestGroup.map(c => c.y0)), gy1 = Math.max(...bestGroup.map(c => c.y1));
  for (const c of cand) {
    if (bestGroup.includes(c)) continue;
    if (c.x0 >= gx0 - E.growX && c.x1 <= gx1 + E.growX && c.y0 >= gy0 - E.growY && c.y1 <= gy1 + E.growY) bestGroup.push(c);
  }
  const isEtch = new Set();
  for (const c of bestGroup) c.idx.forEach(i => isEtch.add(i));
  const cut = [], etch = [];
  entities.forEach((e, i) => (isEtch.has(i) ? etch : cut).push(e));
  return { cut, etch };
}

// The whole clean-up step. Sets part.entities / etchEntities / size and the counts shown in the parts list.
function cleanPart(part, opts) {
  let ents = part.raw, removed = 0, bendRemoved = 0, featSkipped = 0, etchEntities = [];
  if (opts.feat) { const r = skipFeatureOutlines(ents); ents = r.entities; featSkipped = r.removed; }
  if (opts.clean) { const r = removeStray(ents); ents = r.entities; removed = r.removed; }
  let bb = bboxOf(ents);
  if (opts.bend) { const r = removeBendLines(ents, bb); ents = r.entities; bendRemoved = r.removed; bb = bboxOf(ents); }
  if (opts.etch && !part._ncBlocks) {
    const r = splitEtchText(ents);
    ents = r.cut; etchEntities = r.etch;
    if (etchEntities.length) bb = bboxOf(ents);
  }
  part._loops = null;
  part._etchLoops = null;
  Object.assign(part, { entities: ents, ...bb, w: bb.maxX - bb.minX, h: bb.maxY - bb.minY, removed, bendRemoved, etchEntities, etchFound: etchEntities.length, featSkipped });
  return part;
}
