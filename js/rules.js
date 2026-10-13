/* =====================================================================================================
   LASER RULES (nest_admin 5) — shared by the main page and DXF to NC
     omitHitName(name)     → the never-programmed entry a file / part belongs to, or ''   CONFIG.rules.omit + Admin additions
     fixedMaterialOf(name) → the gauge a part always gets, or ''                           CONFIG.rules.fixedMaterial
     isDxfOnly(term)       → this part is always cut from its DXF, never an .NC            CONFIG.rules.dxfOnly
   ===================================================================================================== */
let omitExtra = [];
try { omitExtra = JSON.parse(ls.get('omitExtra', '[]')).map(String).filter(x => /^\d{4,6}[A-Za-z]{0,3}$/.test(x)); } catch (e) {}
const omitList = () => [...new Set([...CONFIG.rules.omit, ...omitExtra])];
// the first part-number token in a file or part name ("14443_6781.dxf" → "14443", "13824W_0508 - 1" → "13824W")
const partToken = name => { const m = /(?<!\d)(\d{4,6}[A-Za-z]*)(?![A-Za-z0-9])/.exec(String(name || '').replace(/\.[^.]+$/, '')); return m ? m[1] : ''; };
// An entry covers a number that starts with it and isn't continued by another digit: 13824 covers 13824_0508 and 13824W, not 138240.
const omitMatch = (tok, e) => { tok = String(tok).toLowerCase(); e = String(e).toLowerCase(); return tok.startsWith(e) && (tok.length === e.length || !/\d/.test(tok[e.length])); };
// → the omit entry a part / file name belongs to, or ''
function omitHitName(name) {
  const stem = String(name || '').replace(/\.[^.]+$/, '');
  if (/^ON/i.test(stem)) return '';
  const t = partToken(stem), L = omitList();
  return t ? L.find(e => e.toLowerCase() === t.toLowerCase()) || L.find(e => omitMatch(t, e)) || '' : '';
}
// → the gauge a part always gets, or ''
function fixedMaterialOf(name) {
  const stem = String(name || '').replace(/\.[^.]+$/, '').replace(/[\s_]+-[\s_]*\d{1,2}$/, '').replace(/\s+/g, '_');
  if (/^ON[-_]?\d{3,6}.*_(HR|CR|SR)$/i.test(stem)) return CONFIG.rules.railMaterial;
  if (/^ON/i.test(stem)) return '';
  return CONFIG.rules.fixedMaterial[partToken(stem)] || '';
}
const isDxfOnly = term => CONFIG.rules.dxfOnly.includes(partToken(term) || String(term));
