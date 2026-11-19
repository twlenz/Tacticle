/* Maps imported in the browser (no local server), kept in this browser's IndexedDB so a draft or a
 * play test on them still works after a reload. Every call fails soft: null or [] when storage is unavailable. */
(function (root) {
  'use strict';
  const DB = 'tacticle', STORE = 'maps';
  function open() {
    return new Promise((resolve, reject) => {
      let r;
      try { r = root.indexedDB.open(DB, 1); } catch (e) { reject(e); return; }
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Browser storage is busy'));
    });
  }
  async function tx(mode, fn) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error || new Error('Browser storage refused the map'));
      });
    } finally { db.close(); }
  }
  root.TacticleLocalMaps = {
    /** Throws if the browser will not store it (private window, storage full). */
    async put(map) { await tx('readwrite', (s) => s.put({ id: map.id, name: map.name, saved: Date.now(), map })); },
    async get(id) { try { const r = await tx('readonly', (s) => s.get(String(id))); return r ? r.map : null; } catch (e) { return null; } },
    async list() { try { return ((await tx('readonly', (s) => s.getAll())) || []).map((r) => ({ id: r.id, name: r.name })); } catch (e) { return []; } },
    async remove(id) { try { await tx('readwrite', (s) => s.delete(String(id))); } catch (e) { /* nothing stored */ } },
  };
})(typeof window !== 'undefined' ? window : globalThis);
