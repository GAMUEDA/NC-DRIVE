/* =====================================================================================================
   P13 · TURRET PROGRAMS — a 14443 strip DXF → the four AMADA turret programs (.nc) the shop runs
   turretTemplateFor(name)          → the CONFIG.turret.templates entry for a file / part name, or null
   turretPart(raw, name)            → {name, L, H, x0, y0, holes, embosses, outline} read from the DXF (mm)
   turretPrograms(part, opts)       → [{suffix, count, name, text, stats}]   one per CONFIG template program
     Built from the shop's own sample programs (14443_10073 - 1 … - 4): the part's holes and emboss
     centres come from the DXF; the outline is punched with the template's tools at fixed offsets from the
     part's edges (inches), so any length of the same strip works. Parts are stacked up the sheet one
     pitch apart (part height + the 0.25" rect tool that slits them apart).
   ===================================================================================================== */

const IN = 25.4;

function turretTemplateFor(name) {
  const t = partToken(name);
  return (t && CONFIG.turret.templates[t]) || null;
}

// ---- the part, from the DXF ----
function turretPart(raw, name) {
  const T = CONFIG.turret, cut = raw.filter(e => !T.nonOutline.test(e.layer || ''));
  const bb = bboxOf(withTessellation(cut));
  if (!(bb.maxX > bb.minX)) return { error: `${name}: no outline found in the DXF` };
  // round holes: circles that are not forming / feature outlines
  const holes = raw.filter(e => e.type === 'CIRCLE' && !T.featureLayer.test(e.layer || '') && !T.nonOutline.test(e.layer || '')).map(e => ({ x: e.x - bb.minX, y: e.y - bb.minY, d: 2 * e.r }));
  // embosses: one per centre of the feature-profile circles
  const em = [];
  for (const e of raw) if (e.type === 'CIRCLE' && T.featureLayer.test(e.layer || '')) {
    const x = e.x - bb.minX, y = e.y - bb.minY;
    if (!em.some(p => Math.hypot(p.x - x, p.y - y) < 0.5)) em.push({ x, y });
  }
  return { name, L: bb.maxX - bb.minX, H: bb.maxY - bb.minY, minX: bb.minX, minY: bb.minY, holes, embosses: em, outline: cut };
}

// ---- number formats (AMADA): coordinates to 0.001", pitch to 0.0001" ----
// whole numbers: coordinates are written 38.0, sheet sizes 48. (as the sample programs)
const tr = (v, d, whole) => { const f = Math.pow(10, d); let r = Math.round(v * f + (v >= 0 ? 1e-7 : -1e-7)) / f; if (Object.is(r, -0)) r = 0; const s = String(r); return s.includes('.') ? s : s + (whole || '.0'); };
const f3 = v => tr(v, 3), f4 = v => tr(v, 4), fDim = v => tr(v, 3, '.');
const fAng = a => (Number.isInteger(a) ? a.toFixed(1) : String(a));

// ---- one program: `count` parts stacked on one sheet ----
function turretProgram(part, tpl, prog, opts) {
  const o = tpl.origin, P = part.H / IN + tpl.gap, W = part.L / IN, H = part.H / IN, n = prog.count;
  const X0 = o.x, XR = o.x + W;                       // left / right edge of every part (in)
  const bot = i => o.y + i * P, top = i => bot(i) + H;  // part i (0 = bottom of the sheet)
  const lineY = k => (k < n ? bot(k) - tpl.gap / 2 : top(n - 1) + tpl.gap / 2); // slit lines 0 … n
  const sx = x => X0 + x / IN, sy = (i, y) => bot(i) + y / IN;
  const down = [...Array(n).keys()].reverse(), up = [...Array(n).keys()];
  const L = [], used = [];
  let N = 0, hits = 0, nibbles = 0, nibLen = 0;
  const emit = s => { N += 5; L.push(`N${String(N).padStart(2, '0')} ${s}`); };
  const toolStart = t => { used.push(t); emit(t.m); return `T${t.no} (${t.comment})`; };

  // a point tool: hits = [{x, y, c}] in order; c = the index angle the hit needs (only written when it changes)
  const pointTool = (t, list) => {
    if (!list.length) return;
    const tt = toolStart(t);
    let first = true, c = null;
    for (const h of list) {
      const cTxt = h.c != null && h.c !== c ? ` C${h.c}.` : '';
      if (first && cTxt && h.y < tpl.indexSafeY) { emit(`G70 X${f3(h.x)} Y${f3(tpl.indexSafeY)} ${tt}`); emit(`X${f3(h.x)} Y${f3(h.y)}${cTxt}`); }
      else emit(`X${f3(h.x)} Y${f3(h.y)}${cTxt}${first ? ' ' + tt : ''}`);
      if (h.c != null) c = h.c;
      first = false;
      hits++;
    }
  };
  // a line (nibble) tool: G70 to the start, G79 along I at angle J, pitch Q
  const lineTool = (t, list) => {
    if (!list.length) return;
    const tt = toolStart(t);
    list.forEach((h, k) => {
      emit(`G70 X${f3(h.x)} Y${f3(h.y)}${k ? '' : ' ' + tt}`);
      const I = h.len, steps = Math.ceil(I / (t.len - tpl.gap) - 1e-9), Q = I / steps;
      emit(`G79 I${f3(I)} J${fAng(h.j)} P0. Q${f4(Q)} D${f4(tpl.thicknessMM / IN)}${h.c != null ? ` C${h.c}.` : ''}`);
      nibbles += steps + 1;
      nibLen += I;
    });
  };
  const byCol = (pts, rightFirstUp) => {
    // left column top → bottom over every part, then the right column bottom → top
    const mid = part.L / 2, left = [], right = [];
    for (const i of down) for (const p of [...pts].filter(p => p.x < mid).sort((a, b) => b.y - a.y)) left.push({ x: sx(p.x), y: sy(i, p.y) });
    for (const i of up) for (const p of [...pts].filter(p => p.x >= mid).sort((a, b) => a.y - b.y)) right.push({ x: sx(p.x), y: sy(i, p.y) });
    if (rightFirstUp === false) right.reverse();
    return left.concat(right);
  };
  const tool = id => tpl.tools[id];

  // 1 · round holes
  const holeTool = tool('hole');
  pointTool(holeTool, byCol(part.holes));
  // 2, 3 · corner tools (index 270 on the bottom corners, 90 on the top corners)
  for (const id of ['bk20', 'bk10']) {
    const t = tool(id), list = [];
    down.forEach(i => list.push({ x: X0 + t.bl, y: bot(i) + t.dy, c: 270 }));
    up.forEach(i => list.push({ x: XR - t.br, y: bot(i) + t.dy }));
    down.forEach((i, k) => list.push({ x: X0 + t.tl, y: top(i) - t.dy, c: 90 }));
    up.forEach(i => list.push({ x: XR - t.tr, y: top(i) - t.dy }));
    pointTool(t, list);
  }
  // 4 · bowtie at each end of every slit line and both sides of every part
  { const t = tool('bowtie'), list = [];
    for (let k = n; k >= 0; k--) { list.push({ x: X0 + t.lineIn, y: lineY(k) }); if (k) { list.push({ x: X0 - t.side, y: top(k - 1) - t.dy }, { x: X0 - t.side, y: bot(k - 1) + (t.dyBot || t.dy) }); } }
    for (let k = 0; k <= n; k++) { list.push({ x: XR - t.lineIn, y: lineY(k) }); if (k < n) { list.push({ x: XR + t.side, y: bot(k) + (t.dyBot || t.dy) }, { x: XR + t.side, y: top(k) - t.dy }); } }
    pointTool(t, list); }
  // 5 · short rect down the left end, up the right end of every part
  { const t = tool('endRect'), list = [], len = H - 2 * t.dy;
    down.forEach(i => list.push({ x: X0 - t.side, y: top(i) - t.dy, len, j: -90, c: 90 }));
    up.forEach(i => list.push({ x: XR + t.side, y: bot(i) + t.dy, len, j: 90, c: 90 }));
    lineTool(t, list); }
  // 6 · long rect along every slit line, top to bottom, alternating direction
  { const t = tool('slit'), list = [], len = W - 2 * t.inset;
    for (let k = n, a = 0; k >= 0; k--, a++) list.push(a % 2 ? { x: X0 + t.inset, y: lineY(k), len, j: 0 } : { x: XR - t.inset, y: lineY(k), len, j: 180 });
    lineTool(t, list); }
  // 7 · emboss (forming, last) on every emboss centre
  pointTool(tool('emboss'), byCol(part.embosses, n === 1 && tpl.singlePartEmbossRightDown ? false : true));
  emit('M692'); emit('M13'); emit('G50');

  const name = `${opts.name || part.name} - ${prog.suffix}`, d = opts.date || new Date();
  const date = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
  const head = [prog.firstLine != null ? prog.firstLine : ' ', `O${String(opts.programNo).padStart(4, '0')}(${name})`, `(${date})`,
    ...used.map(t => `(UT/T${t.no} ${t.ut})`), `(SHEET DIM: ${fDim(prog.sheet[0])} ${fDim(prog.sheet[1])})`, `(THICKNESS: ${f3(tpl.thicknessMM / IN)})`,
    `(CLAMPS POS:  ${tpl.clamps.map(c => c.toFixed(1)).join('--')})`, `(MATERIAL:  ${tpl.material})`,
    `N05 G06 A${f3(tpl.thicknessMM / IN)} B 1`, `N10 ${tpl.g92}`, 'N15 G90'];
  // renumber: head takes N05–N15, the body continues at N20
  const body = L.map((l, k) => l.replace(/^N\d+/, 'N' + String(20 + 5 * k).padStart(2, '0')));
  const text = [...head, ...body, '%', ''].join('\r\n') + '\r\n';
  // a few numbers for the report
  const allY = [], allX = [];
  for (const l of body) { const mx = /(?:^|\s)X(-?[\d.]+)/.exec(l), my = /\sY(-?[\d.]+)/.exec(l); if (mx && my) { allX.push(+mx[1]); allY.push(+my[1]); } }
  const stats = { hits, nibbles, nibLenM: (nibLen * IN) / 1000, tools: used, maxX: Math.max(...allX), maxY: Math.max(...allY), rapidM: rapidLength(body) };
  return { suffix: prog.suffix, count: n, name, text, stats, sheet: prog.sheet, tpl, part, programNo: opts.programNo, date: d };
}

// straight-line length of every positioning move (G79 runs excluded), in metres
function rapidLength(body) {
  let x = null, y = null, d = 0;
  for (const l of body) {
    const mx = /(?:\s)X(-?[\d.]+)/.exec(' ' + l), my = /\sY(-?[\d.]+)/.exec(l), g = /G79 I([\d.]+) J(-?[\d.]+)/.exec(l);
    if (mx && my) { const nx = +mx[1], ny = +my[1]; if (x != null) d += Math.hypot(nx - x, ny - y); x = nx; y = ny; }
    if (g) { const a = (+g[2] * Math.PI) / 180; x += +g[1] * Math.cos(a); y += +g[1] * Math.sin(a); }
  }
  return (d * IN) / 1000;
}

// how many parts fit up the sheet (for a program whose count is 'max')
function turretMaxCount(part, tpl, sheetY) {
  const P = part.H / IN + tpl.gap;
  let n = 1;
  while (tpl.origin.y + (n + 1) * P - tpl.gap / 2 + tpl.edge <= sheetY) n++;
  return n;
}

function turretPrograms(part, opts) {
  const tpl = opts.template;
  return tpl.programs.map((pr, k) => {
    const prog = Object.assign({}, pr, { count: pr.count === 'max' ? turretMaxCount(part, tpl, pr.sheet[1]) : pr.count });
    return turretProgram(part, tpl, prog, Object.assign({}, opts, { programNo: opts.programNo + k }));
  });
}
