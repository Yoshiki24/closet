// IndexedDB への保存(写真が大きいため localStorage は使わない)
(function (root) {
  const NAME = 'closet-app';
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('items', { keyPath: 'id' }).createIndex('owner', 'owner');
        db.createObjectStore('looks', { keyPath: 'id' }).createIndex('owner', 'owner');
        db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function run(store, mode, fn) {
    return open().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      let result;
      const r = fn(tx.objectStore(store));
      if (r) r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  const DB = {
    byOwner: (store, owner) => run(store, 'readonly', (s) => s.index('owner').getAll(owner)),
    all: (store) => run(store, 'readonly', (s) => s.getAll()),
    put: (store, value) => run(store, 'readwrite', (s) => s.put(value)),
    remove: (store, id) => run(store, 'readwrite', (s) => s.delete(id)),
    getMeta: async (key, fallback) => {
      const row = await run('meta', 'readonly', (s) => s.get(key));
      return row ? row.value : fallback;
    },
    setMeta: (key, value) => run('meta', 'readwrite', (s) => s.put({ key, value })),
  };
  root.DB = DB;
})(window);
