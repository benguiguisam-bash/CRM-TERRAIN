// Stockage local (IndexedDB) : fonctionne hors connexion, sur le téléphone.
const DB_NAME = 'crm-terrain';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('clients')) {
        db.createObjectStore('clients', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('facades')) {
        const s = db.createObjectStore('facades', { keyPath: 'id' });
        s.createIndex('clientId', 'clientId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const clients = {
  all: () => tx('clients', 'readonly', s => reqP(s.getAll())),
  get: id => tx('clients', 'readonly', s => reqP(s.get(id))),
  put: c => tx('clients', 'readwrite', s => reqP(s.put(c))),
  async remove(id) {
    const fs = await facades.byClient(id);
    await tx('facades', 'readwrite', s => { fs.forEach(f => s.delete(f.id)); });
    return tx('clients', 'readwrite', s => reqP(s.delete(id)));
  },
};

export const facades = {
  all: () => tx('facades', 'readonly', s => reqP(s.getAll())),
  get: id => tx('facades', 'readonly', s => reqP(s.get(id))),
  byClient: clientId => tx('facades', 'readonly', s => reqP(s.index('clientId').getAll(clientId))),
  put: f => tx('facades', 'readwrite', s => reqP(s.put(f))),
  remove: id => tx('facades', 'readwrite', s => reqP(s.delete(id))),
};
