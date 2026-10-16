/* =====================================================================================================
   NEST ADMIN 8 — nest_admin_8.html, unchanged, running inside the main page.
   Its controls sit in the right-hand box and its sheet layouts (the "screen response") fill the centre box.
   The page is one frame laid over the centre and right boxes: the frame gets a few lines of layout CSS
   (its own header hidden, its side panel moved to the right and sized to the STATUS box), nothing in its code
   changes. The header button switches between this and the NC Drive screens; the choice is remembered.
   To update: replace nest_admin_8.html and run  node tools/embed-nest-admin.js
   ===================================================================================================== */
(function () {
  if (typeof window.NEST_ADMIN8_HTML !== 'string') return;
  const KEY = 'ncdrive.view', middle = $('#middle'), side = $('#side'), btn = $('#na8Btn');
  const LAYOUT_CSS = '<style id="ncdriveLayout">'
    + 'header{display:none!important}'
    + 'main{flex-direction:row-reverse}'
    + '.side{width:var(--ncdrive-side,340px)!important;min-width:0!important;max-width:none!important;border-right:none!important;border-left:1px solid var(--line)}'
    + '</style>';
  let frame = null;

  function build() {
    frame = document.createElement('iframe');
    frame.id = 'na8Frame';
    frame.title = 'Nest admin 8';
    frame.allow = 'camera; clipboard-read; clipboard-write; fullscreen';
    // same document, dark theme (NC Drive is always dark) and the layout lines just before </head>
    frame.srcdoc = NEST_ADMIN8_HTML
      .replace('<html lang="en">', '<html lang="en" data-theme="dark">')
      .replace('</head>', LAYOUT_CSS + '</head>');
    frame.addEventListener('load', fitSide);
    middle.appendChild(frame);
    new ResizeObserver(fitSide).observe(side);
  }
  // its side panel reaches from the middle of the wall you drag to the right edge, i.e. the STATUS box plus half the wall
  function fitSide() {
    const doc = frame && frame.contentDocument;
    if (!doc || !doc.documentElement) return;
    const border = (frame.offsetWidth - frame.clientWidth) / 2;
    doc.documentElement.style.setProperty('--ncdrive-side', Math.max(0, side.offsetWidth - border + WALL / 2) + 'px');
  }
  function show(on) {
    if (on && !frame) build();
    document.body.classList.toggle('na8', on);
    btn.classList.toggle('on', on);
    btn.textContent = on ? 'Nest admin 8' : 'NC Drive';
    btn.title = on ? 'Showing nest_admin 8 (controls right, sheets centre). Click for the NC Drive screens.' : 'Showing the NC Drive screens. Click for nest_admin 8.';
    try { localStorage.setItem(KEY, on ? 'na8' : 'ncdrive'); } catch (e) {}
    if (on) fitSide();
  }
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  btn.addEventListener('click', () => show(!document.body.classList.contains('na8')));
  show(saved !== 'ncdrive');
  window.NCDrive && (window.NCDrive.nestAdmin8 = { show, frame: () => frame });
})();
