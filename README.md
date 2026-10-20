# NC Drive

DXF → nest → NC (Bodor) with PDF reading and a report sheet. Runs in Edge or Chrome straight from the folder; no install or build.

Open `index.html` (online: https://gamueda.github.io/NC-DRIVE/ once GitHub Pages is on). The tools also run on their own and link to the main page when it is open:

| Page | Process |
|---|---|
| `index.html` | main screen: load, clean, nest, NC output, report (P1–P7) |
| `nc_search.html` | P8 NC search |
| `parts_list.html` | P9 parts list from PDF |
| `copy_to_drive.html` | P10 copy parts to drive |
| `erase_usb.html` | P11 erase / write USB |
| `dxf_to_nc.html` | P12–P14 DXF to NC: type a part number or drop DXFs, press RUN CONVERSION. Turret parts (14443 …) get four AMADA programs (- 1, - 2, - 3 parts, - 4 a full 48" sheet), each .nc + .pdf; other parts get nest_admin 5's laser conversion with its defaults (all clean-ups on, OMIT list refused). Save ALL to a USB drive (Change… picks the drive) or a folder |

Shared code is in `js/` (start with `js/config.js`, which holds every setting and a map of the processes) and the look is in `css/ncdrive.css`.

The nesting follows nest_admin 5: grain (0°/180° or the whole nest at 90°/270°), optional section cuts every 4', and an automatic 4' × 14' sheet for parts longer than 10' (`CONFIG.nest` in `js/config.js`). The STATUS box on the main page (`js/ui-status.js`) also holds the nest_admin controls: add new parts to the current nest without moving placed parts, quantities by zone, pull parts by number from a linked parts folder, the laser rules (never-programmed numbers, fixed materials, DXF-only parts) and the settings lock. The rules and the admin key are in `CONFIG.rules` and `CONFIG.admin` in `js/config.js`.
