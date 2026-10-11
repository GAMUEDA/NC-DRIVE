/* =====================================================================================================
   P12 · DXF TO NC — one .dxf → one Bodor .nc program, part by part (no nesting)
   dxfToNc(file, cleanOpts) → {name, ncName, text, w, h, pierces, cutLen, openCount, notes} or {error, kind}
     The same steps as the main page (nest_admin 2's logic): read the DXF (P2), clean it (P3: stray geometry,
     bend lines, etched text, feature outlines), then write the program (P6): G92 zero at the part's lower-left
     corner, G21 metric, G91 incremental, one pierce per closed contour (G41 + M07 … M08 + G40), holes before
     the outer profile, etching as M11/M09 … M10/M12, M02 at the end.
   ===================================================================================================== */

async function dxfToNc(file, cleanOpts) {
  if (!/\.dxf$/i.test(file.name)) return { error: `${file.name}: not a .dxf file — skipped`, kind: 'warn' };
  const r = await loadPartFile(file, cleanOpts, []);
  if (r.error) return r;
  const p = r.part;
  // the part on its own "sheet", unrotated, its lower-left corner on the zero point
  const nc = makeSheetNc({ items: [{ p, R: { minx: 0, miny: 0 }, rot: 0, x: 0, y: 0 }], skeleton: [] });
  const notes = [p.removed && `${p.removed} stray removed`, p.bendRemoved && `${p.bendRemoved} bend line${p.bendRemoved > 1 ? 's' : ''} removed`, p.etchFound && 'etch text', p.featSkipped && `${p.featSkipped} feature outline${p.featSkipped > 1 ? 's' : ''} skipped`].filter(Boolean);
  return { name: file.name, ncName: p.name + '.nc', text: nc.text, w: p.w, h: p.h, pierces: nc.pierces, cutLen: nc.cutLen, openCount: nc.openCount, notes };
}
