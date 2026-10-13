/* =====================================================================================================
   NC DRIVE · SETTINGS
   -----------------------------------------------------------------------------------------------------
   Every number, code and default the processes use lives here, so most changes are a one-line edit
   in this block. Lengths are in millimetres unless the name says otherwise.

   HOW THE PROJECT IS ORGANISED (open the .html pages from this folder in Edge or Chrome):
     index.html        main page: load → clean → read PDF → nest → NC → report, Tools bar, command line
     nc_search.html       P8  tool page   ┐ each runs on its own, and links to index.html when it is open
     parts_list.html      P9  tool page   │ (js/link.js): files, quantities, job name and the nest's .nc files
     copy_to_drive.html   P10 tool page   │ go between the pages; tool logs and progress show on the main page
     erase_usb.html       P11 tool page   │
     dxf_to_nc.html       P12 tool page   ┘
     css/ncdrive.css      the look, shared by every page
     js/config.js         this file: every setting
     js/common.js         small helpers ($, esc, matching, openNamed)    js/link.js     main ↔ tool messages
     js/folders.js        folder access + remembered folders              js/pdf-reader.js  pdf.js loader
     js/p1-geometry.js    P1  arcs / bulges / splines → point lists       tessellate()
     js/p2-load.js        P2  file → raw entities → part                  parseDXF(), parseNC(), loadPartFile()
     js/p3-clean.js       P3  stray, bend lines, etch text, features      cleanPart()
     js/p4-pdf.js         P4  title block → material → shop label         readDrawingPdf(), normalizeMaterial()
     js/p5-nest.js        P5  parts + sheet → placed sheets               nestJob(), nestGroup()
     js/p6-nc.js          P6  sheet → Bodor G-code, names, zip            makeSheetNc(), makeJobNcFiles()
     js/p7-report.js      P7  report rows, page, CSV                      reportData(), reportHtml(), reportCsv()
     js/p8-search.js      P8  part numbers → files in linked folders      searchLibrary(), bestPicks()
     js/p9-partslist.js   P9  parts list / work order → lines             readPartsList(), parsePartsRows()
     js/p10-copy.js       P10 copy files, DXF when a type is missing      copyPartsToDrive(), planCopy()
     js/p11-usb.js        P11 list / erase / write files on a stick       scanDrive(), eraseFiles(), writeJobToDrive()
     js/p12-dxfnc.js      P12 one .dxf → one .nc (no nesting)             dxfToNc()
     js/ui-core.js, ui-job.js, ui-progress.js, ui-status.js, main-tools.js, start.js   main page screen
     (ui-status.js = STATUS box: add to the current nest, zones, parts folder, laser rules, settings lock)
     js/tool-page.js + tool-search.js / tool-partslist.js / tool-copy.js / tool-usb.js / tool-dxfnc.js   tool page screens

   P1–P11 never touch the screen: they take values and return results, so each one can be changed or
   tested on its own. Console (F12): NCDrive.process on the main page, NCDriveTool.process on a tool page,
   NCLink.debug = true on any page prints the messages between pages.
   ===================================================================================================== */
const CONFIG = {
  // ---- machine beds (the 4' × 10' / 6' × 14' buttons) ----
  beds: [
    { name: "4' × 10' Bodor", w: 1219.2, h: 3048 },
    { name: "6' × 14' Bodor", w: 1828.8, h: 4267.2 },
  ],

  // ---- P1 geometry: how finely curves are turned into straight segments ----
  tessellate: {
    chordTol: 0.05, // max distance between a curve and its straight segments
    minRadius: 0.06, // radii below this are treated as this
    maxSegments: 720, // per arc
    splineSamples: { perCtrl: 16, min: 24, max: 2000 },
  },

  // ---- P3 DXF clean-up ----
  cleanup: {
    touchTol: 1, // boxes closer than this belong to the same cluster
    strayReachMin: 50, // a cluster further than max(this, strayReachFrac × part size) from the part is stray
    strayReachFrac: 0.75,
    bendLayers: /BEND|FOLD|TANGENT/i, // whole layers that are never cut
    bendAxisTol: 0.02, // how straight (as a slope) a bend line must be
    bendSpanFrac: 0.5, // a bend line spans at least this share of the part
    bendEndTolMin: 0.5, // end-point join tolerance: max(this, bendEndTolFrac × smaller side)
    bendEndTolFrac: 0.01,
    nonCutLayers: /FEATURE_PROFILES|ARC_CENTER|UNCONSUMED|ALTREP|CENTERMARK/i, // countersink / feature outlines
    etch: { minLetterH: 0.5, maxLetterH: 25, maxLetterW: 40, baselineTol: 2.5, minLetters: 3, growX: 1, growY: 15 },
  },

  // ---- P5 nesting ----
  nest: {
    cellPerGap: 3, // raster cell = gap / cellPerGap ...
    cellMin: 1.5, // ... kept between cellMin and cellMax mm
    cellMax: 6,
    bandFrac: 0.06, // accept a spot further left if it is within this share of the part height of the lowest spot
    tieTol: 2, // cells: two spots this close count as level
    turnMarginFrac: 0.75, // a quarter-turn is only used when it lands this share of the part height lower
    skeletonOffset: 12.7, // skeleton cut sits 0.5" above the nest
    sectionMM: 1219.2, // section cuts every 4' (the "Section cuts" box); the lines are drawn on the sheet, never cut
    defaultSheet: { w: 1219.2, h: 3048 }, // on this sheet, a gauge whose parts don't fit ...
    longSheet: { w: 1219.2, h: 4267.2 }, // ... is redone on this one (4' × 14'). null = never
    progressMs: 60, // how often the screen is updated while nesting
  },

  // ---- P6 NC output (Bodor dialect) ----
  nc: {
    header: ['G92 X0. Y0.', 'G21', 'G91'], // zero here, metric, incremental
    footer: ['M02'],
    compOn: 'G41',
    compOff: 'G40',
    cutOn: ['M07'],
    cutOff: ['M08'],
    markOn: ['M11', 'M09'], // etching
    markOff: ['M10', 'M12'],
    decimals: 3,
    stitchTol: 0.05, // ends closer than this join into one contour
    lineEnd: '\r\n',
  },

  // ---- P4 material / PDF ----
  material: {
    plateStock: { '1/4': { label: '1/4" HRS', mm: 6.35 } }, // plate thicknesses the shop stocks
    pdfPagesToScan: 3,
  },
  pdfjs: [
    { ver: '4.9.155', base: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/', lib: 'pdf.min.mjs', worker: 'pdf.worker.min.mjs' },
    { ver: '3.11.174', base: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/', lib: 'pdf.min.mjs', worker: 'pdf.worker.min.js' },
  ],

  // ---- P8 NC search ----
  search: {
    exts: ['nc', 'dxf', 'pdf'],
    maxDepth: 10,
    neverOpen: /amada/i, // folders with this in the name are skipped
    oldFolder: /(^|[^a-z])(old|backup|bak|obsolete|superseded|archive)([^a-z]|$)/i,
  },

  // ---- P9 parts list ----
  partsList: {
    partNumber: /(?<!\d)(\d{5,6}(?:_\d{1,6})?)(?![\d])/, // 5–6 digit part numbers (optionally _suffix)
    maxPages: 30,
  },

  // ---- P10 copy to drive ----
  copy: { defaultTarget: 'E:', defaultTypes: 'NC, PDF', fallbackType: 'dxf' },

  // ---- P11 USB ----
  usb: { defaults: { show: 'all', sub: true }, // Erase USB options on first run; after that the last ones used are kept
    eraseConfirmMs: 4000, previewBytes: 16384, eraseShowMs: 120, maxDepth: 6, skipFolders: /^(System Volume Information|\$RECYCLE\.BIN)$/i },

  // ---- STATUS box: rules and the settings lock (from nest_admin 2) ----
  rules: {
    omit: ['14443', '13824', '13824W', '18946'], // never programmed (not for the laser), with all their variants; more can be added in Admin mode
    fixedMaterial: { '14031': '14ga Satincoat', '14029': '14ga Satincoat', '19273': '14ga Satincoat' }, // always this gauge, whatever the drawing says
    railMaterial: '14ga Satincoat', // ON-… header / cornice / sill rails (…_HR, …_CR, …_SR)
    dxfOnly: ['18610'], // always cut from the DXF, never from an .NC (Pull parts)
  },
  // lockedByDefault: true = Spacing and DXF clean-up are locked until the admin key is typed (click 🔒 at the bottom of the
  // STATUS box; the unlock is remembered by this browser). false = never locked (nest_admin 5 is an admin build).
  admin: { key: 'nest-admin-3369', lockedByDefault: false, lockIds: ['gapIn', 'marginIn', 'skelChk', 'sectChk', 'cleanChk', 'bendChk', 'etchChk', 'featChk'] },

  // ---- screen ----
  // The screen is drawn for a designW × designH window and scaled to fit the real window each time a page opens
  // or the window changes size, so it keeps the same proportions on any monitor. min/maxScale stop text getting too small or big.
  screen: { designW: 1600, designH: 900, minScale: 0.75, maxScale: 2.5 },
  layout: { header: 56, dock: 96, command: 130, listFrac: 0.25, rightFrac: 0.22, split: 0.58 },
  gaugeColors: ['#3d8fd6', '#2f9e5a', '#d6453d', '#e0802a', '#8a63d2', '#c7a514', '#1fa59a', '#d0559a'],
};
