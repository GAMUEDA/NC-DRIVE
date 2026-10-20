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
     js/rules.js          laser rules: OMIT list, fixed materials, DXF-only parts   omitHitName(), fixedMaterialOf()
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
     js/p13-turret.js     P13 turret strip DXF → AMADA programs -1…-4    turretPart(), turretPrograms()
     js/p14-turret-pdf.js P14 the program sheet PDF for each turret .nc  turretReportPdf()   (falk-logo.js = its logo)
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

  // ---- turret programs (DXF to NC, P13): parts punched on the AMADA turret, not the laser ----
  // A DXF whose part number has a template here becomes that template's programs (.nc + .pdf report) instead of a laser .nc.
  // Offsets are inches from the part's own edges; they come from the shop's sample programs 14443_10073 - 1 … - 4.
  turret: {
    machine: 'AMADA-AE2510-NT-45ST-4AI',
    nonOutline: /FEATURE_PROFILES|ARC_CENTER|TANGENT|BEND|CENTERMARK|UNCONSUMED|ALTREP/i, // not part of the outline
    featureLayer: /FEATURE_PROFILES/i,                                                  // circles here = emboss centres
    densityKgM3: 7800,
    report: { rapidMinPerM: 0.1082, punchMinPerHit: 0.00131, nibbleMinPerM: 0.0917, nibbleMinPerHit: 0.00204, toolChangeMin: 0.0671, loadMin: 0.10 }, // fitted to the sample reports
    templates: {
      '14443': {
        material: 'GALVANIZED', grade: 'GALVANIZED 1.61 mm 16g', thicknessMM: 1.61,
        clamps: [6, 37, 43],                 // inches
        g92: 'G92 X98.425 Y50.0',
        origin: { x: 0.9375, y: 4.4375 },    // the first part's lower-left corner on the sheet (in)
        gap: 0.25,                           // slit between parts = the rect tool's width (in)
        edge: 0.3125,                        // room kept past the last tool hit (in)
        indexSafeY: 8.268,                   // the turret only indexes a tool above this Y: lower first hits move here with G70 first
        singlePartEmbossRightDown: true,     // as the sample: with one part the emboss runs the right side top → bottom
        // -1 … -4: parts per sheet and sheet size (in). 'max' = as many as fit up the sheet.
        programs: [
          { suffix: 1, count: 1, sheet: [49.212, 49.212], firstLine: '' },
          { suffix: 2, count: 2, sheet: [49.212, 49.212] },
          { suffix: 3, count: 3, sheet: [49.212, 49.212] },
          { suffix: 4, count: 'max', sheet: [48, 48] },
        ],
        tools: {
          hole:    { no: 318, m: 'M500', ut: 'ROUND   0.1772   KEYED   0.00', comment: 'RO 0.1772 C500', name: 'RO 4.50 (.177)', dims: '4.50 x 0.00 mm' },
          bk20:    { no: 236, m: 'M500', ut: 'SPC BKRAD-20   KEYED   INDEX', comment: 'SP BKRAD-20 ANG. 0. C500', name: 'BKRAD-20', dims: '10.85 x 15.93 mm', bl: 0.7055, br: 0.3575, tl: 0.3575, tr: 0.7055, dy: 0.4375 },
          bk10:    { no: 225, m: 'M500', ut: 'SPC BKRAD-10   KEYED   INDEX', comment: 'SP BKRAD-10 ANG. 0. C500', name: 'BKRAD-10', dims: '10.85 x 15.93 mm', bl: 0.3575, br: 0.7055, tl: 0.7055, tr: 0.3575, dy: 0.4385 },
          bowtie:  { no: 303, m: 'M500', ut: 'SPC BOWTIE-3.1750 MM   KEYED   0.00', comment: 'SP BOWTIE-3.1750 MM ANG. 0. C500', name: 'BOWTIE-3.1750 MM', dims: '1.59 x 6.35 mm', lineIn: 0.7945, side: 0.1245, dy: 0.6265, dyBot: 0.62697 },
          endRect: { no: 201, m: 'M500', ut: 'RECT 1.8750X0.2500   KEYED   INDEX', comment: 'RE 1.875X0.25 ANG. 0. C500', name: 'RE 47.625x6.35', dims: '47.63 x 6.35 mm', len: 1.875, side: 0.1245, dy: 1.8893 },
          slit:    { no: 245, m: 'M500', ut: 'RECT 4.0000X0.2500   KEYED   0.00', comment: 'RE 4.X0.25 ANG. 0. C500', name: 'RE 101.60x6.35', dims: '101.60 x 6.35 mm', len: 4.0, inset: 3.11905 },
          emboss:  { no: 332, m: 'M532', ut: 'SPC M532 FD EMBOSS 25   KEYED   0.00', comment: 'SP M532 FD EMBOSS 25 ANG. 0. C532', name: 'M532 FD EMBOSS 25', dims: '25.40 x 25.40 mm' },
        },
      },
    },
  },

  // ---- screen ----
  // The screen is drawn for a designW × designH window and scaled to fit the real window each time a page opens
  // or the window changes size, so it keeps the same proportions on any monitor. min/maxScale stop text getting too small or big.
  screen: { designW: 1600, designH: 900, minScale: 0.75, maxScale: 2.5 },
  layout: { header: 56, dock: 96, command: 130, listFrac: 0.25, rightFrac: 0.22, split: 0.58 },
  gaugeColors: ['#3d8fd6', '#2f9e5a', '#d6453d', '#e0802a', '#8a63d2', '#c7a514', '#1fa59a', '#d0559a'],
};
