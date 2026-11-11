// アプリ本体だけをキャッシュする(写真や記録は IndexedDB、天気は常に通信)
const CACHE = 'closet-v6';
const ASSETS = ['./', 'index.html', 'style.css', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png',
  'js/catalog.js', 'js/recommend.js', 'js/figure.js', 'js/collage.js', 'js/db.js', 'js/photo.js', 'js/weather.js', 'js/samples.js', 'js/app.js',
  'js/ai-prompts.js', 'js/ai-map.js', 'js/ai.js', 'js/ai-worker.js', 'js/ai-core.js', 'js/ai-cache.js', 'js/ai-policy.js', 'js/editor.js', 'data/labels.js',
  'vendor/transformers/transformers.iife.js', 'vendor/transformers/ort-wasm-simd-threaded.asyncify.mjs'];
// 公開版には入れていない(jsDelivr から読む)ので、なくても準備は続ける
const OPTIONAL = ['vendor/transformers/ort-wasm-simd-threaded.asyncify.wasm'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(async (c) => {
    await c.addAll(ASSETS);
    await Promise.all(OPTIONAL.map((u) => c.add(u).catch(() => {})));
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('closet-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 更新がすぐ届くように通信を優先し、圏外のときだけキャッシュを使う
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request)));
});
