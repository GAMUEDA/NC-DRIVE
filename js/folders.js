/* =====================================================================================================
   FOLDERS — folder access in Edge / Chrome (File System Access API), shared by every page
   Remembered folder handles live in the browser's IndexedDB: 'libs' = linked parts folders, 'usb' = target drive,
   'usbs' = every USB stick picked so far (Erase USB lets you choose between them).
   Pages opened from the same folder share them, so a folder linked in one page is linked in all of them.
   ===================================================================================================== */

const FS_OK = typeof window.showDirectoryPicker === 'function';
const FS_MSG = 'Folder access needs Edge or Chrome, with this page opened as a file or from a normal web address.';
const idb = {
  _db: null,
  open() {
    return this._db || (this._db = new Promise((res, rej) => {
      const r = indexedDB.open('ncdrive', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('h');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    }));
  },
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise(res => { const q = db.transaction('h').objectStore('h').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
    } catch (e) { return null; }
  },
  async set(k, v) {
    try {
      const db = await this.open();
      await new Promise((res, rej) => { const t = db.transaction('h', 'readwrite'); t.objectStore('h').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error); });
    } catch (e) {}
  },
};
async function ensurePerm(h, mode) {
  if (!h) return false;
  try {
    if (h.queryPermission && (await h.queryPermission({ mode })) === 'granted') return true;
    if (h.requestPermission) return (await h.requestPermission({ mode })) === 'granted';
    return true;
  } catch (e) { return false; }
}
async function pickFolder(opts) {
  try { return await window.showDirectoryPicker(opts); }
  catch (e) { if (e && e.name === 'AbortError') return null; throw e; }
}

// Write one file (File/Blob or text) into a folder handle, replacing a file of the same name.
async function writeFileTo(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

// The target drive / USB stick (one handle, shared by Copy to Drive and Erase USB).
async function loadTargetDrive() { return idb.get('usb'); }
async function saveTargetDrive(h) { await idb.set('usb', h); NCLink.notify('drive-changed'); }

// Every USB stick picked so far, so Erase USB can offer a choice when more than one is plugged in.
async function sameHandleIndex(list, h) {
  for (let i = 0; i < list.length; i++) { try { if (await list[i].isSameEntry(h)) return i; } catch (e) {} }
  return -1;
}
async function loadUsbDrives() {
  const list = (await idb.get('usbs')) || [], t = await loadTargetDrive();
  if (t && (await sameHandleIndex(list, t)) < 0) list.unshift(t);
  return list;
}
async function saveUsbDrives(list) { await idb.set('usbs', list); }

// Drive names: the browser only gives a folder's own name, so a drive letter can be added by hand (✎ on Erase USB).
function usbLabels() { try { return JSON.parse(ls.get('usbLabels', '{}')); } catch (e) { return {}; } }
function driveLabel(h) {
  if (/^[A-Z]:\\?$/i.test(h.name)) return h.name.toUpperCase().replace(/:$/, ':\\');
  return usbLabels()[h.name] || '…\\' + h.name;
}
