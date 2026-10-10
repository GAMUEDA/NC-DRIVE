/* =====================================================================================================
   PDF READER — loads pdf.js (from the internet, the first time) and opens a PDF. Used by P4 and P9.
   withPdf(arrayBuffer, fn) → runs fn(pdf, src) with the first pdf.js version in CONFIG.pdfjs that works
   ===================================================================================================== */

const pdfLibCache = {};
async function loadPdfjs(src) {
  if (!pdfLibCache[src.ver]) {
    const m = await import(src.base + src.lib), L = m.getDocument ? m : m.default || m;
    L.GlobalWorkerOptions.workerSrc = src.base + src.worker;
    pdfLibCache[src.ver] = L;
  }
  return pdfLibCache[src.ver];
}
// Open a PDF with the first pdf.js version that works, then run fn(pdf, src). fn may return null to try the next version.
async function withPdf(buf, fn) {
  let lastErr = null;
  for (const src of CONFIG.pdfjs) {
    try {
      const lib = await loadPdfjs(src);
      const pdf = await lib.getDocument({ data: new Uint8Array(buf.slice(0)), cMapUrl: src.base + 'cmaps/', cMapPacked: true }).promise;
      const r = await fn(pdf, src);
      if (r !== null) return r;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('PDF reader did not load');
}
const cleanPdfText = s => s.replace(/ʌ/g, ':').replace(/\s+/g, ' ').trim();

