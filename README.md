# NC Drive

DXF → nest → NC (Bodor) with PDF reading and a report sheet. Runs in Edge or Chrome straight from the folder; no install or build.

Open `index.html` (online: https://gamueda.github.io/NC-DRIVE/ once GitHub Pages is on). The tools also run on their own and link to the main page when it is open:

| Page | Process |
|---|---|
| `index.html` | main screen. Opens on **nest_admin 8**: its controls in the right box, its sheet layouts in the centre. The header button switches to the NC Drive screens: load, clean, nest, NC output, report (P1–P7) |
| `nest_admin_8.html` | nest_admin 8 on its own, unchanged |
| `nc_search.html` | P8 NC search |
| `parts_list.html` | P9 parts list from PDF |
| `copy_to_drive.html` | P10 copy parts to drive |
| `erase_usb.html` | P11 erase / write USB |
| `dxf_to_nc.html` | P12 DXF to NC: nest_admin 5's conversion with its defaults (all clean-ups on, OMIT list refused); drop DXF files, press CONVERT, then save the .nc files to a USB drive or a folder |

Shared code is in `js/` (start with `js/config.js`, which holds every setting and a map of the processes) and the look is in `css/ncdrive.css`.

The nesting follows nest_admin 5: grain (0°/180° or the whole nest at 90°/270°), optional section cuts every 4', and an automatic 4' × 14' sheet for parts longer than 10' (`CONFIG.nest` in `js/config.js`). The STATUS box on the main page (`js/ui-status.js`) also holds the nest_admin controls: add new parts to the current nest without moving placed parts, quantities by zone, pull parts by number from a linked parts folder, the laser rules (never-programmed numbers, fixed materials, DXF-only parts) and the settings lock. The rules and the admin key are in `CONFIG.rules` and `CONFIG.admin` in `js/config.js`.

nest_admin 8 runs unchanged inside the main page (`js/na8-panel.js`). The page only hides its own header, puts its side panel on the right at the width of the STATUS box, and uses the dark theme. To update it, replace `nest_admin_8.html` and run `node tools/embed-nest-admin.js`, which rebuilds `js/nest-admin8-src.js`. The copy is embedded because a page opened from a folder can't size or theme a separate file in a frame.
