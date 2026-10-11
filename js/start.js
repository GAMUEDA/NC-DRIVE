/* =====================================================================================================
   START (main page) — wire every panel once, draw the empty screen, and publish the processes as window.NCDrive
   ===================================================================================================== */
function startNcDrive() {
  wireLayout();
  wireCommandLine();
  wireSettings();
  wireFileDrop();
  wirePartsPanel();
  wireSheetsPanel();
  wireView();
  wireDownloads();
  wireToolsDock();
  wireToolLink();
  wireProgress();
  wireStatusPanel();
  startClock();
  renderParts();
  renderSheets();
  updateHud();
}

// Every process on this page (P8–P11 are on the tool pages, as NCDriveTool), by name, for trying things in the browser console (F12), e.g.  NCDrive.process.normalizeMaterial('16 GA GALV')
window.NCDrive = {
  CONFIG,
  state: S,
  process: {
    // P1 geometry
    tessellate, arcPts, bulgePts, bspline, bboxOf,
    // P2 load
    parseDXF, parseNC, loadPartFile,
    // P3 clean
    cleanPart, skipFeatureOutlines, removeStray, removeBendLines, splitEtchText,
    // P4 PDF + material
    readDrawingPdf, readPdfTitleBlock, normalizeMaterial, pdfMatchesPart, hasGauge,
    // P5 nesting
    nestJob, groupByGauge, nestGroup, addToGroup, rasterizePart,
    // STATUS box rules
    omitHitName, fixedMaterialOf, nestDeltas,
    // P6 NC output
    makeSheetNc, makeJobNcFiles, makeJobZip, ncFileName, entitiesToLoops,
    // P7 report
    reportData, reportHtml, reportCsv,
  },
  // screen actions (same as the buttons / commands)
  ui: { handleFiles, nestAll, runCommand, renderParts, renderSheets, renderView, downloadZip, downloadCSV, openTool, applyQuantities, addToCurrentNest, openZoneGrid, pullParts, unlockSettings, lockSettings },
  link: NCLink,
};

startNcDrive();
