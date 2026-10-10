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

Shared code is in `js/` (start with `js/config.js`, which holds every setting and a map of the processes) and the look is in `css/ncdrive.css`.
