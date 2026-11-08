// AIのモデルの保存先(IndexedDB)。Cache API は安全な接続(https・localhost)でしか使えず、
// スマホから http://IPアドレス で開くと使えないため、どの開き方でも使える IndexedDB に保存する
(function (root) {
  const DB_NAME = 'closet-ai-models';
  const STORE = 'files';
  const REQUIRED = ['onnx/vision_model_q4.onnx', 'onnx/model_quantized.onnx'];

  function openDb() {
    return new Promise((resolve, reject) => {
      const q = indexedDB.open(DB_NAME, 1);
      q.onupgradeneeded = () => q.result.createObjectStore(STORE);
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  }

  async function run(mode, fn) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r?.result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      });
    } finally {
      db.close();
    }
  }

  // Transformers.js の env.customCache に渡す(Web の Cache と同じ match / put を持つ)
  const cache = {
    async match(key) {
      const v = await run('readonly', (s) => s.get(String(key)));
      if (!v) return undefined;
      return new Response(v.blob, { headers: { 'content-type': v.type || 'application/octet-stream', 'content-length': String(v.blob.size) } });
    },
    async put(key, response) {
      const blob = await response.blob();
      await run('readwrite', (s) => s.put({ blob, type: response.headers.get('content-type') || '' }, String(key)));
    },
  };

  async function keys() {
    if (typeof indexedDB === 'undefined') return [];
    return (await run('readonly', (s) => s.getAllKeys())) || [];
  }

  async function status() {
    if (typeof indexedDB === 'undefined' || typeof WebAssembly === 'undefined') return 'unsupported';
    const list = await keys();
    return REQUIRED.every((f) => list.some((k) => String(k).endsWith(f))) ? 'ready' : 'none';
  }

  async function sizeMB() {
    let total = 0;
    await run('readonly', (s) => {
      const req = s.openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { total += c.value.blob.size; c.continue(); } };
      return null;
    });
    return Math.round(total / 1e6);
  }

  async function clear() {
    await new Promise((resolve) => { const q = indexedDB.deleteDatabase(DB_NAME); q.onsuccess = q.onerror = q.onblocked = () => resolve(); });
    // 以前の版が Cache API に置いたモデルも消す
    if (typeof caches !== 'undefined') await caches.delete('transformers-cache');
  }

  root.AiCache = { cache, status, sizeMB, clear };
})(typeof self !== 'undefined' ? self : window);
